// Checks what the server sends to Claude and how it reads the answers, using a stand-in
// for the Anthropic API (no real key or network needed). Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readNotifications, readReceipt, Problem } from '../worker/ai.js';

function fakeApi(reply, status = 200) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    const body = status === 200
      ? { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: reply.stop_reason || 'end_turn', stop_sequence: null, content: reply.content, usage: { input_tokens: 10, output_tokens: 10 } }
      : { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
  };
  return { fetch, calls };
}

const lists = { accounts: ['RHB Bank', 'TnG'], categories: [{ path: 'Food & Drinks > Dining Out', kind: 'expense' }, { path: 'Income > Salary', kind: 'income' }] };
const answer = { results: [{ id: 'n1', kind: 'expense', amount: 12.5, merchant: 'Pelita', account: 'TnG', to_account: null, category: 'Food & Drinks > Dining Out', reason: 'A meal.' }] };

test('notifications: Opus 5.5 with structured output, low effort and server-side fallback', async () => {
  const api = fakeApi({ content: [{ type: 'text', text: JSON.stringify(answer) }] });
  const out = await readNotifications({ ANTHROPIC_API_KEY: 'test', fetch: api.fetch }, { items: [{ id: 'n1', app: 'TnG', text: 'You have paid RM12.50 to PELITA.' }], ...lists });
  assert.deepEqual(out, answer);
  const c = api.calls[0];
  assert.match(c.url, /\/v1\/messages/);
  assert.equal(c.body.model, 'claude-opus-5-5');
  assert.equal(c.body.fallbacks, 'default');
  assert.match(c.headers.get('anthropic-beta') || '', /server-side-fallback-2026-07-01/);
  assert.equal(c.body.output_config.effort, 'low');
  assert.equal(c.body.output_config.format.type, 'json_schema');
  const item = c.body.output_config.format.schema.properties.results.items;
  assert.deepEqual(item.properties.account.anyOf[0].enum, ['RHB Bank', 'TnG']);
  assert.deepEqual(item.properties.id.enum, ['n1']);
  assert.equal(c.body.thinking, undefined);
  assert.match(c.body.messages[0].content[0].text, /<message id="n1" app="TnG">/);
});

test('a cheaper model without fallback support gets a plain request', async () => {
  const api = fakeApi({ content: [{ type: 'text', text: JSON.stringify(answer) }] });
  await readNotifications({ ANTHROPIC_API_KEY: 'test', MODEL: 'claude-haiku-5-5', fetch: api.fetch }, { items: [{ id: 'n1', text: 'x' }], ...lists });
  const c = api.calls[0];
  assert.equal(c.body.model, 'claude-haiku-5-5');
  assert.equal(c.body.fallbacks, undefined);
  assert.equal(c.headers.get('anthropic-beta'), null);
});

test('receipts send the photo and read the answer', async () => {
  const receipt = { is_receipt: true, merchant: "Lotus's", date: '2026-11-27', time: '18:30', total: 90.3, currency: 'MYR', account: null, category: 'Food & Drinks > Dining Out', items: [], notes: '' };
  const api = fakeApi({ content: [{ type: 'text', text: JSON.stringify(receipt) }] });
  const out = await readReceipt({ ANTHROPIC_API_KEY: 'test', fetch: api.fetch }, { image: 'aGVsbG8=', mediaType: 'image/jpeg', ...lists });
  assert.deepEqual(out, { receipt });
  const content = api.calls[0].body.messages[0].content;
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/jpeg');
  assert.deepEqual(api.calls[0].body.output_config.format.schema.properties.category.anyOf[0].enum, ['Food & Drinks > Dining Out']);
});

test('refusals, bad keys and a missing key become plain messages', async () => {
  const refused = fakeApi({ stop_reason: 'refusal', content: [] });
  await assert.rejects(readNotifications({ ANTHROPIC_API_KEY: 'test', fetch: refused.fetch }, { items: [{ id: 'n1', text: 'x' }], ...lists }), (e) => e instanceof Problem && e.status === 422);
  const badKey = fakeApi({}, 401);
  await assert.rejects(readReceipt({ ANTHROPIC_API_KEY: 'wrong', fetch: badKey.fetch }, { image: 'aGVsbG8=', ...lists }), (e) => e instanceof Problem && /API key/.test(e.message));
  await assert.rejects(readReceipt({}, { image: 'aGVsbG8=' }), (e) => e instanceof Problem && e.status === 503);
  await assert.rejects(readNotifications({ ANTHROPIC_API_KEY: 'test' }, { items: [] }), (e) => e instanceof Problem && e.status === 400);
});
