// Kuat — the More tab, Settings, backup, and optional reminders.
import * as Data from './data.js';
import { html, raw, esc, icon, openSheet, confirmSheet, toast, $, $$, avatarHTML, downloadBlob, dayKey, parseNum, toDisplay, fromDisplay, unit, fmtDate, DAYS_SHORT } from './ui.js';
import { GOALS, dumbbellSettings } from './suggest.js';
import { activePlan } from './plans.js';

// ---------- Theme ----------
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  $$('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0c1322' : '#f3f8ff'));
}

// ---------- Backup helpers ----------
export function backupAgeDays(s) { return s.lastBackupAt ? Math.floor((Date.now() - s.lastBackupAt) / 864e5) : null; }
export async function doExport() {
  try {
    const blob = await Data.exportBackup();
    downloadBlob(blob, `kuat-backup-${dayKey()}.json`);
    toast('Backup saved to your downloads. Keep it somewhere safe, like your cloud drive.');
  } catch (e) { toast('The backup couldn’t be made: ' + (e.message || 'unknown error')); }
}
function doImport(after) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const ok = await confirmSheet({ title: 'Restore this backup?', message: 'Everything currently in the app will be replaced by what’s in the backup file. This can’t be undone.', yes: 'Replace my data', danger: true });
    if (!ok) return;
    try {
      const r = await Data.importBackup(file);
      toast(`Restored ${r.sessions} workouts, ${r.plans} plans and ${r.photos} photos.`);
      setTimeout(() => location.reload(), 900);
    } catch (e) { toast(e.message || 'That file couldn’t be restored.'); }
    after && after();
  });
  input.click();
}

// ---------- More tab ----------
export async function renderMore(ctx) {
  const s = await Data.getSettings();
  const age = backupAgeDays(s);
  const row = (href, ic, title, sub, teal = false) => html`<a class="item" href="${href}"><div class="lead ${teal ? 'teal' : ''}">${icon(ic)}</div><div class="body"><div class="title">${title}</div><div class="sub">${sub}</div></div><div class="trail">${icon('chev')}</div></a>`;
  ctx.mount(html`
    <div class="page-head"><div><h1>More</h1></div>${avatarHTML(s, 'lg')}</div>
    <div class="list">
      ${row('#/plans', 'clipboard', 'Plans', 'Ready-made plans and your own')}
      ${row('#/tool/rest', 'timer', 'Rest timer', 'Presets or your own time')}
      ${row('#/tool/interval', 'interval', 'Interval timer', 'Work, rest, rounds')}
      ${row('#/tool/calc', 'calc', 'Weight calculator', 'Dumbbell settings and kg ↔ lb')}
      ${row('#/tool/warmup', 'flame', 'Warm-up', 'Matched to today’s workout')}
      ${row('#/tool/cooldown', 'leaf', 'Cool-down', 'Stretches with a timer each')}
    </div>
    <div class="section-title">You</div>
    <div class="list">
      ${row('#/settings', 'gear', 'Settings', 'Name, units, dumbbells, goal, rest times, looks')}
      <button class="item" data-act="export"><div class="lead teal">${icon('download')}</div><div class="body"><div class="title">Back up now</div><div class="sub">${age === null ? 'You haven’t made a backup yet' : age === 0 ? 'Last backup today' : `Last backup ${age} day${age === 1 ? '' : 's'} ago`}</div></div></button>
    </div>
    <div class="card teal" style="margin-top:14px"><div class="privacy-note">${icon('lock')}<div><b>Private by design.</b> Kuat has no account, no analytics and no tracking. Your workouts, notes and photos never leave this phone unless you export a backup yourself.</div></div></div>
    <p class="meta center" style="margin-top:18px">Kuat · works offline · made for one</p>
  `);
  ctx.on('export', async () => { await doExport(); renderMore(ctx); });
}

