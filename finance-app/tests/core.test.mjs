// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, money, moneyShort, addMonths, dayLabel, tidyName } from '../app/js/util.js';
import { periodFor, shiftPeriod, periodLabel, balances, byCategory, budgetProgress, childMap, occurrencesBetween, dueDates, freqLabel, matchTx, netWorth } from '../app/js/calc.js';
import { parseCSV, toCSV, analyzeImport, buildImport, parseDate, exportBluecoins, makeBackup, readBackup } from '../app/js/csv.js';
import { parseNotification, findDuplicate, learn, applyAI } from '../app/js/smart.js';

test('amounts are read and shown in ringgit', () => {
  assert.equal(parseAmount('RM1,234.50'), 123450);
  assert.equal(parseAmount('(8.00)'), -800);
  assert.equal(parseAmount('-12.5'), -1250);
  assert.equal(parseAmount('12,50'), 1250);
  assert.equal(parseAmount('1.005'), 101);
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.equal(money(123450), 'RM1,234.50');
  assert.equal(money(-1250), '−RM12.50');
  assert.equal(money(1250, { sign: '+' }), '+RM12.50');
  assert.equal(moneyShort(1250000), 'RM13K');
  assert.equal(moneyShort(120000), 'RM1.2K');
  assert.equal(moneyShort(85000), 'RM850');
});

test('dates', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(dayLabel('2026-11-27', '2026-11-27'), 'Today');
  assert.equal(dayLabel('2026-11-26', '2026-11-27'), 'Yesterday');
  assert.equal(tidyName('NASI KANDAR PELITA SS2'), 'Nasi Kandar Pelita SS2');
});

test('a month can run from payday to payday', () => {
  const p = periodFor('month', '2026-11-27', { monthStart: 25 });
  assert.deepEqual([p.start, p.end], ['2026-11-25', '2026-12-24']);
  const prev = shiftPeriod(p, -1, { monthStart: 25 });
  assert.deepEqual([prev.start, prev.end], ['2026-10-25', '2026-11-24']);
  assert.equal(periodLabel(periodFor('month', '2026-11-27')), 'November 2026');
  const w = periodFor('week', '2026-11-27', { weekStart: 1 });
  assert.deepEqual([w.start, w.end], ['2026-11-23', '2026-11-29']);
});

const A = [
  { id: 'rhb', name: 'RHB Bank', type: 'bank', opening: 100000, aliases: ['rhb'], notifApps: ['rhb'] },
  { id: 'tng', name: 'TnG', type: 'ewallet', opening: 0, aliases: ['tng', 'touch n go'], notifApps: ['tng'] },
  { id: 'visa', name: 'CIMB Petronas Visa-i', type: 'credit', opening: -5000, aliases: ['visa-i'], notifApps: ['cimb'], cardDigits: '4321' },
  { id: 'setel', name: 'SETEL', type: 'ewallet', opening: 0, aliases: ['setel'], notifApps: ['setel'] },
];
const C = [
  { id: 'food', name: 'Food & Drinks', kind: 'expense', parentId: null },
  { id: 'dining', name: 'Dining Out', kind: 'expense', parentId: 'food', key: 'food.dining' },
  { id: 'grocery', name: 'Grocery', kind: 'expense', parentId: 'food', key: 'food.grocery' },
  { id: 'shop', name: 'Shopping', kind: 'expense', parentId: null },
  { id: 'household', name: 'Household', kind: 'expense', parentId: 'shop', key: 'shop.household' },
  { id: 'trans', name: 'Transportation', kind: 'expense', parentId: null },
  { id: 'fuel', name: 'Fuel', kind: 'expense', parentId: 'trans', key: 'trans.fuel' },
];
const T = [
  { id: 1, type: 'e', date: '2026-11-02', amount: 1250, accountId: 'tng', categoryId: 'dining', title: 'Mamak' },
  { id: 2, type: 't', date: '2026-11-03', amount: 20000, accountId: 'rhb', toAccountId: 'tng' },
  { id: 3, type: 'e', date: '2026-11-04', amount: 9090, accountId: 'visa', splits: [{ categoryId: 'grocery', amount: 6210 }, { categoryId: 'household', amount: 2880 }], categoryId: 'grocery' },
  { id: 4, type: 'i', date: '2026-11-25', amount: 480000, accountId: 'rhb', title: 'Salary' },
  { id: 5, type: 'e', date: '2026-11-05', amount: 999, accountId: 'tng', categoryId: 'dining', deleted: true },
];

