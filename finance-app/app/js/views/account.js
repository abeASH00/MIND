// Belanja: one account. Balance, this month in and out, every transaction with the running balance,
// and the account's settings.

import * as st from '../store.js';
import { esc, money, parseAmount, nowHM } from '../util.js';
import { balances, periodFor, sortTx } from '../calc.js';
import { ACCOUNT_TYPES } from '../csv.js';
import { icon } from '../icons.js';
import { openSheet, keypad, toast, confirmBox } from '../ui.js';
import { app, go, opts, baseCur } from '../app.js';
import { dayGroups } from './parts.js';

let limit = 150;
let lastId = '';

const owes = (a) => a.type === 'credit' || a.type === 'loan';

function effect(t, id) {
  let v = 0;
  if (t.type === 'e' && t.accountId === id) v -= t.amount;
  if (t.type === 'i' && t.accountId === id) v += t.amount;
  if (t.type === 't') {
    if (t.accountId === id) v -= t.amount;
    if (t.toAccountId === id) v += t.toAmount ?? t.amount;
  }
  return v;
}

function render(id) {
  const a = st.idx().acc.get(id);
  if (!a || a.deleted) return `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>Account not found</h1></div></header>`;
  if (id !== lastId) { limit = 150; lastId = id; }
  const cur = a.currency || baseCur();
  const mine = st.txs().filter((t) => t.accountId === id || t.toAccountId === id);
  const asc = [...mine].sort((x, y) => -sortTx(x, y));
  const running = new Map();
  let b = a.opening || 0;
  for (const t of asc) { b += effect(t, id); running.set(t.id, b); }
  const bal = balances([a], mine)[id] || 0;
  const pending = mine.filter((t) => t.status === 'pending').reduce((s, t) => s + effect(t, id), 0);
  const p = periodFor('month', app.today, opts());
  let inM = 0;
  let outM = 0;
  for (const t of mine) {
    if (t.date < p.start || t.date > p.end) continue;
    const v = effect(t, id);
    if (v > 0) inM += v; else outM -= v;
  }
  let html = `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>${esc(a.name)}</h1><div class="sub">${esc(ACCOUNT_TYPES[a.type] || 'Account')}${a.archived ? ' · archived' : ''}</div></div>
    <div class="top-r"><button type="button" class="iconbtn" data-act="edit" aria-label="Edit account">${icon('edit', 20)}</button></div></header>
    <section class="card"><div class="label">${owes(a) && bal < 0 ? 'You owe' : 'Balance'}</div>
      <div class="num" style="font-family:var(--display);font-size:32px;font-weight:700;${bal < 0 && !owes(a) ? 'color:var(--neg)' : ''}">${money(owes(a) && bal < 0 ? -bal : bal, { cur })}</div>
      ${pending ? `<div class="small muted">Includes ${money(pending, { cur })} still pending</div>` : ''}
      ${a.type === 'credit' && a.creditLimit ? `<div class="small muted">${money(a.creditLimit + bal, { cur })} available of ${money(a.creditLimit, { cur })}${a.dueDay ? ` · payment due on the ${a.dueDay}` : ''}</div>` : ''}
      <div class="nw"><div class="stat"><div class="d">In this month</div><div class="v num">${money(inM, { cur })}</div></div><div class="stat"><div class="d">Out this month</div><div class="v num">${money(outM, { cur })}</div></div></div>
      <div class="row-btns"><button type="button" class="btn" data-act="addTx">${icon('plus', 16)}Add</button><button type="button" class="btn" data-act="transfer">${icon('swap', 16)}Transfer</button><button type="button" class="btn" data-act="setBal">Set balance</button></div>
    </section>
    <h2 class="sec">Transactions</h2>`;
  const list = mine.sort(sortTx);
  html += list.length ? dayGroups(list, { limit, moreAct: 'more', balances: running }) : `<div class="list"><div class="empty">No transactions in this account yet.</div></div>`;
  return html;
}

