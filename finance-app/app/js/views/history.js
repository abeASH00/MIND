// Belanja: History. Every transaction by day, with period paging, search and filters.

import * as st from '../store.js';
import { esc, money, parseAmount } from '../util.js';
import { periodFor, shiftPeriod, periodLabel, totals, matchTx, sortTx } from '../calc.js';
import { icon } from '../icons.js';
import { openSheet, pickAccount, pickCategory, pickFrom, keypad } from '../ui.js';
import { app, opts, baseCur } from '../app.js';
import { dayGroups, periodBar, choosePeriodKind, totalsBox } from './parts.js';

let p = null;
let searching = false;
let q = '';
let limit = 150;
const f = { types: new Set(), accountIds: new Set(), categoryIds: new Set(), labels: new Set(), status: '', min: null, max: null };

const TYPE_NAME = { e: 'Expenses', i: 'Income', t: 'Transfers' };

function filtered() {
  const { cat, acc } = st.idx();
  const ff = { ...f, q: searching ? q : '' };
  return st.txs().filter((t) => (searching && q ? true : t.date >= p.start && t.date <= p.end) && matchTx(t, ff, cat, acc)).sort(sortTx);
}

function chips() {
  const out = [];
  for (const t of f.types) out.push(['type', t, TYPE_NAME[t]]);
  for (const id of f.accountIds) out.push(['acc', id, st.accName(id)]);
  for (const id of f.categoryIds) {
    const c = st.idx().cat.get(id);
    if (c && !c.parentId) continue;
    out.push(['cat', id, st.catLabel(id)]);
  }
  for (const id of f.categoryIds) {
    const c = st.idx().cat.get(id);
    if (c && !c.parentId) out.push(['cat', id, c.name]);
  }
  for (const l of f.labels) out.push(['label', l, '#' + l]);
  if (f.status) out.push(['status', f.status, f.status === 'pending' ? 'Pending only' : 'Cleared only']);
  if (f.min != null) out.push(['min', '', `From ${money(f.min)}`]);
  if (f.max != null) out.push(['max', '', `Up to ${money(f.max)}`]);
  return out;
}

function render() {
  if (app.historyFilter) {
    const h = app.historyFilter;
    app.historyFilter = null;
    if (h.search) { searching = true; q = ''; }
    if (h.period) p = h.period;
    if (h.categoryIds || h.accountIds || h.labels) {
      f.types.clear(); f.accountIds.clear(); f.categoryIds.clear(); f.labels.clear(); f.status = ''; f.min = f.max = null;
      for (const id of h.categoryIds || []) f.categoryIds.add(id);
      for (const id of h.accountIds || []) f.accountIds.add(id);
      for (const l of h.labels || []) f.labels.add(l);
    }
  }
  if (!p) p = periodFor('month', app.today, opts());
  const list = filtered();
  const t = totals(list, st.idx().acc, baseCur());
  const active = chips();
  let html = `<header class="top"><div class="top-t"><h1>History</h1><div class="sub">${searching && q ? `${list.length} found` : `${list.length} transaction${list.length === 1 ? '' : 's'}`}</div></div>
    <div class="top-r"><button type="button" class="iconbtn ${searching ? 'on' : ''}" data-act="toggleSearch" aria-label="Search">${icon('search', 20)}</button>
    <button type="button" class="iconbtn ${active.length ? 'on' : ''}" data-act="filter" aria-label="Filter">${icon('filter', 20)}</button></div></header>`;
  if (searching) html += `<div class="searchbar"><input class="input" id="hist-q" type="search" placeholder="Search titles, notes, categories, amounts" value="${esc(q)}" autocomplete="off"></div>`;
  if (!(searching && q)) html += periodBar(periodLabel(p, opts()));
  if (active.length) html += `<div class="filters">${active.map(([k, v, label]) => `<button type="button" class="chip on" data-act="unfilter" data-k="${k}" data-v="${esc(v)}"><span>${esc(label)}</span>${icon('close', 14)}</button>`).join('')}</div>`;
  html += totalsBox(t);
  html += list.length ? dayGroups(list, { limit, moreAct: 'more' }) : `<div class="list"><div class="empty">${searching && q ? 'Nothing matches that search.' : 'No transactions in this period.'}</div></div>`;
  return html;
}

function mount(el) {
  const input = el.querySelector('#hist-q');
  if (input) {
    input.addEventListener('input', () => {
      q = input.value;
      limit = 150;
      const pos = input.selectionStart;
      app.refresh();
      const again = document.getElementById('hist-q');
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    });
    if (!q) input.focus();
  }
}

