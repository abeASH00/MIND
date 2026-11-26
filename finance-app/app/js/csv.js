// Belanja: reading and writing CSV files, importing from a Bluecoins export,
// and the full backup format. No page code here, so it is unit-tested.

import { parseAmount, hashStr, uid, senToPlain, pad, daysInMonth, ymd, MON, parseISO } from './util.js';

/* ---------------- CSV text ---------------- */

function countOutsideQuotes(line, ch) {
  let n = 0;
  let q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === ch && !q) n++;
  }
  return n;
}

export function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const nl = text.indexOf('\n');
  const first = nl >= 0 ? text.slice(0, nl) : text;
  const delim = [',', ';', '\t'].map((d) => [d, countOutsideQuotes(first, d)]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => String(f).trim() !== ''));
}

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const toCSV = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

/* ---------------- Column matching ---------------- */

const FIELDS = {
  type: ['type', 'transaction type'],
  date: ['date', 'date time', 'datetime', 'transaction date', 'date/time'],
  time: ['time'],
  title: ['item or payee', 'item', 'payee', 'content', 'title', 'description', 'name', 'merchant'],
  amount: ['amount', 'value'],
  currency: ['currency'],
  rate: ['conversionrate', 'conversion rate', 'exchange rate', 'rate'],
  parent: ['parent category', 'parentcategory', 'category group', 'group'],
  category: ['category', 'subcategory', 'child category'],
  accountType: ['account type', 'accounttype'],
  account: ['account', 'from account', 'wallet'],
  toAccount: ['to account', 'transfer to'],
  notes: ['notes', 'note', 'memo', 'remarks'],
  labels: ['label', 'labels', 'tag', 'tags'],
  status: ['status'],
  split: ['split', 'split id'],
};
export const FIELD_NAMES = {
  type: 'Type', date: 'Date', time: 'Time', title: 'Item or payee', amount: 'Amount', currency: 'Currency',
  rate: 'Conversion rate', parent: 'Parent category', category: 'Category', accountType: 'Account type',
  account: 'Account', toAccount: 'To account', notes: 'Notes', labels: 'Labels', status: 'Status', split: 'Split',
};

export const normHeader = (h) => String(h || '').replace(/^﻿/, '').replace(/^\(\d+\)\s*/, '').trim().toLowerCase().replace(/\s+/g, ' ');

export function guessMapping(headers) {
  const norm = headers.map(normHeader);
  const map = {};
  const used = new Set();
  for (const [field, names] of Object.entries(FIELDS)) {
    const i = norm.findIndex((h, idx) => names.includes(h) && !used.has(idx));
    if (i >= 0) { map[field] = i; used.add(i); }
  }
  return map;
}

/* ---------------- Dates in files ---------------- */

const T = '(?:[ T,]+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*([AaPp]\\.?[Mm]\\.?)?)?';
const RX_NUM = new RegExp('^(\\d{1,4})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{1,4})' + T);
const RX_D_MON_Y = new RegExp('^(\\d{1,2})[\\s\\-]+([A-Za-z]{3,9})[\\s\\-,]+(\\d{2,4})' + T);
const RX_MON_D_Y = new RegExp('^([A-Za-z]{3,9})\\s+(\\d{1,2}),?\\s+(\\d{4})' + T);

const monthNo = (name) => MON.findIndex((m) => m.toLowerCase() === name.slice(0, 3).toLowerCase()) + 1;
const okDate = (y, m, d) => y >= 1900 && y <= 2999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);

function mkTime(h, mi, ap) {
  if (h == null || h === '') return '';
  let H = Number(h);
  if (ap) {
    const pm = /p/i.test(ap);
    if (H === 12) H = pm ? 12 : 0;
    else if (pm) H += 12;
  }
  if (H > 23 || Number(mi) > 59) return null;
  return pad(H) + ':' + pad(Number(mi));
}

export function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?$/.exec(String(s || '').trim());
  return m ? mkTime(m[1], m[2], m[3]) || '' : '';
}

