// Belanja server: the parts that ask Claude to read notifications and receipts.
// Kept apart from index.js so they can be tested without Cloudflare.

import Anthropic from '@anthropic-ai/sdk';

export class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const clip = (s, n) => String(s ?? '').slice(0, n);

/* ---------------- Talking to Claude ---------------- */

export const modelOf = (env) => env.MODEL || 'claude-opus-5-5';
// Server-side fallback (another model takes over if this one declines) is on for the models that support it.
const canFallback = (model) => /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);

export async function ask(env, { system, content, schema, maxTokens }) {
  if (!env.ANTHROPIC_API_KEY) throw new Problem(503, 'AI is off. Add the ANTHROPIC_API_KEY secret in Cloudflare to turn it on.');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(env.fetch ? { fetch: env.fetch } : {}) });
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

export async function readNotifications(env, body) {
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

export async function readReceipt(env, body) {
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
