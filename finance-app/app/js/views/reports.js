// Belanja: Reports. Spending and income by category, cash flow, net worth and labels.

import * as st from '../store.js';
import { esc, money, MON, diffDays } from '../util.js';
import { periodFor, shiftPeriod, periodLabel, byCategory, byLabel, periodSeries, netWorthSeries, totals } from '../calc.js';
import { icon } from '../icons.js';
import { columns, line, segBar } from '../charts.js';
import { app, go, opts, baseCur } from '../app.js';
import { periodBar, choosePeriodKind } from './parts.js';

let tab = 'spend';
let p = null;
let months = 6;
const open = new Set();

const TABS = [['spend', 'Spending'], ['income', 'Income'], ['flow', 'Cash flow'], ['worth', 'Net worth'], ['labels', 'Labels']];

function inPeriod() {
  return st.txs().filter((t) => t.date >= p.start && t.date <= p.end);
}

function categories(kind) {
  const { acc, cat } = st.idx();
  const r = byCategory(inPeriod(), cat, acc, kind, baseCur());
  if (!r.total) return `<div class="card"><div class="empty">No ${kind === 'income' ? 'income' : 'spending'} in this period.</div></div>`;
  const end = p.end < app.today ? p.end : app.today;
  const days = Math.max(1, diffDays(p.start, end) + 1);
  const top = r.parents.slice(0, 5).map((x) => ({ name: x.name, value: x.amount, color: x.color || 'c0' }));
  const rest = r.parents.slice(5).reduce((s, x) => s + x.amount, 0);
  if (rest > 0) top.push({ name: 'Other', value: rest, color: 'c0' });
  const max = r.parents[0].amount;
  let html = `<div class="stats"><div class="stat"><div class="d">${kind === 'income' ? 'Income' : 'Spent'}</div><div class="v num">${money(r.total)}</div></div>
    <div class="stat"><div class="d">Per day${p.kind === 'all' ? '' : ' so far'}</div><div class="v num">${money(Math.round(r.total / days))}</div></div></div>
    <div class="card" style="margin-top:10px">${segBar(top, r.total)}</div>
    <div class="card rank" style="margin-top:10px">`;
  for (const x of r.parents) {
    const pct = Math.round((x.amount / r.total) * 100);
    const isOpen = open.has(x.id);
    html += `<button type="button" data-act="toggle" data-id="${esc(x.id)}" aria-expanded="${isOpen}"><span class="nm"><span class="dot" style="--b:var(--${esc(x.color || 'c0')})"></span><span>${esc(x.name)}</span></span>
      <span class="vl num">${money(x.amount)}<small>${pct}%</small></span><span class="bar"><i style="width:${((x.amount / max) * 100).toFixed(1)}%;--b:var(--${esc(x.color || 'c0')})"></i></span></button>`;
    if (isOpen) {
      html += `<div class="kids">${x.children.map((c) => `<button type="button" class="kid" data-act="drill" data-id="${esc(c.id)}"><span>${esc(c.name)} <span class="small">(${c.count})</span></span><span class="num">${money(c.amount)}</span></button>`).join('')}
        <button type="button" class="kid" data-act="drill" data-id="${esc(x.id)}" style="color:var(--accent);font-weight:600"><span>See these transactions</span>${icon('next', 14)}</button></div>`;
    }
  }
  return html + '</div>';
}

function flow() {
  const o = opts();
  const last = periodFor('month', app.today, o);
  const s = periodSeries(st.txs(), st.idx().acc, last, months, o, baseCur());
  const labels = s.map((x) => MON[Number(x.p.end.slice(5, 7)) - 1]);
  const titles = s.map((x) => periodLabel(x.p, o));
  const t = s.reduce((a, x) => ({ income: a.income + x.income, expense: a.expense + x.expense }), { income: 0, expense: 0 });
  return `<div class="stats"><div class="stat"><div class="d">In over ${months} months</div><div class="v num">${money(t.income)}</div></div><div class="stat"><div class="d">Out over ${months} months</div><div class="v num">${money(t.expense)}</div></div></div>
    <div class="card" style="margin-top:10px">${columns({ labels, titles, label: 'Income and spending by month', series: [{ name: 'Income', color: 'inc', values: s.map((x) => x.income) }, { name: 'Spent', color: 'exp', values: s.map((x) => x.expense) }] })}</div>
    <div class="card tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Month</th><th>In</th><th>Out</th><th>Left over</th></tr></thead><tbody>${s
      .slice()
      .reverse()
      .map((x, i) => `<tr><td>${esc(titles[titles.length - 1 - i])}</td><td>${money(x.income)}</td><td>${money(x.expense)}</td><td style="${x.income - x.expense < 0 ? 'color:var(--neg)' : ''}">${money(x.income - x.expense)}</td></tr>`)
      .join('')}</tbody></table></div>`;
}

