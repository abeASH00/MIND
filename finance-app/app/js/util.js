// Belanja: small helpers shared by every part of the app.
// Nothing in this file touches the page, so the tests can run it in Node.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------------- Money ----------------
   Every amount is stored as whole sen (RM1.00 = 100), so totals never drift. */

// Turns "RM1,234.50", "-12.5", "(8.00)" or 12.5 into sen. Returns NaN if it can't.
export function parseAmount(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.includes('-') || s.includes('−')) neg = !neg;
  s = s.replace(/[^0-9.,]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const tail = s.length - lastComma - 1;
    s = tail === 2 && s.indexOf(',') === lastComma ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  if (!s || s === '.') return NaN;
  const n = Number(s);
  if (!isFinite(n)) return NaN;
  const sen = Math.round(n * 100 + (n >= 0 ? 1e-7 : -1e-7));
  return neg ? -sen : sen;
}

const nf2 = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const curSymbol = (code = 'MYR') => (code === 'MYR' ? 'RM' : code + ' ');

// money(1250) -> "RM12.50"; money(-1250) -> "−RM12.50"; money(1250, {sign:'+'}) -> "+RM12.50"
export function money(sen, opts = {}) {
  const { sign, cur = 'MYR' } = opts;
  const abs = Math.abs(sen || 0) / 100;
  let pre = '';
  if (sign === 'auto') pre = sen < 0 ? '−' : sen > 0 ? '+' : '';
  else if (sign) pre = sign;
  else if (sen < 0) pre = '−';
  return pre + curSymbol(cur) + nf2.format(abs);
}

// Short form for chart axes: RM850, RM1.2K, RM15K, RM1.5M
export function moneyShort(sen, cur = 'MYR') {
  const v = Math.abs(sen || 0) / 100;
  let s;
  if (v >= 1e6) s = (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  else if (v >= 1e4) s = Math.round(v / 1e3) + 'K';
  else if (v >= 1e3) s = (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  else s = String(Math.round(v));
  return (sen < 0 ? '−' : '') + curSymbol(cur) + s;
}

// Plain number for CSV files: 1250 -> "12.50"
export const senToPlain = (sen) => (sen / 100).toFixed(2);

/* ---------------- Dates ----------------
   Dates are plain "YYYY-MM-DD" strings and times "HH:MM", in the phone's local time. */

export const pad = (n) => String(n).padStart(2, '0');
export const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const nowHM = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}
export function ymd(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.toISOString().slice(0, 10);
}
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function addDays(iso, n) {
  const { y, m, d } = parseISO(iso);
  return ymd(y, m, d + n);
}
// Adds months and keeps the day where possible (31 Jan + 1 month = 28/29 Feb).
export function addMonths(iso, n) {
  const { y, m, d } = parseISO(iso);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = first.getUTCFullYear();
  const tm = first.getUTCMonth() + 1;
  return ymd(ty, tm, Math.min(d, daysInMonth(ty, tm)));
}
export function weekday(iso) {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "Today", "Yesterday", "Tue, 24 Nov", or "Tue, 24 Nov 2025" for other years
export function dayLabel(iso, today = todayISO()) {
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  const { y, m, d } = parseISO(iso);
  const base = `${DOW[weekday(iso)]}, ${d} ${MON[m - 1]}`;
  return y === parseISO(today).y ? base : `${base} ${y}`;
}
export function shortDate(iso, withYear = false) {
  const { y, m, d } = parseISO(iso);
  return withYear ? `${d} ${MON[m - 1]} ${y}` : `${d} ${MON[m - 1]}`;
}
export function longDate(iso) {
  const { y, m, d } = parseISO(iso);
  return `${DOW_FULL[weekday(iso)]}, ${d} ${MONTH[m - 1]} ${y}`;
}

/* ---------------- Text ---------------- */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Short, stable fingerprint of a string (used to spot rows that were already imported).
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// "NASI KANDAR PELITA SS2" -> "Nasi Kandar Pelita SS2"
export function tidyName(s) {
  const clean = String(s || '').replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  if (!clean) return '';
  const shouting = clean === clean.toUpperCase();
  if (!shouting) return clean;
  return clean
    .split(' ')
    .map((w) => {
      if (/\d/.test(w) || (w.length <= 3 && /^[A-Z&]+$/.test(w) && !['THE', 'AND', 'DAN', 'BIN', 'KE', 'DI'].includes(w))) return w;
      return w.charAt(0) + w.slice(1).toLowerCase();
    })
    .join(' ');
}

export function initials(name) {
  const words = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// Small seeded random generator, so sample data comes out the same every time.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
