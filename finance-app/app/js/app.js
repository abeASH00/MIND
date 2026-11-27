// Belanja: things every screen needs: moving between screens, today's date,
// demo mode, the theme and the PIN lock.

import { todayISO, uid } from './util.js';
import * as st from './store.js';

export const app = {
  demo: typeof window !== 'undefined' && !!window.BELANJA_DEMO,
  today: todayISO(),
  depth: 0, // how many screens deep we are, so Back knows where to go
  refresh: () => {},
  prefill: null, // details handed to the transaction form (from the inbox, a receipt, Duplicate)
  pendingPhoto: null, // a photo shared from another app, waiting for the receipt screen
  historyFilter: null,
};

export function go(hash) {
  if (location.hash === hash) app.refresh();
  else location.hash = hash;
}

export function back(fallback = '#home') {
  if (app.depth > 0) history.back();
  else go(fallback);
}

export const opts = () => ({ monthStart: st.S.settings.monthStart || 1, weekStart: st.S.settings.weekStart ?? 1 });
export const baseCur = () => st.S.settings.base || 'MYR';

export function applyTheme() {
  const t = st.S.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.body).backgroundColor || '#EEF2EF';
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The PIN is never stored, only a scrambled fingerprint of it.
export async function setPin(pin) {
  if (!pin) return st.setSettings({ pinHash: '', pinSalt: '' });
  const salt = uid();
  return st.setSettings({ pinSalt: salt, pinHash: await sha256(salt + pin) });
}
export async function checkPin(pin) {
  return (await sha256(st.S.settings.pinSalt + pin)) === st.S.settings.pinHash;
}