// ---------- Settings ----------
export async function renderSettings(ctx) {
  const s = await Data.getSettings();
  const age = backupAgeDays(s);
  const list = dumbbellSettings(s);
  const seg = (name, cur, opts) => html`<div class="seg" data-seg="${name}">${opts.map(([v, l]) => html`<button type="button" class="${String(cur) === String(v) ? 'on' : ''}" data-v="${v}">${l}</button>`)}</div>`;
  const sw = (name, on, label, sub = '') => html`<div class="check" style="justify-content:space-between"><div><b style="font-weight:500">${label}</b>${sub ? html`<div class="meta">${sub}</div>` : ''}</div><label class="switch"><input type="checkbox" data-sw="${name}" ${on ? 'checked' : ''} aria-label="${label}"><span></span></label></div>`;
  ctx.mount(html`
    <button class="back-btn" data-act="back">${icon('back')} More</button>
    <div class="page-head"><h1>Settings</h1></div>

    <div class="card ${age === null || age > 14 ? 'warn' : 'teal'}">
      <div class="banner">${icon('shield')}<div class="grow"><b>Backup</b><div class="small">${age === null ? 'No backup yet.' : `Last backup ${age === 0 ? 'today' : age + ' day' + (age === 1 ? '' : 's') + ' ago'}.`} Phone browsers can clear app data if an app isn’t opened for a few weeks, so export a backup every week or two and keep the file in your cloud drive or email it to yourself.</div></div></div>
      <div class="btn-row" style="margin-top:12px"><button class="btn" data-act="export">${icon('download')} Export backup</button><button class="btn ghost" data-act="import">${icon('upload')} Import</button></div>
    </div>

    <div class="section-title">You</div>
    <div class="card">
      <div class="row" style="margin-bottom:14px">${avatarHTML(s, 'lg')}<div class="grow"><button class="btn soft small" data-act="photo">${s.photo ? 'Change photo' : 'Add photo'}</button>${s.photo ? html` <button class="link-btn" data-act="photo-remove">Remove</button>` : ''}</div></div>
      <label class="field" style="margin:0"><span>Your name</span><input class="input" data-f="name" maxlength="40" value="${s.name}" placeholder="What should Kuat call you?" autocomplete="off"></label>
    </div>

    <div class="section-title">Training</div>
    <div class="card">
      <div class="field-label">Goal</div>
      <div class="pills" style="margin-bottom:6px">${Object.entries(GOALS).map(([k, g]) => html`<button type="button" class="pill ${s.goal === k ? 'on' : ''}" data-goal="${k}">${g.name}</button>`)}</div>
      <p class="meta">${GOALS[s.goal] ? `${GOALS[s.goal].reps[0]}–${GOALS[s.goal].reps[1]} reps. ${GOALS[s.goal].note}` : ''}</p>
      <hr class="div">
      <label class="field"><span>Sessions per week you’re aiming for</span><input class="input" data-f="weeklyTarget" inputmode="numeric" pattern="[0-9]*" value="${s.weeklyTarget}"></label>
      <div class="grid2">
        <label class="field" style="margin:0"><span>Rest, big moves (sec)</span><input class="input" data-f="restHeavy" inputmode="numeric" pattern="[0-9]*" value="${s.restHeavy}"></label>
        <label class="field" style="margin:0"><span>Rest, small moves (sec)</span><input class="input" data-f="restLight" inputmode="numeric" pattern="[0-9]*" value="${s.restLight}"></label>
      </div>
    </div>

    <div class="section-title">Dumbbells and gear</div>
    <div class="card">
      <div class="field-label">Units</div>
      ${seg('units', s.units, [['kg', 'kg'], ['lb', 'lb']])}
      <div class="grid2" style="margin-top:14px">
        <label class="field"><span>Lightest (kg)</span><input class="input" data-f="dbMin" inputmode="decimal" value="${s.dbMin}"></label>
        <label class="field"><span>Heaviest (kg)</span><input class="input" data-f="dbMax" inputmode="decimal" value="${s.dbMax}"></label>
      </div>
      <label class="field"><span>Step between settings (kg)</span><input class="input" data-f="dbStep" inputmode="decimal" value="${s.dbStep}"></label>
      <p class="meta">Your settings: ${list.map((w) => toDisplay(w)).join(', ')} ${unit()} per dumbbell. Every weight suggestion uses this list. (Dumbbell setup is entered in kg, the way most dials are marked.)</p>
      <hr class="div">
      <div class="field-label">Other gear you have</div>
      ${[['mat', 'Mat'], ['chair', 'Sturdy chair'], ['bench', 'Bench'], ['band', 'Resistance band']].map(([k, l]) => html`<label class="check"><input type="checkbox" data-gear="${k}" ${s.gear[k] ? 'checked' : ''}> ${l}</label>`)}
    </div>

    <div class="section-title">Look and feel</div>
    <div class="card">
      <div class="field-label">Appearance</div>
      ${seg('theme', s.theme, [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Automatic']])}
      <div style="margin-top:10px">${sw('sound', s.sound, 'Sounds', 'Beeps when a timer ends')}${sw('vibrate', s.vibrate, 'Vibration', 'If your phone supports it')}</div>
    </div>

    <div class="section-title">Reminders (optional)</div>
    <div class="card">
      ${sw('reminders', s.reminders.enabled, 'Remind me on planned days', 'Best effort — see the note below')}
      <label class="field" style="margin-top:10px"><span>Time</span><input class="input" type="time" data-f="remTime" value="${s.reminders.time}"></label>
      <button class="btn ghost block" data-act="ics">${icon('calendar')} Add plan days to my phone’s calendar</button>
      <p class="meta" style="margin-top:10px">Honest note: a website can’t reliably send a reminder at a set time without a server, and Kuat has no server on purpose. While the app is open you’ll get a notice. Some Android phones may also check in the background now and then. On iPhone, notifications only work when Kuat is added to the home screen, and even then aren’t guaranteed. The most reliable option is the calendar button: it makes a file your calendar app can import, with an alert on each planned day.</p>
    </div>

    <div class="section-title">Privacy</div>
    <div class="card"><div class="privacy-note">${icon('lock')}<div class="small">
      Nothing leaves your phone. No account, no analytics, no tracking, no outside scripts or fonts. Photos are kept on this device only.
      Please don’t store ID numbers, bank details or medical records in Kuat — it isn’t built to protect that kind of information.</div></div></div>

    <div class="section-title">Danger zone</div>
    <div class="card">
      <p class="small">Deleting removes every workout, plan, note, measurement and photo from this phone. Export a backup first if you might want them back.</p>
      <button class="btn danger-ghost block" data-act="reset">${icon('trash')} Delete all my data</button>
    </div>
    <div class="spacer"></div>
  `);

  const save = async (patch, rerender = false) => { await Data.saveSettings(patch); if (rerender) renderSettings(ctx); };
  ctx.view.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.f) {
      const f = t.dataset.f, v = t.value.trim();
      if (f === 'name') return save({ name: v.slice(0, 40) });
      if (f === 'remTime') { await save({ reminders: { ...(await Data.getSettings()).reminders, time: /^\d\d:\d\d$/.test(v) ? v : '18:00' } }); return syncReminderInfo(); }
      const n = parseNum(v);
      if (f === 'weeklyTarget') return save({ weeklyTarget: n && n > 0 ? Math.min(7, Math.round(n)) : 3 }, true);
      if (f === 'restHeavy' || f === 'restLight') return save({ [f]: n && n > 0 ? Math.min(600, Math.round(n)) : (f === 'restHeavy' ? 120 : 60) }, true);
      if (f === 'dbMin' || f === 'dbMax' || f === 'dbStep') {
        const cur = await Data.getSettings();
        const next = { dbMin: cur.dbMin, dbMax: cur.dbMax, dbStep: cur.dbStep, [f]: n };
        if (!(next.dbMin > 0 && next.dbMax >= next.dbMin && next.dbStep > 0 && next.dbMax <= 200)) { toast('Those dumbbell numbers don’t add up — check lightest, heaviest and step.'); return renderSettings(ctx); }
        return save(next, true);
      }
    }
    if (t.dataset.gear) { const cur = await Data.getSettings(); return save({ gear: { ...cur.gear, [t.dataset.gear]: t.checked } }); }
    if (t.dataset.sw) {
      const k = t.dataset.sw;
      if (k === 'reminders') {
        const cur = await Data.getSettings();
        if (t.checked) await askNotify();
        await save({ reminders: { ...cur.reminders, enabled: t.checked } });
        return syncReminderInfo();
      }
      return save({ [k]: t.checked });
    }
  });
  ctx.view.addEventListener('click', async (e) => {
    const segBtn = e.target.closest('[data-seg] button');
    if (segBtn) {
      const key = segBtn.closest('[data-seg]').dataset.seg, v = segBtn.dataset.v;
      if (key === 'theme') applyTheme(v);
      return save({ [key]: v }, true);
    }
    const g = e.target.closest('[data-goal]');
    if (g) return save({ goal: g.dataset.goal }, true);
  });
  ctx.on('back', () => ctx.go('#/more'));
  ctx.on('export', async () => { await doExport(); renderSettings(ctx); });
  ctx.on('import', () => doImport());
  ctx.on('photo', () => pickPhoto(async (url) => { await save({ photo: url }, true); }));
  ctx.on('photo-remove', () => save({ photo: '' }, true));
  ctx.on('ics', () => exportCalendar());
  ctx.on('reset', async () => {
    if (!await confirmSheet({ title: 'Delete everything?', message: 'Every workout, plan, note, measurement and photo will be permanently removed from this phone. This cannot be undone.', yes: 'Continue', danger: true })) return;
    if (!await confirmSheet({ title: 'Are you completely sure?', message: 'Last check. If you haven’t exported a backup, your data will be gone for good.', yes: 'Delete all my data', danger: true })) return;
    await Data.resetAll();
    toast('All data deleted.');
    setTimeout(() => { location.hash = '#/home'; location.reload(); }, 600);
  });
}