// fmt is only needed for 1/2/2026-style dates: 'MDY' (Bluecoins' default) or 'DMY'.
export function parseDate(s, fmt = 'MDY') {
  s = String(s || '').trim();
  let m = RX_NUM.exec(s);
  let y;
  let mo;
  let d;
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    if (m[1].length === 4) { y = a; mo = b; d = c; }
    else {
      if (fmt === 'DMY') { d = a; mo = b; } else { mo = a; d = b; }
      y = c < 100 ? 2000 + c : c;
    }
  } else if ((m = RX_D_MON_Y.exec(s))) {
    d = Number(m[1]); mo = monthNo(m[2]); y = Number(m[3]);
    if (y < 100) y += 2000;
  } else if ((m = RX_MON_D_Y.exec(s))) {
    mo = monthNo(m[1]); d = Number(m[2]); y = Number(m[3]);
  } else return null;
  if (!okDate(y, mo, d)) return null;
  const time = mkTime(m[4], m[5], m[7]);
  if (time === null) return null;
  return { date: ymd(y, mo, d), time };
}

export function detectDateFormat(values) {
  const sample = values.filter((v) => String(v || '').trim()).slice(0, 800);
  const count = (fmt) => sample.filter((v) => parseDate(v, fmt)).length;
  return count('DMY') > count('MDY') ? 'DMY' : 'MDY';
}

/* ---------------- Values in files ---------------- */

export function parseType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'e' || s.startsWith('exp') || s === 'withdrawal' || s === 'debit') return 'e';
  if (s === 'i' || s.startsWith('inc') || s === 'deposit' || s === 'credit') return 'i';
  if (s === 't' || s.startsWith('trans')) return 't';
  if (s === 'n' || s.includes('new account') || s.includes('opening') || s.includes('starting')) return 'n';
  return '';
}

