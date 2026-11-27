// Kuat — Progress: totals, charts per exercise, personal bests, calendar, body logs, photos.
import * as Data from './data.js';
import { html, raw, esc, icon, openSheet, confirmSheet, toast, metaJoin, emptyState, fmtW, fmtBig, fmtDur, fmtDate, fmtDateLong, toDisplay, fromDisplay, parseNum, unit, dayKey, parseDayKey, $, $$, revealSelectedPills, KG_PER_LB } from './ui.js';
import { getExercise, partName } from './exercises.js';
import { PARTS } from './exercise-data.js';
import { totals, weekRange, monthRange, sessionsInRange, personalBests, exerciseSeries, trainedDays, weekStreak, bestWeekStreak, sessionVolume } from './stats.js';
import { lineChart, barChart } from './charts.js';
import { activePlan, dayFor } from './plans.js';
import { resizeImage } from './settings.js';

const TABS = [['overview', 'Overview'], ['exercises', 'Exercises'], ['records', 'Records'], ['calendar', 'Calendar'], ['body', 'Body']];
let period = 'week';
let calMonth = null;

export async function renderProgress(ctx, tab = 'overview') {
  const sessions = await Data.listSessions();
  if (tab === 'day') { const k = ctx.params[1]; calMonth = parseDayKey(k); tab = 'calendar'; setTimeout(() => daySheet(k, sessions, ctx), 50); }
  if (tab === 'ex' && ctx.params[1]) return exerciseChart(ctx, ctx.params[1], sessions);
  if (!TABS.some(([t]) => t === tab)) tab = 'overview';
  let body = '';
  if (tab === 'overview') body = overview(sessions);
  if (tab === 'exercises') body = exerciseList(sessions);
  if (tab === 'records') body = records(sessions);
  if (tab === 'calendar') body = await calendar(sessions);
  if (tab === 'body') body = await bodyTab();
  ctx.mount(html`
    <div class="page-head"><div><h1>Progress</h1><div class="meta sub">${sessions.length ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} logged so far.` : 'Your numbers will show up here after your first workout.'}</div></div></div>
    <div class="pills" role="tablist">${TABS.map(([t, l]) => html`<button class="pill ${t === tab ? 'on' : ''}" role="tab" aria-selected="${t === tab}" data-act="tab" data-v="${t}">${l}</button>`)}</div>
    ${raw(body)}
  `);
  revealSelectedPills(ctx.view);
  ctx.on('tab', (b) => ctx.go(`#/progress/${b.dataset.v}`));
  ctx.on('period', (b) => { period = b.dataset.v; ctx.refresh(); });
  ctx.on('cal', (b) => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + Number(b.dataset.d), 1); ctx.refresh(); });
  ctx.on('day', (b) => daySheet(b.dataset.k, sessions, ctx));
  ctx.on('add-body', () => bodySheet(ctx));
  ctx.on('add-measure', () => measureSheet(ctx));
  ctx.on('add-photo', () => addPhoto(ctx));
  ctx.on('photo', (b) => photoSheet(ctx, b.dataset.id));
  ctx.on('del-body', async (b) => { if (await confirmSheet({ title: 'Delete this entry?', message: 'This body weight entry will be removed.', yes: 'Delete', danger: true })) { await Data.deleteBody(b.dataset.id); ctx.refresh(); } });
  ctx.on('del-measure', async (b) => { if (await confirmSheet({ title: 'Delete this entry?', message: 'These measurements will be removed.', yes: 'Delete', danger: true })) { await Data.deleteMeasure(b.dataset.id); ctx.refresh(); } });
}

