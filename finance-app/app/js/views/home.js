// Belanja: Home. This month at a glance, what needs a tap, accounts, budgets and recent spending.

import * as st from '../store.js';
import { esc, money, longDate, diffDays, addDays, parseISO } from '../util.js';
import { periodFor, periodLabel, totals, balances, netWorth, budgetProgress, childMap, dueDates, nextDates, byCategory, shiftPeriod, sortTx, toBase } from '../calc.js';
import { icon } from '../icons.js';
import { meter } from '../charts.js';
import { app, opts, baseCur } from '../app.js';
import { inboxCount } from '../capture.js';
import { dayGroups } from './parts.js';

function insights(p, txs, accMap, catMap, overall) {
  const out = [];
  const o = opts();
  const today = app.today;
  if (today < p.start || today > p.end) return out;
  const elapsed = diffDays(p.start, today) + 1;
  const total = diffDays(p.start, p.end) + 1;
  const now = totals(txs.filter((t) => t.date >= p.start && t.date <= today), accMap, baseCur());
  if (overall && elapsed >= 5) {
    const projected = Math.round((now.expense / elapsed) * total);
    if (projected > overall.limit) out.push(`At this pace you'll spend about ${money(projected)} this month, ${money(projected - overall.limit)} over your budget.`);
    else out.push(`On track: about ${money(projected)} by the end of the month, inside your ${money(overall.limit)} budget.`);
  }
  // Compare with the same days of last month.
  const prev = shiftPeriod(p, -1, o);
  const prevEnd = addDays(prev.start, elapsed - 1);
  const a = byCategory(txs.filter((t) => t.date >= p.start && t.date <= today), catMap, accMap, 'expense', baseCur()).parents;
  const b = new Map(byCategory(txs.filter((t) => t.date >= prev.start && t.date <= prevEnd), catMap, accMap, 'expense', baseCur()).parents.map((x) => [x.id, x.amount]));
  let best = null;
  for (const c of a) {
    const before = b.get(c.id) || 0;
    const up = c.amount - before;
    if (up >= 5000 && (before === 0 || up / before >= 0.25) && (!best || up > best.up)) best = { name: c.name, up };
  }
  if (best) out.push(`${best.name} is ${money(best.up)} higher than at this point last month.`);
  return out.slice(0, 2);
}

