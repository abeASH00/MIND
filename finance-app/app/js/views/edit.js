// Belanja: adding or changing a transaction. Calculator keypad, title suggestions,
// splits across categories, labels, notes, photos, other currencies and repeats.

import * as st from '../store.js';
import { esc, money, nowHM, uid, curSymbol } from '../util.js';
import { icon } from '../icons.js';
import { keypad, pickCategory, pickAccount, pickFrom, openSheet, closeSheet, confirmBox, toast, badge, shrinkImage } from '../ui.js';
import { app, back, baseCur, go } from '../app.js';
import { initials } from '../util.js';

let d = null; // the draft being edited
let orig = null; // the saved transaction, when editing
let key = '';
let touched = {};
let newPhotos = [];
let removed = [];
let sugs = [];
let autoOpened = false;

const TYPE_WORD = { e: 'expense', i: 'income', t: 'transfer' };

function lastAccount(type) {
  const t = st.txs().filter((x) => x.type === type && x.accountId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  return (t && st.idx().acc.get(t.accountId) && !st.idx().acc.get(t.accountId).deleted && t.accountId) || st.S.settings.defaultAccountId || st.accounts()[0]?.id || null;
}

function fresh(type = 'e') {
  return {
    type, amount: 0, title: '', notes: '', labels: [], date: app.today, time: nowHM(), status: 'cleared',
    accountId: lastAccount(type === 't' ? 't' : type), toAccountId: null, toAmount: null, categoryId: null,
    splits: null, fx: null, attachmentIds: [], repeat: null,
  };
}

function init(name, arg) {
  key = `${name}-${arg}`;
  touched = {};
  newPhotos.forEach((p) => URL.revokeObjectURL(p.url));
  newPhotos = [];
  removed = [];
  sugs = [];
  autoOpened = false;
  if (name === 'tx') {
    orig = st.idx().tx.get(arg) || null;
    d = orig ? JSON.parse(JSON.stringify(orig)) : null;
    if (d) touched = { category: true, account: true };
    return;
  }
  orig = null;
  d = fresh(['e', 'i', 't'].includes(arg) ? arg : 'e');
  if (app.prefill) {
    const pf = app.prefill;
    app.prefill = null;
    if (pf.photo) {
      newPhotos.push({ blob: pf.photo, url: URL.createObjectURL(pf.photo) });
      delete pf.photo;
    }
    Object.assign(d, pf);
    if (pf.categoryId) touched.category = true;
    if (pf.accountId) touched.account = true;
  }
}

function catField() {
  if (d.splits) return '';
  const c = st.idx().cat.get(d.categoryId);
  return `<button type="button" class="field" data-act="cat"><span class="k">Category</span>
    <span class="v ${c ? '' : 'placeholder'}">${c ? `${badge(initials(c.name), st.catColor(c.id), 24)}<span>${esc(st.catLabel(c.id, true))}</span>` : '<span>Choose a category</span>'}</span><span class="chev">${icon('next', 16)}</span></button>`;
}

function accField(act, label, id) {
  const a = st.idx().acc.get(id);
  return `<button type="button" class="field" data-act="${act}"><span class="k">${label}</span><span class="v ${a ? '' : 'placeholder'}"><span>${a ? esc(a.name) : act === 'to' ? 'Outside my accounts' : 'Choose an account'}</span></span><span class="chev">${icon('next', 16)}</span></button>`;
}

function splitBlock() {
  if (!d.splits) return '';
  const sum = d.splits.reduce((s, x) => s + (x.amount || 0), 0);
  const left = d.amount - sum;
  return `<h2 class="sec">Split into categories <button type="button" class="link" data-act="unsplit">Undo split</button></h2>
    <div class="list">${d.splits
      .map((s, i) => {
        const c = st.idx().cat.get(s.categoryId);
        return `<div class="split-row"><button type="button" class="chip" data-act="splitCat" data-i="${i}"><span class="dot" style="--b:var(--${st.catColor(s.categoryId)})"></span><span>${esc(c ? c.name : 'Choose')}</span></button>
          <button type="button" class="btn ghost num" data-act="splitAmt" data-i="${i}">${money(s.amount || 0)}</button>
          <button type="button" class="iconbtn sm" data-act="splitDel" data-i="${i}" aria-label="Remove this part">${icon('close', 16)}</button></div>`;
      })
      .join('')}
      <button type="button" class="more-btn" data-act="splitAdd">Add another category</button></div>
    <p class="small ${left === 0 ? 'muted' : ''}" style="${left !== 0 ? 'color:var(--warm)' : ''}">${left === 0 ? 'The parts add up to the total.' : left > 0 ? `${money(left)} still to split.` : `The parts are ${money(-left)} more than the total.`}</p>`;
}

function render(arg) {
  const name = location.hash.startsWith('#tx-') ? 'tx' : 'add';
  if (`${name}-${arg}` !== key || !d) init(name, arg);
  if (!d) return `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>Not found</h1></div></header><div class="empty">This transaction was deleted.</div>`;
  const word = TYPE_WORD[d.type];
  const from = st.idx().acc.get(d.accountId);
  const to = st.idx().acc.get(d.toAccountId);
  const cur = from?.currency || baseCur();
  const labels = (d.labels || []).map((l) => `<span class="chip">#${esc(l)}</span>`).join('');
  let html = `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button>
    <div class="top-t"><h1>${orig ? 'Edit' : 'New'} ${word}</h1>${orig && orig.source && orig.source !== 'manual' ? `<div class="sub">Added ${{ notif: 'from a notification', receipt: 'from a receipt', recurring: 'by a repeating rule', import: 'by import', adjust: 'as a balance fix' }[orig.source] || ''}</div>` : ''}</div>
    <div class="top-r">${orig ? `<button type="button" class="iconbtn" data-act="duplicate" aria-label="Duplicate">${icon('copy', 20)}</button><button type="button" class="iconbtn" data-act="del" aria-label="Delete">${icon('trash', 20)}</button>` : ''}</div></header>
    <div class="seg-ctl" role="tablist">${['e', 'i', 't'].map((t) => `<button type="button" class="${d.type === t ? 'on' : ''}" data-act="type" data-v="${t}">${{ e: 'Expense', i: 'Income', t: 'Transfer' }[t]}</button>`).join('')}</div>
    <button type="button" class="amount-btn" data-act="amount"><div class="v num"><small>${esc(curSymbol(cur).trim())}</small>${(d.amount / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div class="h">${d.amount ? 'Tap to change' : 'Tap to type the amount'}</div></button>
    <div class="fields">
      <label class="field" for="f-title"><span class="k">${d.type === 'i' ? 'From' : d.type === 't' ? 'Note' : 'What for'}</span><input id="f-title" value="${esc(d.title)}" placeholder="${d.type === 'i' ? 'e.g. Salary' : d.type === 't' ? 'e.g. TnG reload' : 'e.g. Mamak Ali'}" autocomplete="off" enterkeyhint="done"></label>
      ${d.type !== 't' ? catField() : ''}
      ${d.type === 't' ? accField('acc', 'From', d.accountId) + accField('to', 'To', d.toAccountId) : accField('acc', 'Account', d.accountId)}
      ${d.type === 't' && from && to && (from.currency || baseCur()) !== (to.currency || baseCur()) ? `<button type="button" class="field" data-act="toAmount"><span class="k">Received</span><span class="v"><span>${money(d.toAmount ?? d.amount, { cur: to.currency })}</span></span></button>` : ''}
      <div class="field"><span class="k">When</span><input id="f-date" type="date" value="${esc(d.date)}" aria-label="Date"><input id="f-time" type="time" value="${esc(d.time || '')}" aria-label="Time" style="flex:0 0 auto;width:auto"></div>
      <button type="button" class="field" data-act="labels"><span class="k">Labels</span><span class="v ${labels ? '' : 'placeholder'}">${labels || '<span>None</span>'}</span><span class="chev">${icon('next', 16)}</span></button>
      <label class="field" for="f-notes"><span class="k">Notes</span><textarea id="f-notes" rows="1" placeholder="Anything to remember">${esc(d.notes || '')}</textarea></label>
      <label class="field" for="f-pending"><span class="k">Pending</span><span class="v"><span class="muted small">Not gone through the bank yet</span></span><span class="switch"><input type="checkbox" id="f-pending" ${d.status === 'pending' ? 'checked' : ''}><span></span></span></label>
      ${d.type !== 't' && !d.splits ? `<button type="button" class="field" data-act="split"><span class="k">Split</span><span class="v placeholder"><span>Spread over several categories</span></span><span class="chev">${icon('split', 16)}</span></button>` : ''}
      ${d.type !== 't' ? `<button type="button" class="field" data-act="fx"><span class="k">Currency</span><span class="v ${d.fx ? '' : 'placeholder'}"><span>${d.fx ? `${esc(d.fx.currency)} ${(d.fx.amount / 100).toFixed(2)} (1 ${esc(d.fx.currency)} = RM${d.fx.rate.toFixed(4)})` : 'Paid in another currency?'}</span></span><span class="chev">${icon('next', 16)}</span></button>` : ''}
      ${!orig ? `<button type="button" class="field" data-act="repeat"><span class="k">Repeat</span><span class="v ${d.repeat ? '' : 'placeholder'}"><span>${d.repeat ? `${{ daily: 'Every day', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' }[d.repeat.freq]} · ${d.repeat.mode === 'auto' ? 'added automatically' : 'remind me'}` : 'Never'}</span></span><span class="chev">${icon('repeat', 16)}</span></button>` : ''}
      <div class="field"><span class="k">Photos</span><div class="v"><div class="thumbs" id="thumbs">${(d.attachmentIds || []).filter((id) => !removed.includes(id)).map((id) => `<img class="thumb" data-att="${id}" alt="Saved photo" role="button" tabindex="0">`).join('')}${newPhotos.map((p, i) => `<img class="thumb" src="${p.url}" data-new="${i}" alt="New photo" role="button" tabindex="0">`).join('')}
        <label class="thumb" for="f-photo" style="display:grid;place-items:center;cursor:pointer" aria-label="Add a photo">${icon('camera', 22)}</label></div></div><input type="file" id="f-photo" accept="image/*" hidden></div>
    </div>
    <div id="f-suggest"></div>
    ${splitBlock()}
    <div class="row-btns" style="margin-top:16px">${!orig ? '<button type="button" class="btn" data-act="saveMore">Save, add another</button>' : ''}<button type="button" class="btn primary" data-act="save">Save</button></div>`;
  return html;
}

function showSuggestions(el) {
  const box = el.querySelector('#f-suggest');
  const q = d.title.trim().toLowerCase();
  if (!q || q.length < 2) { box.innerHTML = ''; sugs = []; return; }
  const seen = new Set();
  sugs = [];
  const list = st.txs().filter((t) => t.type === d.type && t.title).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  for (const t of list) {
    const k = t.title.toLowerCase();
    if (seen.has(k) || !k.includes(q) || k === q) continue;
    seen.add(k);
    sugs.push(t);
    if (sugs.length >= 5) break;
  }
  box.innerHTML = sugs.length ? `<div class="suggest">${sugs.map((t, i) => `<button type="button" data-act="useSug" data-i="${i}">${badge(initials(st.catLabel(t.categoryId)), st.catColor(t.categoryId), 28)}<span class="meta"><span>${esc(t.title)}</span><div class="s">${esc(t.type === 't' ? 'Transfer' : st.catLabel(t.categoryId))} · ${esc(st.accName(t.accountId))}</div></span><span class="num muted">${money(t.amount)}</span></button>`).join('')}</div>` : '';
}

function mount(el) {
  const title = el.querySelector('#f-title');
  if (!d) return;
  title.addEventListener('input', () => { d.title = title.value; showSuggestions(el); });
  el.querySelector('#f-date').addEventListener('change', (e) => { d.date = e.target.value || app.today; });
  el.querySelector('#f-time').addEventListener('change', (e) => { d.time = e.target.value; });
  el.querySelector('#f-notes').addEventListener('input', (e) => { d.notes = e.target.value; });
  el.querySelector('#f-pending').addEventListener('change', (e) => { d.status = e.target.checked ? 'pending' : 'cleared'; });
  el.querySelector('#f-photo').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const blob = await shrinkImage(file, 2000, 0.85);
      newPhotos.push({ blob, url: URL.createObjectURL(blob) });
      app.refresh();
    } catch (err) {
      toast(err.message);
    }
  });
  el.querySelectorAll('img[data-att]').forEach(async (img) => {
    const a = await st.getAttachment(img.dataset.att);
    if (a && a.blob) img.src = URL.createObjectURL(a.blob);
  });
  el.querySelectorAll('#thumbs img').forEach((img) => img.addEventListener('click', () => viewPhoto(img)));
  if (!orig && !d.amount && !autoOpened) {
    autoOpened = true;
    setTimeout(() => openAmount(), 120);
  }
}