// Profile photo: shrunk to 256 px on the phone, stored on the phone.
export function pickPhoto(onDone, maxSize = 256, quality = 0.85) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f || !f.type.startsWith('image/')) return;
    try { onDone(await resizeImage(f, maxSize, quality)); } catch { toast('That photo couldn’t be read.'); }
  });
  input.click();
}
export function resizeImage(file, maxSize, quality = 0.85, asBlob = false) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      if (asBlob) c.toBlob((b) => (b ? resolve(b) : reject(new Error('resize failed'))), 'image/jpeg', quality);
      else resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

// ---------- Reminders ----------
async function askNotify() {
  if (!('Notification' in window)) { toast('This browser doesn’t support notifications. The calendar option still works.'); return false; }
  if (Notification.permission === 'granted') return true;
  const p = await Notification.requestPermission();
  if (p !== 'granted') toast('Notifications are off for Kuat. You can still use the calendar option.');
  return p === 'granted';
}

let reminderTimer = null;
// Writes a small summary the service worker can read, and sets an in-app timer for today.
export async function syncReminderInfo() {
  const s = await Data.getSettings();
  const plan = await activePlan();
  const sessions = await Data.listSessions();
  const last = sessions.length ? dayKey(sessions[sessions.length - 1].startedAt) : '';
  const info = { enabled: !!s.reminders.enabled, time: s.reminders.time, days: plan ? plan.days.map((x) => x.weekday) : [], lastTrained: last };
  await Data.setKV('reminderInfo', info);
  clearTimeout(reminderTimer);
  if (!info.enabled) return;
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready : null;
    if (reg && 'periodicSync' in reg) {
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' }).catch(() => null);
      if (st && st.state === 'granted') await reg.periodicSync.register('kuat-reminder', { minInterval: 6 * 60 * 60 * 1000 });
    }
  } catch { /* not supported — that's fine */ }
  const now = new Date();
  const [hh, mm] = info.time.split(':').map(Number);
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
  if (info.days.includes(now.getDay()) && last !== dayKey(now) && at > now) {
    reminderTimer = setTimeout(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (Notification.permission === 'granted') reg.showNotification('Kuat', { body: 'There’s a workout planned for today, whenever suits you.', icon: './icons/icon-192.png', tag: 'kuat-reminder' });
        else toast('There’s a workout planned for today, whenever suits you.');
      } catch { toast('There’s a workout planned for today, whenever suits you.'); }
    }, Math.min(at - now, 2 ** 31 - 1));
  }
}