function render() {
  const s = st.S.settings;
  const o = opts();
  const p = periodFor('month', app.today, o);
  const all = st.txs();
  const { acc: accMap, cat: catMap } = st.idx();
  const inP = all.filter((t) => t.date >= p.start && t.date <= p.end);
  const t = totals(inP, accMap, baseCur());
  const kids = childMap(st.S.categories);
  const budgets = st.S.budgets.filter((b) => !b.deleted).map((b) => budgetProgress(b, all, kids, accMap, p, app.today, baseCur()));
  const overall = budgets.find((b) => !b.budget.categoryId);
  const accs = st.accounts();
  const bal = balances(st.accounts(true), all);
  const nw = netWorth(st.accounts(true), bal, baseCur());
  const nInbox = inboxCount();

  let html = '';
  if (app.demo && !s.hideDemoNote) html += `<div class="banner"><span>A demo with example data. What you add stays in this browser only.</span><button type="button" data-act="hideNote">Got it</button></div>`;
  html += `<header class="top"><div class="top-t"><h1>Belanja</h1><div class="sub">${esc(longDate(app.today))}</div></div>
    <div class="top-r"><a class="iconbtn" href="#history" data-act="search" aria-label="Search">${icon('search', 20)}</a></div></header>`;

  const daysLeft = diffDays(app.today, p.end) + 1;
  html += `<section class="hero"><div class="label">Spent ${p.kind === 'month' && o.monthStart === 1 ? 'in ' + esc(periodLabel(p, o).split(' ')[0]) : 'this month'}</div>
    <div class="big num"><small>RM</small>${(t.expense / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>`;
  if (overall) {
    html += `${meter(Math.min(1, overall.pct), 'ok', `${Math.round(overall.pct * 100)}% of budget used`)}
      <div class="rowx num"><span>${Math.round(overall.pct * 100)}% of ${money(overall.limit)}</span><span>${overall.left >= 0 ? `${money(overall.left)} left · ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : `${money(-overall.left)} over budget`}</span></div>`;
  } else {
    html += `<div class="rowx num"><span>Income ${money(t.income)}</span><span>${t.net >= 0 ? 'Left over ' + money(t.net) : 'Short by ' + money(-t.net)}</span></div>`;
  }
  html += `</section>`;

  if (nInbox) html += `<a class="cta" href="#inbox"><span class="ico">${nInbox}</span><span class="meta"><b>${nInbox} payment${nInbox === 1 ? '' : 's'} to check</b><span>Belanja filled in the details. Tap to confirm.</span></span><span class="chev">${icon('next', 18)}</span></a>`;

  // Bills that need a tap, and ones coming up.
  const rules = st.S.recurring.filter((r) => !r.deleted && r.active !== false);
  const due = rules.filter((r) => r.mode === 'remind' && dueDates(r, app.today).length);
  const soon = rules.filter((r) => r.mode === 'remind' && !due.includes(r) && nextDates(r, app.today, 3, 1).length);
  if (due.length || soon.length) {
    const names = [...due, ...soon].map((r) => r.template.title || 'Bill').slice(0, 3).join(', ');
    html += `<a class="cta" href="#bills"><span class="ico">${icon('bell', 18)}</span><span class="meta"><b>${due.length ? `${due.length} bill${due.length === 1 ? '' : 's'} due` : 'Bills coming up'}</b><span>${esc(names)}</span></span><span class="chev">${icon('next', 18)}</span></a>`;
  }
  // Credit cards with a payment date coming up.
  for (const a of accs.filter((x) => x.type === 'credit' && x.dueDay && (bal[x.id] || 0) < 0)) {
    const { y, m } = parseISO(app.today);
    let dueDate = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(28, a.dueDay)).padStart(2, '0')}`;
    if (dueDate < app.today) dueDate = addDays(dueDate, 30);
    const days = diffDays(app.today, dueDate);
    if (days <= 7) html += `<a class="cta" href="#account-${a.id}"><span class="ico">${icon('card', 18)}</span><span class="meta"><b>Pay ${esc(a.name)} ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}</b><span>Balance ${money(-bal[a.id])}</span></span><span class="chev">${icon('next', 18)}</span></a>`;
  }

  const tips = insights(p, all, accMap, catMap, overall);
  if (tips.length) html += `<div class="stack" style="margin-top:12px">${tips.map((x) => `<div class="insight">${icon('spark', 16)}<span>${esc(x)}</span></div>`).join('')}</div>`;

  html += `<h2 class="sec">Accounts <a class="link" href="#accounts">All accounts</a></h2><div class="hscroll">
    <a class="acct" href="#accounts"><div class="n">Net worth</div><div class="v num">${money(nw.net)}</div></a>
    ${accs.map((a) => `<a class="acct" href="#account-${a.id}"><div class="n">${esc(a.name)}</div><div class="v num" style="${(bal[a.id] || 0) < 0 ? 'color:var(--neg)' : ''}">${money(bal[a.id] || 0, { cur: a.currency || baseCur() })}</div></a>`).join('')}
  </div>`;

  const shownBudgets = budgets.filter((b) => b.budget.categoryId).sort((a, b) => b.pct - a.pct).slice(0, 3);
  if (shownBudgets.length) {
    html += `<h2 class="sec">Budgets <a class="link" href="#budgets">All budgets</a></h2><div class="list">${shownBudgets
      .map((b) => {
        const c = catMap.get(b.budget.categoryId);
        return `<a class="budget" href="#budgets" style="color:inherit;text-decoration:none"><div class="top1"><span class="nm"><span class="dot" style="--b:var(--${esc(st.catColor(b.budget.categoryId))})"></span><span>${esc(c ? c.name : 'Category')}</span></span><span class="num">${money(b.spent)} <span class="muted">of ${money(b.limit)}</span></span></div>${meter(b.pct, b.state)}</a>`;
      })
      .join('')}</div>`;
  }

  const recent = all.filter((x) => x.date <= app.today).sort(sortTx);
  html += `<h2 class="sec">Recent <a class="link" href="#history">See all</a></h2>`;
  html += recent.length ? dayGroups(recent.slice(0, 8)) : `<div class="list"><div class="empty">Nothing yet. Tap + to add your first expense.</div></div>`;
  return html;
}

export default {
  render,
  actions: {
    hideNote: () => st.setSettings({ hideDemoNote: true }),
    search: () => { app.historyFilter = { search: true }; location.hash = '#history'; },
  },
};

export { toBase };
