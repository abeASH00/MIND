// Belanja: getting transactions in without typing.
// Notifications arrive from your own small server (the Cloudflare Worker), from pasting,
// or from Android's Share menu. The rules read them first; the AI only helps with unclear ones.

import * as st from './store.js';
import { parseNotification, findDuplicate, applyAI, receiptDraft } from './smart.js';
import { uid } from './util.js';
import { SAMPLE_RECEIPT } from './seed.js';
import { app } from './app.js';

const server = () => String(st.S.settings.server || '').trim().replace(/\/+$/, '');
export const serverReady = () => !app.demo && !!st.S.settings.appKey;
const ctx = () => ({ accounts: st.S.accounts, categories: st.S.categories, memory: st.S.memory });

async function call(path, init = {}) {
  let res;
  try {
    res = await fetch(server() + path, { ...init, headers: { 'content-type': 'application/json', 'x-belanja-key': st.S.settings.appKey, ...(init.headers || {}) } });
  } catch {
    throw new Error("Couldn't reach your server. Check the internet connection and the server address.");
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401) throw new Error('The server refused the app key. Check it matches the APP_KEY secret.');
  if (!res.ok) throw new Error((body && body.error) || `The server answered with error ${res.status}.`);
  return body || {};
}

export const health = () => call('/api/health');

// Your account and category names, so the AI picks from your own list.
export function aiContext() {
  const accounts = st.accounts().map((a) => a.name);
  const categories = st.categories().filter((c) => c.parentId && !c.archived).map((c) => {
    const p = st.idx().cat.get(c.parentId);
    return { path: `${p ? p.name : ''} > ${c.name}`, kind: c.kind };
  });
  return { accounts, categories };
}

// Reads a notification with the rules and adds it to the inbox. Returns the item, or null if it was already there.
export async function intake(raw, { quiet = false } = {}) {
  const item = {
    id: raw.id || uid(), remoteId: raw.remoteId || null, app: raw.app || '', title: raw.title || '', text: raw.text || '',
    receivedAt: raw.receivedAt || Date.now(), source: raw.source || 'paste', status: 'new',
  };
  const seen = st.S.inbox.some((x) => (item.remoteId && x.remoteId === item.remoteId) || (x.text === item.text && x.title === item.title && Math.abs(x.receivedAt - item.receivedAt) < 120000));
  if (seen) return null;
  readItem(item);
  await st.save('inbox', item, { quiet });
  return item;
}

function readItem(item) {
  item.parsed = parseNotification(item, ctx());
  delete item.dupOf;
  delete item.dupTx;
  if (item.parsed.kind === 'junk') item.status = 'junk';
  else Object.assign(item, findDuplicate(item, st.S.inbox, st.txs()) || {});
  return item;
}

// Example inbox items (and anything saved before the rules existed) get read on start-up.
export async function prepareInbox() {
  const todo = st.S.inbox.filter((i) => !i.parsed).sort((a, b) => a.receivedAt - b.receivedAt);
  for (const it of todo) {
    readItem(it);
    await st.save('inbox', it, { quiet: true });
  }
}

// Asks the AI about messages the rules weren't sure of (only when the AI is switched on).
export async function aiCheck(items) {
  if (!serverReady() || !st.S.settings.useAI) return 0;
  const todo = items.filter((i) => i.status === 'new' && i.parsed && i.parsed.confidence === 'low' && !i.parsed.byAI).slice(0, 10);
  if (!todo.length) return 0;
  const res = await call('/api/ai/notifications', {
    method: 'POST',
    body: JSON.stringify({ items: todo.map((i) => ({ id: i.id, app: i.app, text: [i.title, i.text].filter(Boolean).join(' — ') })), ...aiContext() }),
  });
  const byId = new Map((res.results || []).map((r) => [r.id, r]));
  const changed = [];
  for (const it of todo) {
    const ai = byId.get(it.id);
    if (!ai) continue;
    const parsed = applyAI(it.parsed, ai, ctx());
    changed.push({ ...it, parsed, status: parsed.kind === 'junk' ? 'junk' : it.status });
  }
  if (changed.length) await st.save('inbox', changed);
  return changed.length;
}

let fetching = false;
// Collects notifications your phone forwarded to the server, then clears them there.
export async function fetchRemote() {
  if (!serverReady() || fetching) return 0;
  fetching = true;
  try {
    const res = await call('/api/inbox');
    const items = res.items || [];
    const added = [];
    for (const r of items) {
      const it = await intake({ remoteId: r.id, app: r.app, title: r.title, text: r.text, receivedAt: r.receivedAt, source: 'phone' }, { quiet: true });
      if (it) added.push(it);
    }
    if (items.length) await call('/api/inbox/ack', { method: 'POST', body: JSON.stringify({ ids: items.map((r) => r.id) }) });
    if (added.length) {
      st.emit('inbox');
      try { await aiCheck(added); } catch (e) { console.warn('AI check failed', e); }
    }
    await st.setSettings({ lastFetch: Date.now() }, true);
    return added.length;
  } finally {
    fetching = false;
  }
}

// Reads a receipt photo. The demo answers with an example receipt instead.
export async function readReceipt(blob, base64) {
  if (app.demo) {
    await new Promise((r) => setTimeout(r, 1200));
    return receiptDraft(SAMPLE_RECEIPT, ctx());
  }
  const res = await call('/api/ai/receipt', { method: 'POST', body: JSON.stringify({ image: base64, mediaType: blob.type || 'image/jpeg', ...aiContext() }) });
  if (!res.receipt || res.receipt.is_receipt === false) throw new Error("That photo doesn't look like a receipt. Try again with the whole receipt in view.");
  return receiptDraft(res.receipt, ctx());
}

// Handled messages are kept 30 days (to spot duplicates), then dropped.
export async function tidyInbox() {
  const cut = Date.now() - 30 * 86400000;
  const old = st.S.inbox.filter((i) => i.status !== 'new' && i.receivedAt < cut).map((i) => i.id);
  if (old.length) await st.purge('inbox', old);
}

// Brings in things shared to Belanja from other apps (texts go to the inbox, a photo to the receipt screen).
export async function takeShares() {
  const db = st.storage();
  const out = { texts: 0, image: null };
  if (!db) return out;
  const shares = await db.all('shares');
  for (const s of shares) {
    if (s.file && !out.image) out.image = s.file;
    const text = [s.title, s.text, s.url].filter(Boolean).join(' ').trim();
    if (text && (await intake({ text, app: 'Shared', source: 'share', receivedAt: s.at || Date.now() }, { quiet: true }))) out.texts++;
  }
  if (shares.length) await db.del('shares', shares.map((s) => s.id));
  if (out.texts) st.emit('inbox');
  return out;
}

export const inboxCount = () => st.S.inbox.filter((i) => i.status === 'new').length;