function worth() {
  const o = opts();
  const periods = [];
  let q = periodFor('month', app.today, o);
  for (let i = 0; i < months; i++) { periods.unshift(q); q = shiftPeriod(q, -1, o); }
  const s = netWorthSeries(st.accounts(true), st.txs(), periods, baseCur());
  const now = s[s.length - 1];
  const change = now.net - s[0].net;
  const titles = s.map((x) => `End of ${periodLabel(x.p, o)}`);
  return `<div class="stats"><div class="stat"><div class="d">Net worth now</div><div class="v num">${money(now.net)}</div></div><div class="stat"><div class="d">Change in ${months} months</div><div class="v num" style="${change < 0 ? 'color:var(--neg)' : ''}">${money(change, { sign: change > 0 ? '+' : undefined })}</div></div></div>
    <div class="card" style="margin-top:10px">${line({ labels: s.map((x) => MON[Number(x.p.end.slice(5, 7)) - 1]), titles, values: s.map((x) => x.net), color: 'inc', name: 'Net worth', label: 'Net worth by month' })}</div>
    <div class="card tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Month end</th><th>Have</th><th>Owe</th><th>Net worth</th></tr></thead><tbody>${s
      .slice()
      .reverse()
      .map((x) => `<tr><td>${esc(periodLabel(x.p, o))}</td><td>${money(x.assets)}</td><td>${money(-x.liabilities)}</td><td>${money(x.net)}</td></tr>`)
      .join('')}</tbody></table></div>`;
}

function labels() {
  const r = byLabel(inPeriod(), st.idx().acc, baseCur());
  if (!r.length) return `<div class="card"><div class="empty">No labelled transactions in this period. Add labels like #balikkampung or #work when you save, then see their totals here.</div></div>`;
  const max = Math.max(...r.map((x) => x.expense || x.income));
  return `<div class="card rank">${r
    .map((x) => `<button type="button" data-act="label" data-id="${esc(x.label)}"><span class="nm"><span>#${esc(x.label)}</span><span class="small muted">${x.count}</span></span><span class="vl num">${money(x.expense)}${x.income ? `<small>+${money(x.income)} in</small>` : ''}</span><span class="bar"><i style="width:${(((x.expense || x.income) / max) * 100).toFixed(1)}%;--b:var(--exp)"></i></span></button>`)
    .join('')}</div>`;
}

function render() {
  if (!p) p = periodFor('month', app.today, opts());
  let html = `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>Reports</h1></div></header>
    <div class="seg-ctl" style="margin-bottom:12px;overflow-x:auto">${TABS.map(([k, v]) => `<button type="button" class="${tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${v}</button>`).join('')}</div>`;
  if (tab === 'flow' || tab === 'worth') html += `<div class="seg-ctl" style="margin-bottom:12px">${[6, 12].map((n) => `<button type="button" class="${months === n ? 'on' : ''}" data-act="months" data-v="${n}">Last ${n} months</button>`).join('')}</div>`;
  else html += periodBar(periodLabel(p, opts()));
  if (tab === 'spend') html += categories('expense');
  if (tab === 'income') html += categories('income');
  if (tab === 'flow') html += flow();
  if (tab === 'worth') html += worth();
  if (tab === 'labels') html += labels();
  return html;
}

export default {
  render,
  parent: '#more',
  actions: {
    tab: (b) => { tab = b.dataset.v; app.refresh(); },
    months: (b) => { months = Number(b.dataset.v); app.refresh(); },
    prev: () => { p = shiftPeriod(p, -1, opts()); app.refresh(); },
    next: () => { p = shiftPeriod(p, 1, opts()); app.refresh(); },
    period: async () => {
      const kind = await choosePeriodKind(p.kind);
      if (kind) { p = periodFor(kind, app.today, opts()); app.refresh(); }
    },
    toggle: (b) => { const id = b.dataset.id; if (open.has(id)) open.delete(id); else open.add(id); app.refresh(); },
    drill: (b) => {
      const id = b.dataset.id;
      if (id === '_none') return;
      app.historyFilter = { period: p, categoryIds: [id, ...st.children(id).map((c) => c.id)] };
      go('#history');
    },
    label: (b) => { app.historyFilter = { period: p, labels: [b.dataset.id] }; go('#history'); },
  },
};

export { totals };
