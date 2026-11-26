// Belanja: the money maths. Balances, periods, category totals, budgets,
// repeating transactions and search. No page code here, so it is unit-tested.

import { addDays, addMonths, parseISO, ymd, daysInMonth, weekday, diffDays, MON, MONTH, DOW_FULL, shortDate } from './util.js';

export const live = (arr) => arr.filter((x) => !x.deleted);

/* ---------------- Periods ----------------
   A period is { kind, start, end } with inclusive ISO dates.
   opts.monthStart lets a "month" run from payday to payday (e.g. 25th to 24th). */

export function periodFor(kind, anchor, opts = {}) {
  const monthStart = Math.min(28, Math.max(1, opts.monthStart || 1));
  const weekStart = opts.weekStart ?? 1;
  if (kind === 'day') return { kind, start: anchor, end: anchor };
  if (kind === 'week') {
    const back = (weekday(anchor) - weekStart + 7) % 7;
    const start = addDays(anchor, -back);
    return { kind, start, end: addDays(start, 6) };
  }
  if (kind === 'month') {
    const { y, m, d } = parseISO(anchor);
    let sy = y;
    let sm = m;
    if (d < monthStart) {
      sm -= 1;
      if (sm < 1) { sm = 12; sy -= 1; }
    }
    const start = ymd(sy, sm, monthStart);
    const next = addMonths(start, 1);
    return { kind, start, end: addDays(next, -1) };
  }
  if (kind === 'year') {
    const { y } = parseISO(anchor);
    return { kind, start: `${y}-01-01`, end: `${y}-12-31` };
  }
  if (kind === 'all') return { kind, start: '1900-01-01', end: '2999-12-31' };
  throw new Error('Unknown period ' + kind);
}

export function shiftPeriod(p, dir, opts = {}) {
  if (p.kind === 'custom') {
    const len = diffDays(p.start, p.end) + 1;
    return { kind: 'custom', start: addDays(p.start, dir * len), end: addDays(p.end, dir * len) };
  }
  if (p.kind === 'all') return p;
  const anchor = dir > 0 ? addDays(p.end, 1) : addDays(p.start, -1);
  return periodFor(p.kind, anchor, opts);
}

export function periodLabel(p, opts = {}) {
  const s = parseISO(p.start);
  const e = parseISO(p.end);
  if (p.kind === 'all') return 'All time';
  if (p.kind === 'day') return `${DOW_FULL[weekday(p.start)]}, ${s.d} ${MON[s.m - 1]} ${s.y}`;
  if (p.kind === 'year') return String(s.y);
  if (p.kind === 'month' && (opts.monthStart || 1) === 1) return `${MONTH[s.m - 1]} ${s.y}`;
  if (s.y === e.y) {
    if (s.m === e.m) return `${s.d}–${e.d} ${MON[s.m - 1]} ${s.y}`;
    return `${shortDate(p.start)} – ${shortDate(p.end)} ${e.y}`;
  }
  return `${shortDate(p.start, true)} – ${shortDate(p.end, true)}`;
}

export const periodDays = (p) => diffDays(p.start, p.end) + 1;
export const inPeriod = (date, p) => date >= p.start && date <= p.end;

/* ---------------- Accounts ---------------- */

// Converts an amount in an account's own currency to the main currency.
export function toBase(sen, acc, base = 'MYR') {
  if (!acc || !acc.currency || acc.currency === base) return sen;
  return Math.round(sen * (acc.rate || 1));
}

// Balance of every account (in its own currency), optionally only counting up to a date.
export function balances(accounts, txs, upTo) {
  const b = {};
  for (const a of accounts) b[a.id] = a.opening || 0;
  for (const t of txs) {
    if (t.deleted || (upTo && t.date > upTo)) continue;
    if (t.type === 'e') b[t.accountId] = (b[t.accountId] || 0) - t.amount;
    else if (t.type === 'i') b[t.accountId] = (b[t.accountId] || 0) + t.amount;
    else if (t.type === 't') {
      if (t.accountId) b[t.accountId] = (b[t.accountId] || 0) - t.amount;
      if (t.toAccountId) b[t.toAccountId] = (b[t.toAccountId] || 0) + (t.toAmount ?? t.amount);
    }
  }
  return b;
}

export function netWorth(accounts, bal, base = 'MYR') {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (a.deleted || a.netWorth === false) continue;
    const v = toBase(bal[a.id] || 0, a, base);
    if (v >= 0) assets += v;
    else liabilities += v;
  }
  return { assets, liabilities, net: assets + liabilities };
}

/* ---------------- Category lines ----------------
   A split transaction becomes several lines, one per category. */

export function lines(t) {
  if (t.type === 't') return [];
  if (t.splits && t.splits.length) return t.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount, notes: s.notes || '' }));
  return [{ categoryId: t.categoryId, amount: t.amount }];
}

export function totals(txs, accMap, base = 'MYR') {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.deleted) continue;
    const acc = accMap.get(t.accountId);
    if (t.type === 'e') expense += toBase(t.amount, acc, base);
    else if (t.type === 'i') income += toBase(t.amount, acc, base);
  }
  return { income, expense, net: income - expense };
}