// ---------- Overview ----------
function overview(sessions) {
  if (!sessions.length) return String(emptyState('sparkle', 'Finish a workout and your totals, streaks and charts will appear here.', '<a class="btn" href="#/workout">Go to workout</a>'));
  const [from, to] = period === 'week' ? weekRange() : monthRange();
  const list = sessionsInRange(sessions, from, to);
  const t = totals(list, getExercise);
  const partsAll = PARTS.map((p) => ({ ...p, sets: t.parts[p.id] || 0 }));
  const maxSets = Math.max(1, ...partsAll.map((p) => p.sets));
  const trainedParts = partsAll.filter((p) => p.sets > 0 && p.id !== 'full');
  const neglected = t.sessions >= 2 ? partsAll.filter((p) => p.sets === 0 && !['full', 'core'].includes(p.id)) : [];
  // Weekly bars for the last 8 weeks.
  const bars = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i * 7);
    const [a, b] = weekRange(d);
    const n = sessionsInRange(sessions, a, b).length;
    bars.push({ label: fmtDate(a, { day: 'numeric', month: 'numeric' }), value: n });
  }
  return String(html`
    <div class="seg" style="margin-bottom:10px"><button class="${period === 'week' ? 'on' : ''}" data-act="period" data-v="week">This week</button><button class="${period === 'month' ? 'on' : ''}" data-act="period" data-v="month">This month</button></div>
    <div class="grid2">
      <div class="card stat" style="margin:0"><div class="value">${t.sessions}</div><div class="label">sessions</div></div>
      <div class="card stat" style="margin:0"><div class="value">${fmtBig(t.kg)}</div><div class="label">${unit()} lifted</div></div>
      <div class="card stat" style="margin:0"><div class="value">${fmtDur(t.sec)}</div><div class="label">time training</div></div>
      <div class="card stat" style="margin:0"><div class="value">${weekStreak(sessions)}</div><div class="label">week streak · best ${bestWeekStreak(sessions)}</div></div>
    </div>
    <div class="card"><div class="kicker">Body parts trained (sets)</div>
      ${partsAll.map((p) => html`<div class="hbar"><span>${p.name}</span><div class="track"><span style="width:${(p.sets / maxSets) * 100}%"></span></div><span class="v">${p.sets}</span></div>`)}
      ${trainedParts.length ? html`<p class="meta" style="margin-top:8px">Most: ${trainedParts.sort((a, b) => b.sets - a.sets)[0].name}.${neglected.length ? '' : ' Nicely balanced.'}</p>` : ''}
      ${neglected.length ? html`<p class="small" style="margin-top:6px">Gentle note: no ${neglected.map((p) => p.name.toLowerCase()).join(', ')} work ${period === 'week' ? 'this week' : 'this month'} yet. Worth adding a move or two if it suits you.</p>` : ''}
    </div>
    <div class="card"><div class="kicker">Sessions per week</div>${raw(barChart(bars, { label: 'Sessions per week, last 8 weeks' }))}</div>
  `);
}

// ---------- Per-exercise ----------
function exerciseList(sessions) {
  const ids = [...new Set(sessions.flatMap((s) => s.exercises.map((e) => e.exId)))];
  if (!ids.length) return String(emptyState('dumbbell', 'Exercises you log will be listed here with a chart each.'));
  const rows = ids.map((id) => ({ id, ex: getExercise(id), series: exerciseSeries(sessions, id) })).sort((a, b) => b.series[b.series.length - 1].date - a.series[a.series.length - 1].date);
  return String(html`<div class="list">${rows.map((r) => html`<a class="item" href="#/progress/ex/${encodeURIComponent(r.id)}"><div class="lead">${icon('interval')}</div><div class="body"><div class="title">${r.ex ? r.ex.name : 'Removed exercise'}</div><div class="sub">${raw(metaJoin([`${r.series.length} session${r.series.length === 1 ? '' : 's'}`, r.ex && r.ex.type === 'w' ? `top ${fmtW(Math.max(...r.series.map((p) => p.topW)))}` : `best ${Math.max(...r.series.map((p) => p.topR))}`]))}</div></div><div class="trail">${icon('chev')}</div></a>`)}</div>`);
}

