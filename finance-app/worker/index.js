// Belanja server (a Cloudflare Worker).
// 1. Serves the app itself (the files in ../app).
// 2. Keeps the notifications MacroDroid forwards from your phone until the app collects them.
// 3. Asks Claude to read receipt photos and the notifications the app's own rules couldn't.
//
// Secrets (set in Cloudflare, never in this file): APP_KEY, ANTHROPIC_API_KEY.
// Setting: MODEL (in wrangler.jsonc). Default claude-opus-5-5.

import Anthropic from '@anthropic-ai/sdk';
import { DurableObject } from 'cloudflare:workers';

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

class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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

const clip = (s, n) => String(s ?? '').slice(0, n);

/* ---------------- Talking to Claude ---------------- */

const modelOf = (env) => env.MODEL || 'claude-opus-5-5';
// Server-side fallback (another model takes over if this one declines) is on for the models that support it.
const canFallback = (model) => /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);

async function ask(env, { system, content, schema, maxTokens }) {
  if (!env.ANTHROPIC_API_KEY) throw new Problem(503, 'AI is off. Add the ANTHROPIC_API_KEY secret in Cloudflare to turn it on.');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = modelOf(env);
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
  };
  let res;
  try {
    res = canFallback(model)
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Problem(502, 'Anthropic refused the API key. Check the ANTHROPIC_API_KEY secret.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Problem(502, "Your Anthropic account can't use this model. Check billing, or change MODEL.");
    if (e instanceof Anthropic.NotFoundError) throw new Problem(502, `The model "${model}" wasn't found. Check the MODEL setting.`);
    if (e instanceof Anthropic.RateLimitError) throw new Problem(503, 'The AI is busy right now. Try again in a minute.');
    if (e instanceof Anthropic.BadRequestError) throw new Problem(502, `The AI couldn't take this request: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new Problem(502, `The AI service had a problem (${e.status ?? 'no answer'}). Try again.`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new Problem(422, "The AI wouldn't read this one. Fill it in by hand.");
  if (res.stop_reason === 'max_tokens') throw new Problem(502, 'The AI ran out of room on this one. Fill it in by hand.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new Problem(502, "The AI's answer couldn't be read. Try again.");
  }
}

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const pick = (list) => (list.length ? nullable({ type: 'string', enum: list }) : { type: 'null' });

function lists(body) {
  const accounts = (Array.isArray(body.accounts) ? body.accounts : []).map((a) => clip(a, 80)).filter(Boolean).slice(0, 60);
  const categories = (Array.isArray(body.categories) ? body.categories : []).map((c) => ({ path: clip(c.path, 120), kind: c.kind === 'income' ? 'income' : 'expense' })).filter((c) => c.path).slice(0, 200);
  return { accounts, categories };
}

const listText = ({ accounts, categories }) =>
  `Spending categories:\n${categories.filter((c) => c.kind === 'expense').map((c) => `- ${c.path}`).join('\n') || '- (none)'}\n\n` +
  `Income categories:\n${categories.filter((c) => c.kind === 'income').map((c) => `- ${c.path}`).join('\n') || '- (none)'}\n\n` +
  `The user's accounts:\n${accounts.map((a) => `- ${a}`).join('\n') || '- (none)'}`;

const NOTIFY_SYSTEM = `Each item is the text of a phone notification or SMS from a Malaysian bank, card or e-wallet app (for example RHB, CIMB, Maybank, Touch 'n Go eWallet, SETEL, GrabPay, Boost). Decide what money moved, if any.

- kind: "expense" when money was paid out for something; "income" when money came in from someone else, including refunds and cashback; "transfer" when money moved between two of the user's own accounts, including e-wallet reloads and credit card payments; "ignore" for codes, promotions, reminders, statements, failed or declined payments, and anything where no money actually moved.
- amount: the ringgit amount as a number (12.5 for RM12.50), or null.
- merchant: who was paid, or who paid the user, written the way a person would say it ("Nasi Kandar Pelita SS2"), or null.
- account: the user's account the money left, or arrived in for income, chosen from the account list, or null if the message doesn't say.
- to_account: for transfers only, the user's receiving account from the list, or null.
- category: for expenses and income, the best match from the matching category list, or null.
- reason: one short, plain sentence that a non-technical person understands, saying why.

Return exactly one result per item, with the item's id.`;

const RECEIPT_SYSTEM = `You read photos of shop receipts and bills, mostly from Malaysia: supermarkets like Lotus's, Mydin and AEON, mamak and kopitiam bills, petrol stations, pharmacies, pasar stalls and online orders.

- is_receipt: false if the photo isn't a receipt or bill; then use 0 for total and empty values elsewhere.
- merchant: the shop's trading name as a person would say it ("Lotus's Setia Alam"), not the company registration line.
- date as YYYY-MM-DD and time as HH:MM (24-hour), or null when not printed. Malaysian receipts usually print the day first (27/11/2026).
- total: the final amount paid after discounts, rounding and SST, in ringgit as a number.
- currency: the three-letter currency code, usually MYR.
- items: each purchased line with its final price (quantity times unit price, after any line discount). Leave out subtotal, tax, rounding, change, cash tendered and loyalty-point lines. If the lines can't be read, return an empty list.
- category: for the whole receipt and for each item, the best match from the spending categories, or null if nothing fits.
- account: if the receipt shows how it was paid (card's last digits, an e-wallet name, or cash), the matching account from the user's list, or null.
- notes: one short line only if something is unclear (for example "total partly torn"), otherwise an empty string.`;

async function readNotifications(env, body) {
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 20).map((i) => ({ id: clip(i.id, 40), app: clip(i.app, 60), text: clip(i.text, 1200) })).filter((i) => i.id && i.text);
  if (!items.length) throw new Problem(400, 'No messages were sent to read.');
  const l = lists(body);
  const schema = {
    type: 'object', additionalProperties: false, required: ['results'],
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['id', 'kind', 'amount', 'merchant', 'account', 'to_account', 'category', 'reason'],
          properties: {
            id: { type: 'string', enum: items.map((i) => i.id) },
            kind: { type: 'string', enum: ['expense', 'income', 'transfer', 'ignore'] },
            amount: nullable({ type: 'number' }),
            merchant: nullable({ type: 'string' }),
            account: pick(l.accounts),
            to_account: pick(l.accounts),
            category: pick(l.categories.map((c) => c.path)),
            reason: { type: 'string' },
          },
        },
      },
    },
  };
  const text = `${listText(l)}\n\nMessages:\n${items.map((i) => `<message id="${i.id}" app="${i.app.replace(/"/g, "'")}">\n${i.text}\n</message>`).join('\n')}`;
  return ask(env, { system: NOTIFY_SYSTEM, content: [{ type: 'text', text }], schema, maxTokens: 4000 });
}