// Calendar file (.ics): one weekly repeating event per planned day, with an alert.
async function exportCalendar() {
  const s = await Data.getSettings();
  const plan = await activePlan();
  if (!plan || !plan.days.length) { toast('Choose a plan first (More → Plans).'); return; }
  const codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const [hh, mm] = s.reminders.time.split(':').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const icsText = (t) => String(t).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\r?\n/g, ' ');
  let out = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Kuat//Workouts//EN\r\nCALSCALE:GREGORIAN\r\n';
  for (const day of plan.days) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    while (d.getDay() !== day.weekday) d.setDate(d.getDate() + 1);
    const start = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(hh)}${pad(mm)}00`;
    const endD = new Date(d); endD.setHours(hh, mm + 45);
    const end = `${endD.getFullYear()}${pad(endD.getMonth() + 1)}${pad(endD.getDate())}T${pad(endD.getHours())}${pad(endD.getMinutes())}00`;
    out += `BEGIN:VEVENT\r\nUID:kuat-${icsText(plan.id)}-${day.weekday}@kuat.local\r\nDTSTAMP:${stamp}\r\nDTSTART:${start}\r\nDTEND:${end}\r\nRRULE:FREQ=WEEKLY;BYDAY=${codes[day.weekday]}\r\nSUMMARY:${icsText('Kuat: ' + day.name)}\r\nDESCRIPTION:${icsText('Workout from your plan "' + plan.name + '". Open Kuat when you’re ready.')}\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:${icsText('Kuat: ' + day.name)}\r\nTRIGGER:PT0M\r\nEND:VALARM\r\nEND:VEVENT\r\n`;
  }
  out += 'END:VCALENDAR\r\n';
  downloadBlob(new Blob([out], { type: 'text/calendar' }), 'kuat-plan.ics');
  toast('Calendar file saved. Open it to add the events to your calendar.');
}
