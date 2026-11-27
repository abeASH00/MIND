// Belanja: Calendar. A month grid with what was spent each day.

import * as st from '../store.js';
import { esc, money, moneyShort, parseISO, ymd, daysInMonth, weekday, addDays, addMonths, MONTH, DOW, longDate } from '../util.js';
import { toBase, sortTx } from '../calc.js';
import { icon } from '../icons.js';
import { app, baseCur } from '../app.js';
import { dayGroups, periodBar } from './parts.js';

let month = null; // "YYYY-MM-01"
let sel = null;

function render() {
  if (!month) month = app.today.slice(0, 8) + '01';
  if (!sel) sel = app.today;
  const { y, m } = parseISO(month);
  const ws = st.S.settings.weekStart ?? 1;
  const first = ymd(y, m, 1);
  const lead = (weekday(first) - ws + 7) % 7;
  const start = addDays(first, -lead);
  const cells = Math.ceil((lead + daysInMonth(y, m)) / 7) * 7;
  const end = addDays(start, cells - 1);
  const acc = st.idx().acc;
  const spent = new Map();
  const income = new Set();
  for (const t of st.txs()) {
    if (t.date < start || t.date > end) continue;
    if (t.type === 'e') spent.set(t.date, (spent.get(t.date) || 0) + toBase(t.amount, acc.get(t.accountId), baseCur()));
    if (t.type === 'i') income.add(t.date);
  }
  const monthTotal = [...spent.entries()].filter(([d]) => d.slice(0, 7) === month.slice(0, 7)).reduce((s, [, v]) => s + v, 0);
  let html = `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>Calendar</h1><div class="sub">${money(monthTotal)} spent in ${MONTH[m - 1]}</div></div></header>
    ${periodBar(`${MONTH[m - 1]} ${y}`, { act: 'today' })}
    <div class="cal"><div class="cal-h">${Array.from({ length: 7 }, (_, i) => `<span>${DOW[(i + ws) % 7]}</span>`).join('')}</div><div class="cal-g">`;
  for (let i = 0; i < cells; i++) {
    const d = addDays(start, i);
    const v = spent.get(d) || 0;
    const cls = [d.slice(0, 7) !== month.slice(0, 7) ? 'out' : '', d === app.today ? 'today' : '', d === sel ? 'sel' : ''].join(' ');
    html += `<button type="button" class="cal-d ${cls}" data-act="pick" data-d="${d}" aria-label="${esc(longDate(d))}${v ? ', spent ' + esc(money(v)) : ''}"><span>${Number(d.slice(8))}</span>${v ? `<span class="e num">${esc(moneyShort(v).replace('RM', ''))}</span>` : ''}${income.has(d) ? '<span class="i" aria-hidden="true"></span>' : ''}</button>`;
  }
  html += `</div></div><p class="muted small">Numbers are ringgit spent that day. A blue dot means money came in.</p>`;
  const day = st.txs().filter((t) => t.date === sel).sort(sortTx);
  html += `<h2 class="sec">${esc(longDate(sel))}</h2>${day.length ? dayGroups(day) : `<div class="list"><div class="empty">Nothing on this day. <a href="#add" data-act="addOn">Add something</a></div></div>`}`;
  return html;
}

export default {
  render,
  parent: '#more',
  actions: {
    prev: () => { month = addMonths(month, -1); app.refresh(); },
    next: () => { month = addMonths(month, 1); app.refresh(); },
    today: () => { month = app.today.slice(0, 8) + '01'; sel = app.today; app.refresh(); },
    pick: (b) => { sel = b.dataset.d; if (sel.slice(0, 7) !== month.slice(0, 7)) month = sel.slice(0, 8) + '01'; app.refresh(); },
    addOn: () => { app.prefill = { date: sel }; location.hash = '#add'; },
  },
};