// Totals per parent category (with children inside), biggest first.
export function byCategory(txs, catMap, accMap, kind = 'expense', base = 'MYR') {
  const type = kind === 'income' ? 'i' : 'e';
  const parents = new Map();
  let total = 0;
  for (const t of txs) {
    if (t.deleted || t.type !== type) continue;
    const acc = accMap.get(t.accountId);
    for (const ln of lines(t)) {
      const amt = toBase(ln.amount, acc, base);
      const child = catMap.get(ln.categoryId) || null;
      const parent = child ? (child.parentId ? catMap.get(child.parentId) || child : child) : null;
      const pid = parent ? parent.id : '_none';
      if (!parents.has(pid)) {
        parents.set(pid, { id: pid, name: parent ? parent.name : 'No category', color: parent ? parent.color : null, amount: 0, count: 0, children: new Map() });
      }
      const P = parents.get(pid);
      P.amount += amt;
      P.count += 1;
      const cid = child ? child.id : '_none';
      if (!P.children.has(cid)) P.children.set(cid, { id: cid, name: child ? child.name : 'No category', amount: 0, count: 0 });
      const C = P.children.get(cid);
      C.amount += amt;
      C.count += 1;
      total += amt;
    }
  }
  const list = [...parents.values()]
    .map((p) => ({ ...p, children: [...p.children.values()].sort((a, b) => b.amount - a.amount) }))
    .sort((a, b) => b.amount - a.amount);
  return { total, parents: list };
}

export function byLabel(txs, accMap, base = 'MYR') {
  const m = new Map();
  for (const t of txs) {
    if (t.deleted || t.type === 't' || !t.labels || !t.labels.length) continue;
    const amt = toBase(t.amount, accMap.get(t.accountId), base);
    for (const l of t.labels) {
      if (!m.has(l)) m.set(l, { label: l, expense: 0, income: 0, count: 0 });
      const r = m.get(l);
      if (t.type === 'e') r.expense += amt;
      else r.income += amt;
      r.count += 1;
    }
  }
  return [...m.values()].sort((a, b) => b.expense + b.income - (a.expense + a.income));
}

// Income and expense for each of the n periods that end with `last`.
export function periodSeries(txs, accMap, last, n, opts = {}, base = 'MYR') {
  const periods = [];
  let p = last;
  for (let i = 0; i < n; i++) {
    periods.unshift(p);
    p = shiftPeriod(p, -1, opts);
  }
  const out = periods.map((pp) => ({ p: pp, income: 0, expense: 0 }));
  const first = periods[0].start;
  const end = periods[periods.length - 1].end;
  for (const t of txs) {
    if (t.deleted || t.type === 't' || t.date < first || t.date > end) continue;
    let lo = 0;
    let hi = out.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (out[mid].p.start <= t.date) lo = mid;
      else hi = mid - 1;
    }
    const amt = toBase(t.amount, accMap.get(t.accountId), base);
    if (t.type === 'e') out[lo].expense += amt;
    else out[lo].income += amt;
  }
  return out;
}

// Net worth at the end of each period.
export function netWorthSeries(accounts, txs, periods, base = 'MYR') {
  const sorted = txs.filter((t) => !t.deleted).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const bal = {};
  for (const a of accounts) bal[a.id] = a.opening || 0;
  const out = [];
  let i = 0;
  for (const p of periods) {
    while (i < sorted.length && sorted[i].date <= p.end) {
      const t = sorted[i++];
      if (t.type === 'e') bal[t.accountId] = (bal[t.accountId] || 0) - t.amount;
      else if (t.type === 'i') bal[t.accountId] = (bal[t.accountId] || 0) + t.amount;
      else if (t.type === 't') {
        if (t.accountId) bal[t.accountId] = (bal[t.accountId] || 0) - t.amount;
        if (t.toAccountId) bal[t.toAccountId] = (bal[t.toAccountId] || 0) + (t.toAmount ?? t.amount);
      }
    }
    out.push({ p, ...netWorth(accounts, bal, base) });
  }
  return out;
}

/* ---------------- Budgets ---------------- */

export function childMap(categories) {
  const m = new Map();
  for (const c of categories) {
    if (c.deleted || !c.parentId) continue;
    if (!m.has(c.parentId)) m.set(c.parentId, []);
    m.get(c.parentId).push(c.id);
  }
  return m;
}