function viewPhoto(img) {
  const wrap = document.createElement('div');
  wrap.className = 'photo-view';
  wrap.innerHTML = `<img src="${img.src}" alt="Photo"><div style="position:fixed;left:0;right:0;bottom:calc(16px + env(safe-area-inset-bottom,0px));display:flex;gap:8px;justify-content:center"><button type="button" class="btn" data-x="close">Close</button><button type="button" class="btn danger" data-x="remove">Remove photo</button></div>`;
  wrap.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]');
    if (!x && e.target.tagName === 'IMG') return;
    if (x && x.dataset.x === 'remove') {
      if (img.dataset.att) removed.push(img.dataset.att);
      if (img.dataset.new != null) newPhotos.splice(Number(img.dataset.new), 1);
      app.refresh();
    }
    wrap.remove();
  });
  document.body.appendChild(wrap);
}

function openAmount() {
  keypad({ title: `Amount of this ${TYPE_WORD[d.type]}`, value: d.amount, onDone: (v) => {
    d.amount = v;
    if (d.splits && d.splits.length === 1) d.splits[0].amount = v;
    app.refresh();
  } });
}

async function chooseLabels() {
  const all = [...new Set(st.txs().flatMap((t) => t.labels || []))].sort();
  const draw = () => `<div class="chip-opts">${all.map((l) => `<button type="button" class="chip-opt ${d.labels.includes(l) ? 'on' : ''}" data-pick="t:${esc(l)}">#${esc(l)}</button>`).join('') || '<span class="muted small">No labels yet.</span>'}</div>
    <div style="display:flex;gap:8px"><input class="input" id="new-label" placeholder="New label, e.g. balikkampung" autocomplete="off"><button type="button" class="btn" data-pick="add">Add</button></div>
    <button type="button" class="btn primary block" data-pick="done">Done</button>`;
  openSheet({
    title: 'Labels',
    body: draw(),
    onPick: (v, _b) => {
      const sheet = document.querySelector('#sheet-root .sheet-body');
      if (v === 'done') { app.refresh(); return false; }
      if (v === 'add') {
        const raw = sheet.querySelector('#new-label').value.trim().replace(/^#/, '').replace(/\s+/g, '');
        if (raw) { if (!all.includes(raw)) all.push(raw); if (!d.labels.includes(raw)) d.labels.push(raw); }
      } else if (v.startsWith('t:')) {
        const l = v.slice(2);
        d.labels = d.labels.includes(l) ? d.labels.filter((x) => x !== l) : [...d.labels, l];
      }
      sheet.innerHTML = draw();
      return true;
    },
    onClose: () => app.refresh(),
  });
}

function fxSheet() {
  openSheet({
    title: 'Paid in another currency',
    body: `<p class="muted small">Type what the shop charged in its own currency. The amount above stays what your account was charged in ringgit.</p>
      <div style="display:flex;gap:8px"><input class="input" id="fx-cur" maxlength="3" placeholder="USD" value="${esc(d.fx ? d.fx.currency : '')}" style="width:90px;text-transform:uppercase" autocomplete="off">
      <input class="input" id="fx-amt" inputmode="decimal" placeholder="10.00" value="${d.fx ? (d.fx.amount / 100).toFixed(2) : ''}"></div>
      <div class="row-btns">${d.fx ? '<button type="button" class="btn" data-pick="clear">Remove</button>' : ''}<button type="button" class="btn primary" data-pick="ok">Done</button></div>`,
    onPick: (v) => {
      if (v === 'clear') { d.fx = null; app.refresh(); return false; }
      const cur = document.getElementById('fx-cur').value.trim().toUpperCase();
      const amt = Math.round(parseFloat(document.getElementById('fx-amt').value) * 100);
      if (!/^[A-Z]{3}$/.test(cur) || !(amt > 0)) { toast('Type a 3-letter currency code and an amount.'); return true; }
      if (!d.amount) { toast('Type the ringgit amount first, then the foreign amount.'); return true; }
      d.fx = { currency: cur, amount: amt, rate: d.amount / amt };
      app.refresh();
      return false;
    },
  });
}

async function save(again) {
  if (!(d.amount > 0)) { toast('Type an amount first.'); openAmount(); return; }
  const tx = { ...(orig || {}), ...d };
  delete tx.repeat;
  if (d.type === 't') {
    if (!d.accountId && !d.toAccountId) return toast('Pick at least one account for this transfer.');
    if (d.accountId && d.accountId === d.toAccountId) return toast('Pick two different accounts.');
    tx.categoryId = null;
    tx.splits = null;
    tx.fx = null;
    if (tx.toAmount == null) delete tx.toAmount;
  } else {
    if (!d.accountId) return toast('Pick an account.');
    tx.toAccountId = null;
    delete tx.toAmount;
    if (d.splits) {
      const parts = d.splits.filter((s) => s.amount > 0);
      if (parts.some((s) => !s.categoryId)) return toast('Pick a category for every part of the split.');
      const sum = parts.reduce((s, x) => s + x.amount, 0);
      if (sum !== d.amount) return toast(sum < d.amount ? `Split the remaining ${money(d.amount - sum)} first.` : `The parts are ${money(sum - d.amount)} more than the total.`);
      tx.splits = parts.length > 1 ? parts : null;
      tx.categoryId = parts[0].categoryId;
    } else if (!d.categoryId) {
      toast('Pick a category.');
      return pickCat();
    }
  }
  if (!orig) {
    tx.id = uid();
    tx.source = d.source || 'manual';
  }
  const ids = (d.attachmentIds || []).filter((x) => !removed.includes(x));
  for (const p of newPhotos) ids.push(await st.saveAttachment(p.blob, tx.id));
  for (const r of removed) await st.deleteAttachment(r);
  tx.attachmentIds = ids;
  const before = orig ? JSON.parse(JSON.stringify(orig)) : null;
  await st.save('transactions', tx);
  if (d.inboxId) {
    const it = st.S.inbox.find((x) => x.id === d.inboxId);
    if (it) await st.save('inbox', { ...it, status: 'saved', txId: tx.id }, { quiet: true });
  }
  if (tx.type === 'e' && tx.title && tx.categoryId && !tx.splits) await st.remember(tx.title, tx.categoryId, tx.accountId);
  if (d.repeat) {
    await st.save('recurring', {
      active: true, mode: d.repeat.mode, freq: d.repeat.freq, interval: 1, startDate: tx.date, endDate: null, doneThrough: tx.date,
      template: { type: tx.type, title: tx.title, amount: tx.amount, accountId: tx.accountId, toAccountId: tx.toAccountId || null, categoryId: tx.categoryId, notes: tx.notes, labels: tx.labels, time: tx.time },
    });
  }
  toast(`Saved ${money(tx.amount)}`, {
    label: 'Undo',
    run: async () => {
      if (before) await st.save('transactions', before);
      else await st.remove('transactions', tx.id);
    },
  });
  if (again) {
    const keep = { type: d.type, accountId: d.accountId, date: d.date };
    key = '';
    init('add', d.type);
    Object.assign(d, keep);
    app.refresh();
  } else {
    key = '';
    back('#home');
  }
}

async function pickCat() {
  const id = await pickCategory({ kind: d.type === 'i' ? 'income' : 'expense', current: d.categoryId });
  if (id) { d.categoryId = id; touched.category = true; app.refresh(); }
}

export default {
  render,
  mount,
  keep: true,
  parent: '#home',
  actions: {
    type: (b) => {
      const t = b.dataset.v;
      if (t === d.type) return;
      const wasIncome = d.type === 'i';
      d.type = t;
      if ((t === 'i') !== wasIncome) { d.categoryId = null; d.splits = null; }
      if (t === 't') { d.splits = null; d.fx = null; }
      app.refresh();
    },
    amount: () => openAmount(),
    cat: () => pickCat(),
    acc: async () => {
      const id = await pickAccount({ current: d.accountId, title: d.type === 't' ? 'Money comes from' : 'Choose an account', exclude: d.type === 't' ? d.toAccountId : null, allowNone: d.type === 't' });
      if (id != null) { d.accountId = id || null; touched.account = true; app.refresh(); }
    },
    to: async () => {
      const id = await pickAccount({ current: d.toAccountId, title: 'Money goes to', exclude: d.accountId, allowNone: true });
      if (id != null) { d.toAccountId = id || null; app.refresh(); }
    },
    toAmount: () => keypad({ title: 'Amount received', value: d.toAmount ?? d.amount, onDone: (v) => { d.toAmount = v; app.refresh(); } }),
    labels: () => chooseLabels(),
    fx: () => fxSheet(),
    repeat: async () => {
      const f = await pickFrom('Repeat', [
        { value: 'never', label: 'Never' }, { value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' },
        { value: 'monthly', label: 'Every month' }, { value: 'yearly', label: 'Every year' },
      ], d.repeat ? d.repeat.freq : 'never');
      if (!f) return;
      if (f === 'never') { d.repeat = null; app.refresh(); return; }
      const mode = await pickFrom('When it comes due', [
        { value: 'remind', label: 'Remind me to confirm', sub: 'Shows up under Bills; you tap to add it' },
        { value: 'auto', label: 'Add it automatically', sub: 'Good for fixed amounts like rent or loans' },
      ], d.repeat ? d.repeat.mode : 'remind');
      if (mode) { d.repeat = { freq: f, mode }; app.refresh(); }
    },
    split: () => {
      d.splits = [{ categoryId: d.categoryId, amount: d.amount }, { categoryId: null, amount: 0 }];
      app.refresh();
    },
    unsplit: () => { d.categoryId = d.splits && d.splits[0] ? d.splits[0].categoryId : d.categoryId; d.splits = null; app.refresh(); },
    splitAdd: () => { d.splits.push({ categoryId: null, amount: Math.max(0, d.amount - d.splits.reduce((s, x) => s + (x.amount || 0), 0)) }); app.refresh(); },
    splitDel: (b) => { d.splits.splice(Number(b.dataset.i), 1); if (d.splits.length < 2) { d.categoryId = d.splits[0]?.categoryId || d.categoryId; d.splits = null; } app.refresh(); },
    splitCat: async (b) => {
      const i = Number(b.dataset.i);
      const id = await pickCategory({ kind: d.type === 'i' ? 'income' : 'expense', current: d.splits[i].categoryId });
      if (id) { d.splits[i].categoryId = id; app.refresh(); }
    },
    splitAmt: (b) => {
      const i = Number(b.dataset.i);
      keypad({ title: 'Amount for this part', value: d.splits[i].amount, onDone: (v) => { d.splits[i].amount = v; app.refresh(); } });
    },
    useSug: (b) => {
      const t = sugs[Number(b.dataset.i)];
      if (!t) return;
      d.title = t.title;
      if (!touched.category && t.categoryId && !d.splits) d.categoryId = t.categoryId;
      if (!touched.account && t.accountId) d.accountId = t.accountId;
      if (d.type === 't' && t.toAccountId) d.toAccountId = t.toAccountId;
      if (!d.amount) d.amount = t.amount;
      sugs = [];
      app.refresh();
    },
    save: () => save(false),
    saveMore: () => save(true),
    duplicate: () => {
      const copy = JSON.parse(JSON.stringify(d));
      for (const k of ['id', 'createdAt', 'updatedAt', 'importKey', 'importBatch', 'inboxId', 'recurringId', 'attachmentIds', 'sample']) delete copy[k];
      app.prefill = { ...copy, date: app.today, time: nowHM(), source: 'manual' };
      key = '';
      go('#add');
    },
    del: async () => {
      if (!(await confirmBox('Delete this transaction?', { ok: 'Delete', danger: true }))) return;
      const id = orig.id;
      await st.remove('transactions', id);
      key = '';
      toast('Deleted', { label: 'Undo', run: () => st.save('transactions', { ...st.S.transactions.find((x) => x.id === id), deleted: false }) });
      back('#history');
    },
  },
};

export { closeSheet };