// The account form, used for new accounts too.
export function editAccount(a) {
  const isNew = !a;
  a = a ? { ...a } : { name: '', type: 'bank', currency: baseCur(), rate: 1, opening: 0, netWorth: true, archived: false, aliases: [], notifApps: [], cardDigits: '', order: st.accounts(true).length };
  const used = !isNew && st.txs().some((t) => t.accountId === a.id || t.toAccountId === a.id);
  openSheet({
    title: isNew ? 'New account' : 'Edit account',
    body: `<div class="stack">
      <label><div class="label">Name</div><input class="input" id="a-name" value="${esc(a.name)}" placeholder="e.g. Maybank" autocomplete="off"></label>
      <label><div class="label">Kind</div><select class="input" id="a-type">${Object.entries(ACCOUNT_TYPES).map(([k, v]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label><div class="label">Starting balance</div><input class="input num" id="a-open" inputmode="decimal" value="${((a.opening || 0) / 100).toFixed(2)}"><div class="small muted">The balance before your first transaction here. If you owe money (credit card, loan), put a minus in front, like -500.</div></label>
      <label><div class="label">Currency</div><input class="input" id="a-cur" maxlength="3" value="${esc(a.currency || baseCur())}" style="text-transform:uppercase" autocomplete="off"></label>
      <label id="a-rate-row" ${!a.currency || a.currency === baseCur() ? 'hidden' : ''}><div class="label">1 unit of this currency in ringgit</div><input class="input num" id="a-rate" inputmode="decimal" value="${a.rate || 1}"></label>
      <div class="card" style="padding:12px"><div class="label">Helps read your notifications</div>
        <label><div class="small muted" style="margin:6px 0 4px">Card's last 4 digits</div><input class="input" id="a-digits" inputmode="numeric" value="${esc(a.cardDigits || '')}" placeholder="1234" autocomplete="off"></label>
        <label><div class="small muted" style="margin:8px 0 4px">Names banks use for it, comma between</div><input class="input" id="a-alias" value="${esc((a.aliases || []).join(', '))}" placeholder="touch n go, tng" autocomplete="off"></label>
        <label><div class="small muted" style="margin:8px 0 4px">Apps whose notifications are about it</div><input class="input" id="a-apps" value="${esc((a.notifApps || []).join(', '))}" placeholder="tng" autocomplete="off"></label></div>
      <div id="a-credit" ${a.type === 'credit' ? '' : 'hidden'} class="stack"><label><div class="label">Credit limit</div><input class="input num" id="a-limit" inputmode="decimal" value="${a.creditLimit ? (a.creditLimit / 100).toFixed(2) : ''}"></label>
        <label><div class="label">Payment due on day</div><select class="input" id="a-due"><option value="">Not set</option>${Array.from({ length: 28 }, (_, i) => `<option ${a.dueDay === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label></div>
      <label class="field card" style="padding:12px"><span class="v"><span>Count in net worth</span></span><span class="switch"><input type="checkbox" id="a-nw" ${a.netWorth !== false ? 'checked' : ''}><span></span></span></label>
      ${!isNew ? `<label class="field card" style="padding:12px"><span class="v"><span>Archive (hide from lists)</span></span><span class="switch"><input type="checkbox" id="a-arch" ${a.archived ? 'checked' : ''}><span></span></span></label>` : ''}
      <div class="row-btns">${!isNew ? `<button type="button" class="btn" data-pick="delete">${used ? 'Delete…' : 'Delete'}</button>` : ''}<button type="button" class="btn primary" data-pick="save">Save</button></div></div>`,
    onMount: (el) => {
      el.querySelector('#a-type').addEventListener('change', (e) => { el.querySelector('#a-credit').hidden = e.target.value !== 'credit'; });
      el.querySelector('#a-cur').addEventListener('input', (e) => { el.querySelector('#a-rate-row').hidden = e.target.value.trim().toUpperCase() === baseCur(); });
    },
    onPick: (v) => {
      const val = (id) => document.getElementById(id)?.value ?? '';
      if (v === 'delete') {
        if (used) {
          toast('This account has transactions. Archive it instead, or delete its transactions first.');
          return true;
        }
        confirmBox(`Delete ${a.name}?`, { ok: 'Delete', danger: true }).then((ok) => ok && st.remove('accounts', a.id).then(() => go('#accounts')));
        return false;
      }
      const name = val('a-name').trim();
      if (!name) { toast('Give the account a name.'); return true; }
      if (st.accounts(true).some((x) => x.id !== a.id && x.name.toLowerCase() === name.toLowerCase())) { toast('You already have an account with that name.'); return true; }
      const opening = parseAmount(val('a-open') || '0');
      if (isNaN(opening)) { toast('The starting balance isn’t a number.'); return true; }
      const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
      const cur = (val('a-cur').trim().toUpperCase() || baseCur()).slice(0, 3);
      Object.assign(a, {
        name, type: val('a-type'), opening, currency: cur, rate: cur === baseCur() ? 1 : parseFloat(val('a-rate')) || 1,
        cardDigits: val('a-digits').replace(/[^0-9, ]/g, ''), aliases: list(val('a-alias')), notifApps: list(val('a-apps')),
        creditLimit: val('a-type') === 'credit' ? Math.max(0, parseAmount(val('a-limit') || '0') || 0) : undefined,
        dueDay: val('a-type') === 'credit' && val('a-due') ? Number(val('a-due')) : undefined,
        netWorth: document.getElementById('a-nw').checked, archived: !isNew && document.getElementById('a-arch').checked,
      });
      st.save('accounts', a).then(() => { toast(isNew ? 'Account added' : 'Saved'); if (isNew) go('#account-' + a.id); });
      return false;
    },
  });
}

export default {
  render,
  parent: '#accounts',
  actions: {
    edit: () => editAccount(st.idx().acc.get(lastId)),
    more: () => { limit += 200; app.refresh(); },
    addTx: () => { app.prefill = { accountId: lastId }; go('#add'); },
    transfer: () => { app.prefill = { type: 't', accountId: lastId }; go('#add-t'); },
    setBal: () => {
      const a = st.idx().acc.get(lastId);
      const bal = balances([a], st.txs())[a.id] || 0;
      keypad({
        title: owes(a) ? `How much do you owe on ${a.name} now?` : `What does ${a.name} show right now?`,
        value: Math.abs(bal),
        onDone: async (v) => {
          const target = owes(a) ? -v : v;
          const diff = target - bal;
          if (!diff) { toast('Already matches.'); return; }
          const [t] = await st.save('transactions', {
            type: 't', amount: Math.abs(diff), accountId: diff < 0 ? a.id : null, toAccountId: diff > 0 ? a.id : null,
            categoryId: null, title: 'Balance adjustment', notes: '', labels: [], date: app.today, time: nowHM(), status: 'cleared', source: 'adjust',
          });
          toast(`Balance set to ${money(target)}`, { label: 'Undo', run: () => st.remove('transactions', t.id) });
        },
      });
    },
  },
};
