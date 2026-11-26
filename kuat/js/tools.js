// Kuat — quick tools: rest timer, interval timer, weight calculator, warm-up and cool-down.
// Every timer works from the real clock (it remembers the time it should end), so it stays
// accurate even if the screen turns off or you switch apps.
import * as Data from './data.js';
import { html, raw, esc, icon, toast, $, $$, fmtClock, beep, buzz, keepAwake, toDisplay, fromDisplay, unit, parseNum, KG_PER_LB, trimNum } from './ui.js';
import { dumbbellSettings, calcForTotal, settingIndex } from './suggest.js';
import { getExercise } from './exercises.js';
import { activePlan, dayFor, dayParts } from './plans.js';
import { WARMUPS, COOLDOWN, PART_ZONE } from './exercise-data.js';

// ---------- Global rest timer (floating bar above the nav) ----------
const REST_KEY = 'kuat.rest.v1';
let rest = null;       // { endAt, total, label }
let restTick = null;

export function startRest(sec, label = 'Rest') {
  sec = Math.max(5, Math.round(sec));
  rest = { endAt: Date.now() + sec * 1000, total: sec, label };
  try { localStorage.setItem(REST_KEY, JSON.stringify(rest)); } catch { /* ignore */ }
  drawRest();
}
export function stopRest() {
  rest = null;
  try { localStorage.removeItem(REST_KEY); } catch { /* ignore */ }
  clearInterval(restTick); restTick = null;
  const slot = $('#timer-slot'); if (slot) slot.innerHTML = '';
  document.body.classList.remove('has-timer');
}
export function restoreTimer() {
  try { const r = JSON.parse(localStorage.getItem(REST_KEY) || 'null'); if (r && r.endAt > Date.now() - 60000) { rest = r; drawRest(); } } catch { /* ignore */ }
}
function drawRest() {
  const slot = $('#timer-slot');
  if (!slot || !rest) return;
  document.body.classList.add('has-timer');
  slot.innerHTML = `<div class="timer-bar" role="timer" aria-live="off">
    <div class="grow"><div class="t num" data-t>0:00</div><div class="l">${esc(rest.label)}</div></div>
    <button type="button" data-r="-15" aria-label="15 seconds less">−15</button>
    <button type="button" data-r="15" aria-label="15 seconds more">+15</button>
    <button type="button" data-r="skip">Skip</button>
    <div class="prog"><span data-p></span></div></div>`;
  slot.querySelector('.timer-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]'); if (!b || !rest) return;
    if (b.dataset.r === 'skip') return stopRest();
    rest.endAt += Number(b.dataset.r) * 1000; rest.total = Math.max(5, rest.total + Number(b.dataset.r));
    try { localStorage.setItem(REST_KEY, JSON.stringify(rest)); } catch { /* ignore */ }
    tickRest();
  });
  clearInterval(restTick);
  restTick = setInterval(tickRest, 250);
  tickRest();
}
let finishedAt = 0;
function tickRest() {
  if (!rest) return;
  const left = (rest.endAt - Date.now()) / 1000;
  const t = $('#timer-slot [data-t]'), p = $('#timer-slot [data-p]');
  if (left <= 0) {
    if (!finishedAt || finishedAt !== rest.endAt) {
      finishedAt = rest.endAt;
      // Only beep if it ended just now (not if you come back long after).
      if (left > -3) { beep({ freq: 988, times: 3 }); buzz([200, 100, 200]); }
      if (t) t.textContent = 'Go';
      const label = $('#timer-slot .l'); if (label) label.textContent = 'Rest done — next set when ready';
      setTimeout(() => { if (rest && rest.endAt === finishedAt) stopRest(); }, 6000);
    }
    return;
  }
  if (t) t.textContent = fmtClock(left);
  if (p) p.style.width = `${Math.max(0, Math.min(100, 100 - (left / rest.total) * 100))}%`;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tickRest(); });

