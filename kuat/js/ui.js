// Kuat — shared screen helpers: safe text, icons, sheets, toasts, formatting, units.
import { settingsNow } from './data.js';

// ---------- Safety: every piece of typed text goes through esc() before it is shown ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export function esc(v) { return String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]); }

// Tagged template: html`<p>${userText}</p>` escapes the values automatically.
// Wrap trusted markup (icons, other html`` results) with raw() to insert it as-is.
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
    else if (v instanceof Raw) out += v.s;
    else if (v === null || v === undefined || v === false) out += '';
    else out += esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}

// Only http and https links are allowed. Anything else (javascript:, data:, etc.) is refused.
export function safeUrl(u) {
  try { const url = new URL(String(u), location.href); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}
// Turns plain text into safe HTML, making http(s) links tappable.
export function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (m) => {
    const href = safeUrl(m.replace(/&amp;/g, '&'));
    return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${m}</a>` : m;
  }).replace(/\n/g, '<br>');
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Icons (thin line style) ----------
const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M10 3h4"/>',
  interval: '<path d="M4 12h3l2-5 3 10 2-5h6"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/>',
  flame: '<path d="M12 21c3.6 0 6-2.4 6-5.6 0-3.4-2.6-5.4-3.6-8.4-.4 2-1.6 3.2-2.6 3.6C12 7.6 10.6 5 9 3.5 9 7.5 6 9.6 6 15.4 6 18.6 8.4 21 12 21z"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19 13 11"/>',
  dumbbell: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  star: '<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4-3.9-3.8 5.4-.8z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4v3h-4z"/>',
  swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  trash: '<path d="M5 7h14M10 4h4M7 7l1 13h8l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  scale: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 9.5a5 5 0 0 1 7 0L12 12"/>',
  tape: '<circle cx="9" cy="12" r="5.5"/><path d="M9 6.5h11v11H9"/><circle cx="9" cy="12" r="1.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  heart: '<path d="M12 19.5s-7.5-4.4-7.5-9.7A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.4c0 5.3-7.5 9.7-7.5 9.7z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  stretch: '<circle cx="12" cy="5" r="2"/><path d="M12 7.5v6l-4 6.5M12 13.5l4 6.5M5 10l7-1.5 7 1.5"/>',
  clipboard: '<rect x="5.5" y="4.5" width="13" height="16" rx="3"/><path d="M9 4.5h6v2.5H9zM9 11h6M9 15h4"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  sparkle: '<path d="M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2 2M15 15l2 2M7 17l2-2M15 9l2-2"/>',
};
export function icon(name, extra = '') {
  return raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${P[name] || ''}</svg>`);
}

// ---------- Toasts (small pop-up messages) ----------
export function toast(msg, { action, onAction, ms = 3200 } = {}) {
  const wrap = $('#toasts');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  if (action) t.querySelector('button').addEventListener('click', () => { t.remove(); onAction && onAction(); });
  wrap.appendChild(t);
  setTimeout(() => t.remove(), action ? Math.max(ms, 6000) : ms);
}