test('balances, transfers, splits and net worth', () => {
  const b = balances(A, T);
  assert.equal(b.rhb, 100000 - 20000 + 480000);
  assert.equal(b.tng, 20000 - 1250);
  assert.equal(b.visa, -5000 - 9090);
  const nw = netWorth(A, b);
  assert.equal(nw.liabilities, -14090);
  const r = byCategory(T, new Map(C.map((c) => [c.id, c])), new Map(A.map((a) => [a.id, a])));
  assert.equal(r.total, 1250 + 9090);
  assert.deepEqual(r.parents.map((p) => [p.name, p.amount]), [['Food & Drinks', 7460], ['Shopping', 2880]]);
});

test('budgets count child categories and splits', () => {
  const p = periodFor('month', '2026-11-10');
  const res = budgetProgress({ categoryId: 'food', amount: 10000 }, T, childMap(C), new Map(A.map((a) => [a.id, a])), p, '2026-11-10');
  assert.equal(res.spent, 7460);
  assert.equal(res.left, 2540);
  assert.equal(res.daysLeft, 21);
});

test('repeating transactions', () => {
  const rule = { freq: 'monthly', interval: 1, startDate: '2026-01-31' };
  assert.deepEqual(occurrencesBetween(rule, '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(dueDates({ ...rule, doneThrough: '2026-03-31' }, '2026-05-01'), ['2026-04-30']);
  assert.equal(freqLabel({ freq: 'monthly', interval: 1, startDate: '2026-01-05' }), 'Every month on the 5th');
  assert.equal(freqLabel({ freq: 'weekly', interval: 2, startDate: '2026-11-27' }), 'Every 2 weeks on Friday');
});

test('search finds words in titles, categories and amounts', () => {
  const catMap = new Map(C.map((c) => [c.id, c]));
  const accMap = new Map(A.map((a) => [a.id, a]));
  assert.ok(matchTx(T[0], { q: 'mamak' }, catMap, accMap));
  assert.ok(matchTx(T[0], { q: 'dining tng' }, catMap, accMap));
  assert.ok(matchTx(T[2], { categoryIds: new Set(['household']) }, catMap, accMap));
  assert.ok(!matchTx(T[4], {}, catMap, accMap));
});

const BLUECOINS = `(1)Type,(2)Date,(3)Item or Payee,(4)Amount,(5)Parent Category,(6)Category,(7)Account Type,(8)Account,(9)Notes,(10) Label,(11) Status,(12) Split
Expense,11/25/2026 13:12,Nasi Kandar Pelita,-12.50,Food & Drinks,Dining Out,E-Wallet,TnG,,work,Reconciled,
Income,11/25/2026 09:00,Salary,"4,800.00",Income,Salary,Bank,RHB Bank,,,,
Transfer,11/24/2026 10:00,,-200.00,(Transfer),(Transfer),Bank,RHB Bank,,,,
Transfer,11/24/2026 10:00,,200.00,(Transfer),(Transfer),E-Wallet,TnG,,,,
Expense,11/22/2026 18:30,Lotus's,-62.10,Food & Drinks,Grocery,Credit Card,CIMB Petronas Visa-i,,,,7
Expense,11/22/2026 18:30,Lotus's,-28.80,Shopping,Household,Credit Card,CIMB Petronas Visa-i,,,,7
`;

test('CSV round trip keeps quotes, commas and new lines', () => {
  const rows = [['a', 'b,c', 'say "hi"', 'two\nlines']];
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
  assert.deepEqual(parseCSV('x;y\n1;2'), [['x', 'y'], ['1', '2']]);
});

test('dates in files', () => {
  assert.deepEqual(parseDate('3/31/2016 15:30'), { date: '2016-03-31', time: '15:30' });
  assert.deepEqual(parseDate('26/11/2026', 'DMY'), { date: '2026-11-26', time: '' });
  assert.deepEqual(parseDate('2026-11-26 7:05 PM'), { date: '2026-11-26', time: '19:05' });
  assert.deepEqual(parseDate('26 Nov 2026'), { date: '2026-11-26', time: '' });
  assert.equal(parseDate('13/13/2026'), null);
});

test('Bluecoins import: accounts, categories, transfers, splits, no double import', () => {
  const an = analyzeImport(BLUECOINS);
  const res = buildImport(an, { accounts: [], categories: [], transactions: [] });
  assert.deepEqual(res.counts, { e: 2, i: 1, t: 1 });
  assert.equal(res.problems.length, 0);
  assert.equal(res.unpaired, 0);
  const byName = Object.fromEntries(res.newAccounts.map((a) => [a.name, a]));
  assert.equal(byName['CIMB Petronas Visa-i'].type, 'credit');
  assert.equal(byName.TnG.type, 'ewallet');
  const b = balances(res.newAccounts, res.txs);
  assert.equal(b[byName.TnG.id], 18750);
  assert.equal(b[byName['RHB Bank'].id], 460000);
  assert.equal(b[byName['CIMB Petronas Visa-i'].id], -9090);
  const split = res.txs.find((t) => t.splits);
  assert.equal(split.splits.length, 2);
  const again = buildImport(an, { accounts: res.newAccounts, categories: res.newCategories, transactions: res.txs });
  assert.equal(again.txs.length, 0);
  assert.equal(again.skipped, 4);
  const out = exportBluecoins({ accounts: res.newAccounts, categories: res.newCategories, transactions: res.txs });
  assert.match(out, /^\(1\)Type,\(2\)Date/);
  assert.match(out, /e,11\/22\/2026 18:30,Lotus's,62\.10,MYR,1,Food & Drinks,Grocery/);
});

test('backup reads back', () => {
  const text = makeBackup({ accounts: A, categories: C, transactions: T }, { theme: 'dark' });
  const back = readBackup(text);
  assert.equal(back.transactions.length, T.length);
  assert.throws(() => readBackup('{"hello":1}'));
});

const ctx = { accounts: A, categories: C, memory: [] };
const read = (app, text) => parseNotification({ app, text, receivedAt: 0 }, ctx);

test('notifications: payments, transfers and junk', () => {
  let p = read('TnG eWallet', 'You have paid RM12.50 to NASI KANDAR PELITA SS2.');
  assert.equal(p.kind, 'expense');
  assert.equal(p.amount, 1250);
  assert.equal(p.accountId, 'tng');
  assert.equal(p.categoryId, 'dining');
  assert.equal(p.merchant, 'Nasi Kandar Pelita SS2');
  p = read('SETEL', 'Payment of RM50.00 at Petron Jalan Kuching was successful.');
  assert.deepEqual([p.kind, p.accountId, p.categoryId], ['expense', 'setel', 'fuel']);
  p = read('CIMB OCTO', 'Card ending 4321: RM50.00 charged at SETEL PETRON.');
  assert.equal(p.accountId, 'visa');
  p = read('RHB Mobile', 'You have transferred RM200.00 to TOUCH N GO EWALLET.');
  assert.deepEqual([p.kind, p.accountId, p.toAccountId], ['transfer', 'rhb', 'tng']);
  for (const [app, text] of [
    ['RHB Mobile', 'Your TAC is 482913. Do not share this number.'],
    ['CIMB OCTO', 'Enjoy 0% EPP up to 36 months with your CIMB card. T&C apply.'],
    ['Shopee', '11.11 is back! Grab vouchers up to RM100 off now.'],
    ['CIMB OCTO', 'Your statement is ready. Amount due RM842.30, pay by 15 Dec.'],
    ['Shopee', 'Your parcel is out for delivery.'],
  ]) assert.equal(read(app, text).kind, 'junk', text);
});

test('notifications: duplicates, learning and AI answers', () => {
  const a = { id: 'a', app: 'SETEL', receivedAt: 1000, parsed: read('SETEL', 'Payment of RM50.00 at Petron was successful.') };
  const b = { id: 'b', app: 'CIMB', receivedAt: 61000, parsed: read('CIMB OCTO', 'Card ending 4321: RM50.00 charged at SETEL PETRON.') };
  assert.equal(findDuplicate(b, [a, b], []).dupOf, 'a');
  const m = learn([], 'Kedai Ah Seng', 'grocery', 'tng');
  const p = parseNotification({ app: 'TnG eWallet', text: 'You have paid RM8.00 to KEDAI AH SENG.', receivedAt: 0 }, { ...ctx, memory: [m] });
  assert.equal(p.categoryId, 'grocery');
  assert.ok(p.fromMemory);
  const ai = applyAI(p, { kind: 'expense', amount: 8, merchant: 'Kedai Ah Seng', account: 'TnG', to_account: null, category: 'Shopping > Household', reason: 'Hardware shop.' }, ctx);
  assert.equal(ai.categoryId, 'household');
  assert.equal(applyAI(p, { kind: 'ignore', reason: 'Advert' }, ctx).kind, 'junk');
});