// ---------- Tool screens ----------
export async function renderTool(ctx, name) {
  const back = html`<button class="back-btn" data-act="back">${icon('back')} Back</button>`;
  ctx.on('back', () => (history.length > 1 ? history.back() : ctx.go('#/home')));
  if (name === 'rest') return restTool(ctx, back);
  if (name === 'interval') return intervalTool(ctx, back);
  if (name === 'calc') return calcTool(ctx, back);
  if (name === 'warmup' || name === 'cooldown') return routineTool(ctx, back, name);
  ctx.go('#/home');
}

async function restTool(ctx, back) {
  const s = await Data.getSettings();
  const presets = [30, 45, 60, 90, 120, 180];
  ctx.mount(html`${back}
    <div class="page-head"><div><h1>Rest timer</h1><div class="meta sub">Tap a time to start. It keeps counting with the screen off.</div></div></div>
    <div class="grid2">${presets.map((p) => html`<button class="btn ghost" data-act="go" data-v="${p}" style="min-height:64px;font-size:20px"><span class="num">${fmtClock(p)}</span></button>`)}</div>
    <div class="card" style="margin-top:12px">
      <div class="kicker">Your own time</div>
      <div class="row"><input class="input grow" id="custom-sec" inputmode="numeric" pattern="[0-9]*" placeholder="Seconds, e.g. 75"><button class="btn" data-act="custom">Start</button></div>
    </div>
    <div class="card tinted"><p class="small">Your defaults: ${s.restHeavy} s after big moves, ${s.restLight} s after small ones. During a workout the timer starts by itself when you tick a set. Change these in Settings.</p></div>
  `);
  ctx.on('go', (b) => { startRest(Number(b.dataset.v), 'Rest'); toast('Rest timer started.'); });
  ctx.on('custom', () => {
    const v = parseNum($('#custom-sec', ctx.view).value);
    if (!v || v < 5 || v > 3600) { toast('Type a number of seconds between 5 and 3600.'); return; }
    startRest(v, 'Rest');
    toast('Rest timer started.');
  });
}

