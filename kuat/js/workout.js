// Kuat — today's workout: log every set, rest timer, supersets, swaps, and resume after closing.
// Every number you type is saved straight away (see Data.saveActiveSync).
import * as Data from './data.js';
import { html, raw, esc, icon, toast, openSheet, confirmSheet, metaJoin, $, $$, fmtW, fmtBig, fmtDur, fmtClock, fmtDate, toDisplay, fromDisplay, parseNum, unit, keepAwake, buzz, DAYS_LONG, emptyState } from './ui.js';
import { getExercise, exercisePicker, partName } from './exercises.js';
import { activePlan, dayFor, dayParts } from './plans.js';
import { lastPerformance, suggestFor, stepSetting, repText, targetLow } from './suggest.js';
import { newRecords, sessionVolume } from './stats.js';
import { startRest, stopRest, restoreTimer } from './tools.js';
import { syncReminderInfo } from './settings.js';
import { exerciseFigure } from './figures.js';

export { restoreTimer, startRest };

let A = null; // the active workout while this screen is open

function save() { if (A) Data.saveActiveSync(A); }
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

async function buildExercise(exId, sets, reps, sessions, s) {
  const ex = getExercise(exId);
  const last = lastPerformance(sessions, exId);
  const sug = ex ? suggestFor(ex, last, s, reps) : null;
  const n = Math.max(1, Math.min(10, sets || 3));
  return {
    uid: Data.uid('we'), exId, targetSets: n, reps: reps || null, feel: null, ss: null,
    sug: sug ? { kg: sug.kg, reps: sug.reps, headline: sug.headline, why: sug.why, ideas: sug.ideas || [] } : null,
    last: last ? { date: last.date, sets: last.sets } : null,
    sets: Array.from({ length: n }, () => ({ w: sug && sug.kg !== null && sug.kg !== undefined ? sug.kg : null, r: null, done: false })),
  };
}

export async function startWorkout(plan, day, ctx) {
  const existing = await Data.getActive();
  if (existing) { ctx.go('#/workout'); return; }
  const s = await Data.getSettings();
  const sessions = await Data.listSessions();
  const exercises = [];
  if (day) for (const pe of day.exercises) if (getExercise(pe.exId)) exercises.push(await buildExercise(pe.exId, pe.sets, pe.reps, sessions, s));
  A = { id: Data.uid('session'), planId: plan ? plan.id : null, dayId: day ? day.id : null, dayName: day ? day.name : 'Workout', startedAt: Date.now(), exercises };
  save();
  ctx.go('#/workout');
}

export async function renderWorkout(ctx) {
  A = await Data.getActive();
  if (!A) return renderStart(ctx);
  keepAwake(true);
  draw(ctx);
  const tick = setInterval(() => { const el = $('#wk-elapsed', ctx.view); if (el && A) el.textContent = fmtClock((Date.now() - A.startedAt) / 1000); }, 1000);
  ctx.onLeave(() => { clearInterval(tick); save(); });
  // Resume exactly where you left off: scroll to the exercise you were on.
  if (A.focusUid) setTimeout(() => { const c = $(`[data-card="${CSS.escape(A.focusUid)}"]`, ctx.view); if (c) c.scrollIntoView({ block: 'start' }); }, 50);
  wire(ctx);
}

// ---------- No workout running: choose what to do ----------
async function renderStart(ctx) {
  const plan = await activePlan();
  const today = dayFor(plan, new Date());
  ctx.mount(html`
    <div class="page-head"><div><h1>Workout</h1><div class="meta sub">${today ? `Today is ${today.name}.` : 'No workout planned today — train anyway if you like.'}</div></div></div>
    ${today ? html`<div class="card"><div class="kicker">Today · ${DAYS_LONG[new Date().getDay()]}</div><h3>${today.name}</h3>
      <p class="meta">${raw(metaJoin([`${today.exercises.length} exercises`, dayParts(today).map(partName).join(', ')]))}</p>
      <button class="btn block" data-act="start" data-day="${today.id}" style="margin-top:8px">${icon('play')} Start</button></div>` : ''}
    ${plan && plan.days.length ? html`<div class="section-title">Other days in ${plan.name}</div>
      <div class="list">${plan.days.filter((d) => !today || d.id !== today.id).map((d) => html`<button class="item" data-act="start" data-day="${d.id}"><div class="lead">${icon('dumbbell')}</div><div class="body"><div class="title">${d.name}</div><div class="sub">${raw(metaJoin([DAYS_LONG[d.weekday], `${d.exercises.length} exercises`]))}</div></div><div class="trail">${icon('play')}</div></button>`)}</div>` : ''}
    <div class="section-title">Or</div>
    <div class="list">
      <button class="item" data-act="empty"><div class="lead teal">${icon('plus')}</div><div class="body"><div class="title">Empty workout</div><div class="sub">Add exercises as you go</div></div></button>
      <a class="item" href="#/plans"><div class="lead">${icon('clipboard')}</div><div class="body"><div class="title">Choose a plan</div><div class="sub">Ready-made or your own</div></div></a>
    </div>`);
  ctx.on('start', (b) => startWorkout(plan, plan.days.find((d) => d.id === b.dataset.day), ctx));
  ctx.on('empty', () => startWorkout(null, null, ctx));
}

