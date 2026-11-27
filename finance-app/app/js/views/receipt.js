// Belanja: Scan a receipt. Photo in, AI reads the shop, total and items, you check and save.

import * as st from '../store.js';
import { esc, money, initials, nowHM } from '../util.js';
import { icon } from '../icons.js';
import { keypad, pickCategory, pickAccount, toast, badge, shrinkImage, blobToBase64 } from '../ui.js';
import { app, go } from '../app.js';
import * as capture from '../capture.js';

let photo = null;
let url = '';
let state = 'pick'; // pick | reading | review | manual
let error = '';
let d = null; // the receipt draft
let mode = 'one';

function reset() {
  if (url) URL.revokeObjectURL(url);
  photo = null; url = ''; state = 'pick'; error = ''; d = null; mode = 'one';
}

async function useBlob(blob) {
  try {
    photo = await shrinkImage(blob);
  } catch (e) {
    toast(e.message);
    return;
  }
  url = URL.createObjectURL(photo);
  error = '';
  if (!app.demo && !capture.serverReady()) { state = 'manual'; app.refresh(); return; }
  state = 'reading';
  app.refresh();
  try {
    d = await capture.readReceipt(photo, app.demo ? '' : await blobToBase64(photo));
    if (!d.accountId) d.accountId = st.S.settings.defaultAccountId || st.accounts()[0]?.id || null;
    mode = new Set(d.items.map((i) => i.categoryId).filter(Boolean)).size > 1 ? 'split' : 'one';
    state = 'review';
  } catch (e) {
    error = e.message;
    state = 'manual';
  }
  app.refresh();
}

function groups() {
  const g = new Map();
  for (const it of d.items) {
    const k = it.categoryId || d.categoryId || '';
    g.set(k, (g.get(k) || 0) + it.amount);
  }
  const itemsSum = d.items.reduce((s, i) => s + i.amount, 0);
  const diff = d.amount - itemsSum;
  if (diff && g.size) {
    const biggest = [...g.entries()].sort((a, b) => b[1] - a[1])[0][0];
    g.set(biggest, g.get(biggest) + diff);
  }
  return { list: [...g.entries()].map(([categoryId, amount]) => ({ categoryId, amount })), diff, itemsSum };
}

function catChip(id, act, i = '') {
  const c = st.idx().cat.get(id);
  return `<button type="button" class="chip" data-act="${act}" data-i="${i}"><span class="dot" style="--b:var(--${st.catColor(id)})"></span><span>${esc(c ? c.name : 'Category?')}</span></button>`;
}

