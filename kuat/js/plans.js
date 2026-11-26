// Kuat — plans: ready-made dumbbell plans, your own plans, and "what's planned for which day".
import * as Data from './data.js';
import { html, raw, esc, icon, openSheet, confirmSheet, toast, DAYS_SHORT, DAYS_LONG, metaJoin, emptyState, $, $$ } from './ui.js';
import { getExercise, allExercises, exercisePicker } from './exercises.js';
import { repText } from './suggest.js';

const PRESET_VERSION = 1;
const d = (exId, sets = 3, reps = null) => ({ exId, sets, reps });

// weekday: 0 = Sunday … 6 = Saturday. reps null = use the rep range from your goal.
export const PRESETS = [
  { id: 'preset-full3', name: 'Full body, 3 days', suits: 'Good all-rounder if you can train three times a week.', days: [
    { name: 'Full body A', weekday: 1, exercises: [d('goblet-squat'), d('floor-press'), d('one-arm-row'), d('overhead-press'), d('glute-bridge'), d('plank', 3, '30')] },
    { name: 'Full body B', weekday: 3, exercises: [d('rdl'), d('push-up'), d('bent-row'), d('lateral-raise'), d('reverse-lunge'), d('dead-bug', 3, '10')] },
    { name: 'Full body C', weekday: 5, exercises: [d('split-squat'), d('squeeze-press'), d('renegade-row', 3, '8'), d('curl', 2), d('overhead-extension', 2), d('side-plank', 2, '25')] },
  ] },
  { id: 'preset-ul4', name: 'Upper / lower, 4 days', suits: 'For when you have four days and want a bit more on each muscle.', days: [
    { name: 'Upper A', weekday: 1, exercises: [d('floor-press'), d('one-arm-row'), d('seated-press'), d('reverse-fly'), d('curl', 2), d('skull-crusher', 2)] },
    { name: 'Lower A', weekday: 2, exercises: [d('goblet-squat'), d('rdl'), d('reverse-lunge'), d('calf-raise'), d('plank', 3, '30')] },
    { name: 'Upper B', weekday: 4, exercises: [d('push-up'), d('bent-row'), d('arnold-press'), d('lateral-raise'), d('hammer-curl', 2), d('kickback', 2)] },
    { name: 'Lower B', weekday: 5, exercises: [d('split-squat'), d('single-leg-rdl'), d('step-up'), d('glute-bridge'), d('russian-twist', 3, '16')] },
  ] },
  { id: 'preset-ppl', name: 'Push / pull / legs', suits: 'Splits pushing, pulling and leg work — nice if you like focused sessions.', days: [
    { name: 'Push', weekday: 1, exercises: [d('floor-press'), d('overhead-press'), d('squeeze-press'), d('lateral-raise'), d('overhead-extension'), d('chair-dip', 2)] },
    { name: 'Pull', weekday: 3, exercises: [d('one-arm-row'), d('bent-row'), d('pullover'), d('reverse-fly'), d('curl'), d('hammer-curl', 2)] },
    { name: 'Legs', weekday: 5, exercises: [d('goblet-squat'), d('rdl'), d('split-squat'), d('glute-bridge'), d('calf-raise'), d('plank', 3, '30')] },
  ] },
  { id: 'preset-express', name: 'Express 20 minutes', suits: 'Short on time? Five moves, done in about twenty minutes.', days: [
    { name: 'Express A', weekday: 2, exercises: [d('thruster', 3, '10'), d('one-arm-row', 3, '10'), d('push-up', 2), d('reverse-lunge', 2, '10'), d('plank', 2, '30')] },
    { name: 'Express B', weekday: 4, exercises: [d('goblet-squat', 3, '10'), d('floor-press', 3, '10'), d('bent-row', 2, '10'), d('db-swing', 2, '15'), d('dead-bug', 2, '10')] },
    { name: 'Express A', weekday: 6, exercises: [d('thruster', 3, '10'), d('one-arm-row', 3, '10'), d('push-up', 2), d('reverse-lunge', 2, '10'), d('plank', 2, '30')] },
  ] },
  { id: 'preset-beginner', name: 'First month (beginner)', suits: 'New to this? Simple moves, two sets each, to learn good form. Add a third set in weeks 3–4 if it feels good.', days: [
    { name: 'Day 1', weekday: 1, exercises: [d('goblet-squat', 2, '10'), d('incline-push-up', 2, '8'), d('one-arm-row', 2, '10'), d('glute-bridge', 2, '12'), d('plank', 2, '20')] },
    { name: 'Day 2', weekday: 3, exercises: [d('reverse-lunge', 2, '8'), d('floor-press', 2, '10'), d('seated-press', 2, '10'), d('curl', 2, '10'), d('dead-bug', 2, '8')] },
    { name: 'Day 3', weekday: 5, exercises: [d('goblet-squat', 2, '10'), d('incline-push-up', 2, '8'), d('one-arm-row', 2, '10'), d('glute-bridge', 2, '12'), d('plank', 2, '20')] },
  ] },
];

