// Belanja: Bills & repeats. What's due, what's coming, and every repeating rule.

import * as st from '../store.js';
import { esc, money, dayLabel, initials } from '../util.js';
import { dueDates, nextDates, freqLabel } from '../calc.js';
import { icon } from '../icons.js';
import { toast, badge } from '../ui.js';
import { app } from '../app.js';

const rules = () => st.S.recurring.filter((r) => !r.deleted);

function tBadge(r) {
  const t = r.template;
  if (t.type === 't') return `<span class="badge xf">${icon('swap', 18)}</span>`;
  const c = st.idx().cat.get(t.categoryId);
  return badge(initials(c ? c.name : t.title || '?'), st.catColor(t.categoryId));
}

function render() {
  const all = rules();
  const due = all.filter((r) => r.mode === 'remind' && r.active !== false).map((r) => ({ r, dates: dueDates(r, app.today) })).filter((x) => x.dates.length);
  const coming = [];
  for (const r of all) for (const d of nextDates(r, app.today, 30, 3)) coming.push({ r, d });
  coming.sort((a, b) => (a.d < b.d ? -1 : 1));
  let html = `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>Bills & repeats</h1></div>
    <div class="top-r"><a class="iconbtn" href="#bill-new" aria-label="Add a repeating transaction">${icon('plus', 20)}</a></div></header>`;
  if (due.length) {
    html += `<h2 class="sec">Due now</h2><div class="list">${due
      .map(({ r, dates }) => `<div class="row">${tBadge(r)}<div class="meta"><div class="t">${esc(r.template.title || 'Bill')}</div><div class="s">Due ${esc(dayLabel(dates[0], app.today))}${dates.length > 1 ? ` · ${dates.length - 1} more after this` : ''}</div></div>
        <div style="display:flex;gap:6px;align-items:center"><span class="num" style="font-weight:600">${money(r.template.amount)}</span><button type="button" class="btn ghost" data-act="skip" data-id="${r.id}" data-d="${dates[0]}">Skip</button><button type="button" class="btn primary" data-act="addDue" data-id="${r.id}" data-d="${dates[0]}">Add</button></div></div>`)
      .join('')}</div>`;
  }
  html += `<h2 class="sec">Next 30 days</h2>`;
  html += coming.length
    ? `<div class="list">${coming.slice(0, 20).map(({ r, d }) => `<a class="row" href="#bill-${r.id}">${tBadge(r)}<div class="meta"><div class="t">${esc(r.template.title || 'Repeat')}</div><div class="s">${esc(dayLabel(d, app.today))} · ${r.mode === 'auto' ? 'adds itself' : 'reminds you'}</div></div><div class="a num">${money(r.template.amount)}</div></a>`).join('')}</div>`
    : `<div class="card"><div class="empty" style="padding:10px">Nothing coming up.</div></div>`;
  html += `<h2 class="sec">All repeating</h2>`;
  html += all.length
    ? `<div class="list">${all
        .sort((a, b) => (b.active !== false) - (a.active !== false) || String(a.template.title).localeCompare(String(b.template.title)))
        .map((r) => `<a class="row" href="#bill-${r.id}">${tBadge(r)}<div class="meta"><div class="t">${esc(r.template.title || 'Repeat')}${r.active === false ? '<span class="tagline"><span class="tg">Paused</span></span>' : ''}</div><div class="s">${esc(freqLabel(r))} · ${r.mode === 'auto' ? 'adds itself' : 'reminds you'}</div></div><div class="a num">${money(r.template.amount)}</div></a>`)
        .join('')}</div>`
    : `<div class="card"><div class="empty" style="padding:10px">No repeating transactions. Tap + for rent, loans, Unifi, Netflix and the like.</div></div>`;
  return html;
}

export default {
  render,
  parent: '#more',
  actions: {
    addDue: async (b) => {
      const r = st.S.recurring.find((x) => x.id === b.dataset.id);
      await st.handleDue(r, b.dataset.d, true);
      toast(`Added ${r.template.title || 'it'}`);
    },
    skip: async (b) => {
      const r = st.S.recurring.find((x) => x.id === b.dataset.id);
      await st.handleDue(r, b.dataset.d, false);
      toast('Skipped this one');
    },
  },
};
