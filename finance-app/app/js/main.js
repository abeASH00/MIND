// Belanja: starts the app, moves between screens, and handles the PIN lock.

import * as st from './store.js';
import { todayISO } from './util.js';
import { toast, closeSheet } from './ui.js';
import { mountCharts } from './charts.js';
import { app, go, applyTheme, checkPin } from './app.js';
import * as capture from './capture.js';
import * as cloud from './cloud.js';
import home from './views/home.js';
import history from './views/history.js';
import edit from './views/edit.js';
import inbox from './views/inbox.js';
import more from './views/more.js';
import accounts from './views/accounts.js';
import account from './views/account.js';
import reports from './views/reports.js';
import budgets from './views/budgets.js';
import calendar from './views/calendar.js';
import bills from './views/bills.js';
import bill from './views/bill.js';
import categories from './views/categories.js';
import prefs from './views/prefs.js';
import data from './views/data.js';
import receipt from './views/receipt.js';
import welcome from './views/welcome.js';

const VIEWS = { home, history, add: edit, tx: edit, inbox, more, accounts, account, reports, budgets, calendar, bills, bill, categories, prefs, data, receipt, welcome };
const TAB = { home: 'home', history: 'history', tx: 'history', inbox: 'inbox', add: 'add' };

let current = null;
let currentKey = '';
const stack = [];

function route() {
  const h = decodeURIComponent(location.hash.replace(/^#/, '')) || 'home';
  const i = h.indexOf('-');
  return i < 0 ? { name: h, arg: '' } : { name: h.slice(0, i), arg: h.slice(i + 1) };
}

const needsWelcome = () => !st.S.settings.onboarded && !st.accounts(true).length && !st.categories().length;

function render(fromData = false) {
  const { name, arg } = route();
  if (needsWelcome() && !['welcome', 'data', 'prefs'].includes(name)) {
    location.replace('#welcome');
    return;
  }
  const view = VIEWS[name] || home;
  const key = `${name}-${arg}`;
  if (fromData && view === current && view.keep && key === currentKey) {
    tabs(name);
    return;
  }
  const el = document.getElementById('view');
  const y = window.scrollY;
  try {
    el.innerHTML = view.render(arg);
    current = view;
    view.mount?.(el, arg);
    mountCharts(el);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="empty">Something went wrong showing this screen.<br><a href="#home">Go to Home</a></div>`;
  }
  window.scrollTo(0, key === currentKey ? y : 0);
  currentKey = key;
  tabs(name);
}

function tabs(name) {
  const t = TAB[name] || 'more';
  document.querySelectorAll('nav.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === t));
  const n = capture.inboxCount();
  const c = document.getElementById('inbox-cnt');
  c.hidden = !n;
  c.textContent = n > 99 ? '99+' : String(n);
  document.querySelector('nav.tabs').hidden = name === 'welcome';
}

let queued = false;
function scheduleRender() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    render(true);
  });
}

/* ---------------- Taps ---------------- */

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a || a.closest('#sheet-root') || a.closest('#lock')) return;
  const name = a.dataset.act;
  if (name === 'back') {
    e.preventDefault();
    if (stack.length > 1) history.back();
    else go(current?.parent || '#home');
    return;
  }
  const fn = current && current.actions && current.actions[name];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve()
    .then(() => fn(a, e))
    .catch((err) => {
      console.error(err);
      toast(err && err.message ? err.message : 'Something went wrong. Try again.');
    });
});

window.addEventListener('hashchange', () => {
  const h = location.hash || '#home';
  if (stack.length > 1 && stack[stack.length - 2] === h) stack.pop();
  else stack.push(h);
  app.depth = stack.length - 1;
  closeSheet(true);
  render();
});

/* ---------------- PIN lock ---------------- */

let hiddenAt = 0;
function showLock() {
  if (!st.S.settings.pinHash) return;
  const el = document.getElementById('lock');
  const len = st.S.settings.pinLen || 4;
  let pin = '';
  let fails = 0;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  const draw = (msg = 'Enter your PIN') => {
    el.innerHTML = `<div class="lock-in"><h2 style="font-family:var(--display);margin:0">Belanja</h2><p class="muted" style="margin:0" role="status">${msg}</p>
      <div class="pins">${Array.from({ length: len }, (_, i) => `<i class="${i < pin.length ? 'f' : ''}"></i>`).join('')}</div>
      <div class="kp">${keys.map((k) => (k ? `<button type="button" class="kp-k" data-k="${k}" aria-label="${k === '⌫' ? 'Delete' : k}">${k}</button>` : '<span></span>')).join('')}</div>
      <button type="button" class="link" data-k="forgot">Forgot your PIN?</button></div>`;
  };
  draw();
  el.hidden = false;
  el.onclick = async (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'forgot') {
      draw('Without the PIN, the only way in is to clear this app’s data in your browser settings. If cloud backup is on, sign in again afterwards to get your data back.');
      return;
    }
    if (k === '⌫') pin = pin.slice(0, -1);
    else if (pin.length < len) pin += k;
    draw();
    if (pin.length === len) {
      if (await checkPin(pin)) {
        el.hidden = true;
        el.innerHTML = '';
      } else {
        fails++;
        pin = '';
        draw(fails >= 3 ? 'Wrong PIN again. Take your time.' : 'Wrong PIN. Try again.');
      }
    }
  };
}

/* ---------------- Coming back to the app ---------------- */

async function newDayCheck() {
  const t = todayISO();
  if (t !== app.today) {
    app.today = t;
    await st.runRecurring(t);
    render(true);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  if (st.S.settings.pinHash && hiddenAt && Date.now() - hiddenAt > (st.S.settings.lockAfter ?? 60) * 1000) showLock();
  newDayCheck();
  pull();
  shares();
});

function pull() {
  if (!st.S.settings.autoFetch) return;
  capture.fetchRemote().catch((e) => console.warn('Fetching notifications failed:', e.message));
}

async function shares() {
  if (app.demo) return;
  const s = await capture.takeShares();
  if (s.image) {
    app.pendingPhoto = s.image;
    go('#receipt');
  } else if (s.texts) {
    toast(s.texts === 1 ? 'Added the shared message to your inbox' : `Added ${s.texts} shared messages to your inbox`);
    go('#inbox');
  }
}

/* ---------------- Start ---------------- */

async function boot() {
  const persistent = await st.load(app.demo ? 'belanja-demo' : 'belanja');
  app.persistent = persistent;
  applyTheme();
  if (app.demo && !st.S.settings.onboarded) await st.loadSample(app.today);
  await capture.prepareInbox();
  await st.runRecurring(app.today);
  capture.tidyInbox();
  st.onChange((what) => {
    if (what === 'settings') applyTheme();
    scheduleRender();
  });
  app.refresh = () => render();
  stack.push(location.hash || '#home');
  render();
  if (st.S.settings.pinHash) showLock();
  if (!app.persistent) toast('This browser is blocking storage, so nothing you add will be kept after you close it.');
  if (app.demo) return;
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Offline support is off:', e));
  }
  cloud.start();
  await shares();
  pull();
  setInterval(() => { if (!document.hidden) pull(); }, 60000);
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('view').innerHTML = '<div class="empty">Belanja couldn’t start. Close it and open it again.</div>';
});