// Put the ready-made plans into storage the first time the app runs.
export async function ensurePresets() {
  const seeded = await Data.getKV('presetVersion');
  if (seeded >= PRESET_VERSION) return;
  const existing = new Set((await Data.listPlans()).map((p) => p.id));
  for (const p of PRESETS) if (!existing.has(p.id)) await Data.savePlan(freshPreset(p));
  await Data.setKV('presetVersion', PRESET_VERSION);
}
function freshPreset(p) {
  return { ...JSON.parse(JSON.stringify(p)), preset: true, createdAt: Date.now(), days: p.days.map((day) => ({ ...day, id: Data.uid('day'), exercises: day.exercises.map((e) => ({ ...e, uid: Data.uid('pe') })) })) };
}

export async function activePlan() {
  const s = await Data.getSettings();
  return (s.activePlanId && await Data.getPlan(s.activePlanId)) || null;
}

// The planned day (if any) for a date.
export function dayFor(plan, date) {
  if (!plan) return null;
  const wd = new Date(date).getDay();
  return plan.days.find((x) => x.weekday === wd) || null;
}
export function upcoming(plan, from = new Date(), count = 4) {
  const out = [];
  if (!plan || !plan.days.length) return out;
  const dt = new Date(from); dt.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 14 && out.length < count; i++) {
    const x = new Date(dt); x.setDate(dt.getDate() + i);
    const day = dayFor(plan, x);
    if (day) out.push({ date: x, day });
  }
  return out;
}
export function dayParts(day) {
  const parts = new Set();
  for (const e of day.exercises || []) { const ex = getExercise(e.exId); if (ex) parts.add(ex.part); }
  return [...parts];
}

// ---------- Screens ----------
export async function renderPlans(ctx) {
  const plans = await Data.listPlans();
  const s = await Data.getSettings();
  plans.sort((a, b) => (b.id === s.activePlanId) - (a.id === s.activePlanId) || (a.preset === b.preset ? 0 : a.preset ? 1 : -1) || (a.createdAt || 0) - (b.createdAt || 0));
  const item = (p) => html`
    <a class="item" href="#/plan/${encodeURIComponent(p.id)}">
      <div class="lead ${p.id === s.activePlanId ? 'teal' : ''}">${icon(p.id === s.activePlanId ? 'check' : 'clipboard')}</div>
      <div class="body"><div class="title">${p.name}</div>
        <div class="sub">${raw(metaJoin([p.days.map((x) => DAYS_SHORT[x.weekday]).join(', '), `${p.days.length} day${p.days.length === 1 ? '' : 's'}`, p.id === s.activePlanId ? 'Your current plan' : '']))}</div>
        ${p.suits ? html`<div class="sub">${p.suits}</div>` : ''}</div>
      <div class="trail">${icon('chev')}</div>
    </a>`;
  ctx.mount(html`
    <button class="back-btn" data-act="back">${icon('back')} More</button>
    <div class="page-head"><div><h1>Plans</h1><div class="meta sub">Pick one to follow, or build your own.</div></div></div>
    <div class="section-title">Yours</div>
    ${plans.filter((p) => !p.preset).length ? html`<div class="list">${plans.filter((p) => !p.preset).map(item)}</div>` : html`<div class="card flat tinted"><p class="small">You haven’t built a plan yet. Tap “New plan” to make one.</p></div>`}
    <div class="section-title">Ready-made</div>
    <div class="list">${plans.filter((p) => p.preset).map(item)}</div>
    <button class="fab" data-act="new">${icon('plus')} New plan</button>
  `);
  ctx.on('back', () => ctx.go('#/more'));
  ctx.on('new', () => newPlanSheet(ctx));
}

