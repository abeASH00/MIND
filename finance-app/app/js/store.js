// Belanja: the app's data in memory, kept in step with the phone's storage
// (and with the cloud copy, when cloud backup is turned on).

import { openDB, askPersist } from './db.js';
import { uid } from './util.js';
import { dueDates } from './calc.js';
import { learn } from './smart.js';
import { makeSample, defaultCategories, defaultAccounts } from './seed.js';

export const COLLECTIONS = ['accounts', 'categories', 'transactions', 'budgets', 'recurring', 'inbox', 'memory'];
export const SYNCED = ['accounts', 'categories', 'transactions', 'budgets', 'recurring', 'memory'];

export const DEFAULT_SETTINGS = {
  base: 'MYR', monthStart: 1, weekStart: 1, theme: 'system', defaultAccountId: null,
  server: '', appKey: '', autoFetch: true, useAI: true,
  pinHash: '', pinSalt: '', lockAfter: 60,
  cloud: null, cloudSince: {}, onboarded: false, lastBackupAt: 0,
};

export const S = { accounts: [], categories: [], transactions: [], budgets: [], recurring: [], inbox: [], memory: [], settings: { ...DEFAULT_SETTINGS } };

let db = null;
let cloudHook = null;
let maps = null;
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = (what) => { for (const fn of listeners) fn(what); };
export const setCloudHook = (fn) => { cloudHook = fn; };
export const storage = () => db;

export async function load(dbName) {
  db = await openDB(dbName);
  for (const c of COLLECTIONS) S[c] = await db.all(c);
  const kv = await db.get('kv', 'settings');
  S.settings = { ...DEFAULT_SETTINGS, ...(kv ? kv.value : {}) };
  maps = null;
  askPersist();
  return db.persistent;
}

// Quick lookups by id, rebuilt after every change.
export function idx() {
  if (!maps) {
    maps = {
      acc: new Map(S.accounts.map((a) => [a.id, a])),
      cat: new Map(S.categories.map((c) => [c.id, c])),
      tx: new Map(S.transactions.map((t) => [t.id, t])),
    };
  }
  return maps;
}

function upsert(store, obj) {
  const arr = S[store];
  const i = arr.findIndex((x) => x.id === obj.id);
  if (i >= 0) arr[i] = obj;
  else arr.push(obj);
}

// opts.quiet: don't redraw yet. opts.fromCloud: came from another device, don't send it back.
export async function save(store, objs, opts = {}) {
  const list = [].concat(objs).filter(Boolean);
  if (!list.length) return list;
  const now = Date.now();
  for (const o of list) {
    if (!o.id) o.id = uid();
    if (!o.createdAt) o.createdAt = now;
    if (!opts.fromCloud) o.updatedAt = now;
    upsert(store, o);
  }
  maps = null;
  await db.put(store, list);
  if (!opts.fromCloud && cloudHook && SYNCED.includes(store)) cloudHook(store, list.map((o) => o.id));
  if (!opts.quiet) emit(store);
  return list;
}

// Deleting keeps a small marker, so the deletion also reaches your other devices.
export async function remove(store, ids, opts = {}) {
  const set = new Set([].concat(ids));
  const list = S[store].filter((x) => set.has(x.id) && !x.deleted).map((o) => ({ ...o, deleted: true }));
  return save(store, list, opts);
}

// Really deletes (for things that never leave this phone, like old inbox messages).
export async function purge(store, ids) {
  const set = new Set([].concat(ids));
  S[store] = S[store].filter((x) => !set.has(x.id));
  maps = null;
  await db.del(store, [...set]);
  emit(store);
}

export async function setSettings(patch, quiet = false) {
  Object.assign(S.settings, patch);
  await db.put('kv', { id: 'settings', value: S.settings });
  if (!quiet) emit('settings');
}

/* ---------------- Reading ---------------- */