function render() {
  if (app.pendingPhoto) {
    const b = app.pendingPhoto;
    app.pendingPhoto = null;
    reset();
    setTimeout(() => useBlob(b), 0);
    state = 'reading';
  }
  let html = `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>Scan a receipt</h1></div>
    ${state !== 'pick' ? `<div class="top-r"><button type="button" class="iconbtn" data-act="again" aria-label="Start again">${icon('refresh', 20)}</button></div>` : ''}</header>`;
  if (state === 'pick') {
    html += `<div class="card stack"><p class="muted small" style="margin:0">Take a photo of the whole receipt, flat and in good light. ${app.demo ? 'The demo reads an example receipt instead of yours.' : 'AI reads the shop, the total and each item.'}</p>
      <label class="btn primary block" for="r-cam">${icon('camera', 18)}Take a photo</label><input type="file" id="r-cam" accept="image/*" capture="environment" hidden>
      <label class="btn block" for="r-pick">${icon('receipt', 18)}Choose from gallery</label><input type="file" id="r-pick" accept="image/*" hidden>
      ${app.demo ? '<button type="button" class="btn block" data-act="example">Use the example receipt</button>' : ''}</div>`;
    return html;
  }
  if (url) html += `<img class="receipt-photo" src="${url}" alt="Your receipt">`;
  if (state === 'reading') return html + `<div class="loading" role="status"><div class="spin"></div>Reading the shop, total and items…</div>`;
  if (state === 'manual') {
    return html + `<div class="card" style="margin-top:10px">${error ? `<p class="small" style="color:var(--neg);margin:0 0 8px">${esc(error)}</p>` : `<p class="small muted" style="margin:0 0 8px">Reading receipts automatically needs your server (Settings › Automatic capture). For now, type the details in; the photo is saved with them.</p>`}
      <button type="button" class="btn primary block" data-act="manual">Fill in by hand</button></div>`;
  }
  const g = groups();
  html += `<div class="fields" style="margin-top:10px">
    <label class="field" for="r-shop"><span class="k">Shop</span><input id="r-shop" value="${esc(d.title)}" autocomplete="off"></label>
    <div class="field"><span class="k">When</span><input id="r-date" type="date" value="${esc(d.date)}"><input id="r-time" type="time" value="${esc(d.time || '')}" style="flex:0 0 auto;width:auto"></div>
    <button type="button" class="field" data-act="total"><span class="k">Total</span><span class="v num"><span>${money(d.amount)}</span></span><span class="chev">${icon('edit', 16)}</span></button>
    <button type="button" class="field" data-act="acc"><span class="k">Paid from</span><span class="v ${d.accountId ? '' : 'placeholder'}"><span>${esc(st.accName(d.accountId) || 'Choose an account')}</span></span><span class="chev">${icon('next', 16)}</span></button>
  </div>
  <div class="seg-ctl" style="margin-top:12px"><button type="button" class="${mode === 'one' ? 'on' : ''}" data-act="mode" data-v="one">One category</button><button type="button" class="${mode === 'split' ? 'on' : ''}" data-act="mode" data-v="split">Split by category</button></div>`;
  if (mode === 'one') {
    const c = st.idx().cat.get(d.categoryId);
    html += `<div class="fields" style="margin-top:10px"><button type="button" class="field" data-act="cat"><span class="k">Category</span><span class="v ${c ? '' : 'placeholder'}">${c ? badge(initials(c.name), st.catColor(c.id), 24) : ''}<span>${c ? esc(st.catLabel(c.id, true)) : 'Choose a category'}</span></span><span class="chev">${icon('next', 16)}</span></button></div>`;
  } else {
    html += `<div class="list" style="margin-top:10px">${d.items.map((it, i) => `<div class="split-row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</span>${catChip(it.categoryId, 'itemCat', i)}<span class="num">${money(it.amount)}</span></div>`).join('')}</div>
      <div class="card small" style="margin-top:10px">${g.list.map((x) => `<div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(st.catLabel(x.categoryId, true))}</span><b class="num">${money(x.amount)}</b></div>`).join('')}
      ${g.diff ? `<div class="muted" style="margin-top:6px">The items add up to ${money(g.itemsSum)}; the total is ${money(d.amount)}. The ${money(Math.abs(g.diff))} difference (tax, rounding or discounts) goes to the biggest part.</div>` : ''}</div>`;
  }
  html += `<div class="row-btns"><button type="button" class="btn" data-act="full">Open full form</button><button type="button" class="btn primary" data-act="save">Save</button></div>`;
  return html;
}

function mount(el) {
  for (const id of ['#r-cam', '#r-pick']) {
    el.querySelector(id)?.addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) useBlob(f); });
  }
  el.querySelector('#r-shop')?.addEventListener('input', (e) => { d.title = e.target.value; });
  el.querySelector('#r-date')?.addEventListener('change', (e) => { d.date = e.target.value || app.today; });
  el.querySelector('#r-time')?.addEventListener('change', (e) => { d.time = e.target.value; });
}

function toTx() {
  const base = { type: 'e', amount: d.amount, title: d.title, date: d.date, time: d.time || nowHM(), accountId: d.accountId, notes: d.notes || '', labels: [], status: 'cleared', source: 'receipt' };
  if (mode === 'split') {
    const parts = groups().list.filter((x) => x.amount > 0);
    if (parts.length > 1) return { ...base, categoryId: parts[0].categoryId, splits: parts.map((x) => ({ categoryId: x.categoryId, amount: x.amount, notes: '' })) };
    return { ...base, categoryId: parts[0]?.categoryId || d.categoryId };
  }
  return { ...base, categoryId: d.categoryId };
}

export default {
  render,
  mount,
  keep: true,
  parent: '#inbox',
  actions: {
    again: () => { reset(); app.refresh(); },
    example: async () => {
      const c = document.createElement('canvas');
      c.width = 300; c.height = 420;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 300, 420);
      g.fillStyle = '#222'; g.font = 'bold 18px monospace'; g.fillText("LOTUS'S SETIA ALAM", 40, 40);
      g.font = '14px monospace';
      ['Beras 5kg       26.90', 'Ayam 1.2kg      14.30', 'Telur 30s       13.50', 'Sayur campur     6.80', 'Detergent       18.90', 'Tisu 10s         9.90', '', 'TOTAL           90.30'].forEach((l, i) => g.fillText(l, 30, 90 + i * 26));
      c.toBlob((b) => useBlob(b), 'image/jpeg', 0.9);
    },
    manual: () => { app.prefill = { photo, source: 'receipt' }; reset(); go('#add'); },
    total: () => keypad({ title: 'Receipt total', value: d.amount, onDone: (v) => { d.amount = v; app.refresh(); } }),
    acc: async () => { const id = await pickAccount({ current: d.accountId, title: 'Paid from' }); if (id) { d.accountId = id; app.refresh(); } },
    cat: async () => { const id = await pickCategory({ current: d.categoryId }); if (id) { d.categoryId = id; app.refresh(); } },
    itemCat: async (b) => {
      const it = d.items[Number(b.dataset.i)];
      const id = await pickCategory({ current: it.categoryId });
      if (id) { it.categoryId = id; app.refresh(); }
    },
    mode: (b) => { mode = b.dataset.v; app.refresh(); },
    full: () => { app.prefill = { ...toTx(), photo }; reset(); go('#add'); },
    save: async () => {
      if (!(d.amount > 0)) return toast('Type the total first.');
      if (!d.accountId) return toast('Pick the account you paid from.');
      const tx = toTx();
      if (!tx.categoryId || (tx.splits && tx.splits.some((s) => !s.categoryId))) return toast('Pick a category for every part.');
      const [saved] = await st.save('transactions', tx, { quiet: true });
      const attId = await st.saveAttachment(photo, saved.id);
      await st.save('transactions', { ...saved, attachmentIds: [attId] });
      if (tx.title && !tx.splits) await st.remember(tx.title, tx.categoryId, tx.accountId);
      toast(`Saved ${money(tx.amount)} from ${tx.title || 'the receipt'}`);
      reset();
      go('#home');
    },
  },
};