// ---------- Sheets (slide-up pop-up forms) ----------
// openSheet({ title, body, saveLabel, onSave, cancelLabel, onOpen }) -> { close, el }
// onSave(el) may return false to keep the sheet open (e.g. a field is missing).
let sheetStack = [];
export function openSheet({ title = '', sub = '', body = '', saveLabel = 'Save', cancelLabel = 'Cancel', onSave = null, onOpen = null, onClose = null, danger = false, noFoot = false } = {}) {
  const slot = $('#sheet-slot');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-dim"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="grab"></div>
      ${title ? `<div class="sheet-head"><h2>${esc(title)}</h2>${sub ? `<div class="meta">${esc(sub)}</div>` : ''}</div>` : ''}
      <div class="sheet-body">${String(body)}</div>
      ${noFoot ? '' : `<div class="sheet-foot">
        <button type="button" class="btn ghost" data-sheet="cancel">${esc(cancelLabel)}</button>
        ${onSave ? `<button type="button" class="btn ${danger ? 'danger' : ''}" data-sheet="save">${esc(saveLabel)}</button>` : ''}
      </div>`}
    </div>`;
  slot.appendChild(wrap);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    wrap.classList.remove('show');
    sheetStack = sheetStack.filter((s) => s !== api);
    setTimeout(() => wrap.remove(), 260);
    onClose && onClose();
  };
  const api = { close, el: wrap };
  sheetStack.push(api);
  wrap.querySelector('.sheet-dim').addEventListener('click', close);
  const c = wrap.querySelector('[data-sheet="cancel"]');
  if (c) c.addEventListener('click', close);
  const s = wrap.querySelector('[data-sheet="save"]');
  if (s) s.addEventListener('click', async () => {
    s.disabled = true;
    try { const r = await onSave(wrap.querySelector('.sheet-body'), api); if (r !== false) close(); }
    catch (e) { toast(e && e.message ? e.message : 'Something went wrong.'); }
    finally { s.disabled = false; }
  });
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('show')));
  onOpen && onOpen(wrap.querySelector('.sheet-body'), api);
  return api;
}
export function closeTopSheet() { const s = sheetStack[sheetStack.length - 1]; if (s) { s.close(); return true; } return false; }

export function confirmSheet({ title, message, yes = 'Yes', no = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title, body: `<p>${esc(message)}</p>`, saveLabel: yes, cancelLabel: no, danger,
      onSave: () => { answered = true; resolve(true); },
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

// ---------- Formatting ----------
export const KG_PER_LB = 0.45359237;
export function unit() { return settingsNow().units === 'lb' ? 'lb' : 'kg'; }
export function toDisplay(kg) {
  if (kg === null || kg === undefined || kg === '') return '';
  const v = unit() === 'lb' ? kg / KG_PER_LB : kg;
  return trimNum(unit() === 'lb' ? Math.round(v * 2) / 2 : Math.round(v * 100) / 100);
}
export function fromDisplay(v) {
  const n = parseNum(v);
  if (n === null) return null;
  return unit() === 'lb' ? n * KG_PER_LB : n;
}
export function parseNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export function trimNum(n) { return String(Math.round(n * 100) / 100); }
export function fmtW(kg, withUnit = true) { return kg === null || kg === undefined ? '—' : `${toDisplay(kg)}${withUnit ? ' ' + unit() : ''}`; }
export function fmtBig(kg) {
  const v = unit() === 'lb' ? kg / KG_PER_LB : kg;
  if (v >= 100000) return `${Math.round(v / 1000)}k`;
  if (v >= 10000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return Math.round(v).toLocaleString();
}
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${sec} s`;
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function dayKey(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function parseDayKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
export const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function fmtDate(d, opts = { day: 'numeric', month: 'short' }) { return new Date(d).toLocaleDateString(undefined, opts); }
export function fmtDateLong(d) { return new Date(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }); }
// Meta lines: items joined by " · " (the dot always stays at the end of the previous item).
// A non-breaking space before the dot keeps it glued to the previous item, so a wrapped line never starts with a dot.
export function metaJoin(items) { return items.filter((x) => x !== null && x !== undefined && x !== '').map(esc).join('&nbsp;· '); }

// ---------- Feedback: sound and vibration ----------
let audioCtx = null;
export function unlockAudio() {
  try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch { /* no audio */ }
}
export function beep({ freq = 880, ms = 160, times = 1, gap = 120 } = {}) {
  if (!settingsNow().sound) return;
  unlockAudio();
  if (!audioCtx) return;
  for (let i = 0; i < times; i++) {
    const t0 = audioCtx.currentTime + i * (ms + gap) / 1000;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0); o.stop(t0 + ms / 1000 + 0.05);
  }
}
export function buzz(pattern = 60) {
  if (!settingsNow().vibrate) return;
  try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* not supported */ }
}

// ---------- Keep the screen awake (where the phone allows it) ----------
let wakeLock = null, wantWake = false;
export async function keepAwake(on) {
  wantWake = on;
  try {
    if (on && 'wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wantWake) keepAwake(true); });

// ---------- Keyboard: hide the nav while typing and keep the field in view ----------
export function setupKeyboardHandling() {
  const vv = window.visualViewport;
  const update = () => {
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && !['checkbox', 'radio', 'file', 'range'].includes(ae.type);
    const shrunk = vv ? (window.innerHeight - vv.height > 120) : false;
    document.body.classList.toggle('kb-open', !!(typing && (shrunk || matchMedia('(pointer: coarse)').matches)));
  };
  // Keep the field (and for workouts, its whole set row) inside the part of the screen the
  // keyboard isn't covering. iPhones don't shrink the page for the keyboard, so we measure
  // the visible area (visualViewport) rather than trusting the window size.
  const reveal = (el) => {
    if (!el || !el.getBoundingClientRect) return;
    const row = el.closest('.set-row') || el;
    const fix = () => {
      if (document.activeElement !== el) return;
      const r = row.getBoundingClientRect();
      const visH = vv ? vv.height : window.innerHeight;
      const top = 70, bottom = visH - 16;
      if (r.top < top || r.bottom > bottom) window.scrollBy({ top: r.top - Math.max(top, (visH - r.height) / 2), behavior: 'smooth' });
    };
    setTimeout(fix, 300);
    setTimeout(fix, 650); // again once the keyboard has finished sliding up
  };
  document.addEventListener('focusin', (e) => { update(); if (e.target.matches('input, textarea')) reveal(e.target); });
  document.addEventListener('focusout', () => setTimeout(update, 60));
  if (vv) vv.addEventListener('resize', () => { update(); const ae = document.activeElement; if (ae && ae.matches && ae.matches('input, textarea')) reveal(ae); });
}

// ---------- Downloads ----------
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- Small building blocks ----------
export function emptyState(iconName, text, btn = '') {
  return html`<div class="empty">${icon(iconName)}<p>${text}</p>${raw(btn)}</div>`;
}
export function avatarHTML(s, cls = '') {
  const initial = (s.name || '').trim().charAt(0).toUpperCase();
  if (s.photo && /^data:image\/(jpeg|png|webp);base64,/.test(s.photo)) return html`<div class="avatar ${cls}"><img src="${s.photo}" alt=""></div>`;
  return html`<div class="avatar ${cls}">${initial || icon('user')}</div>`;
}
// Scroll the selected pill in a sideways row into view.
export function revealSelectedPills(root = document) {
  $$('.pills', root).forEach((row) => {
    const on = row.querySelector('.pill.on, .pill[aria-pressed="true"]');
    if (on) row.scrollLeft = Math.max(0, on.offsetLeft - row.clientWidth / 2 + on.offsetWidth / 2);
  });
}