export const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name));
export const accounts = (withArchived = false) => S.accounts.filter((a) => !a.deleted && (withArchived || !a.archived)).sort(byOrder);
export const categories = (kind) => S.categories.filter((c) => !c.deleted && (!kind || c.kind === kind));
export const parents = (kind) => categories(kind).filter((c) => !c.parentId).sort(byOrder);
export const children = (pid) => S.categories.filter((c) => !c.deleted && c.parentId === pid).sort(byOrder);
export const txs = () => S.transactions.filter((t) => !t.deleted);
export const accName = (id) => idx().acc.get(id)?.name || '';

export function catParent(id) {
  const c = idx().cat.get(id);
  if (!c) return null;
  return c.parentId ? idx().cat.get(c.parentId) || c : c;
}
export function catLabel(id, long = false) {
  const c = idx().cat.get(id);
  if (!c) return 'No category';
  const p = c.parentId ? idx().cat.get(c.parentId) : null;
  return long && p ? `${p.name} › ${c.name}` : c.name;
}
export const catColor = (id) => catParent(id)?.color || 'c0';

/* ---------------- Photos (kept on this phone only) ---------------- */

export async function saveAttachment(blob, txId) {
  const a = { id: uid(), txId, blob, type: blob.type, createdAt: Date.now() };
  await db.put('attachments', a);
  return a.id;
}
export const getAttachment = (id) => db.get('attachments', id);
export const deleteAttachment = (id) => db.del('attachments', id);

/* ---------------- Changes waiting to go to the cloud ---------------- */

export const outbox = {
  add: (store, ids) => db.put('outbox', ids.map((id) => ({ id: `${store}/${id}`, store, docId: id, at: Date.now() }))),
  all: () => db.all('outbox'),
  remove: (keys) => db.del('outbox', keys),
};

/* ---------------- Learning shops ---------------- */

export async function remember(merchant, categoryId, accountId) {
  const rec = learn(S.memory, merchant, categoryId, accountId);
  if (rec) await save('memory', rec, { quiet: true });
}

/* ---------------- Repeating transactions ---------------- */

export function txFromRule(rule, date) {
  const t = rule.template;
  return {
    id: uid(), type: t.type, date, time: t.time || '09:00', amount: t.amount, accountId: t.accountId || null,
    toAccountId: t.type === 't' ? t.toAccountId || null : undefined, categoryId: t.type === 't' ? null : t.categoryId || null,
    title: t.title || '', notes: t.notes || '', labels: t.labels || [], status: 'cleared', source: 'recurring', recurringId: rule.id,
  };
}

// Adds every "add automatically" transaction that has come due. Returns how many were added.
export async function runRecurring(today) {
  const made = [];
  for (const r of S.recurring.filter((x) => !x.deleted && x.active !== false && x.mode === 'auto')) {
    const dates = dueDates(r, today);
    if (!dates.length) continue;
    for (const d of dates) made.push(txFromRule(r, d));
    await save('recurring', { ...r, doneThrough: dates[dates.length - 1] }, { quiet: true });
  }
  if (made.length) await save('transactions', made);
  return made.length;
}

// For "remind me" rules: add (or skip) the oldest date that is due.
export async function handleDue(rule, date, add) {
  if (add) await save('transactions', txFromRule(rule, date), { quiet: true });
  await save('recurring', { ...rule, doneThrough: date });
}

/* ---------------- Import ---------------- */

export async function applyImport(res) {
  await save('accounts', res.newAccounts, { quiet: true });
  await save('categories', res.newCategories, { quiet: true });
  const changed = new Map();
  for (const o of res.openings) {
    const a = changed.get(o.accountId) || { ...idx().acc.get(o.accountId) };
    if (!a.id) continue;
    a.opening = (a.opening || 0) + o.amount;
    a.importOpenings = { ...(a.importOpenings || {}), [res.batch]: ((a.importOpenings || {})[res.batch] || 0) + o.amount };
    changed.set(a.id, a);
  }
  await save('accounts', [...changed.values()], { quiet: true });
  for (let i = 0; i < res.txs.length; i += 500) await save('transactions', res.txs.slice(i, i + 500), { quiet: true });
  emit('import');
}

