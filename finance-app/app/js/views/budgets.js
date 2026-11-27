// Belanja: Budgets. A monthly limit overall and per category, with how much is left per day.

import * as st from '../store.js';
import { esc, money, initials } from '../util.js';
import { periodFor, shiftPeriod, periodLabel, budgetProgress, childMap, lines, toBase } from '../calc.js';
import { icon } from '../icons.js';
import { meter } from '../charts.js';
import { keypad, pickCategory, pickFrom, openSheet, toast, badge } from '../ui.js';
import { app, opts, baseCur } from '../app.js';
import { periodBar } from './parts.js';

let p = null;

const stateWord = { ok: ['ok', 'On track'], near: ['warn', 'Close to the limit'], over: ['bad', 'Over'] };

function row(b) {
  const c = st.idx().cat.get(b.budget.categoryId);
  const [cls, word] = stateWord[b.state];
  const live = app.today >= p.start && app.today <= p.end;
  return `<button type="button" class="budget" data-act="edit" data-id="${b.budget.id}">
    <div class="top1"><span class="nm">${badge(initials(c ? c.name : 'All'), b.budget.categoryId ? st.catColor(b.budget.categoryId) : 'c0', 26)}<span>${esc(c ? st.catLabel(c.id, true) : 'Everything')}</span></span><span class="pill ${cls}">${word}</span></div>
    ${meter(b.pct, b.state, `${Math.round(b.pct * 100)}% used`)}
    <div class="sub2 num"><span>${money(b.spent)} of ${money(b.limit)}</span><span>${b.left >= 0 ? `${money(b.left)} left${live && b.perDay ? ` · ${money(b.perDay)} a day` : ''}` : `${money(-b.left)} over`}</span></div>
  </button>`;
}

function render() {
  if (!p) p = periodFor('month', app.today, opts());
  const all = st.txs();
  const kids = childMap(st.S.categories);
  const accMap = st.idx().acc;
  const list = st.S.budgets.filter((b) => !b.deleted).map((b) => budgetProgress(b, all, kids, accMap, p, app.today, baseCur()));
  const overall = list.find((b) => !b.budget.categoryId);
  const cats = list.filter((b) => b.budget.categoryId).sort((a, b) => b.pct - a.pct);
  const covered = new Set();
  for (const b of cats) { covered.add(b.budget.categoryId); for (const k of kids.get(b.budget.categoryId) || []) covered.add(k); }
  let outside = 0;
  for (const t of all) {
    if (t.type !== 'e' || t.date < p.start || t.date > p.end) continue;
    for (const ln of lines(t)) if (!covered.has(ln.categoryId)) outside += toBase(ln.amount, accMap.get(t.accountId), baseCur());
  }
  let html = `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>Budgets</h1><div class="sub">Limits reset every month</div></div>
    <div class="top-r"><button type="button" class="iconbtn" data-act="add" aria-label="Add a budget">${icon('plus', 20)}</button></div></header>${periodBar(periodLabel(p, opts()))}`;
  html += overall ? `<div class="list">${row(overall)}</div>` : `<button type="button" class="cta" data-act="addOverall"><span class="ico">${icon('target', 18)}</span><span class="meta"><b>Set a limit for all spending</b><span>One number for the whole month</span></span><span class="chev">${icon('next', 18)}</span></button>`;
  html += `<h2 class="sec">By category</h2>`;
  html += cats.length ? `<div class="list">${cats.map(row).join('')}</div>` : `<div class="card"><div class="empty" style="padding:10px">No category budgets yet. Tap + to add one, for example Food & Drinks.</div></div>`;
  if (cats.length && outside) html += `<p class="muted small">${money(outside)} spent this month in categories without a budget.</p>`;
  return html;
}

async function addBudget(categoryId) {
  if (categoryId === undefined) {
    const id = await pickCategory({ kind: 'expense', allowParent: true, title: 'Budget for which category?' });
    if (!id) return;
    categoryId = id;
  }
  if (st.S.budgets.some((b) => !b.deleted && (b.categoryId || null) === (categoryId || null))) { toast('That already has a budget. Tap it to change the amount.'); return; }
  keypad({ title: 'Monthly limit', value: 0, onDone: (v) => { if (v > 0) st.save('budgets', { categoryId: categoryId || null, amount: v }).then(() => toast('Budget added')); } });
}

export default {
  render,
  parent: '#more',
  actions: {
    prev: () => { p = shiftPeriod(p, -1, opts()); app.refresh(); },
    next: () => { p = shiftPeriod(p, 1, opts()); app.refresh(); },
    period: () => { p = periodFor('month', app.today, opts()); app.refresh(); },
    add: () => addBudget(),
    addOverall: () => addBudget(null),
    edit: async (b) => {
      const bud = st.S.budgets.find((x) => x.id === b.dataset.id);
      const v = await pickFrom('This budget', [{ value: 'amount', label: 'Change the monthly limit', sub: money(bud.amount) }, { value: 'delete', label: 'Remove this budget' }]);
      if (v === 'amount') keypad({ title: 'Monthly limit', value: bud.amount, onDone: (x) => x > 0 && st.save('budgets', { ...bud, amount: x }) });
      if (v === 'delete') {
        await st.remove('budgets', bud.id);
        toast('Budget removed', { label: 'Undo', run: () => st.save('budgets', { ...bud, deleted: false }) });
      }
    },
  },
};

export { openSheet };
