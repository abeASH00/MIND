// Belanja: shared screen pieces: short messages, bottom sheets, pickers and the calculator keypad.

import { esc, money, initials } from './util.js';
import { icon, ACCOUNT_ICON } from './icons.js';
import * as st from './store.js';

/* ---------------- Short message at the bottom ---------------- */

let toastTimer;
export function toast(msg, action) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button" class="toast-act">${esc(action.label)}</button>` : '');
  el.hidden = false;
  if (action) el.querySelector('.toast-act').onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 2400);
}

/* ---------------- Bottom sheet ---------------- */

let sheet = null;
const escClose = (e) => { if (e.key === 'Escape') closeSheet(); };

// onPick(value, element) runs when something with data-pick is tapped; return true to keep the sheet open.
export function openSheet({ title = '', body = '', onPick, onMount, onClose }) {
  closeSheet(true);
  const root = document.getElementById('sheet-root');
  root.innerHTML = `<div class="backdrop" data-sheet-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-in">
      <div class="grab"></div>
      ${title ? `<div class="sheet-head"><h3>${esc(title)}</h3><button type="button" class="iconbtn sm" data-sheet-close aria-label="Close">${icon('close', 18)}</button></div>` : ''}
      <div class="sheet-body">${body}</div>
    </div></div>`;
  root.hidden = false;
  const el = root.querySelector('.sheet');
  sheet = { root, el, onClose };
  root.onclick = (e) => {
    if (e.target.closest('[data-sheet-close]')) { closeSheet(); return; }
    const p = e.target.closest('[data-pick]');
    if (p && onPick) {
      const keep = onPick(p.dataset.pick, p, e);
      if (keep !== true) closeSheet(true);
    }
  };
  document.addEventListener('keydown', escClose);
  if (onMount) onMount(el);
  const f = el.querySelector('[autofocus]');
  if (f) setTimeout(() => f.focus(), 60);
  return el;
}

export function closeSheet(silent = false) {
  if (!sheet) return;
  const s = sheet;
  sheet = null;
  s.root.hidden = true;
  s.root.innerHTML = '';
  s.root.onclick = null;
  document.removeEventListener('keydown', escClose);
  if (!silent && s.onClose) s.onClose();
}
export const sheetIsOpen = () => !!sheet;

export function confirmBox(message, { ok = 'OK', danger = false, title = 'Are you sure?' } = {}) {
  return new Promise((resolve) => {
    openSheet({
      title,
      body: `<p class="muted">${esc(message)}</p><div class="row-btns"><button type="button" class="btn" data-pick="no">Cancel</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-pick="yes">${esc(ok)}</button></div>`,
      onPick: (v) => resolve(v === 'yes'),
      onClose: () => resolve(false),
    });
  });
}

/* ---------------- Badges ---------------- */

export function badge(text, color = 'c0', size = 36) {
  return `<span class="badge" style="--b:var(--${esc(color)});width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px" aria-hidden="true">${esc(text)}</span>`;
}
export function catBadge(t, size = 36) {
  if (t.type === 't') return `<span class="badge xf" style="width:${size}px;height:${size}px" aria-hidden="true">${icon('swap', Math.round(size * 0.5))}</span>`;
  if (t.splits && t.splits.length > 1) return `<span class="badge xf" style="width:${size}px;height:${size}px" aria-hidden="true">${icon('split', Math.round(size * 0.5))}</span>`;
  const c = st.idx().cat.get(t.categoryId);
  return badge(c ? initials(c.name) : '?', st.catColor(t.categoryId), size);
}
export function accBadge(a, size = 36) {
  return `<span class="badge acc" style="width:${size}px;height:${size}px" aria-hidden="true">${icon(ACCOUNT_ICON[a.type] || 'wallet', Math.round(size * 0.5))}</span>`;
}

/* ---------------- Pickers ---------------- */

