// Kuat — exercise library: browse, filter, learn, favourite, add notes, add your own.
import * as Data from './data.js';
import { html, raw, esc, icon, openSheet, confirmSheet, toast, metaJoin, emptyState, fmtW, fmtDate, linkify, $, $$, revealSelectedPills } from './ui.js';
import { EXERCISES, PARTS, GEAR } from './exercise-data.js';
import { exerciseFigure } from './figures.js';
import { exerciseSeries } from './stats.js';
import { lineChart } from './charts.js';

let custom = [];   // your own exercises, loaded at start
let meta = {};     // favourites and notes, by exercise id
let byId = new Map();

export async function loadExercises() {
  custom = (await Data.listCustom()).map(normaliseCustom);
  meta = Object.fromEntries((await Data.listExMeta()).map((m) => [m.id, m]));
  byId = new Map([...EXERCISES, ...custom].map((e) => [e.id, e]));
}
function normaliseCustom(c) {
  return {
    id: c.id, name: c.name, part: PARTS.some((p) => p.id === c.part) ? c.part : 'full', gear: Array.isArray(c.gear) ? c.gear : ['db'],
    type: ['w', 'bw', 'time'].includes(c.type) ? c.type : 'w', dbs: [0, 1, 2].includes(c.dbs) ? c.dbs : 2,
    small: ['shoulders', 'biceps', 'triceps'].includes(c.part), heavy: !!c.heavy, custom: true,
    trains: c.trains || '', steps: (c.how || '').split('\n').map((x) => x.trim()).filter(Boolean), mistakes: [], easier: '', harder: '',
    fig: c.type === 'time' ? ['plank', 'plank'] : ['stand', 'stand'],
  };
}
export const getExercise = (id) => byId.get(id) || null;
export const allExercises = () => [...byId.values()];
export const partName = (id) => (PARTS.find((p) => p.id === id) || { name: 'Other' }).name;
export const isFav = (id) => !!(meta[id] && meta[id].fav);
function gearLine(ex) { const names = (ex.gear || []).map((g) => (GEAR.find((x) => x.id === g) || {}).name).filter(Boolean); return names.length ? names.join(', ') : 'No gear'; }

// ---------- Library list ----------
const state = { part: 'all', gear: 'all', q: '', open: new Set() };