// Takes an import back out, including accounts and categories it created that nothing else uses.
export async function undoImport(batch) {
  const ids = S.transactions.filter((t) => t.importBatch === batch && !t.deleted).map((t) => t.id);
  await remove('transactions', ids, { quiet: true });
  const accs = S.accounts.filter((a) => a.importOpenings && a.importOpenings[batch]).map((a) => {
    const n = { ...a, importOpenings: { ...a.importOpenings } };
    n.opening -= n.importOpenings[batch];
    delete n.importOpenings[batch];
    return n;
  });
  await save('accounts', accs, { quiet: true });
  const used = new Set();
  for (const t of txs()) {
    used.add(t.accountId);
    used.add(t.toAccountId);
    used.add(t.categoryId);
    for (const s of t.splits || []) used.add(s.categoryId);
  }
  const deadAcc = S.accounts.filter((a) => a.importBatch === batch && !a.deleted && !used.has(a.id)).map((a) => a.id);
  const mine = S.categories.filter((c) => c.importBatch === batch && !c.deleted);
  const deadKids = mine.filter((c) => c.parentId && !used.has(c.id)).map((c) => c.id);
  const deadParents = mine
    .filter((c) => !c.parentId && !used.has(c.id) && !S.categories.some((k) => k.parentId === c.id && !k.deleted && !deadKids.includes(k.id)))
    .map((c) => c.id);
  await remove('accounts', deadAcc, { quiet: true });
  await remove('categories', [...deadKids, ...deadParents], { quiet: true });
  emit('import');
  return ids.length;
}

/* ---------------- Starting points ---------------- */

export async function startFresh() {
  if (!categories().length) await save('categories', defaultCategories(), { quiet: true });
  if (!accounts(true).length) await save('accounts', defaultAccounts(), { quiet: true });
  await setSettings({ onboarded: true });
}

export async function loadSample(today) {
  await startFresh();
  const s = makeSample(today, categories(), accounts(true));
  const accs = accounts(true).map((a) => {
    const extra = s.openings[a.name] || 0;
    return { ...a, opening: (a.opening || 0) + extra, sampleOpening: (a.sampleOpening || 0) + extra };
  });
  await save('accounts', accs, { quiet: true });
  await save('transactions', s.transactions, { quiet: true });
  await save('budgets', s.budgets, { quiet: true });
  await save('recurring', s.recurring, { quiet: true });
  await save('inbox', s.inbox, { quiet: true });
  emit('all');
}

export async function clearSample() {
  for (const store of ['transactions', 'budgets', 'recurring']) {
    await remove(store, S[store].filter((x) => x.sample && !x.deleted).map((x) => x.id), { quiet: true });
  }
  await purge('inbox', S.inbox.filter((x) => x.sample).map((x) => x.id));
  const accs = S.accounts.filter((a) => a.sampleOpening).map((a) => ({ ...a, opening: (a.opening || 0) - a.sampleOpening, sampleOpening: 0 }));
  await save('accounts', accs, { quiet: true });
  emit('all');
}

export const hasSample = () => S.transactions.some((t) => t.sample && !t.deleted);

// Everything gone from this phone. The cloud copy, if any, is not touched.
export async function wipeAll() {
  for (const c of [...COLLECTIONS, 'attachments', 'outbox', 'shares']) await db.clear(c);
  for (const c of COLLECTIONS) S[c] = [];
  maps = null;
  await setSettings({ ...DEFAULT_SETTINGS }, true);
  emit('all');
}

// Replaces everything with a backup. The caller saves a safety copy first.
export async function restoreBackup(data) {
  for (const c of ['accounts', 'categories', 'transactions', 'budgets', 'recurring', 'memory']) {
    const old = S[c].filter((x) => !x.deleted).map((x) => x.id);
    const incoming = new Set((data[c] || []).map((x) => x.id));
    await remove(c, old.filter((id) => !incoming.has(id)), { quiet: true });
    await save(c, (data[c] || []).map((x) => ({ ...x })), { quiet: true });
  }
  const keep = { server: S.settings.server, appKey: S.settings.appKey, cloud: S.settings.cloud, pinHash: S.settings.pinHash, pinSalt: S.settings.pinSalt };
  await setSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}), ...keep, onboarded: true }, true);
  emit('all');
}