export function pickFrom(title, options, current) {
  return new Promise((resolve) => {
    openSheet({
      title,
      body: `<div class="opts">${options.map((o) => `<button type="button" class="opt ${o.value === current ? 'on' : ''}" data-pick="${esc(o.value)}"><span class="opt-main"><span>${esc(o.label)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span>${o.value === current ? icon('check', 18) : ''}</button>`).join('')}</div>`,
      onPick: (v) => resolve(v),
      onClose: () => resolve(null),
    });
  });
}

export function pickAccount({ current, title = 'Choose an account', exclude = null, allowNone = false } = {}) {
  const list = st.accounts().filter((a) => a.id !== exclude);
  return new Promise((resolve) => {
    openSheet({
      title,
      body: `<div class="opts">${allowNone ? `<button type="button" class="opt" data-pick="__none"><span class="opt-main"><span>Not one of my accounts</span></span></button>` : ''}${list
        .map((a) => `<button type="button" class="opt ${a.id === current ? 'on' : ''}" data-pick="${a.id}">${accBadge(a, 30)}<span class="opt-main"><span>${esc(a.name)}</span></span>${a.id === current ? icon('check', 18) : ''}</button>`)
        .join('')}</div>`,
      onPick: (v) => resolve(v === '__none' ? '' : v),
      onClose: () => resolve(null),
    });
  });
}

function recentCategories(kind, n = 6) {
  const type = kind === 'income' ? 'i' : 'e';
  const seen = [];
  const all = st.txs().filter((t) => t.type === type && t.categoryId).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  for (const t of all) {
    if (!seen.includes(t.categoryId) && st.idx().cat.get(t.categoryId) && !st.idx().cat.get(t.categoryId).deleted) seen.push(t.categoryId);
    if (seen.length >= n) break;
  }
  return seen;
}

export function pickCategory({ kind = 'expense', current, title = 'Choose a category', allowParent = false } = {}) {
  const ps = st.parents(kind);
  const recent = recentCategories(kind);
  const opt = (c, color) => `<button type="button" class="chip-opt ${c.id === current ? 'on' : ''}" data-pick="${c.id}" data-name="${esc(c.name.toLowerCase())}"><span class="dot" style="--b:var(--${esc(color || 'c0')})"></span>${esc(c.name)}</button>`;
  const body = `
    <input type="search" class="input" id="cat-search" placeholder="Search categories" autocomplete="off">
    ${recent.length ? `<div class="grp" data-grp="recent"><div class="label">Recently used</div><div class="chip-opts">${recent.map((id) => opt(st.idx().cat.get(id), st.catColor(id))).join('')}</div></div>` : ''}
    ${ps
      .map((p) => {
        const kids = st.children(p.id);
        const list = kids.length ? kids : [p];
        return `<div class="grp"><div class="label"><span class="dot" style="--b:var(--${esc(p.color || 'c0')})"></span>${esc(p.name)}</div><div class="chip-opts">${allowParent && kids.length ? opt({ ...p, name: 'All of ' + p.name }, p.color) : ''}${list.map((c) => opt(c, p.color)).join('')}</div></div>`;
      })
      .join('')}
    <p class="muted small">Add or rename categories in More › Categories.</p>`;
  return new Promise((resolve) => {
    openSheet({
      title,
      body,
      onPick: (v) => resolve(v),
      onClose: () => resolve(null),
      onMount: (el) => {
        el.querySelector('#cat-search').addEventListener('input', (e) => {
          const q = e.target.value.trim().toLowerCase();
          el.querySelectorAll('.chip-opt').forEach((b) => { b.hidden = q && !b.dataset.name.includes(q); });
          el.querySelectorAll('.grp').forEach((g) => { g.hidden = q && (g.dataset.grp === 'recent' || ![...g.querySelectorAll('.chip-opt')].some((b) => !b.hidden)); });
        });
      },
    });
  });
}

/* ---------------- Calculator keypad ---------------- */

// Works out "12.50+3×2" with × and ÷ before + and −. Returns sen, or NaN if it doesn't make sense.
export function evalAmount(expr) {
  const s = String(expr || '').replace(/[+\-×÷]$/, '');
  if (!s) return 0;
  const tokens = s.match(/\d+\.\d*|\.\d+|\d+|[+\-×÷]/g);
  if (!tokens || tokens.join('') !== s) return NaN;
  const nums = [];
  const ops = [];
  for (const t of tokens) {
    if ('+-×÷'.includes(t)) ops.push(t);
    else nums.push(parseFloat(t));
  }
  if (nums.length !== ops.length + 1) return NaN;
  const n2 = [nums[0]];
  const o2 = [];
  ops.forEach((op, i) => {
    const b = nums[i + 1];
    if (op === '×') n2[n2.length - 1] *= b;
    else if (op === '÷') n2[n2.length - 1] = b === 0 ? NaN : n2[n2.length - 1] / b;
    else { o2.push(op); n2.push(b); }
  });
  let v = n2[0];
  o2.forEach((op, i) => { v = op === '+' ? v + n2[i + 1] : v - n2[i + 1]; });
  if (!isFinite(v) || v < 0) return NaN;
  return Math.round(v * 100 + 1e-7);
}

export function keypad({ title = 'Amount', value = 0, onDone }) {
  let expr = value ? (value / 100).toFixed(2).replace(/\.00$/, '') : '';
  const keys = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '.', '0', '⌫', '+'];
  const show = (el) => {
    const v = evalAmount(expr.replace(/−/g, '-'));
    el.querySelector('.kp-expr').textContent = /[+\-−×÷]/.test(expr) ? expr : ' ';
    el.querySelector('.kp-val').textContent = isNaN(v) ? 'Check the sum' : money(v);
  };
  openSheet({
    title,
    body: `<div class="kp-display"><div class="kp-expr num"> </div><div class="kp-val num">RM0.00</div></div>
      <div class="kp">${keys.map((k) => `<button type="button" class="kp-k ${'÷×−+'.includes(k) ? 'op' : ''}" data-pick="${k}" aria-label="${k === '⌫' ? 'Delete' : k === '−' ? 'Minus' : k}">${k}</button>`).join('')}
      <button type="button" class="kp-k" data-pick="C" aria-label="Clear">C</button><button type="button" class="kp-k done" data-pick="OK">Done</button></div>`,
    onMount: show,
    onPick: (k, _b) => {
      const el = document.querySelector('#sheet-root .sheet');
      if (k === 'OK') {
        const v = evalAmount(expr.replace(/−/g, '-'));
        if (isNaN(v)) { toast('That sum doesn’t work. Fix it or press C.'); return true; }
        onDone(v);
        return false;
      }
      if (k === 'C') expr = '';
      else if (k === '⌫') expr = expr.slice(0, -1);
      else if ('÷×−+'.includes(k)) {
        if (!expr) return true;
        expr = /[÷×−+]$/.test(expr) ? expr.slice(0, -1) + k : expr + k;
      } else if (k === '.') {
        const last = expr.split(/[÷×−+]/).pop();
        if (!last.includes('.')) expr += last ? '.' : '0.';
      } else {
        const last = expr.split(/[÷×−+]/).pop();
        if (last.includes('.') && last.split('.')[1].length >= 2) return true;
        if (last.replace('.', '').length >= 9) return true;
        expr = last === '0' ? expr.slice(0, -1) + k : expr + k;
      }
      show(el);
      return true;
    },
  });
}

/* ---------------- Small helpers for screens ---------------- */

export function header(title, { back = false, sub = '', right = '' } = {}) {
  return `<header class="top">
    ${back ? `<button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button>` : ''}
    <div class="top-t"><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <div class="top-r">${right}</div>
  </header>`;
}

export const empty = (msg, extra = '') => `<div class="empty">${esc(msg)}${extra}</div>`;

// Shrinks a photo so it uploads fast and costs less to read (longest side 1568px, JPEG).
export function shrinkImage(file, max = 1568, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the photo'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the photo')); };
    img.src = url;
  });
}

export const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// Saves a file: shares it on phones that can, otherwise downloads it.
export async function saveFile(name, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const file = typeof File === 'function' ? new File([blob], name, { type }) : null;
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return 'downloaded';
}