export function renderLibrary(ctx) {
  const list = allExercises().filter((ex) =>
    (state.part === 'all' || (state.part === 'fav' ? isFav(ex.id) : ex.part === state.part)) &&
    (state.gear === 'all' || (state.gear === 'none' ? !(ex.gear || []).length : (ex.gear || []).includes(state.gear))) &&
    (!state.q || ex.name.toLowerCase().includes(state.q) || partName(ex.part).toLowerCase().includes(state.q)));
  const groups = PARTS.map((p) => ({ ...p, items: list.filter((e) => e.part === p.id).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.items.length);
  const filtering = state.part !== 'all' || state.gear !== 'all' || state.q;
  ctx.mount(html`
    <div class="page-head"><div><h1>Exercises</h1><div class="meta sub">${allExercises().length} moves for dumbbells, a mat and a chair.</div></div></div>
    <div class="search" style="margin-bottom:12px">${icon('search')}<input class="input" type="search" id="lib-q" placeholder="Search exercises" value="${state.q}" autocomplete="off" enterkeyhint="search"></div>
    <div class="pills" role="tablist" aria-label="Body part">
      ${[{ id: 'all', name: 'All' }, { id: 'fav', name: '★ Favourites' }, ...PARTS].map((p) => html`<button class="pill ${state.part === p.id ? 'on' : ''}" data-act="part" data-v="${p.id}" aria-pressed="${state.part === p.id}">${p.name}</button>`)}
    </div>
    <div class="pills sub" aria-label="Gear">
      ${[{ id: 'all', name: 'Any gear' }, ...GEAR].map((g) => html`<button class="pill ${state.gear === g.id ? 'on' : ''}" data-act="gear" data-v="${g.id}" aria-pressed="${state.gear === g.id}">${g.name}</button>`)}
    </div>
    ${groups.length ? html`<div class="list">${groups.map((g) => {
      const open = filtering || state.open.has(g.id);
      const favs = g.items.filter((e) => isFav(e.id)).length;
      return html`<div class="group ${open ? 'open' : ''}">
        <button class="group-head" data-act="toggle" data-v="${g.id}" aria-expanded="${open}">${g.name}<span class="count">${favs ? `★ ${favs} · ` : ''}${g.items.length}</span>${icon('chev', ' class="chev"')}</button>
        <div class="group-body">${g.items.map((ex) => html`
          <a class="item" href="#/exercise/${encodeURIComponent(ex.id)}">
            <div class="lead fig">${raw(exerciseFigure(ex, { small: true }))}</div>
            <div class="body"><div class="title">${ex.name}${isFav(ex.id) ? ' ★' : ''}</div><div class="sub">${raw(metaJoin([gearLine(ex), ex.type === 'time' ? 'Timed hold' : ex.type === 'bw' ? 'Bodyweight' : '', ex.custom ? 'Your exercise' : '']))}</div></div>
            <div class="trail">${icon('chev')}</div></a>`)}</div>
      </div>`;
    })}</div>` : emptyState('search', 'Nothing matches. Try another filter, or add your own exercise.')}
    <button class="fab" data-act="add">${icon('plus')} Add your own</button>
  `);
  revealSelectedPills(ctx.view);
  const q = $('#lib-q', ctx.view);
  q.addEventListener('input', () => { state.q = q.value.trim().toLowerCase(); const pos = q.selectionStart; renderLibrary(ctx); const n = $('#lib-q', ctx.view); n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* ignore */ } });
  ctx.on('part', (b) => { state.part = b.dataset.v; renderLibrary(ctx); });
  ctx.on('gear', (b) => { state.gear = b.dataset.v; renderLibrary(ctx); });
  ctx.on('toggle', (b) => { const id = b.dataset.v; state.open.has(id) ? state.open.delete(id) : state.open.add(id); b.closest('.group').classList.toggle('open'); b.setAttribute('aria-expanded', state.open.has(id)); });
  ctx.on('add', () => customSheet(ctx));
}

// ---------- Exercise detail ----------
export async function renderExercise(ctx, id) {
  const ex = getExercise(id);
  if (!ex) { ctx.mount(emptyState('search', 'That exercise isn’t in the library.', '<a class="btn" href="#/exercises">Back to exercises</a>')); return; }
  const m = await Data.getExMeta(id);
  const sessions = await Data.listSessions();
  const series = exerciseSeries(sessions, id);
  const recent = series.slice(-6).reverse();
  const isW = ex.type === 'w';
  ctx.mount(html`
    <button class="back-btn" data-act="back">${icon('back')} Exercises</button>
    <div class="page-head"><div><h1>${ex.name}</h1><div class="meta sub">${raw(metaJoin([partName(ex.part), gearLine(ex)]))}</div></div>
      <button class="icon-btn ${m.fav ? 'on' : ''}" data-act="fav" aria-label="${m.fav ? 'Remove from favourites' : 'Add to favourites'}" aria-pressed="${!!m.fav}">${icon('star', m.fav ? ' fill="currentColor"' : '')}</button></div>
    <div class="figure">${raw(exerciseFigure(ex))}</div>
    ${ex.fig && ex.fig[0] !== ex.fig[1] ? html`<p class="meta center" style="margin-top:6px">Faint figure = start · solid = end</p>` : ''}
    ${ex.trains ? html`<div class="card"><div class="kicker">What it trains</div><p>${ex.trains}</p></div>` : ''}
    ${ex.steps.length ? html`<div class="card"><div class="kicker">How to do it</div><ol class="steps">${ex.steps.map((s) => html`<li>${s}</li>`)}</ol></div>` : ''}
    ${ex.mistakes.length ? html`<div class="card"><div class="kicker">Common mistakes</div><ul class="bullets">${ex.mistakes.map((s) => html`<li>${s}</li>`)}</ul></div>` : ''}
    ${ex.easier || ex.harder ? html`<div class="grid2" style="margin-top:10px">
      ${ex.easier ? html`<div class="card teal" style="margin:0"><div class="kicker">Easier</div><p class="small">${ex.easier}</p></div>` : ''}
      ${ex.harder ? html`<div class="card tinted" style="margin:0"><div class="kicker">Harder</div><p class="small">${ex.harder}</p></div>` : ''}</div>` : ''}
    <div class="card">
      <div class="card-head"><div class="kicker" style="margin:0">Your notes</div><button class="link-btn" data-act="notes">${m.notes ? 'Edit' : 'Add'}</button></div>
      ${m.notes ? html`<p class="small">${raw(linkify(m.notes))}</p>` : html`<p class="meta">Seat height, grip, anything you want to remember.</p>`}
    </div>
    <div class="card">
      <div class="kicker">Your history</div>
      ${series.length ? html`
        ${series.length > 1 ? raw(lineChart(series.map((p) => ({ x: p.date, y: isW ? p.topW : p.topR })), { unitKg: isW, pbIndex: bestIndex(series, isW) })) : ''}
        <div style="margin-top:8px">${recent.map((p) => html`<div class="kv"><span class="k">${fmtDate(p.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span><span class="v">${p.sets.map((st) => isW ? `${fmtW(st.w, false)}×${st.r}` : `${st.r}${ex.type === 'time' ? 's' : ''}`).join(', ')}</span></div>`)}</div>
      ` : html`<p class="meta">You haven’t logged this one yet.</p>`}
    </div>
    ${ex.custom ? html`<div class="btn-row" style="margin-top:12px"><button class="btn ghost" data-act="edit-custom">Edit</button><button class="btn danger-ghost" data-act="del-custom">Delete</button></div>` : ''}
  `);
  ctx.on('back', () => history.length > 1 ? history.back() : ctx.go('#/exercises'));
  ctx.on('fav', async () => { m.fav = !m.fav; await Data.saveExMeta(m); meta[id] = m; renderExercise(ctx, id); });
  ctx.on('notes', () => openSheet({
    title: 'Your notes', sub: ex.name,
    body: html`<label class="field"><span>Notes</span><textarea class="input" name="n" maxlength="2000" placeholder="e.g. Chair against the wall. Elbows tucked.">${m.notes || ''}</textarea></label><p class="meta">Stays on this phone only. Please don’t store ID numbers, bank details or medical records here.</p>`,
    onSave: async (el) => { m.notes = $('[name=n]', el).value.slice(0, 2000); await Data.saveExMeta(m); meta[id] = m; renderExercise(ctx, id); },
  }));
  ctx.on('edit-custom', async () => customSheet(ctx, (await Data.listCustom()).find((c) => c.id === id)));
  ctx.on('del-custom', async () => {
    if (!await confirmSheet({ title: 'Delete this exercise?', message: 'It’s removed from the library and from plans. Workouts you already logged keep their numbers.', yes: 'Delete', danger: true })) return;
    await Data.deleteCustom(id);
    for (const p of await Data.listPlans()) {
      let changed = false;
      for (const day of p.days) { const n = day.exercises.length; day.exercises = day.exercises.filter((e) => e.exId !== id); changed ||= n !== day.exercises.length; }
      if (changed) await Data.savePlan(p);
    }
    await loadExercises();
    ctx.go('#/exercises');
  });
}
function bestIndex(series, isW) {
  let bi = 0;
  series.forEach((p, i) => { if ((isW ? p.topW : p.topR) >= (isW ? series[bi].topW : series[bi].topR)) bi = i; });
  return bi;
}

// ---------- Add / edit your own exercise ----------
function customSheet(ctx, existing = null) {
  const c = existing || { name: '', part: 'chest', gear: ['db'], type: 'w', dbs: 2, trains: '', how: '' };
  openSheet({
    title: existing ? 'Edit exercise' : 'Add your own exercise',
    body: html`
      <label class="field"><span>Name</span><input class="input" name="name" maxlength="60" value="${c.name}" placeholder="e.g. Tempo goblet squat"></label>
      <label class="field"><span>Body part</span><select class="input" name="part">${PARTS.map((p) => html`<option value="${p.id}" ${p.id === c.part ? 'selected' : ''}>${p.name}</option>`)}</select></label>
      <label class="field"><span>How you log it</span><select class="input" name="type">
        <option value="w" ${c.type === 'w' ? 'selected' : ''}>Weight and reps</option>
        <option value="bw" ${c.type === 'bw' ? 'selected' : ''}>Reps only (bodyweight)</option>
        <option value="time" ${c.type === 'time' ? 'selected' : ''}>Seconds (a hold)</option></select></label>
      <label class="field"><span>Dumbbells used</span><select class="input" name="dbs">
        <option value="2" ${c.dbs === 2 ? 'selected' : ''}>Both (a pair)</option><option value="1" ${c.dbs === 1 ? 'selected' : ''}>One</option><option value="0" ${c.dbs === 0 ? 'selected' : ''}>None</option></select></label>
      <div class="field-label">Gear needed</div>
      <div class="card flat" style="padding:4px 14px;margin-bottom:14px">${GEAR.filter((g) => g.id !== 'none').map((g) => html`<label class="check"><input type="checkbox" name="gear" value="${g.id}" ${c.gear.includes(g.id) ? 'checked' : ''}> ${g.name}</label>`)}</div>
      <label class="field"><span>What it trains (optional)</span><input class="input" name="trains" maxlength="200" value="${c.trains}"></label>
      <label class="field"><span>How to do it (optional, one step per line)</span><textarea class="input" name="how" maxlength="2000">${c.how}</textarea></label>`,
    onSave: async (el) => {
      const name = $('[name=name]', el).value.trim();
      if (!name) { toast('Give it a name first.'); return false; }
      const rec = {
        id: existing ? existing.id : Data.uid('custom'), name: name.slice(0, 60), part: $('[name=part]', el).value, type: $('[name=type]', el).value,
        dbs: Number($('[name=dbs]', el).value), gear: $$('[name=gear]:checked', el).map((x) => x.value),
        trains: $('[name=trains]', el).value.slice(0, 200), how: $('[name=how]', el).value.slice(0, 2000), createdAt: existing ? existing.createdAt : Date.now(),
      };
      await Data.saveCustom(rec);
      await loadExercises();
      toast(existing ? 'Saved.' : 'Added to your library.');
      ctx.go(`#/exercise/${encodeURIComponent(rec.id)}`);
      if (existing) ctx.refresh();
    },
  });
}

// ---------- Pick an exercise (used by plans and workouts) ----------
export function exercisePicker({ title = 'Choose an exercise', part = null, exclude = null, onPick }) {
  let filter = part || 'all', q = '';
  const listHTML = () => {
    const items = allExercises().filter((e) => e.id !== exclude && (filter === 'all' || (filter === 'fav' ? isFav(e.id) : e.part === filter)) && (!q || e.name.toLowerCase().includes(q)))
      .sort((a, b) => (isFav(b.id) - isFav(a.id)) || a.name.localeCompare(b.name));
    if (!items.length) return '<p class="meta center">Nothing here.</p>';
    return String(html`<div class="list">${items.map((e) => html`<button type="button" class="item" data-pick="${e.id}">
      <div class="lead fig">${raw(exerciseFigure(e, { small: true }))}</div>
      <div class="body"><div class="title">${e.name}${isFav(e.id) ? ' ★' : ''}</div><div class="sub">${raw(metaJoin([partName(e.part), gearLine(e)]))}</div></div></button>`)}</div>`);
  };
  openSheet({
    title, sub: part ? `Showing ${partName(part).toLowerCase()} moves first — trains the same muscles.` : '',
    body: html`<div class="search" style="margin-bottom:10px">${icon('search')}<input class="input" type="search" data-q placeholder="Search" autocomplete="off"></div>
      <div class="pills sub" style="margin-left:-20px;margin-right:-20px;padding-left:20px;padding-right:20px">${[{ id: 'all', name: 'All' }, { id: 'fav', name: '★' }, ...PARTS].map((p) => html`<button type="button" class="pill ${filter === p.id ? 'on' : ''}" data-f="${p.id}">${p.name}</button>`)}</div>
      <div data-list>${raw(listHTML())}</div>`,
    cancelLabel: 'Close',
    onOpen: (el, api) => {
      revealSelectedPills(el);
      const box = $('[data-list]', el);
      $('[data-q]', el).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); box.innerHTML = listHTML(); });
      el.addEventListener('click', (e) => {
        const f = e.target.closest('[data-f]');
        if (f) { filter = f.dataset.f; $$('[data-f]', el).forEach((b) => b.classList.toggle('on', b === f)); box.innerHTML = listHTML(); return; }
        const p = e.target.closest('[data-pick]');
        if (p) { const ex = getExercise(p.dataset.pick); api.close(); onPick(ex); }
      });
    },
  });
}

export function searchExercises(q) {
  return allExercises().filter((e) => e.name.toLowerCase().includes(q) || partName(e.part).toLowerCase().includes(q)).slice(0, 8);
}