function newPlanSheet(ctx) {
  const picked = new Set([1, 3, 5]);
  openSheet({
    title: 'New plan',
    body: html`<label class="field"><span>Name</span><input class="input" name="name" maxlength="60" placeholder="e.g. My home routine" autocomplete="off"></label>
      <div class="field-label">Training days</div>
      <div class="days">${[1, 2, 3, 4, 5, 6, 0].map((wd) => html`<button type="button" class="pill ${picked.has(wd) ? 'on' : ''}" data-wd="${wd}" aria-pressed="${picked.has(wd)}">${DAYS_SHORT[wd]}</button>`)}</div>
      <p class="meta" style="margin-top:12px">You’ll add exercises to each day next.</p>`,
    onOpen: (el) => el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-wd]'); if (!b) return;
      const wd = Number(b.dataset.wd);
      picked.has(wd) ? picked.delete(wd) : picked.add(wd);
      b.classList.toggle('on', picked.has(wd)); b.setAttribute('aria-pressed', picked.has(wd));
    }),
    saveLabel: 'Create',
    onSave: async (el) => {
      const name = $('[name=name]', el).value.trim();
      if (!name) { toast('Give your plan a name first.'); return false; }
      if (!picked.size) { toast('Pick at least one day.'); return false; }
      const days = [...picked].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((wd, i) => ({ id: Data.uid('day'), name: `Day ${i + 1}`, weekday: wd, exercises: [] }));
      const plan = { id: Data.uid('plan'), name: name.slice(0, 60), days, preset: false, createdAt: Date.now() };
      await Data.savePlan(plan);
      ctx.go(`#/plan/${encodeURIComponent(plan.id)}`);
    },
  });
}