async function readReceipt(env, body) {
  const image = String(body.image || '');
  const mediaType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(body.mediaType) ? body.mediaType : 'image/jpeg';
  if (!image) throw new Problem(400, 'No photo was sent.');
  if (image.length > 7_000_000) throw new Problem(413, 'That photo is too big. Try again; the app shrinks photos before sending.');
  const l = lists(body);
  const cats = pick(l.categories.filter((c) => c.kind === 'expense').map((c) => c.path));
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['is_receipt', 'merchant', 'date', 'time', 'total', 'currency', 'account', 'category', 'items', 'notes'],
    properties: {
      is_receipt: { type: 'boolean' },
      merchant: { type: 'string' },
      date: nullable({ type: 'string' }),
      time: nullable({ type: 'string' }),
      total: { type: 'number' },
      currency: { type: 'string' },
      account: pick(l.accounts),
      category: cats,
      items: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['name', 'amount', 'category'], properties: { name: { type: 'string' }, amount: { type: 'number' }, category: cats } },
      },
      notes: { type: 'string' },
    },
  };
  const receipt = await ask(env, {
    system: RECEIPT_SYSTEM,
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
      { type: 'text', text: `${listText(l)}\n\nRead this receipt.` },
    ],
    schema,
    maxTokens: 8000,
  });
  return { receipt };
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