// Interval timer: work / rest / rounds, worked out from the start time.
let iv = null; // { work, rest, rounds, startAt, pausedAt, pausedTotal, lastPhaseKey }
async function intervalTool(ctx, back) {
  const saved = (await Data.getKV('intervalPrefs')) || { work: 40, rest: 20, rounds: 8 };
  const draw = () => {
    ctx.mount(html`${back}
      <div class="page-head"><div><h1>Interval timer</h1><div class="meta sub">Beeps on each change. Keeps time with the screen off.</div></div></div>
      <div class="card big-timer" id="iv-face">
        <div class="phase" id="iv-phase">Ready</div>
        <div class="clock num" id="iv-clock">${fmtClock(saved.work)}</div>
        <div class="meta" id="iv-round">${saved.rounds} rounds</div>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" data-act="start" id="iv-start">${icon('play')} Start</button>
        <button class="btn ghost" data-act="reset">Reset</button>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="grid2" style="grid-template-columns:1fr 1fr 1fr">
          <label class="field" style="margin:0"><span>Work (s)</span><input class="input" data-k="work" inputmode="numeric" pattern="[0-9]*" value="${saved.work}"></label>
          <label class="field" style="margin:0"><span>Rest (s)</span><input class="input" data-k="rest" inputmode="numeric" pattern="[0-9]*" value="${saved.rest}"></label>
          <label class="field" style="margin:0"><span>Rounds</span><input class="input" data-k="rounds" inputmode="numeric" pattern="[0-9]*" value="${saved.rounds}"></label>
        </div>
      </div>`);
  };
  draw();
  let tick = null;
  const phaseAt = (elapsed) => {
    const cyc = iv.work + iv.rest;
    const total = iv.rounds * cyc - iv.rest; // no rest after the last round
    if (elapsed >= total) return { done: true };
    const round = Math.floor(elapsed / cyc) + 1;
    const inCyc = elapsed % cyc;
    return inCyc < iv.work ? { phase: 'work', round, left: iv.work - inCyc } : { phase: 'rest', round, left: cyc - inCyc };
  };
  const update = () => {
    if (!iv) return;
    const now = iv.pausedAt || Date.now();
    const elapsed = (now - iv.startAt - iv.pausedTotal) / 1000;
    const st = phaseAt(elapsed);
    const face = $('#iv-face', ctx.view); if (!face) { clearInterval(tick); return; }
    if (st.done) {
      $('#iv-phase', ctx.view).textContent = 'All done — nice work';
      $('#iv-clock', ctx.view).textContent = '0:00';
      face.className = 'card big-timer';
      if (iv.lastPhaseKey !== 'done') { iv.lastPhaseKey = 'done'; beep({ freq: 660, times: 4 }); buzz([300, 100, 300]); keepAwake(false); }
      clearInterval(tick); $('#iv-start', ctx.view).innerHTML = `${icon('play')} Start`; iv = null;
      return;
    }
    const key = `${st.phase}-${st.round}`;
    if (iv.lastPhaseKey !== key) {
      if (iv.lastPhaseKey && elapsed - (iv.lastSeen || elapsed) < 2) { st.phase === 'work' ? beep({ freq: 988, times: 2 }) : beep({ freq: 660, times: 1, ms: 300 }); buzz(st.phase === 'work' ? [150, 80, 150] : 250); }
      iv.lastPhaseKey = key;
    }
    const sec = Math.ceil(st.left);
    if (!iv.pausedAt && sec <= 3 && sec >= 1 && iv.lastCount !== `${key}-${sec}`) { iv.lastCount = `${key}-${sec}`; beep({ freq: 523, ms: 90 }); }
    iv.lastSeen = elapsed;
    face.className = `card big-timer ${st.phase}`;
    $('#iv-phase', ctx.view).textContent = iv.pausedAt ? 'Paused' : st.phase === 'work' ? 'Work' : 'Rest';
    $('#iv-clock', ctx.view).textContent = fmtClock(st.left);
    $('#iv-round', ctx.view).textContent = `Round ${st.round} of ${iv.rounds}`;
  };
  const readPrefs = () => {
    const get = (k, d, max) => { const n = parseNum($(`[data-k=${k}]`, ctx.view).value); return n && n > 0 ? Math.min(max, Math.round(n)) : d; };
    const p = { work: get('work', 40, 3600), rest: Math.max(0, parseNum($('[data-k=rest]', ctx.view).value) ?? 20), rounds: get('rounds', 8, 99) };
    p.rest = Math.min(3600, Math.round(p.rest));
    Data.setKV('intervalPrefs', p);
    return p;
  };
  ctx.on('start', (b) => {
    if (iv && !iv.pausedAt) { iv.pausedAt = Date.now(); b.innerHTML = `${icon('play')} Resume`; keepAwake(false); update(); return; }
    if (iv && iv.pausedAt) { iv.pausedTotal += Date.now() - iv.pausedAt; iv.pausedAt = 0; b.innerHTML = `${icon('pause')} Pause`; keepAwake(true); update(); return; }
    const p = readPrefs();
    iv = { ...p, startAt: Date.now(), pausedAt: 0, pausedTotal: 0, lastPhaseKey: '' };
    beep({ freq: 988, times: 2 });
    keepAwake(true);
    b.innerHTML = `${icon('pause')} Pause`;
    clearInterval(tick); tick = setInterval(update, 200); update();
  });
  ctx.on('reset', () => { iv = null; clearInterval(tick); keepAwake(false); Object.assign(saved, readPrefs()); draw(); });
  ctx.onLeave(() => { clearInterval(tick); iv = null; keepAwake(false); });
}