export function accountTypeFrom(typeText, name) {
  const s = String(typeText || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  if (/credit/.test(s)) return 'credit';
  if (/loan|liabilit|mortgage|debt/.test(s)) return 'loan';
  if (/invest|stock|unit trust|fund/.test(s)) return 'investment';
  if (/saving/.test(s)) return 'savings';
  if (/e-?wallet|electronic|digital/.test(s)) return 'ewallet';
  if (/cash/.test(s)) return 'cash';
  if (/bank|checking|current/.test(s)) return 'bank';
  if (/visa|master ?card|amex|credit/.test(n)) return 'credit';
  if (/\btng\b|touch ?'?n ?'?go|setel|grab ?pay|boost|shopee ?pay|bigpay|\bmae\b/.test(n)) return 'ewallet';
  if (/loan|ptptn/.test(n)) return 'loan';
  if (/\basb\b|tabung|invest|stock/.test(n)) return 'investment';
  if (/wallet|cash|dompet/.test(n)) return 'cash';
  if (/bank|rhb|cimb|maybank|affin|public|hong leong|ambank|bsn|uob|ocbc|hsbc|alliance|agro|muamalat|rakyat/.test(n)) return 'bank';
  return 'other';
}

const splitLabels = (s) => String(s || '').split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
const isNoSplit = (s) => !s || /^(0|no|false|n)$/i.test(s.trim());

/* ---------------- Import ----------------
   Step 1: analyzeImport(text) reads the file and guesses which column is which.
   Step 2: buildImport(...) turns rows into accounts, categories and transactions.
   Nothing is saved here; the app shows a summary first. */

export function analyzeImport(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('This file has no rows to import.');
  const headers = rows[0].map((h) => String(h).trim());
  const mapping = guessMapping(headers);
  const body = rows.slice(1);
  const dateFormat = mapping.date != null ? detectDateFormat(body.map((r) => r[mapping.date])) : 'MDY';
  return { headers, rows: body, mapping, dateFormat };
}

export function buildImport(an, existing, opts = {}) {
  const M = opts.mapping || an.mapping;
  const fmt = opts.dateFormat || an.dateFormat;
  const base = opts.base || 'MYR';
  const now = opts.now || Date.now();
  const batch = opts.batchId || uid();
  if (M.date == null || M.amount == null) throw new Error('The file needs a Date column and an Amount column.');
  const get = (r, f) => (M[f] != null ? String(r[M[f]] ?? '').trim() : '');
  const problems = [];

  const accounts = existing.accounts.filter((a) => !a.deleted);
  const categories = existing.categories.filter((c) => !c.deleted);
  const newAccounts = [];
  const newCategories = [];
  const accByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]));
  const account = (name, typeText) => {
    const nm = name || 'Imported';
    const key = nm.toLowerCase();
    if (accByName.has(key)) return accByName.get(key);
    const a = {
      id: uid(), name: nm, type: accountTypeFrom(typeText, nm), currency: base, rate: 1, opening: 0, color: null,
      netWorth: true, archived: false, order: accounts.length + newAccounts.length, aliases: [], notifApps: [],
      createdAt: now, updatedAt: now, importBatch: batch,
    };
    accByName.set(key, a);
    newAccounts.push(a);
    return a;
  };
  const ck = (kind, parentId, name) => `${kind}|${parentId || ''}|${name.toLowerCase()}`;
  const catIdx = new Map(categories.map((c) => [ck(c.kind, c.parentId, c.name), c]));
  const childByName = new Map();
  for (const c of categories) if (c.parentId) childByName.set(`${c.kind}|${c.name.toLowerCase()}`, c);
  const makeCat = (kind, name, parentId) => {
    const c = { id: uid(), kind, name, parentId: parentId || null, color: null, order: categories.length + newCategories.length, createdAt: now, updatedAt: now, importBatch: batch };
    catIdx.set(ck(kind, parentId, name), c);
    if (parentId) childByName.set(`${kind}|${name.toLowerCase()}`, c);
    newCategories.push(c);
    return c;
  };
  const category = (kind, parentName, childName) => {
    if (!parentName && !childName) return null;
    if (!parentName) {
      const found = childByName.get(`${kind}|${childName.toLowerCase()}`);
      if (found) return found;
      parentName = 'Other';
    }
    if (!childName) childName = parentName;
    const P = catIdx.get(ck(kind, null, parentName)) || makeCat(kind, parentName, null);
    return catIdx.get(ck(kind, P.id, childName)) || makeCat(kind, childName, P.id);
  };

  // 1. Read every row.
  const recs = [];
  an.rows.forEach((r, i) => {
    const rowNo = i + 2;
    const rawDate = get(r, 'date');
    const dt = parseDate(rawDate, fmt);
    if (!dt) { problems.push(`Row ${rowNo}: couldn't read the date "${rawDate}"`); return; }
    const amount = parseAmount(get(r, 'amount'));
    if (isNaN(amount)) { problems.push(`Row ${rowNo}: couldn't read the amount "${get(r, 'amount')}"`); return; }
    const title = get(r, 'title');
    let type = parseType(get(r, 'type'));
    if (!type) type = amount < 0 ? 'e' : 'i';
    if (type !== 't' && /^(starting|opening) balance$|^new account$/i.test(title) && !get(r, 'category')) type = 'n';
    recs.push({
      rowNo, type, date: dt.date, time: parseTime(get(r, 'time')) || dt.time || '', amount, title,
      notes: get(r, 'notes'), account: get(r, 'account'), accountType: get(r, 'accountType'), toAccount: get(r, 'toAccount'),
      parent: get(r, 'parent'), category: get(r, 'category'), labels: splitLabels(get(r, 'labels')),
      status: /pend|uncleared|not cleared/i.test(get(r, 'status')) ? 'pending' : 'cleared',
      split: get(r, 'split'), currency: get(r, 'currency').toUpperCase(), rate: parseFloat(get(r, 'rate')) || null,
    });
  });

  const existingKeys = new Set(existing.transactions.filter((t) => !t.deleted && t.importKey).map((t) => t.importKey));
  const keyOf = (r) => 'b:' + hashStr([r.type, r.date, r.time, Math.abs(r.amount), r.account, r.toAccount, r.title, r.parent, r.category, r.split].join('|'));
  let skipped = 0;
  const txs = [];
  const openings = [];

  const convert = (r) => {
    const abs = Math.abs(r.amount);
    if (r.currency && r.currency !== base && r.rate && r.rate !== 1) {
      return { amount: Math.round(abs * r.rate), fx: { currency: r.currency, amount: abs, rate: r.rate } };
    }
    return { amount: abs };
  };
  const baseTx = (r, key) => ({
    id: uid(), type: r.type, date: r.date, time: r.time, title: r.title, notes: r.notes, labels: r.labels,
    status: r.status, source: 'import', importBatch: batch, importKey: key, createdAt: now, updatedAt: now,
  });

  // 2. Opening balances.
  for (const r of recs.filter((x) => x.type === 'n')) {
    const key = keyOf(r);
    if (existingKeys.has(key)) { skipped++; continue; }
    openings.push({ accountId: account(r.account, r.accountType).id, amount: r.amount, key });
  }

  // 3. Expenses and income, with split rows merged into one transaction.
  const plain = recs.filter((x) => x.type === 'e' || x.type === 'i');
  const groups = new Map();
  for (const r of plain) {
    const k = isNoSplit(r.split)
      ? 'row' + r.rowNo
      : /^(yes|true|y)$/i.test(r.split)
        ? `s|${r.date}|${r.time}|${r.account}|${r.title}`
        : `s|${r.split}|${r.date}|${r.account}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const g of groups.values()) {
    const r = g[0];
    const key = keyOf({ ...r, amount: g.reduce((s, x) => s + Math.abs(x.amount), 0) });
    if (existingKeys.has(key)) { skipped++; continue; }
    const kind = r.type === 'i' ? 'income' : 'expense';
    const t = { ...baseTx(r, key), accountId: account(r.account, r.accountType).id };
    if (g.length === 1) {
      Object.assign(t, convert(r));
      t.categoryId = category(kind, r.parent, r.category)?.id || null;
    } else {
      t.splits = g.map((x) => ({ categoryId: category(kind, x.parent, x.category)?.id || null, amount: convert(x).amount, notes: x.notes || '' }));
      t.amount = t.splits.reduce((s, x) => s + x.amount, 0);
      t.categoryId = t.splits[0].categoryId;
      t.notes = g.map((x) => x.notes).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
    }
    txs.push(t);
  }

  // 4. Transfers. Bluecoins writes a transfer as two rows: money out (negative) and money in.
  const tr = recs.filter((x) => x.type === 't');
  const tg = new Map();
  for (const r of tr) {
    const k = `${r.date}|${r.time}|${Math.abs(r.amount)}`;
    if (!tg.has(k)) tg.set(k, []);
    tg.get(k).push(r);
  }
  let unpaired = 0;
  const pushTransfer = (from, to, r) => {
    const key = keyOf({ ...r, account: from ? from.account : '', toAccount: to ? to.account : '' });
    if (existingKeys.has(key)) { skipped++; return; }
    const src = from || r;
    const t = { ...baseTx(src, key), type: 't', ...convert(src), categoryId: null };
    t.accountId = from ? account(from.account, from.accountType).id : null;
    t.toAccountId = to ? account(to.account, to.accountType).id : null;
    if (to) t.toAmount = convert(to).amount;
    if (!t.title) t.title = (from && to ? '' : 'Transfer');
    txs.push(t);
  };
  for (const g of tg.values()) {
    if (g.every((r) => r.toAccount)) {
      for (const r of g) pushTransfer(r, { ...r, account: r.toAccount, accountType: '' }, r);
      continue;
    }
    const outs = g.filter((r) => r.amount < 0);
    const ins = g.filter((r) => r.amount > 0);
    if (outs.length && ins.length) {
      while (outs.length && ins.length) {
        const o = outs.shift();
        const idx = ins.findIndex((x) => x.account !== o.account);
        const i = ins.splice(idx >= 0 ? idx : 0, 1)[0];
        pushTransfer(o, i, o);
      }
      for (const o of outs) { unpaired++; pushTransfer(o, null, o); }
      for (const i of ins) { unpaired++; pushTransfer(null, i, i); }
    } else {
      for (let k = 0; k + 1 < g.length; k += 2) pushTransfer(g[k], g[k + 1], g[k]);
      if (g.length % 2) {
        const last = g[g.length - 1];
        unpaired++;
        if (last.amount < 0) pushTransfer(last, null, last);
        else pushTransfer(null, last, last);
      }
    }
  }

  txs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const counts = { e: 0, i: 0, t: 0 };
  for (const t of txs) counts[t.type]++;
  return {
    batch, txs, newAccounts, newCategories, openings, skipped, problems, unpaired, counts,
    range: txs.length ? { start: txs[0].date, end: txs[txs.length - 1].date } : null,
  };
}

/* ---------------- Export ---------------- */

export const ACCOUNT_TYPES = {
  bank: 'Bank', cash: 'Cash', credit: 'Credit card', ewallet: 'E-wallet',
  savings: 'Savings', investment: 'Investment', loan: 'Loan', other: 'Other',
};

const bcDate = (t) => {
  const { y, m, d } = parseISO(t.date);
  return `${m}/${d}/${y}${t.time ? ' ' + t.time : ''}`;
};

// The Bluecoins "advanced" import template (14 columns), so data can go back if ever needed.
export function exportBluecoins(data, base = 'MYR') {
  const acc = new Map(data.accounts.map((a) => [a.id, a]));
  const cat = new Map(data.categories.map((c) => [c.id, c]));
  const names = (id) => {
    const c = cat.get(id);
    if (!c) return ['', ''];
    const p = c.parentId ? cat.get(c.parentId) : null;
    return [p ? p.name : c.name, c.name];
  };
  const rows = [[
    '(1)Type', '(2)Date', '(3)Item or Payee', '(4)Amount', '(5)Currency', '(6)ConversionRate', '(7)Parent Category',
    '(8)Category', '(9)Account Type', '(10)Account', '(11)Notes', '(12) Label', '(13) Status', '(14) Split',
  ]];
  let splitNo = 0;
  const txs = data.transactions.filter((t) => !t.deleted).sort((a, b) => (a.date + (a.time || '') < b.date + (b.time || '') ? -1 : 1));
  for (const t of txs) {
    const a = acc.get(t.accountId);
    const common = (amount, account, parentName, catName, notes, split) => [
      t.type, bcDate(t), t.title || '', senToPlain(amount), (account && account.currency) || base, '1',
      parentName, catName, account ? ACCOUNT_TYPES[account.type] || 'Other' : '', account ? account.name : '',
      notes, (t.labels || []).join(','), t.status === 'pending' ? 'Pending' : 'Cleared', split,
    ];
    if (t.type === 't') {
      const to = acc.get(t.toAccountId);
      if (a) rows.push(common(-t.amount, a, '(Transfer)', '(Transfer)', t.notes || '', ''));
      if (to) rows.push(common(t.toAmount ?? t.amount, to, '(Transfer)', '(Transfer)', t.notes || '', ''));
    } else if (t.splits && t.splits.length) {
      splitNo++;
      for (const s of t.splits) rows.push(common(s.amount, a, ...names(s.categoryId), s.notes || t.notes || '', String(splitNo)));
    } else {
      rows.push(common(t.amount, a, ...names(t.categoryId), t.notes || '', ''));
    }
  }
  return toCSV(rows);
}

// A simple spreadsheet of everything, easy to open in Google Sheets or Excel.
export function exportPlain(data) {
  const acc = new Map(data.accounts.map((a) => [a.id, a]));
  const cat = new Map(data.categories.map((c) => [c.id, c]));
  const TYPE = { e: 'Expense', i: 'Income', t: 'Transfer' };
  const rows = [['Date', 'Time', 'Type', 'Title', 'Amount', 'Account', 'To account', 'Parent category', 'Category', 'Labels', 'Notes', 'Status', 'Added by']];
  const txs = data.transactions.filter((t) => !t.deleted).sort((a, b) => (a.date + (a.time || '') < b.date + (b.time || '') ? 1 : -1));
  for (const t of txs) {
    const parts = t.splits && t.splits.length ? t.splits : [{ categoryId: t.categoryId, amount: t.amount, notes: t.notes }];
    for (const s of parts) {
      const c = cat.get(s.categoryId);
      const p = c && c.parentId ? cat.get(c.parentId) : null;
      rows.push([
        t.date, t.time || '', TYPE[t.type], t.title || '', senToPlain(t.type === 'e' ? -s.amount : s.amount),
        acc.get(t.accountId)?.name || '', acc.get(t.toAccountId)?.name || '', p ? p.name : c ? c.name : '', c ? c.name : '',
        (t.labels || []).join(', '), s.notes || t.notes || '', t.status === 'pending' ? 'Pending' : 'Cleared', t.source || 'manual',
      ]);
    }
  }
  return toCSV(rows);
}

export const BACKUP_STORES = ['accounts', 'categories', 'transactions', 'budgets', 'recurring', 'memory'];

export function makeBackup(data, settings) {
  const out = { app: 'belanja', version: 1, exportedAt: new Date().toISOString(), settings: settings || {} };
  for (const s of BACKUP_STORES) out[s] = data[s] || [];
  return JSON.stringify(out);
}

export function readBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error("This isn't a Belanja backup file."); }
  if (!obj || obj.app !== 'belanja' || !Array.isArray(obj.transactions)) throw new Error("This isn't a Belanja backup file.");
  for (const s of BACKUP_STORES) if (!Array.isArray(obj[s])) obj[s] = [];
  return obj;
}