// ---------- Drawing the running workout ----------
function setRow(ex, we, i) {
  const st = we.sets[i];
  const isW = ex.type === 'w';
  const repPh = we.sug && we.sug.reps ? we.sug.reps : (ex.type === 'time' ? 30 : targetLow(we.reps, Data.settingsNow().goal));
  return html`<div class="set-row ${st.done ? 'done' : ''}" data-row="${we.uid}:${i}">
    <div class="n">${i + 1}</div>
    ${isW ? html`<div class="stepper"><button type="button" data-step="w" data-d="-1" aria-label="Lighter">−</button><input data-f="w" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" aria-label="Weight in ${unit()}, set ${i + 1}" placeholder="${unit()}" value="${st.w === null ? '' : toDisplay(st.w)}"><button type="button" data-step="w" data-d="1" aria-label="Heavier">+</button></div>`
      : html`<div class="meta center">${ex.type === 'time' ? 'Hold' : 'Bodyweight'}</div>`}
    <div class="stepper"><button type="button" data-step="r" data-d="-1" aria-label="Fewer">−</button><input data-f="r" type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" aria-label="${ex.type === 'time' ? 'Seconds' : 'Reps'}, set ${i + 1}" placeholder="${repPh}${ex.type === 'time' ? 's' : ''}" value="${st.r === null ? '' : st.r}"><button type="button" data-step="r" data-d="1" aria-label="More">+</button></div>
    <button type="button" class="tick ${st.done ? 'on' : ''}" data-tick aria-label="${st.done ? 'Set done — tap to undo' : 'Mark set done'}" aria-pressed="${st.done}"><span>${icon('check')}</span></button>
  </div>`;
}

function card(we, idx, ssLabel) {
  const ex = getExercise(we.exId) || { name: 'Missing exercise', type: 'w', part: 'full', fig: ['stand', 'stand'], gear: [] };
  const allDone = we.sets.length && we.sets.every((x) => x.done);
  const goal = Data.settingsNow().goal;
  const target = ex.type === 'time' ? `${we.targetSets} × ${we.reps || 30} s` : `${we.targetSets} × ${repText(we.reps, goal)} reps`;
  const lastTxt = we.last ? `Last time (${fmtDate(we.last.date)}): ${we.last.sets.map((s) => ex.type === 'w' ? `${toDisplay(s.w)}×${s.r}` : `${s.r}${ex.type === 'time' ? 's' : ''}`).join(', ')}${ex.type === 'w' ? ' ' + unit() : ''}` : 'First time doing this one.';
  return html`<div class="card ex-card ${allDone ? 'done-all' : ''}" data-card="${we.uid}">
    ${ssLabel ? html`<div class="ss-tag">${ssLabel}</div>` : ''}
    <div class="row between"><a class="ex-name" href="#/exercise/${encodeURIComponent(we.exId)}" style="color:inherit;text-decoration:none">${ex.name}</a><button class="icon-btn plain" data-act="ex-menu" data-uid="${we.uid}" aria-label="More options for ${ex.name}">${icon('edit')}</button></div>
    <div class="meta ex-meta">${raw(metaJoin([target, partName(ex.part)]))}</div>
    <div class="last-line">${lastTxt}</div>
    ${we.sug ? html`<div class="suggest"><b>${we.sug.headline}</b><div class="why">${we.sug.why}</div>${we.sug.ideas && we.sug.ideas.length ? html`<ul>${we.sug.ideas.map((x) => html`<li>${x}</li>`)}</ul>` : ''}</div>` : ''}
    <div class="sets-head"><span>Set</span><span>${ex.type === 'w' ? unit() + (ex.dbs === 2 ? ' each' : '') : ''}</span><span>${ex.type === 'time' ? 'Seconds' : 'Reps'}</span><span>Done</span></div>
    ${we.sets.map((_, i) => setRow(ex, we, i))}
    <div class="ex-actions">
      <button class="btn soft small" data-act="add-set" data-uid="${we.uid}">${icon('plus')} Set</button>
      <button class="btn ghost small" data-act="rm-set" data-uid="${we.uid}" ${we.sets.length <= 1 ? 'disabled' : ''}>${icon('minus')} Set</button>
      <button class="btn ghost small" data-act="swap" data-uid="${we.uid}">${icon('swap')} Swap</button>
    </div>
    ${allDone ? html`<div class="feel"><div class="q">How did that feel?</div>
      <div class="seg">${[['easy', 'Easy'], ['right', 'Just right'], ['hard', 'Hard']].map(([v, l]) => html`<button type="button" class="${we.feel === v ? 'on' : ''}" data-act="feel" data-uid="${we.uid}" data-v="${v}">${l}</button>`)}</div>
      ${we.feel === 'hard' ? html`<p class="meta" style="margin:8px 0 0">Noted — next time stays at this weight. If anything hurt (not just burned), skip it and rest.</p>` : ''}</div>` : ''}
  </div>`;
}

function draw(ctx) {
  const done = A.exercises.filter((e) => e.sets.length && e.sets.every((x) => x.done)).length;
  const letters = {};
  let n = 0;
  for (const e of A.exercises) if (e.ss && !letters[e.ss]) letters[e.ss] = String.fromCharCode(65 + n++);
  ctx.mount(html`
    <div class="card wk-top"><div class="grow"><div class="meta">${A.dayName}</div><div class="t num" id="wk-elapsed">${fmtClock((Date.now() - A.startedAt) / 1000)}</div></div>
      <div class="center"><div class="num" style="font-size:20px">${done}/${A.exercises.length}</div><div class="meta">exercises</div></div>
      <button class="btn small" data-act="finish">Finish</button></div>
    ${A.exercises.length ? '' : html`<div class="card flat tinted"><p class="small">Add your first exercise to get going.</p></div>`}
    ${A.exercises.map((we, i) => card(we, i, we.ss ? `Superset ${letters[we.ss]} · alternate sets` : ''))}
    <div class="btn-row" style="margin-top:12px"><button class="btn ghost" data-act="add-ex">${icon('plus')} Add exercise</button></div>
    <div class="btn-row" style="margin-top:10px"><a class="btn ghost small" href="#/tool/warmup">${icon('flame')} Warm-up</a><a class="btn ghost small" href="#/tool/cooldown">${icon('leaf')} Cool-down</a></div>
    <div class="btn-row" style="margin-top:10px"><button class="btn danger-ghost small" data-act="discard">Discard workout</button></div>
  `);
}

function redraw(ctx) {
  const y = window.scrollY;
  draw(ctx);
  window.scrollTo(0, y);
}

const findWE = (uid) => A.exercises.find((e) => e.uid === uid);

// ---------- Interaction ----------
function wire(ctx) {
  // Typing: save on every keystroke, no redraw (so the keyboard stays put).
  ctx.listen('input', (e) => {
    const inp = e.target.closest('[data-f]'); if (!inp || !A) return;
    const [uid, i] = inp.closest('[data-row]').dataset.row.split(':');
    const we = findWE(uid); if (!we) return;
    const st = we.sets[Number(i)];
    if (inp.dataset.f === 'w') { const kg = fromDisplay(inp.value); st.w = kg !== null && kg >= 0 && kg < 1000 ? kg : null; }
    else { const r = parseNum(inp.value); st.r = r !== null && r >= 0 && r < 10000 ? Math.round(r) : null; }
    A.focusUid = uid;
    save();
  });
  ctx.listen('click', async (e) => {
    if (!A) return;
    const step = e.target.closest('[data-step]');
    if (step) {
      const row = step.closest('[data-row]');
      const [uid, i] = row.dataset.row.split(':');
      const we = findWE(uid), ex = getExercise(we.exId) || { type: 'w' };
      const st = we.sets[Number(i)], dir = Number(step.dataset.d);
      if (step.dataset.step === 'w') {
        st.w = stepSetting(st.w, dir, Data.settingsNow());
        $('[data-f=w]', row).value = toDisplay(st.w);
      } else {
        const base = st.r ?? (we.sug && we.sug.reps) ?? targetLow(we.reps, Data.settingsNow().goal);
        const inc = ex.type === 'time' ? 5 : 1;
        st.r = Math.max(0, (st.r === null ? base : base + dir * inc));
        $('[data-f=r]', row).value = st.r;
      }
      A.focusUid = uid; save(); buzz(10);
      return;
    }
    const tick = e.target.closest('[data-tick]');
    if (tick) return onTick(ctx, tick);
  });

  ctx.on('feel', (b) => { const we = findWE(b.dataset.uid); we.feel = b.dataset.v; save(); redraw(ctx); });
  ctx.on('add-set', (b) => { const we = findWE(b.dataset.uid); const lastSet = we.sets[we.sets.length - 1]; we.sets.push({ w: lastSet ? lastSet.w : null, r: null, done: false }); save(); redraw(ctx); });
  ctx.on('rm-set', (b) => {
    const we = findWE(b.dataset.uid); if (we.sets.length <= 1) return;
    const idx = [...we.sets].reverse().findIndex((x) => !x.done);
    we.sets.splice(idx >= 0 ? we.sets.length - 1 - idx : we.sets.length - 1, 1);
    save(); redraw(ctx);
  });
  ctx.on('swap', (b) => swapExercise(ctx, findWE(b.dataset.uid)));
  ctx.on('ex-menu', (b) => exerciseMenu(ctx, findWE(b.dataset.uid)));
  ctx.on('add-ex', () => exercisePicker({ title: 'Add exercise', onPick: async (ex) => {
    const we = await buildExercise(ex.id, 3, ex.type === 'time' ? '30' : null, await Data.listSessions(), await Data.getSettings());
    A.exercises.push(we); A.focusUid = we.uid; save(); redraw(ctx);
    setTimeout(() => { const c = $(`[data-card="${CSS.escape(we.uid)}"]`, ctx.view); if (c) c.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 60);
  } }));
  ctx.on('discard', async () => {
    if (!await confirmSheet({ title: 'Discard this workout?', message: 'Nothing from this session will be saved.', yes: 'Discard', danger: true })) return;
    await Data.clearActive(); A = null; stopRest(); keepAwake(false); ctx.refresh();
  });
  ctx.on('finish', () => finish(ctx));
}

function onTick(ctx, tick) {
  const row = tick.closest('[data-row]');
  const [uid, i] = row.dataset.row.split(':');
  const we = findWE(uid), ex = getExercise(we.exId) || { type: 'w', heavy: false, name: 'Exercise' };
  const st = we.sets[Number(i)];
  st.done = !st.done;
  if (st.done) {
    if (st.r === null) st.r = (we.sug && we.sug.reps) || targetLow(we.reps, Data.settingsNow().goal) || (ex.type === 'time' ? 30 : 10);
    if (ex.type === 'w' && st.w === null && we.sug) st.w = we.sug.kg;
    buzz(25);
  }
  A.focusUid = uid;
  save();
  const allDone = we.sets.every((x) => x.done);
  if (!st.done) { redraw(ctx); return; }
  // Superset: go straight to the partner's matching set, rest after the pair.
  const partner = we.ss ? A.exercises.find((x) => x.ss === we.ss && x.uid !== we.uid) : null;
  const partnerPending = partner && partner.sets.findIndex((x) => !x.done);
  const s = Data.settingsNow();
  if (partner && partnerPending !== -1 && partnerPending <= Number(i) + (A.exercises.indexOf(we) < A.exercises.indexOf(partner) ? 0 : 1)) {
    const pex = getExercise(partner.exId);
    toast(`Now: ${pex ? pex.name : 'next exercise'}, set ${partnerPending + 1}`);
    redraw(ctx);
    setTimeout(() => { const r = $(`[data-row="${CSS.escape(partner.uid + ':' + partnerPending)}"]`, ctx.view); if (r) r.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 60);
    return;
  }
  const restSec = (ex.heavy || (partner && (getExercise(partner.exId) || {}).heavy)) ? s.restHeavy : s.restLight;
  const nextIdx = we.sets.findIndex((x) => !x.done);
  if (!allDone || nextExercise(we)) startRest(restSec, allDone ? 'Rest — next exercise when ready' : `Rest — then set ${nextIdx + 1}`);
  redraw(ctx);
  if (allDone) setTimeout(() => { const c = $(`[data-card="${CSS.escape(uid)}"] .feel`, ctx.view); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 60);
}
const nextExercise = (we) => A.exercises.slice(A.exercises.indexOf(we) + 1).find((e) => e.sets.some((x) => !x.done)) || A.exercises.find((e) => e !== we && e.sets.some((x) => !x.done));

function exerciseMenu(ctx, we) {
  const ex = getExercise(we.exId);
  const i = A.exercises.indexOf(we);
  const next = A.exercises[i + 1];
  openSheet({
    title: ex ? ex.name : 'Exercise', noFoot: false, cancelLabel: 'Close',
    body: html`<div class="list">
      ${we.ss ? html`<button class="item" data-m="unpair"><div class="lead teal">${icon('link')}</div><div class="body"><div class="title">Undo superset</div><div class="sub">Do the exercises separately again</div></div></button>`
        : next ? html`<button class="item" data-m="pair"><div class="lead teal">${icon('link')}</div><div class="body"><div class="title">Superset with the next exercise</div><div class="sub">${(getExercise(next.exId) || {}).name || ''} — alternate sets, rest after each pair</div></div></button>` : ''}
      <button class="item" data-m="up" ${i === 0 ? 'disabled' : ''}><div class="lead">${icon('up')}</div><div class="body"><div class="title">Move up</div></div></button>
      <button class="item" data-m="down" ${i === A.exercises.length - 1 ? 'disabled' : ''}><div class="lead">${icon('down')}</div><div class="body"><div class="title">Move down</div></div></button>
      <button class="item" data-m="swap"><div class="lead">${icon('swap')}</div><div class="body"><div class="title">Swap for a similar exercise</div><div class="sub">Same muscles</div></div></button>
      <button class="item" data-m="remove"><div class="lead" style="color:var(--danger)">${icon('trash')}</div><div class="body"><div class="title">Remove from this workout</div></div></button>
    </div>${ex ? html`<div class="figure" style="margin-top:12px">${raw(exerciseFigure(ex))}</div>` : ''}`,
    onOpen: (el, api) => el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-m]'); if (!b || b.disabled) return;
      api.close();
      const m = b.dataset.m;
      if (m === 'pair' && next) { const g = Data.uid('ss'); if (next.ss) A.exercises.filter((x) => x.ss === next.ss).forEach((x) => (x.ss = null)); we.ss = g; next.ss = g; }
      if (m === 'unpair') A.exercises.filter((x) => x.ss === we.ss).forEach((x) => (x.ss = null));
      if (m === 'up' && i > 0) [A.exercises[i - 1], A.exercises[i]] = [A.exercises[i], A.exercises[i - 1]];
      if (m === 'down' && i < A.exercises.length - 1) [A.exercises[i + 1], A.exercises[i]] = [A.exercises[i], A.exercises[i + 1]];
      if (m === 'swap') return swapExercise(ctx, we);
      if (m === 'remove') {
        if (we.sets.some((x) => x.done) && !await confirmSheet({ title: 'Remove this exercise?', message: 'Sets you ticked for it won’t be saved.', yes: 'Remove', danger: true })) return;
        if (we.ss) A.exercises.filter((x) => x.ss === we.ss).forEach((x) => (x.ss = null));
        A.exercises.splice(A.exercises.indexOf(we), 1);
      }
      save(); redraw(ctx);
    }),
  });
}

function swapExercise(ctx, we) {
  const ex = getExercise(we.exId);
  exercisePicker({ title: 'Swap for…', part: ex ? ex.part : null, exclude: we.exId, onPick: async (n) => {
    const s = await Data.getSettings();
    const fresh = await buildExercise(n.id, we.sets.length, n.type === 'time' ? (we.reps && ex && ex.type === 'time' ? we.reps : '30') : (ex && ex.type === 'time' ? null : we.reps), await Data.listSessions(), s);
    const oldId = we.exId;
    we.exId = n.id; we.sug = fresh.sug; we.last = fresh.last; we.feel = null; we.reps = fresh.reps;
    we.sets = we.sets.map((st, i) => (st.done ? st : fresh.sets[i] || { w: null, r: null, done: false }));
    save(); redraw(ctx);
    if (A.planId && A.dayId) {
      const plan = await Data.getPlan(A.planId);
      const day = plan && plan.days.find((d) => d.id === A.dayId);
      const pe = day && day.exercises.find((x) => x.exId === oldId);
      if (pe && await confirmSheet({ title: 'Remember this swap?', message: `Use ${n.name} instead of ${ex ? ex.name : 'the old exercise'} in “${day.name}” from now on?`, yes: 'Yes, update my plan', no: 'Just today' })) {
        pe.exId = n.id; if (n.type === 'time' && !pe.reps) pe.reps = '30';
        await Data.savePlan(plan); toast('Plan updated.');
      }
    }
  } });
}

// ---------- Finish ----------
async function finish(ctx) {
  const anyDone = A.exercises.some((e) => e.sets.some((x) => x.done));
  if (!anyDone) {
    if (await confirmSheet({ title: 'No sets ticked yet', message: 'There’s nothing to save. Discard this workout?', yes: 'Discard', danger: true })) { await Data.clearActive(); A = null; stopRest(); keepAwake(false); ctx.refresh(); }
    return;
  }
  const pending = A.exercises.reduce((n, e) => n + e.sets.filter((x) => !x.done).length, 0);
  if (pending && !await confirmSheet({ title: 'Finish now?', message: `${pending} set${pending === 1 ? '' : 's'} not ticked. Only ticked sets are saved — and that’s completely fine.`, yes: 'Finish' })) return;
  const endedAt = Date.now();
  const sessions = await Data.listSessions();
  const session = {
    id: A.id, startedAt: A.startedAt, endedAt, duration: Math.round((endedAt - A.startedAt) / 1000), planId: A.planId, dayName: A.dayName,
    exercises: A.exercises.map((e) => ({ exId: e.exId, name: (getExercise(e.exId) || {}).name || '', feel: e.feel, sets: e.sets.filter((x) => x.done).map((x) => ({ w: x.w, r: x.r })) })).filter((e) => e.sets.length),
  };
  session.totalKg = sessionVolume(session, getExercise);
  session.pbs = newRecords(session, sessions, getExercise);
  await Data.saveSession(session);
  await Data.clearActive();
  A = null; stopRest(); keepAwake(false);
  syncReminderInfo();
  showSummary(ctx, session, sessions.length + 1);
}

function showSummary(ctx, session, count) {
  const line = session.pbs.length ? `You beat ${session.pbs.length} personal best${session.pbs.length === 1 ? '' : 's'} today. Lovely work.`
    : count === 1 ? 'Your first session is in the book. The hardest one is done.'
    : session.duration < 900 ? 'Short and done still counts. Nicely fitted in.' : 'Solid session. Rest up and come back fresh.';
  const pbText = (p) => { const ex = getExercise(p.exId) || { name: 'Exercise' }; return p.kind === 'heaviest' ? `${ex.name}: heaviest yet, ${fmtW(p.w)} × ${p.r}` : p.kind === 'best' ? `${ex.name}: best set, ${fmtW(p.w)} × ${p.r}` : p.kind === 'hold' ? `${ex.name}: longest hold, ${p.r} s` : `${ex.name}: most reps, ${p.r}`; };
  ctx.mount(html`
    <div class="hero" style="margin-top:8px"><div class="hello">Workout done</div><h1 style="color:#fff">${session.dayName}</h1><div class="line">${line}</div></div>
    <div class="card"><div class="summary-big">
      <div><div class="value">${fmtDur(session.duration)}</div><div class="label">total time</div></div>
      <div><div class="value">${fmtBig(session.totalKg)}</div><div class="label">${unit()} lifted</div></div>
      <div><div class="value">${session.exercises.reduce((n, e) => n + e.sets.length, 0)}</div><div class="label">sets</div></div></div></div>
    ${session.pbs.length ? html`<div class="card"><div class="kicker">Personal bests</div>${session.pbs.map((p) => html`<div class="kv"><span class="k">${icon('trophy', ' width="16" height="16"')}</span><span class="v" style="font-weight:500;text-align:left;flex:1">${pbText(p)}</span></div>`)}</div>` : ''}
    <div class="card"><div class="kicker">What you did</div>${session.exercises.map((e) => { const ex = getExercise(e.exId) || { name: e.name, type: 'w' }; return html`<div class="kv"><span class="k">${ex.name}</span><span class="v">${e.sets.map((s) => ex.type === 'w' ? `${toDisplay(s.w)}×${s.r}` : `${s.r}${ex.type === 'time' ? 's' : ''}`).join(', ')}</span></div>`; })}</div>
    <div class="btn-row" style="margin-top:12px"><a class="btn ghost" href="#/tool/cooldown">${icon('leaf')} Cool-down</a><a class="btn" href="#/home">Done</a></div>
  `);
}