async function calcTool(ctx, back) {
  const s = await Data.getSettings();
  const list = dumbbellSettings(s);
  ctx.mount(html`${back}
    <div class="page-head"><div><h1>Weight calculator</h1><div class="meta sub">Find the dial setting for a weight you have in mind.</div></div></div>
    <div class="card">
      <div class="field-label">Target weight</div>
      <div class="row"><input class="input grow" id="calc-w" inputmode="decimal" placeholder="e.g. 25"><span class="muted" style="font-weight:700">${unit()}</span></div>
      <div class="seg" id="calc-mode" style="margin-top:12px"><button type="button" class="on" data-v="pair">Total for the pair</button><button type="button" data-v="one">One dumbbell</button></div>
      <div id="calc-out" style="margin-top:14px"><p class="meta">Type a weight to see the closest setting.</p></div>
    </div>
    <div class="card">
      <div class="kicker">kg ↔ lb</div>
      <div class="grid2">
        <label class="field" style="margin:0"><span>kg</span><input class="input" id="cv-kg" inputmode="decimal"></label>
        <label class="field" style="margin:0"><span>lb</span><input class="input" id="cv-lb" inputmode="decimal"></label>
      </div>
    </div>
    <div class="card tinted"><div class="kicker">Your dumbbell settings</div><p class="small num" style="font-weight:500">${list.map((w) => toDisplay(w)).join(' · ')} ${unit()}</p></div>
  `);
  let mode = 'pair';
  const calc = () => {
    const out = $('#calc-out', ctx.view);
    const kg = fromDisplay($('#calc-w', ctx.view).value);
    if (!kg || kg <= 0) { out.innerHTML = '<p class="meta">Type a weight to see the closest setting.</p>'; return; }
    const r = calcForTotal(kg, s, mode === 'pair');
    out.innerHTML = String(html`
      <div class="kv"><span class="k">Set each dumbbell to</span><span class="v">${toDisplay(r.perDumbbell)} ${unit()}</span></div>
      <div class="kv"><span class="k">Dial setting</span><span class="v">${r.index + 1} of ${r.count}</span></div>
      ${mode === 'pair' ? html`<div class="kv"><span class="k">Total for the pair</span><span class="v">${toDisplay(r.total)} ${unit()}</span></div>` : ''}
      ${r.exact ? '' : html`<p class="meta" style="margin-top:8px">Your dumbbells can’t make exactly that, so this is the closest setting.</p>`}
      ${kg / (mode === 'pair' ? 2 : 1) > r.maxKg ? html`<p class="meta">That’s more than your heaviest setting.</p>` : ''}`);
  };
  $('#calc-w', ctx.view).addEventListener('input', calc);
  $('#calc-mode', ctx.view).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.v; $$('#calc-mode button', ctx.view).forEach((x) => x.classList.toggle('on', x === b)); calc(); });
  $('#cv-kg', ctx.view).addEventListener('input', (e) => { const n = parseNum(e.target.value); $('#cv-lb', ctx.view).value = n === null ? '' : trimNum(n / KG_PER_LB); });
  $('#cv-lb', ctx.view).addEventListener('input', (e) => { const n = parseNum(e.target.value); $('#cv-kg', ctx.view).value = n === null ? '' : trimNum(n * KG_PER_LB); });
}

