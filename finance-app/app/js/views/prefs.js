// Belanja: Settings. Look, money options, PIN lock, automatic capture and cloud backup.

import * as st from '../store.js';
import { esc } from '../util.js';
import { ordinal } from '../calc.js';
import { icon } from '../icons.js';
import { openSheet, pickAccount, toast, confirmBox } from '../ui.js';
import { app, setPin } from '../app.js';
import * as capture from '../capture.js';
import * as cloud from '../cloud.js';

export const VERSION = '1.0.0';
let healthMsg = '';

function sw(id, on, label, sub = '') {
  return `<label class="field" for="${id}"><span class="v" style="display:grid"><span style="white-space:normal">${label}</span>${sub ? `<span class="small muted" style="font-weight:400;white-space:normal">${sub}</span>` : ''}</span><span class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></span></label>`;
}

function render() {
  const s = st.S.settings;
  const cs = cloud.getStatus();
  const acc = st.idx().acc.get(s.defaultAccountId);
  let html = `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>Settings</h1></div></header>
    <h2 class="sec">Look</h2>
    <div class="seg-ctl">${[['system', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']].map(([k, v]) => `<button type="button" class="${(s.theme || 'system') === k ? 'on' : ''}" data-act="theme" data-v="${k}">${v}</button>`).join('')}</div>
    <h2 class="sec">Money</h2>
    <div class="fields">
      <div class="field"><span class="k">Month starts</span><select id="p-ms" aria-label="Month starts on day">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${(s.monthStart || 1) === i + 1 ? 'selected' : ''}>On the ${ordinal(i + 1)}</option>`).join('')}</select></div>
      <div class="field"><span class="k">Week starts</span><select id="p-ws" aria-label="Week starts on">${[[1, 'Monday'], [0, 'Sunday']].map(([v, l]) => `<option value="${v}" ${(s.weekStart ?? 1) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <button type="button" class="field" data-act="defAcc"><span class="k">Usual account</span><span class="v ${acc ? '' : 'placeholder'}"><span>${acc ? esc(acc.name) : 'The last one you used'}</span></span><span class="chev">${icon('next', 16)}</span></button>
    </div>
    <p class="muted small">Paid on the 25th? Start the month on the 25th and budgets run from payday to payday.</p>
    <h2 class="sec">Lock</h2>
    <div class="fields">
      <button type="button" class="field" data-act="pin"><span class="k">PIN</span><span class="v"><span>${s.pinHash ? 'On' : 'Off'}</span></span><span class="chev">${icon('lock', 16)}</span></button>
      ${s.pinHash ? `<div class="field"><span class="k">Ask again</span><select id="p-la" aria-label="Ask for the PIN again after">${[[0, 'Every time'], [60, 'After 1 minute away'], [300, 'After 5 minutes away'], [900, 'After 15 minutes away']].map(([v, l]) => `<option value="${v}" ${(s.lockAfter ?? 60) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
    </div>
    <h2 class="sec">Automatic capture</h2>`;
  if (app.demo) html += `<div class="card"><p class="muted small" style="margin:0">Not in the demo. In your own copy, payments from your bank and e-wallet notifications arrive in the Inbox by themselves, and receipt photos are read by AI.</p></div>`;
  else {
    html += `<div class="fields">
      <label class="field" for="p-server"><span class="k">Server</span><input id="p-server" value="${esc(s.server || '')}" placeholder="Leave empty if Belanja runs on it" autocomplete="off" inputmode="url"></label>
      <label class="field" for="p-key"><span class="k">App key</span><input id="p-key" type="password" value="${esc(s.appKey || '')}" placeholder="The APP_KEY you chose" autocomplete="off"></label>
      ${sw('p-auto', s.autoFetch !== false, 'Check for new payments every minute')}
      ${sw('p-ai', s.useAI !== false, 'Let AI read unclear messages', 'Costs a little per message on your Anthropic account. Plain rules read most messages for free.')}
    </div>
    <div class="row-btns"><button type="button" class="btn" data-act="test">Test the connection</button><button type="button" class="btn" data-act="howto">How to set up</button></div>
    ${healthMsg ? `<p class="small" role="status">${esc(healthMsg)}</p>` : ''}`;
  }
  html += `<h2 class="sec">Cloud backup</h2>`;
  if (app.demo) html += `<div class="card"><p class="muted small" style="margin:0">Not in the demo. In your own copy you can sign in with Google to back up to your own Firebase and use Belanja on more than one phone.</p></div>`;
  else if (!s.cloud) {
    html += `<div class="card"><p class="muted small" style="margin:0 0 8px">Back up to your own Firebase project and sync between phones. Paste the <b>firebaseConfig</b> block from the Firebase console (Project settings › Your apps).</p>
      <textarea class="input" id="p-fb" placeholder="const firebaseConfig = { apiKey: ..., authDomain: ..., projectId: ... }"></textarea>
      <div class="row-btns"><button type="button" class="btn primary" data-act="fbSave">Save</button></div></div>`;
  } else {
    html += `<div class="card"><div style="display:flex;gap:8px;align-items:center">${icon('cloud', 18)}<b>${esc(cs.message || '')}</b></div>
      ${s.cloudLastSync ? `<p class="muted small" style="margin:6px 0 0">Last synced ${new Date(s.cloudLastSync).toLocaleString('en-MY')}</p>` : ''}
      <div class="row-btns">${cloud.currentUser() ? '<button type="button" class="btn" data-act="fbSync">Sync now</button><button type="button" class="btn" data-act="fbOut">Sign out</button>' : '<button type="button" class="btn primary" data-act="fbIn">Sign in with Google</button>'}</div>
      <button type="button" class="link" data-act="fbRemove" style="margin-top:10px">Remove cloud settings from this phone</button></div>`;
  }
  const n = st.txs().length;
  html += `<h2 class="sec">About</h2><div class="card small"><div>Belanja ${VERSION}${app.demo ? ' (demo)' : ''}</div><div class="muted">${n} transaction${n === 1 ? '' : 's'}, ${st.accounts(true).length} accounts, ${st.categories().length} categories.</div>
    <div class="muted">${app.persistent ? 'Saved on this phone.' : 'This browser is blocking storage, so nothing is kept after you close it.'}</div>
    <div style="margin-top:8px"><a href="#data">Import, export and backups</a></div></div>`;
  return html;
}

function mount(el) {
  const on = (id, ev, fn) => { const x = el.querySelector(id); if (x) x.addEventListener(ev, fn); };
  on('#p-ms', 'change', (e) => st.setSettings({ monthStart: Number(e.target.value) }));
  on('#p-ws', 'change', (e) => st.setSettings({ weekStart: Number(e.target.value) }));
  on('#p-la', 'change', (e) => st.setSettings({ lockAfter: Number(e.target.value) }, true));
  on('#p-server', 'change', (e) => st.setSettings({ server: e.target.value.trim() }, true));
  on('#p-key', 'change', (e) => st.setSettings({ appKey: e.target.value.trim() }, true));
  on('#p-auto', 'change', (e) => st.setSettings({ autoFetch: e.target.checked }, true));
  on('#p-ai', 'change', (e) => st.setSettings({ useAI: e.target.checked }, true));
}

function pinSheet() {
  const s = st.S.settings;
  openSheet({
    title: s.pinHash ? 'Change or remove PIN' : 'Set a PIN',
    body: `<p class="muted small">4 to 6 digits. Belanja asks for it when you open the app. There's no way to recover a forgotten PIN except clearing the app's data, so pick one you'll remember.</p>
      <input class="input" id="pin1" type="password" inputmode="numeric" maxlength="6" placeholder="New PIN" autocomplete="off">
      <input class="input" id="pin2" type="password" inputmode="numeric" maxlength="6" placeholder="Type it again" autocomplete="off">
      <div class="row-btns">${s.pinHash ? '<button type="button" class="btn" data-pick="off">Turn PIN off</button>' : ''}<button type="button" class="btn primary" data-pick="set">Save PIN</button></div>`,
    onPick: (v) => {
      if (v === 'off') { setPin('').then(() => toast('PIN turned off')); return false; }
      const a = document.getElementById('pin1').value;
      const b = document.getElementById('pin2').value;
      if (!/^\d{4,6}$/.test(a)) { toast('Use 4 to 6 digits.'); return true; }
      if (a !== b) { toast("The two PINs don't match."); return true; }
      st.setSettings({ pinLen: a.length }, true).then(() => setPin(a)).then(() => toast('PIN saved'));
      return false;
    },
  });
}

export default {
  render,
  mount,
  parent: '#more',
  actions: {
    theme: (b) => st.setSettings({ theme: b.dataset.v }),
    defAcc: async () => {
      const id = await pickAccount({ current: st.S.settings.defaultAccountId, title: 'Usual account for new expenses' });
      if (id) st.setSettings({ defaultAccountId: id });
    },
    pin: () => pinSheet(),
    test: async () => {
      healthMsg = 'Checking…';
      app.refresh();
      try {
        const h = await capture.health();
        healthMsg = `Connected. ${h.ai ? `AI is on (${h.model}).` : 'AI is off: add the ANTHROPIC_API_KEY secret to turn it on.'} ${h.waiting ? `${h.waiting} message(s) waiting.` : ''}`;
      } catch (e) {
        healthMsg = e.message;
      }
      app.refresh();
    },
    howto: () => openSheet({
      title: 'Automatic capture',
      body: `<ol class="small" style="padding-left:18px;margin:0;display:grid;gap:8px">
        <li>Your Belanja server runs on Cloudflare (see SETUP.md, step 2). Choose an app key: a long password only you know.</li>
        <li>Put the same app key in the box above, and tap Test the connection.</li>
        <li>Install <b>MacroDroid</b> from the Play Store. New macro: trigger <b>Notification received</b>, pick your bank and e-wallet apps.</li>
        <li>Action: <b>HTTP request</b>, method POST, to <span class="num">${esc((st.S.settings.server || location.origin).replace(/\/+$/, ''))}/api/notify</span>. Add query parameters key = your app key, app = the app name, title = the notification title, text = the notification text (use MacroDroid's ... button to insert them).</li>
        <li>Pay for something small. Within a minute it shows up in your Inbox.</li></ol>`,
    }),
    fbSave: () => {
      try {
        const cfg = cloud.parseConfig(document.getElementById('p-fb').value);
        st.setSettings({ cloud: cfg }).then(() => cloud.start());
        toast('Saved. Now sign in with Google.');
      } catch (e) {
        toast(e.message);
      }
    },
    fbIn: async () => {
      try { await cloud.signIn(); } catch (e) { toast(e.code === 'auth/unauthorized-domain' ? 'Add this website to Firebase › Authentication › Settings › Authorized domains first.' : e.message || 'Sign-in failed'); }
    },
    fbOut: async () => { await cloud.signOut(); toast('Signed out. Your data stays on this phone.'); app.refresh(); },
    fbSync: async () => { await cloud.sync(); toast(cloud.getStatus().message); },
    fbRemove: async () => {
      if (!(await confirmBox('Remove the cloud settings from this phone? Your cloud copy stays in Firebase.', { ok: 'Remove' }))) return;
      await cloud.signOut().catch(() => {});
      await st.setSettings({ cloud: null });
      location.reload();
    },
  },
};

cloud.onStatus(() => { if (location.hash === '#prefs') app.refresh(); });