function exerciseChart(ctx, id, sessions) {
  const ex = getExercise(id) || { name: 'Exercise', type: 'w' };
  const series = exerciseSeries(sessions, id);
  const isW = ex.type === 'w';
  let pbW = 0, pbE = 0;
  series.forEach((p, i) => { if (p.topW >= series[pbW].topW) pbW = i; if (p.est >= series[pbE].est) pbE = i; });
  ctx.mount(html`
    <button class="back-btn" data-act="back">${icon('back')} Progress</button>
    <div class="page-head"><div><h1>${ex.name}</h1><div class="meta sub">${series.length} session${series.length === 1 ? '' : 's'}</div></div></div>
    ${series.length ? html`
      ${isW ? html`<div class="card"><div class="kicker">Heaviest weight each session (${unit()} per dumbbell)</div>${raw(lineChart(series.map((p) => ({ x: p.date, y: p.topW })), { unitKg: true, pbIndex: pbW, label: 'Weight over time' }))}
        <div class="legend"><span><i style="background:var(--accent)"></i>Weight</span><span><i style="background:#e0a100"></i>Personal best</span></div></div>
        <div class="card"><div class="kicker">Best set each session</div>${raw(lineChart(series.map((p) => ({ x: p.date, y: p.est })), { unitKg: true, pbIndex: pbE, label: 'Best set over time' }))}
        <p class="meta">Combines weight and reps into one number (an estimate of the most you could lift once), so a set with more reps at the same weight counts as progress.</p></div>`
      : html`<div class="card"><div class="kicker">Best ${ex.type === 'time' ? 'hold (seconds)' : 'reps'} each session</div>${raw(lineChart(series.map((p) => ({ x: p.date, y: p.topR })), { pbIndex: series.reduce((b, p, i) => (p.topR >= series[b].topR ? i : b), 0) }))}</div>`}
      <div class="card"><div class="kicker">Every session</div>${series.slice().reverse().map((p) => html`<div class="kv"><span class="k">${fmtDate(p.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span><span class="v">${p.sets.map((s) => isW ? `${toDisplay(s.w)}×${s.r}` : `${s.r}${ex.type === 'time' ? 's' : ''}`).join(', ')}</span></div>`)}</div>
      <a class="btn ghost block" href="#/exercise/${encodeURIComponent(id)}" style="margin-top:10px">How to do it</a>`
    : emptyState('dumbbell', 'No sessions logged for this one yet.')}`);
  ctx.on('back', () => ctx.go('#/progress/exercises'));
}

// ---------- Records ----------
function records(sessions) {
  const pbs = Object.values(personalBests(sessions, getExercise));
  if (!pbs.length) return String(emptyState('trophy', 'Personal bests appear here as you train. Each one is just you, beating you.'));
  const rows = pbs.map((p) => ({ p, ex: getExercise(p.exId) })).sort((a, b) => ((a.ex && a.ex.name) || '').localeCompare((b.ex && b.ex.name) || ''));
  return String(html`<div class="list">${rows.map(({ p, ex }) => html`<a class="item" href="#/progress/ex/${encodeURIComponent(p.exId)}"><div class="lead" style="color:#e0a100;background:rgba(224,161,0,.12)">${icon('trophy')}</div>
    <div class="body"><div class="title">${ex ? ex.name : 'Removed exercise'}</div>
      <div class="sub">${raw(p.heaviest ? metaJoin([`Heaviest ${fmtW(p.heaviest.w)} × ${p.heaviest.r}`, fmtDate(p.heaviest.date, { day: 'numeric', month: 'short', year: 'numeric' })]) : p.reps ? metaJoin([`${p.type === 'time' ? 'Longest hold' : 'Most reps'} ${p.reps.r}${p.type === 'time' ? ' s' : ''}`, fmtDate(p.reps.date, { day: 'numeric', month: 'short', year: 'numeric' })]) : '')}</div>
      ${p.best && p.heaviest && (p.best.w !== p.heaviest.w || p.best.r !== p.heaviest.r) ? html`<div class="sub">${raw(metaJoin([`Best set ${fmtW(p.best.w)} × ${p.best.r}`, fmtDate(p.best.date, { day: 'numeric', month: 'short' })]))}</div>` : ''}</div></a>`)}</div>`);
}