// Warm-up and cool-down: a list matched to today's planned body parts, played one by one.
async function routineTool(ctx, back, kind) {
  const plan = await activePlan();
  const active = await Data.getActive();
  let parts = [];
  if (active && active.exercises) parts = [...new Set(active.exercises.map((e) => (getExercise(e.exId) || {}).part).filter(Boolean))];
  else { const day = dayFor(plan, new Date()); if (day) parts = dayParts(day); }
  const zones = [...new Set(parts.map((p) => PART_ZONE[p]).filter(Boolean))];
  if (!zones.length) zones.push('upper', 'lower');
  const src = kind === 'warmup' ? WARMUPS : COOLDOWN;
  const items = kind === 'warmup'
    ? [...src.general, ...zones.flatMap((z) => src[z] || [])]
    : [...zones.flatMap((z) => src[z] || []), ...src.general];
  const total = items.reduce((a, b) => a + b.sec, 0);
  let idx = -1, endAt = 0, pausedLeft = 0, tick = null;
  ctx.mount(html`${back}
    <div class="page-head"><div><h1>${kind === 'warmup' ? 'Warm-up' : 'Cool-down'}</h1>
      <div class="meta sub">${parts.length ? `Matched to today: ${parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(', ')}.` : 'A general routine for upper and lower body.'} About ${Math.round(total / 60)} minutes.</div></div></div>
    <div class="card big-timer" id="rt-face"><div class="phase" id="rt-name">Ready when you are</div><div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" style="stroke:var(--field)" stroke-width="8"/><circle id="rt-ring" cx="50" cy="50" r="44" fill="none" style="stroke:var(--teal)" stroke-width="8" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="276.5"/></svg><div class="clock num" id="rt-clock">${fmtClock(items[0].sec)}</div></div><p class="small" id="rt-how">${kind === 'warmup' ? 'Easy movements to get warm. Nothing should hurt.' : 'Gentle stretches. Ease in, never bounce, breathe slowly.'}</p></div>
    <div class="btn-row" style="margin:12px 0"><button class="btn" data-act="play" id="rt-play">${icon('play')} Start</button><button class="btn ghost" data-act="next">Next</button></div>
    <div class="list">${items.map((it, i) => html`<div class="item static" data-row="${i}"><div class="lead ${kind === 'warmup' ? '' : 'teal'}">${icon(kind === 'warmup' ? 'flame' : 'stretch')}</div><div class="body"><div class="title">${it.name}</div><div class="sub">${it.how}</div></div><div class="trail num">${it.sec}s</div></div>`)}</div>
  `);
  const show = (left) => {
    const it = items[idx];
    $('#rt-clock', ctx.view).textContent = fmtClock(left);
    $('#rt-ring', ctx.view).setAttribute('stroke-dashoffset', String(276.5 * (left / it.sec)));
  };
  const begin = (i) => {
    idx = i;
    if (idx >= items.length) {
      clearInterval(tick); keepAwake(false);
      $('#rt-name', ctx.view).textContent = kind === 'warmup' ? 'Warm. Off you go.' : 'All done. Well looked after.';
      $('#rt-how', ctx.view).textContent = '';
      $('#rt-play', ctx.view).innerHTML = `${icon('play')} Again`; idx = -1;
      beep({ freq: 660, times: 3 });
      return;
    }
    const it = items[idx];
    endAt = Date.now() + it.sec * 1000; pausedLeft = 0;
    $('#rt-name', ctx.view).textContent = it.name;
    $('#rt-how', ctx.view).textContent = it.how;
    $$('[data-row]', ctx.view).forEach((r) => r.classList.toggle('tinted', Number(r.dataset.row) === idx));
    $('#rt-play', ctx.view).innerHTML = `${icon('pause')} Pause`;
    beep({ freq: 880 });
    show(it.sec);
  };
  const loop = () => {
    if (idx < 0 || pausedLeft) return;
    const left = (endAt - Date.now()) / 1000;
    if (left <= 0) { buzz(120); begin(idx + 1); return; }
    show(left);
  };
  ctx.on('play', (b) => {
    if (idx < 0) { keepAwake(true); begin(0); clearInterval(tick); tick = setInterval(loop, 200); return; }
    if (pausedLeft) { endAt = Date.now() + pausedLeft; pausedLeft = 0; b.innerHTML = `${icon('pause')} Pause`; keepAwake(true); }
    else { pausedLeft = endAt - Date.now(); b.innerHTML = `${icon('play')} Resume`; keepAwake(false); }
  });
  ctx.on('next', () => { if (idx < 0) { keepAwake(true); begin(0); clearInterval(tick); tick = setInterval(loop, 200); } else begin(idx + 1); });
  ctx.onLeave(() => { clearInterval(tick); keepAwake(false); });
}