export async function renderPlan(ctx, id) {
  const plan = await Data.getPlan(id);
  const s = await Data.getSettings();
  if (!plan) { ctx.mount(emptyState('clipboard', 'That plan isn’t here any more.', '<a class="btn" href="#/plans">All plans</a>')); return; }
  const isActive = s.activePlanId === plan.id;
  const dayCard = (day, di) => html`
    <div class="card">
      <div class="card-head"><div><div class="kicker">${DAYS_LONG[day.weekday]}</div><h3>${day.name}</h3></div>
        <button class="icon-btn plain" data-act="day-edit" data-d="${di}" aria-label="Rename or change day">${icon('edit')}</button></div>
      ${day.exercises.length ? html`<div class="list" style="box-shadow:none">${day.exercises.map((pe, i) => {
        const ex = getExercise(pe.exId);
        return html`<div class="item static">
          <div class="body"><div class="title">${ex ? ex.name : 'Missing exercise'}</div>
            <div class="sub">${raw(metaJoin([`${pe.sets} sets`, ex && ex.type === 'time' ? `${pe.reps || 30} s` : `${repText(pe.reps, s.goal)} reps`]))}</div></div>
          <div class="order-btns">
            <button class="icon-btn plain" data-act="up" data-d="${di}" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
            <button class="icon-btn plain" data-act="down" data-d="${di}" data-i="${i}" aria-label="Move down" ${i === day.exercises.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
            <button class="icon-btn plain" data-act="ex-menu" data-d="${di}" data-i="${i}" aria-label="Edit, swap or remove">${icon('edit')}</button>
          </div></div>`;
      })}</div>` : html`<p class="meta">No exercises yet.</p>`}
      <div class="btn-row" style="margin-top:10px"><button class="btn soft small" data-act="add" data-d="${di}">${icon('plus')} Add exercise</button></div>
    </div>`;
  ctx.mount(html`
    <button class="back-btn" data-act="back">${icon('back')} Plans</button>
    <div class="page-head"><div><h1>${plan.name}</h1>${plan.suits ? html`<div class="meta sub">${plan.suits}</div>` : ''}</div></div>
    <div class="btn-row" style="margin-bottom:12px">
      ${isActive ? html`<div class="badge teal" style="padding:10px 14px">${icon('check', ' width="16" height="16"')} Your current plan</div>` : html`<button class="btn" data-act="activate">Follow this plan</button>`}
      <button class="btn ghost" data-act="rename">Rename</button>
    </div>
    ${plan.days.map(dayCard)}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" data-act="add-day">${icon('plus')} Add a day</button>
      ${plan.preset ? html`<button class="btn ghost" data-act="reset">Reset to original</button>` : ''}
      <button class="btn danger-ghost" data-act="delete">Delete plan</button>
    </div>
  `);
  const save = async () => { await Data.savePlan(plan); renderPlan(ctx, id); };
  ctx.on('back', () => ctx.go('#/plans'));
  ctx.on('activate', async () => { await Data.saveSettings({ activePlanId: plan.id }); toast('Following this plan now.'); renderPlan(ctx, id); });
  ctx.on('rename', () => openSheet({ title: 'Rename plan', body: html`<label class="field"><span>Name</span><input class="input" name="n" maxlength="60" value="${plan.name}"></label>`,
    onSave: async (el) => { const v = $('[name=n]', el).value.trim(); if (!v) return false; plan.name = v.slice(0, 60); await save(); } }));
  ctx.on('up', (b) => { const day = plan.days[b.dataset.d], i = +b.dataset.i; [day.exercises[i - 1], day.exercises[i]] = [day.exercises[i], day.exercises[i - 1]]; save(); });
  ctx.on('down', (b) => { const day = plan.days[b.dataset.d], i = +b.dataset.i; [day.exercises[i + 1], day.exercises[i]] = [day.exercises[i], day.exercises[i + 1]]; save(); });
  ctx.on('add', (b) => exercisePicker({ title: 'Add exercise', onPick: async (ex) => { plan.days[b.dataset.d].exercises.push({ uid: Data.uid('pe'), exId: ex.id, sets: 3, reps: ex.type === 'time' ? '30' : null }); await save(); } }));
  ctx.on('ex-menu', (b) => planExerciseSheet(plan, plan.days[b.dataset.d], +b.dataset.i, save, s));
  ctx.on('day-edit', (b) => daySheet(plan, +b.dataset.d, save));
  ctx.on('add-day', () => {
    const used = new Set(plan.days.map((x) => x.weekday));
    const wd = [1, 2, 3, 4, 5, 6, 0].find((x) => !used.has(x));
    if (wd === undefined) { toast('Every day of the week already has a workout.'); return; }
    plan.days.push({ id: Data.uid('day'), name: `Day ${plan.days.length + 1}`, weekday: wd, exercises: [] });
    plan.days.sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
    save();
  });
  ctx.on('reset', async () => {
    if (!await confirmSheet({ title: 'Reset this plan?', message: 'Your changes to this ready-made plan will be undone. Your logged workouts are not affected.', yes: 'Reset' })) return;
    const orig = PRESETS.find((p) => p.id === plan.id);
    if (orig) { await Data.savePlan(freshPreset(orig)); renderPlan(ctx, id); }
  });
  ctx.on('delete', async () => {
    if (!await confirmSheet({ title: 'Delete this plan?', message: 'The plan goes, but every workout you logged with it stays.', yes: 'Delete', danger: true })) return;
    await Data.deletePlan(plan.id);
    if (isActive) await Data.saveSettings({ activePlanId: '' });
    ctx.go('#/plans');
  });
}