async function filterSheet() {
  const rows = [
    ['type', 'Type', [...f.types].map((x) => TYPE_NAME[x]).join(', ') || 'All'],
    ['acc', 'Account', [...f.accountIds].map(st.accName).join(', ') || 'All'],
    ['cat', 'Category', [...f.categoryIds].map((id) => st.catLabel(id)).join(', ') || 'All'],
    ['label', 'Label', [...f.labels].map((l) => '#' + l).join(', ') || 'All'],
    ['status', 'Status', f.status ? (f.status === 'pending' ? 'Pending only' : 'Cleared only') : 'All'],
    ['amount', 'Amount', f.min != null || f.max != null ? `${f.min != null ? money(f.min) : 'RM0'} – ${f.max != null ? money(f.max) : 'any'}` : 'Any'],
  ];
  openSheet({
    title: 'Filter',
    body: `<div class="fields">${rows.map(([k, label, v]) => `<button type="button" class="field" data-pick="${k}"><span class="k">${label}</span><span class="v"><span>${esc(v)}</span></span><span class="chev">${icon('next', 16)}</span></button>`).join('')}</div>
      <div class="row-btns"><button type="button" class="btn" data-pick="clear">Clear filters</button><button type="button" class="btn primary" data-pick="done">Done</button></div>`,
    onPick: (k) => { setTimeout(() => editFilter(k), 0); },
  });
}

async function editFilter(k) {
  if (k === 'done') return app.refresh();
  if (k === 'clear') {
    f.types.clear(); f.accountIds.clear(); f.categoryIds.clear(); f.labels.clear(); f.status = ''; f.min = f.max = null;
    return app.refresh();
  }
  if (k === 'type') {
    const v = await pickFrom('Type', [{ value: '', label: 'All' }, { value: 'e', label: 'Expenses' }, { value: 'i', label: 'Income' }, { value: 't', label: 'Transfers' }], [...f.types][0] || '');
    if (v != null) { f.types.clear(); if (v) f.types.add(v); }
  } else if (k === 'acc') {
    const v = await pickAccount({ title: 'Show one account' });
    if (v) { f.accountIds.clear(); f.accountIds.add(v); }
  } else if (k === 'cat') {
    const kind = await pickFrom('Which kind?', [{ value: 'expense', label: 'Expense categories' }, { value: 'income', label: 'Income categories' }], 'expense');
    if (!kind) return filterSheet();
    const v = await pickCategory({ kind, allowParent: true, title: 'Show one category' });
    if (v) {
      f.categoryIds.clear();
      f.categoryIds.add(v);
      for (const c of st.children(v)) f.categoryIds.add(c.id);
    }
  } else if (k === 'label') {
    const labels = [...new Set(st.txs().flatMap((t) => t.labels || []))].sort();
    if (!labels.length) { openSheet({ title: 'Labels', body: '<p class="muted">No labels yet. Add labels to transactions to group them, for example #balikkampung or #work.</p>' }); return; }
    const v = await pickFrom('Show one label', labels.map((l) => ({ value: l, label: '#' + l })));
    if (v) { f.labels.clear(); f.labels.add(v); }
  } else if (k === 'status') {
    const v = await pickFrom('Status', [{ value: '', label: 'All' }, { value: 'cleared', label: 'Cleared only' }, { value: 'pending', label: 'Pending only' }], f.status);
    if (v != null) f.status = v;
  } else if (k === 'amount') {
    await new Promise((res) => keypad({ title: 'Smallest amount (0 for none)', value: f.min || 0, onDone: (v) => { f.min = v || null; res(); } }));
    await new Promise((res) => setTimeout(() => keypad({ title: 'Largest amount (0 for none)', value: f.max || 0, onDone: (v) => { f.max = v || null; res(); } }), 50));
  }
  app.refresh();
  setTimeout(filterSheet, 0);
}

export default {
  render,
  mount,
  actions: {
    prev: () => { p = shiftPeriod(p, -1, opts()); limit = 150; app.refresh(); },
    next: () => { p = shiftPeriod(p, 1, opts()); limit = 150; app.refresh(); },
    period: async () => {
      const kind = await choosePeriodKind(p.kind);
      if (kind) { p = periodFor(kind, p.kind === 'all' ? app.today : p.start > app.today || p.end < app.today ? p.start : app.today, opts()); app.refresh(); }
    },
    toggleSearch: () => { searching = !searching; if (!searching) q = ''; app.refresh(); },
    filter: () => filterSheet(),
    unfilter: (b) => {
      const { k, v } = b.dataset;
      if (k === 'type') f.types.delete(v);
      if (k === 'acc') f.accountIds.delete(v);
      if (k === 'cat') { f.categoryIds.delete(v); for (const c of st.children(v)) f.categoryIds.delete(c.id); }
      if (k === 'label') f.labels.delete(v);
      if (k === 'status') f.status = '';
      if (k === 'min') f.min = null;
      if (k === 'max') f.max = null;
      app.refresh();
    },
    more: () => { limit += 200; app.refresh(); },
  },
};

export { parseAmount };