// How a monthly budget is doing in period p. Budgets are monthly; a year shows 12x.
export function budgetProgress(budget, txs, kids, accMap, p, today, base = 'MYR') {
  const ids = budget.categoryId ? new Set([budget.categoryId, ...(kids.get(budget.categoryId) || [])]) : null;
  let spent = 0;
  for (const t of txs) {
    if (t.deleted || t.type !== 'e' || t.date < p.start || t.date > p.end) continue;
    const acc = accMap.get(t.accountId);
    for (const ln of lines(t)) if (!ids || ids.has(ln.categoryId)) spent += toBase(ln.amount, acc, base);
  }
  const limit = p.kind === 'year' ? budget.amount * 12 : budget.amount;
  const left = limit - spent;
  const pct = limit > 0 ? spent / limit : 0;
  const total = periodDays(p);
  const daysLeft = today >= p.start && today <= p.end ? diffDays(today, p.end) + 1 : today < p.start ? total : 0;
  const elapsed = total - daysLeft;
  const pace = total > 0 ? elapsed / total : 1;
  const perDay = daysLeft > 0 && left > 0 ? Math.floor(left / daysLeft) : 0;
  const state = pct > 1 ? 'over' : pct >= 0.9 || (pace > 0 && pct > pace + 0.15) ? 'near' : 'ok';
  return { budget, spent, limit, left, pct, daysLeft, perDay, pace, state };
}

/* ---------------- Repeating transactions ----------------
   rule: { freq: daily|weekly|monthly|yearly, interval, startDate, endDate?, count?, doneThrough? } */

export function occurrence(rule, k) {
  const n = (rule.interval || 1) * k;
  if (rule.freq === 'daily') return addDays(rule.startDate, n);
  if (rule.freq === 'weekly') return addDays(rule.startDate, 7 * n);
  if (rule.freq === 'monthly') return addMonths(rule.startDate, n);
  if (rule.freq === 'yearly') return addMonths(rule.startDate, 12 * n);
  throw new Error('Unknown frequency ' + rule.freq);
}

export function occurrencesBetween(rule, from, to, max = 400) {
  const out = [];
  for (let k = 0; k < 20000 && out.length < max; k++) {
    if (rule.count && k >= rule.count) break;
    const d = occurrence(rule, k);
    if (rule.endDate && d > rule.endDate) break;
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

const firstOpen = (rule) => (rule.doneThrough ? addDays(rule.doneThrough, 1) : rule.startDate);

// Dates that have come due and haven't been handled yet.
export function dueDates(rule, today) {
  if (!rule || rule.deleted || rule.active === false) return [];
  return occurrencesBetween(rule, firstOpen(rule), today);
}

export function nextDates(rule, today, days = 31, max = 3) {
  if (!rule || rule.deleted || rule.active === false) return [];
  const from = firstOpen(rule) > today ? firstOpen(rule) : addDays(today, 1);
  return occurrencesBetween(rule, from, addDays(today, days), max);
}

export function ordinal(n) {
  const s = n % 100;
  if (s >= 11 && s <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

export function freqLabel(rule) {
  const n = rule.interval || 1;
  const { m, d } = parseISO(rule.startDate);
  if (rule.freq === 'daily') return n === 1 ? 'Every day' : `Every ${n} days`;
  if (rule.freq === 'weekly') return (n === 1 ? 'Every week' : `Every ${n} weeks`) + ` on ${DOW_FULL[weekday(rule.startDate)]}`;
  if (rule.freq === 'monthly') {
    const day = d >= 29 && d === daysInMonth(parseISO(rule.startDate).y, m) ? 'the last day' : `the ${ordinal(d)}`;
    return (n === 1 ? 'Every month' : `Every ${n} months`) + ` on ${day}`;
  }
  if (rule.freq === 'yearly') return (n === 1 ? 'Every year' : `Every ${n} years`) + ` on ${d} ${MON[m - 1]}`;
  return '';
}

/* ---------------- Search & filters ----------------
   f: { q, types:Set, accountIds:Set, categoryIds:Set, labels:Set, status, min, max } */

export function matchTx(t, f, catMap, accMap) {
  if (t.deleted) return false;
  if (f.types && f.types.size && !f.types.has(t.type)) return false;
  if (f.accountIds && f.accountIds.size && !f.accountIds.has(t.accountId) && !f.accountIds.has(t.toAccountId)) return false;
  if (f.categoryIds && f.categoryIds.size && !lines(t).some((l) => f.categoryIds.has(l.categoryId))) return false;
  if (f.labels && f.labels.size && !(t.labels || []).some((l) => f.labels.has(l))) return false;
  if (f.status && (t.status || 'cleared') !== f.status) return false;
  if (f.min != null && t.amount < f.min) return false;
  if (f.max != null && t.amount > f.max) return false;
  if (f.q) {
    const q = f.q.toLowerCase().trim();
    if (!q) return true;
    const cat = catMap.get(t.categoryId);
    const parent = cat && cat.parentId ? catMap.get(cat.parentId) : null;
    const hay = [
      t.title,
      t.notes,
      (t.labels || []).join(' '),
      cat && cat.name,
      parent && parent.name,
      accMap.get(t.accountId)?.name,
      accMap.get(t.toAccountId)?.name,
      (t.amount / 100).toFixed(2),
      ...(t.splits || []).map((s) => catMap.get(s.categoryId)?.name || ''),
    ]
      .join(' ')
      .toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }
  return true;
}

export const sortTx = (a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.time || '') < (a.time || '') ? -1 : (b.time || '') > (a.time || '') ? 1 : (b.createdAt || 0) - (a.createdAt || 0));
