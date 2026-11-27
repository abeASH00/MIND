// Belanja server (a Cloudflare Worker).
// 1. Serves the app itself (the files in ../app).
// 2. Keeps the notifications MacroDroid forwards from your phone until the app collects them.
// 3. Asks Claude to read receipt photos and the notifications the app's own rules couldn't.
//
// Secrets (set in Cloudflare, never in this file): APP_KEY, ANTHROPIC_API_KEY.
// Setting: MODEL (in wrangler.jsonc). Default claude-opus-5-5.

import { DurableObject } from 'cloudflare:workers';
import { Problem, modelOf, readNotifications, readReceipt, clip } from './ai.js';

const KEEP_MS = 30 * 86400000;
const MAX_ITEMS = 500;

/* ---------------- Notification store ---------------- */

export class Inbox extends DurableObject {
  async add(item) {
    const recent = await this.ctx.storage.list({ prefix: 'n:', reverse: true, limit: 20 });
    for (const v of recent.values()) {
      if (v.text === item.text && v.title === item.title && Math.abs(v.receivedAt - item.receivedAt) < 120000) return { duplicate: true };
    }
    const id = `n:${String(item.receivedAt).padStart(15, '0')}:${crypto.randomUUID().slice(0, 8)}`;
    await this.ctx.storage.put(id, { ...item, id });
    const all = await this.ctx.storage.list({ prefix: 'n:' });
    if (all.size > MAX_ITEMS) await this.drop([...all.keys()].slice(0, all.size - MAX_ITEMS));
    return { id };
  }

  async list() {
    const all = await this.ctx.storage.list({ prefix: 'n:' });
    const cut = Date.now() - KEEP_MS;
    const old = [...all.entries()].filter(([, v]) => v.receivedAt < cut).map(([k]) => k);
    await this.drop(old);
    return [...all.values()].filter((v) => v.receivedAt >= cut);
  }

  async ack(ids) {
    const keys = (Array.isArray(ids) ? ids : []).filter((k) => typeof k === 'string' && k.startsWith('n:'));
    await this.drop(keys);
    return { removed: keys.length };
  }

  async count() {
    return (await this.ctx.storage.list({ prefix: 'n:' })).size;
  }

  async drop(keys) {
    for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.delete(keys.slice(i, i + 128));
  }
}

/* ---------------- Helpers ---------------- */

const corsHeaders = (req) => ({
  'access-control-allow-origin': req.headers.get('origin') || '*',
  'access-control-allow-headers': 'content-type, x-belanja-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  vary: 'origin',
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function keyOk(req, url, env) {
  const want = env.APP_KEY || '';
  const given = req.headers.get('x-belanja-key') || url.searchParams.get('key') || '';
  if (!want || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

const inbox = (env) => env.INBOX.get(env.INBOX.idFromName('main'));

async function readBody(req) {
  const type = req.headers.get('content-type') || '';
  if (req.method !== 'POST') return {};
  if (type.includes('application/json')) {
    try { return await req.json(); } catch { throw new Problem(400, 'The request body is not valid JSON.'); }
  }
  if (type.includes('multipart/form-data')) return Object.fromEntries(await req.formData());
  const text = await req.text();
  if (!text) return {};
  // Form fields if it looks like a form; otherwise the whole body is the notification text.
  if (type.includes('application/x-www-form-urlencoded')) {
    const p = new URLSearchParams(text);
    if (['text', 'title', 'app'].some((k) => p.has(k))) return Object.fromEntries(p);
  }
  return { text };
}


/* ---------------- Routes ---------------- */

async function api(req, env, url) {
  const path = url.pathname;
  if (!env.APP_KEY) throw new Problem(503, 'Set the APP_KEY secret in Cloudflare first.');
  if (!keyOk(req, url, env)) throw new Problem(401, 'Wrong or missing app key.');

  if (path === '/api/health') {
    return json({ ok: true, ai: !!env.ANTHROPIC_API_KEY, model: modelOf(env), waiting: await inbox(env).count() });
  }
  if (path === '/api/notify' && (req.method === 'POST' || req.method === 'GET')) {
    const body = await readBody(req);
    const q = (k) => url.searchParams.get(k);
    const text = clip(body.text ?? q('text') ?? '', 2000).trim();
    const title = clip(body.title ?? q('title') ?? '', 300).trim();
    if (!text && !title) throw new Problem(400, 'Send the notification in a "text" field.');
    const at = Number(body.time ?? q('time'));
    const receivedAt = at > 1e12 && at < Date.now() + 86400000 ? at : Date.now();
    const r = await inbox(env).add({ app: clip(body.app ?? q('app') ?? '', 100), title, text, receivedAt });
    return json({ ok: true, ...r });
  }
  if (path === '/api/inbox' && req.method === 'GET') return json({ items: await inbox(env).list() });
  if (path === '/api/inbox/ack' && req.method === 'POST') return json(await inbox(env).ack((await readBody(req)).ids));
  if (path === '/api/ai/notifications' && req.method === 'POST') return json(await readNotifications(env, await readBody(req)));
  if (path === '/api/ai/receipt' && req.method === 'POST') return json(await readReceipt(env, await readBody(req)));
  throw new Problem(404, 'No such address.');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) {
      // Shared from another app before the offline helper was ready: just open the inbox.
      if (req.method === 'POST' && url.pathname === '/share') return Response.redirect(new URL('/#inbox', url).href, 303);
      return env.ASSETS.fetch(req);
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
    let res;
    try {
      res = await api(req, env, url);
    } catch (e) {
      if (!(e instanceof Problem)) console.error(e);
      res = json({ error: e instanceof Problem ? e.message : 'Something went wrong on the server.' }, e instanceof Problem ? e.status : 500);
    }
    for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
    return res;
  },
};
