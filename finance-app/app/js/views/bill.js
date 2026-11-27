// Belanja: one repeating transaction (a bill, salary, loan or subscription).

import * as st from '../store.js';
import { esc, money, addDays, initials } from '../util.js';
import { freqLabel } from '../calc.js';
import { icon } from '../icons.js';
import { keypad, pickCategory, pickAccount, toast, confirmBox, badge } from '../ui.js';
import { app, back } from '../app.js';

let r = null;
let key = '';

function blank() {
  return {
    active: true, mode: 'remind', freq: 'monthly', interval: 1, startDate: app.today, endDate: null, doneThrough: null,
    template: { type: 'e', title: '', amount: 0, accountId: st.accounts()[0]?.id || null, toAccountId: null, categoryId: null, notes: '', labels: [] },
  };
}

function render(arg) {
  if (arg !== key || !r) {
    key = arg;
    const found = st.S.recurring.find((x) => x.id === arg && !x.deleted);
    r = found ? JSON.parse(JSON.stringify(found)) : arg === 'new' ? blank() : null;
  }
  if (!r) return `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>Not found</h1></div></header>`;
  const t = r.template;
  const isNew = key === 'new';
  const c = st.idx().cat.get(t.categoryId);
  const acc = (id, empty) => esc(st.idx().acc.get(id)?.name || empty);
  return `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>${isNew ? 'New repeat' : esc(t.title || 'Repeat')}</h1>${!isNew ? `<div class="sub">${esc(freqLabel(r))}</div>` : ''}</div>
    <div class="top-r">${!isNew ? `<button type="button" class="iconbtn" data-act="del" aria-label="Delete">${icon('trash', 20)}</button>` : ''}</div></header>
    <div class="seg-ctl">${['e', 'i', 't'].map((x) => `<button type="button" class="${t.type === x ? 'on' : ''}" data-act="type" data-v="${x}">${{ e: 'Expense', i: 'Income', t: 'Transfer' }[x]}</button>`).join('')}</div>
    <button type="button" class="amount-btn" data-act="amount"><div class="v num"><small>RM</small>${(t.amount / 100).toFixed(2)}</div><div class="h">Tap to change</div></button>
    <div class="fields">
      <label class="field" for="b-title"><span class="k">Name</span><input id="b-title" value="${esc(t.title)}" placeholder="e.g. Unifi, Rent, PTPTN" autocomplete="off"></label>
      ${t.type !== 't' ? `<button type="button" class="field" data-act="cat"><span class="k">Category</span><span class="v ${c ? '' : 'placeholder'}">${c ? badge(initials(c.name), st.catColor(c.id), 24) : ''}<span>${c ? esc(st.catLabel(c.id, true)) : 'Choose a category'}</span></span><span class="chev">${icon('next', 16)}</span></button>` : ''}
      <button type="button" class="field" data-act="acc"><span class="k">${t.type === 't' ? 'From' : 'Account'}</span><span class="v"><span>${acc(t.accountId, 'Choose an account')}</span></span><span class="chev">${icon('next', 16)}</span></button>
      ${t.type === 't' ? `<button type="button" class="field" data-act="to"><span class="k">To</span><span class="v"><span>${acc(t.toAccountId, 'Choose an account')}</span></span><span class="chev">${icon('next', 16)}</span></button>` : ''}
      <div class="field"><span class="k">Repeats</span><select id="b-freq" aria-label="How often">${['daily', 'weekly', 'monthly', 'yearly'].map((f) => `<option value="${f}" ${r.freq === f ? 'selected' : ''}>${{ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[f]}</option>`).join('')}</select>
        <select id="b-int" aria-label="Every how many" style="flex:0 0 auto;width:auto">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${r.interval === i + 1 ? 'selected' : ''}>${i === 0 ? 'every time' : `every ${i + 1}`}</option>`).join('')}</select></div>
      <label class="field" for="b-start"><span class="k">First date</span><input id="b-start" type="date" value="${esc(r.startDate)}"></label>
      <label class="field" for="b-end"><span class="k">Last date</span><input id="b-end" type="date" value="${esc(r.endDate || '')}"><span class="small muted">optional</span></label>
      <label class="field" for="b-active"><span class="k">Active</span><span class="v"><span class="muted small">Pause to stop it for now</span></span><span class="switch"><input type="checkbox" id="b-active" ${r.active !== false ? 'checked' : ''}><span></span></span></label>
    </div>
    <h2 class="sec">When it comes due</h2>
    <div class="seg-ctl"><button type="button" class="${r.mode === 'remind' ? 'on' : ''}" data-act="mode" data-v="remind">Remind me</button><button type="button" class="${r.mode === 'auto' ? 'on' : ''}" data-act="mode" data-v="auto">Add it by itself</button></div>
    <p class="muted small">${r.mode === 'auto' ? 'Belanja adds it on the day. Good for fixed amounts like rent or a car loan.' : 'It shows under Bills on the day, and you tap Add. Good for bills that change, like TNB.'}</p>
    <div class="row-btns"><button type="button" class="btn primary" data-act="save">Save</button></div>`;
}

function mount(el) {
  if (!r) return;
  el.querySelector('#b-title').addEventListener('input', (e) => { r.template.title = e.target.value; });
  el.querySelector('#b-freq').addEventListener('change', (e) => { r.freq = e.target.value; });
  el.querySelector('#b-int').addEventListener('change', (e) => { r.interval = Number(e.target.value); });
  el.querySelector('#b-start').addEventListener('change', (e) => { r.startDate = e.target.value || app.today; });
  el.querySelector('#b-end').addEventListener('change', (e) => { r.endDate = e.target.value || null; });
  el.querySelector('#b-active').addEventListener('change', (e) => { r.active = e.target.checked; });
}

export default {
  render,
  mount,
  keep: true,
  parent: '#bills',
  actions: {
    type: (b) => { r.template.type = b.dataset.v; r.template.categoryId = null; app.refresh(); },
    mode: (b) => { r.mode = b.dataset.v; app.refresh(); },
    amount: () => keypad({ title: 'Amount each time', value: r.template.amount, onDone: (v) => { r.template.amount = v; app.refresh(); } }),
    cat: async () => {
      const id = await pickCategory({ kind: r.template.type === 'i' ? 'income' : 'expense', current: r.template.categoryId });
      if (id) { r.template.categoryId = id; app.refresh(); }
    },
    acc: async () => {
      const id = await pickAccount({ current: r.template.accountId, exclude: r.template.type === 't' ? r.template.toAccountId : null });
      if (id) { r.template.accountId = id; app.refresh(); }
    },
    to: async () => {
      const id = await pickAccount({ current: r.template.toAccountId, title: 'Money goes to', exclude: r.template.accountId });
      if (id) { r.template.toAccountId = id; app.refresh(); }
    },
    save: async () => {
      const t = r.template;
      if (!t.title.trim()) return toast('Give it a name.');
      if (!(t.amount > 0)) return toast('Type the amount.');
      if (!t.accountId) return toast('Pick an account.');
      if (t.type === 't' && !t.toAccountId) return toast('Pick where the money goes.');
      if (t.type !== 't' && !t.categoryId) return toast('Pick a category.');
      if (r.endDate && r.endDate < r.startDate) return toast('The last date is before the first date.');
      if (key === 'new') r.doneThrough = r.startDate < app.today ? addDays(app.today, -1) : null;
      await st.save('recurring', r);
      if (r.mode === 'auto') await st.runRecurring(app.today);
      toast('Saved');
      key = '';
      back('#bills');
    },
    del: async () => {
      if (!(await confirmBox('Delete this repeat? Transactions it already added stay.', { ok: 'Delete', danger: true }))) return;
      await st.remove('recurring', r.id);
      key = '';
      back('#bills');
    },
  },
};

export { money };