// ---------- Calendar ----------
async function calendar(sessions) {
  if (!calMonth) calMonth = new Date();
  const days = trainedDays(sessions);
  const plan = await activePlan();
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday first
  const start = new Date(y, m, 1 - startOffset);
  const todayK = dayKey();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i >= 35 && d.getMonth() !== m) break;
    const k = dayKey(d);
    const trained = days.has(k), planned = !!dayFor(plan, d) && k >= todayK;
    cells.push(html`<button type="button" class="${d.getMonth() !== m ? 'out' : ''} ${k === todayK ? 'today' : ''} ${trained ? 'trained' : ''} ${planned ? 'planned' : ''}" data-act="day" data-k="${k}" aria-label="${fmtDateLong(d)}${trained ? ', trained' : ''}">${d.getDate()}</button>`);
  }
  const monthCount = [...days.keys()].filter((k) => k.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`)).length;
  return String(html`<div class="card">
    <div class="card-head"><button class="icon-btn plain" data-act="cal" data-d="-1" aria-label="Previous month">${icon('back')}</button><h3>${calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3><button class="icon-btn plain" data-act="cal" data-d="1" aria-label="Next month">${icon('chev')}</button></div>
    <div class="cal">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => html`<div class="dow">${x}</div>`)}${cells}</div>
    <p class="meta" style="margin-top:8px">${monthCount ? `${monthCount} training day${monthCount === 1 ? '' : 's'} this month.` : 'No training days this month yet.'} Filled dot = trained · ring = planned. Tap a day to see it.</p></div>`);
}

function daySheet(k, sessions, ctx) {
  const list = sessions.filter((s) => dayKey(s.startedAt) === k);
  openSheet({
    title: fmtDateLong(parseDayKey(k)), cancelLabel: 'Close',
    body: list.length ? String(html`${list.map((s) => html`<div class="card flat" style="border:1px solid var(--line)"><h3>${s.dayName || 'Workout'}</h3>
      <p class="meta">${raw(metaJoin([fmtDur(s.duration || 0), `${fmtBig(s.totalKg || sessionVolume(s, getExercise))} ${unit()} lifted`, (s.pbs || []).length ? `${s.pbs.length} PB${s.pbs.length === 1 ? '' : 's'}` : '']))}</p>
      ${s.exercises.map((e) => { const ex = getExercise(e.exId) || { name: e.name || 'Exercise', type: 'w' }; return html`<div class="kv"><span class="k">${ex.name}</span><span class="v">${e.sets.map((x) => ex.type === 'w' ? `${toDisplay(x.w)}×${x.r}` : `${x.r}${ex.type === 'time' ? 's' : ''}`).join(', ')}</span></div>`; })}
      <button type="button" class="link-btn" data-del="${s.id}" style="color:var(--danger);margin-top:6px">Delete this session</button></div>`)}`)
      : '<p class="meta">No workout logged on this day. Rest days count too.</p>',
    onOpen: (el, api) => el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      api.close();
      if (await confirmSheet({ title: 'Delete this session?', message: 'Its sets will be removed from your history and charts.', yes: 'Delete', danger: true })) { await Data.deleteSession(b.dataset.del); ctx.refresh(); }
    }),
  });
}

// ---------- Body: weight, measurements, photos ----------
async function bodyTab() {
  const body = await Data.listBody();
  const meas = await Data.listMeasure();
  const photos = await Data.listPhotos();
  const urls = photos.map((p) => ({ ...p, url: p.blob ? URL.createObjectURL(p.blob) : '' }));
  setTimeout(() => urls.forEach((u) => u.url && setTimeout(() => URL.revokeObjectURL(u.url), 60000)), 0);
  return String(html`
    <p class="meta" style="margin:0 4px 10px">All optional. Log only what’s useful to you.</p>
    <div class="card"><div class="card-head"><h3>Body weight</h3><button class="btn soft small" data-act="add-body">${icon('plus')} Add</button></div>
      ${body.length > 1 ? raw(lineChart(body.map((b) => ({ x: parseDayKey(b.date).getTime(), y: b.kg })), { unitKg: true, label: 'Body weight' })) : ''}
      ${body.length ? html`${body.slice(-5).reverse().map((b) => html`<div class="kv"><span class="k">${fmtDate(parseDayKey(b.date), { day: 'numeric', month: 'short', year: 'numeric' })}</span><span class="v">${fmtW(b.kg)} <button class="link-btn" data-act="del-body" data-id="${b.id}" aria-label="Delete">×</button></span></div>`)}` : html`<p class="meta">No entries yet.</p>`}</div>
    <div class="card"><div class="card-head"><h3>Measurements</h3><button class="btn soft small" data-act="add-measure">${icon('plus')} Add</button></div>
      ${meas.length ? meas.slice(-5).reverse().map((m) => html`<div class="kv"><span class="k">${fmtDate(parseDayKey(m.date), { day: 'numeric', month: 'short' })}</span><span class="v small">${raw(metaJoin(['chest', 'arm', 'waist', 'thigh'].filter((k) => m[k]).map((k) => `${k} ${m[k]} cm`)))} <button class="link-btn" data-act="del-measure" data-id="${m.id}" aria-label="Delete">×</button></span></div>`) : html`<p class="meta">Chest, arm, waist and thigh, in cm.</p>`}</div>
    <div class="card"><div class="card-head"><h3>Progress photos</h3><button class="btn soft small" data-act="add-photo">${icon('camera')} Add</button></div>
      <div class="privacy-note" style="margin-bottom:10px">${icon('lock')}<span class="small">Photos are stored on this phone only. They never leave it, unless you export a backup file yourself.</span></div>
      ${urls.length ? html`<div class="photo-grid">${urls.map((p) => html`<button type="button" data-act="photo" data-id="${p.id}"><img src="${p.url}" alt="Progress photo ${p.date}"><span class="d">${fmtDate(parseDayKey(p.date))}</span></button>`)}</div>` : html`<p class="meta">No photos yet.</p>`}</div>
  `);
}

function bodySheet(ctx) {
  openSheet({ title: 'Body weight', body: html`<label class="field"><span>Date</span><input class="input" type="date" name="d" value="${dayKey()}" max="${dayKey()}"></label><label class="field"><span>Weight (${unit()})</span><input class="input" name="w" inputmode="decimal" placeholder="e.g. 70.5"></label>`,
    onSave: async (el) => {
      const kg = fromDisplay($('[name=w]', el).value), d = $('[name=d]', el).value;
      if (!kg || kg < 20 || kg > 400 || !/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast('Check the date and weight.'); return false; }
      await Data.saveBody({ id: Data.uid('bw'), date: d, kg }); ctx.refresh();
    } });
}
function measureSheet(ctx) {
  openSheet({ title: 'Measurements (cm)', body: html`<label class="field"><span>Date</span><input class="input" type="date" name="d" value="${dayKey()}" max="${dayKey()}"></label>
    <div class="grid2">${['chest', 'arm', 'waist', 'thigh'].map((k) => html`<label class="field"><span>${k[0].toUpperCase() + k.slice(1)}</span><input class="input" name="${k}" inputmode="decimal"></label>`)}</div><p class="meta">Fill in any you like; leave the rest empty.</p>`,
    onSave: async (el) => {
      const rec = { id: Data.uid('ms'), date: $('[name=d]', el).value };
      let any = false;
      for (const k of ['chest', 'arm', 'waist', 'thigh']) { const n = parseNum($(`[name=${k}]`, el).value); if (n && n > 0 && n < 400) { rec[k] = Math.round(n * 10) / 10; any = true; } }
      if (!any || !/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) { toast('Add at least one measurement.'); return false; }
      await Data.saveMeasure(rec); ctx.refresh();
    } });
}
function addPhoto(ctx) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f || !f.type.startsWith('image/')) return;
    try {
      const blob = await resizeImage(f, 1400, 0.82, true);
      await Data.savePhoto({ id: Data.uid('ph'), date: dayKey(), note: '', blob });
      toast('Photo saved on this phone.');
      ctx.refresh();
    } catch { toast('That photo couldn’t be saved.'); }
  });
  input.click();
}
async function photoSheet(ctx, id) {
  const p = (await Data.listPhotos()).find((x) => x.id === id);
  if (!p) return;
  const url = URL.createObjectURL(p.blob);
  openSheet({ title: fmtDateLong(parseDayKey(p.date)), cancelLabel: 'Close', body: html`<img src="${url}" alt="Progress photo" style="border-radius:18px;width:100%"><button type="button" class="btn danger-ghost block" data-del style="margin-top:12px">Delete photo</button>`,
    onOpen: (el, api) => $('[data-del]', el).addEventListener('click', async () => { api.close(); if (await confirmSheet({ title: 'Delete this photo?', message: 'It will be removed from this phone.', yes: 'Delete', danger: true })) { await Data.deletePhoto(id); ctx.refresh(); } }),
    onClose: () => setTimeout(() => URL.revokeObjectURL(url), 400) });
}
