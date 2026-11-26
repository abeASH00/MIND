// Kuat — starts the app: loads settings, picks the screen from the address (#/home etc.),
// applies the theme, registers the offline helper (service worker) and shows the first-open note.
import * as Data from './data.js';
import { $, $$, html, icon, openSheet, closeTopSheet, toast, setupKeyboardHandling, unlockAudio, esc } from './ui.js';
import { loadExercises, renderLibrary, renderExercise } from './exercises.js';
import { ensurePresets, renderPlans, renderPlan } from './plans.js';
import { renderHome } from './home.js';
import { renderWorkout, restoreTimer } from './workout.js';
import { renderProgress } from './progress.js';
import { renderTool } from './tools.js';
import { renderMore, renderSettings, applyTheme, syncReminderInfo } from './settings.js';

const view = $('#view');
let cleanup = [];

// The "ctx" every screen receives.
function makeCtx(params) {
  const handlers = {};
  const onClick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !view.contains(b) || b.disabled) return;
    const fn = handlers[b.dataset.act];
    if (fn) { e.preventDefault(); fn(b, e); }
  };
  view.addEventListener('click', onClick);
  cleanup.push(() => view.removeEventListener('click', onClick));
  return {
    view, params,
    mount(markup) { view.innerHTML = String(markup); },
    on(act, fn) { handlers[act] = fn; },
    go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
    refresh() { route(); },
    onLeave(fn) { cleanup.push(fn); },
  };
}

const TAB_OF = { home: 'home', workout: 'workout', exercises: 'exercises', exercise: 'exercises', progress: 'progress', more: 'more', plans: 'more', plan: 'more', settings: 'more', tool: 'home' };

async function route() {
  cleanup.forEach((f) => { try { f(); } catch { /* ignore */ } });
  cleanup = [];
  while (closeTopSheet()) { /* close any open sheets when changing screen */ }
  const parts = (location.hash || '#/home').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const name = parts[0] || 'home';
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === (TAB_OF[name] || 'home')));
  $$('#nav a').forEach((a) => (a.dataset.tab === (TAB_OF[name] || 'home') ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const ctx = makeCtx(parts.slice(1));
  try {
    switch (name) {
      case 'home': await renderHome(ctx); break;
      case 'workout': await renderWorkout(ctx); break;
      case 'exercises': renderLibrary(ctx); break;
      case 'exercise': await renderExercise(ctx, parts[1]); break;
      case 'progress': await renderProgress(ctx, parts[1]); break;
      case 'more': await renderMore(ctx); break;
      case 'plans': await renderPlans(ctx); break;
      case 'plan': await renderPlan(ctx, parts[1]); break;
      case 'settings': await renderSettings(ctx); break;
      case 'tool': await renderTool(ctx, parts[1]); break;
      default: location.replace('#/home'); return;
    }
  } catch (err) {
    console.error(err);
    view.innerHTML = String(html`<div class="card"><h3>Something went wrong</h3><p class="small">${err && err.message ? err.message : 'Unknown error'}</p><p class="meta">Your data is safe. Try going back to Home.</p><a class="btn" href="#/home">Home</a></div>`);
  }
  if (!ctx.keepScroll) window.scrollTo(0, 0);
}

// First open: a short, calm safety and privacy note.
function safetyNote() {
  openSheet({
    title: 'Before you start',
    body: html`
      <p>A few calm notes from your training partner:</p>
      <ul class="bullets">
        <li>Start lighter than you think. You can always go up next time.</li>
        <li>Learn the movement first; the weight comes later.</li>
        <li>Muscle burn is fine. Sharp or joint pain is not — stop if you feel it.</li>
        <li>If you have an injury or a health condition, check with a doctor before starting.</li>
      </ul>
      <div class="card teal" style="margin-top:14px"><div class="privacy-note">${icon('lock')}<div>
        <b>Everything stays on this phone.</b> No account, no tracking, nothing sent anywhere.
        Please don’t store ID numbers, bank details or medical records in the app.
        Export a backup now and then (More → Settings) because phones can clear app data.</div></div></div>`,
    saveLabel: 'Got it', cancelLabel: 'Later',
    onSave: async () => { await Data.saveSettings({ onboarded: true }); },
  });
}

// Service worker: keeps the app working offline. When a new version is ready we offer a refresh.
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const offer = (w) => toast('A new version of Kuat is ready.', { action: 'Refresh', onAction: () => w.postMessage('skipWaiting') });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => { /* offline support unavailable here */ });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

async function start() {
  const s = await Data.getSettings();
  applyTheme(s.theme);
  await loadExercises();
  await ensurePresets();
  setupKeyboardHandling();
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('hashchange', route);
  if (!location.hash) history.replaceState(null, '', '#/home');
  await route();
  restoreTimer();
  registerSW();
  Data.requestPersist();
  syncReminderInfo();
  if (Data.usingFallback()) toast('This browser is blocking storage, so nothing will be saved. Try normal (not private) browsing.', { ms: 9000 });
  if (!s.onboarded) safetyNote();
}

start().catch((e) => {
  console.error(e);
  view.innerHTML = `<div class="card"><h3>Kuat couldn’t start</h3><p class="small">${esc(e && e.message)}</p></div>`;
});