function daySheet(plan, di, save) {
  const day = plan.days[di];
  const taken = new Set(plan.days.filter((x, i) => i !== di).map((x) => x.weekday));
  openSheet({
    title: 'Edit day',
    body: html`<label class="field"><span>Name</span><input class="input" name="n" maxlength="40" value="${day.name}"></label>
      <label class="field"><span>Weekday</span><select class="input" name="wd">${[1, 2, 3, 4, 5, 6, 0].map((wd) => html`<option value="${wd}" ${wd === day.weekday ? 'selected' : ''} ${taken.has(wd) ? 'disabled' : ''}>${DAYS_LONG[wd]}${taken.has(wd) ? ' (used)' : ''}</option>`)}</select></label>
      <button type="button" class="btn danger-ghost block" data-remove>Remove this day</button>`,
    onOpen: (el, api) => $('[data-remove]', el).addEventListener('click', async () => {
      api.close();
      if (await confirmSheet({ title: 'Remove this day?', message: `${day.name} and its exercise list will be removed from the plan.`, yes: 'Remove', danger: true })) { plan.days.splice(di, 1); save(); }
    }),
    onSave: (el) => {
      day.name = ($('[name=n]', el).value.trim() || day.name).slice(0, 40);
      day.weekday = Number($('[name=wd]', el).value);
      plan.days.sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
      save();
    },
  });
}

function planExerciseSheet(plan, day, i, save, s) {
  const pe = day.exercises[i];
  const ex = getExercise(pe.exId);
  const timed = ex && ex.type === 'time';
  openSheet({
    title: ex ? ex.name : 'Exercise',
    body: html`<div class="grid2">
        <label class="field"><span>Sets</span><input class="input" name="sets" inputmode="numeric" pattern="[0-9]*" value="${pe.sets}"></label>
        <label class="field"><span>${timed ? 'Seconds' : 'Reps'}</span><input class="input" name="reps" inputmode="text" maxlength="7" placeholder="${timed ? '30' : repText(null, s.goal)}" value="${pe.reps || ''}"></label>
      </div>
      <p class="meta">${timed ? 'How long to hold each set.' : 'Leave reps empty to use the range from your goal, or type a number like 10 or a range like 8-12.'}</p>
      <div class="btn-row" style="margin-top:8px"><button type="button" class="btn ghost" data-swap>${icon('swap')} Swap</button><button type="button" class="btn danger-ghost" data-remove>${icon('trash')} Remove</button></div>`,
    onOpen: (el, api) => {
      $('[data-swap]', el).addEventListener('click', () => { api.close(); exercisePicker({ title: 'Swap for…', part: ex ? ex.part : null, exclude: pe.exId, onPick: (n) => { pe.exId = n.id; if (n.type === 'time' && !pe.reps) pe.reps = '30'; save(); } }); });
      $('[data-remove]', el).addEventListener('click', () => { api.close(); day.exercises.splice(i, 1); save(); });
    },
    onSave: (el) => {
      const sets = Math.round(Number($('[name=sets]', el).value));
      pe.sets = Number.isFinite(sets) && sets > 0 ? Math.min(sets, 10) : pe.sets;
      const r = $('[name=reps]', el).value.trim().replace(/\s+/g, '');
      pe.reps = /^\d{1,3}(-\d{1,3})?$/.test(r) ? r : null;
      save();
    },
  });
}

// Used by Home search.
export async function searchPlans(q) {
  const plans = await Data.listPlans();
  const out = [];
  for (const p of plans) {
    if (p.name.toLowerCase().includes(q)) out.push({ plan: p });
    for (const day of p.days) if (day.name.toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) out.push({ plan: p, day });
  }
  return out.slice(0, 8);
}
export { allExercises };
