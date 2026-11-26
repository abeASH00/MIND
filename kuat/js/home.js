// Kuat — Home: streak, today's workout, last session, stats, coming up, quick tools, search.
import * as Data from './data.js';
import { html, raw, esc, icon, metaJoin, fmtBig, fmtDur, fmtDate, fmtDateLong, unit, DAYS_LONG, DAYS_SHORT, avatarHTML, $, emptyState, dayKey } from './ui.js';
import { activePlan, dayFor, upcoming, dayParts, searchPlans } from './plans.js';
import { getExercise, partName, searchExercises } from './exercises.js';
import { weekStreak, weekRange, sessionsInRange, totals, sessionVolume } from './stats.js';
import { backupAgeDays, doExport } from './settings.js';
import { REST_DAY_IDEAS } from './exercise-data.js';
import { startWorkout } from './workout.js';

function streakLine(n, thisWeek) {
  if (n === 0) return 'Every streak starts with one session. No rush.';
  if (n === 1) return thisWeek ? 'You’ve trained this week. That’s the hard part done.' : 'One week in. A steady start.';
  if (n < 4) return `${n} weeks in a row with training. Nice and steady.`;
  if (n < 12) return `${n} weeks running. This is becoming a habit.`;
  return `${n} weeks in a row. Quietly impressive.`;
}
function greeting(name) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

export async function renderHome(ctx) {
  const s = await Data.getSettings();
  const sessions = await Data.listSessions();
  const plan = await activePlan();
  const active = await Data.getActive();
  const today = new Date();
  const todayDay = dayFor(plan, today);
  const doneToday = sessions.some((x) => new Date(x.startedAt).toDateString() === today.toDateString());
  const [ws, we] = weekRange(today);
  const week = sessionsInRange(sessions, ws, we);
  const streak = weekStreak(sessions, today);
  const all = totals(sessions, getExercise);
  const last = sessions[sessions.length - 1];
  const next = upcoming(plan, today, 4);
  const age = backupAgeDays(s);
  const nudge = sessions.length >= 2 && (age === null || age >= 14) && Date.now() - (s.backupNudgeAt || 0) > 3 * 864e5;
  const idea = REST_DAY_IDEAS[today.getDate() % REST_DAY_IDEAS.length];
  const pct = Math.min(100, Math.round((week.length / Math.max(1, s.weeklyTarget)) * 100));

  let todayCard;
  if (active) {
    const done = active.exercises.filter((e) => e.sets.length && e.sets.every((x) => x.done)).length;
    todayCard = html`<div class="card tinted"><div class="kicker">Workout in progress</div><h3>${active.dayName || 'Workout'}</h3>
      <p class="meta">${done} of ${active.exercises.length} exercises done. Everything you typed is saved.</p>
      <a class="btn block" href="#/workout">${icon('play')} Carry on</a></div>`;
  } else if (todayDay && !doneToday) {
    todayCard = html`<div class="card"><div class="kicker">Today · ${DAYS_LONG[today.getDay()]}</div><h3>${todayDay.name}</h3>
      <p class="meta">${raw(metaJoin([`${todayDay.exercises.length} exercises`, dayParts(todayDay).map(partName).join(', ')]))}</p>
      <div class="btn-row" style="margin-top:10px"><button class="btn" data-act="start">${icon('play')} Start</button><a class="btn ghost" href="#/tool/warmup">Warm-up</a></div></div>`;
  } else if (doneToday) {
    todayCard = html`<div class="card teal"><div class="kicker">Today</div><h3>Done for today</h3><p class="small">Good work. Rest is when the strength actually gets built.</p><a class="btn ghost small" href="#/tool/cooldown">Cool-down stretches</a></div>`;
  } else {
    todayCard = html`<div class="card teal"><div class="kicker">Today · rest day</div><h3>${idea.name}</h3><p class="small">${idea.how}</p>
      <div class="btn-row" style="margin-top:10px"><a class="btn ghost small" href="#/tool/cooldown">Stretch with a timer</a><button class="btn soft small" data-act="quick">Train anyway</button></div></div>`;
  }

  let lastCard = '';
  if (last) {
    const vol = last.totalKg ?? sessionVolume(last, getExercise);
    lastCard = html`<div class="card"><div class="card-head"><div><div class="kicker">Last session</div><h3>${last.dayName || 'Workout'}</h3></div><span class="meta">${fmtDate(last.startedAt)}</span></div>
      <p class="meta">${raw(metaJoin([last.exercises.map((e) => (getExercise(e.exId) || { name: e.name || 'Exercise' }).name).slice(0, 4).join(', ') + (last.exercises.length > 4 ? '…' : '')]))}</p>
      <div class="summary-big"><div><div class="value">${fmtDur(last.duration || 0)}</div><div class="label">time</div></div><div><div class="value">${fmtBig(vol)}</div><div class="label">${unit()} lifted</div></div><div><div class="value">${(last.pbs || []).length}</div><div class="label">beaten</div></div></div>
      ${(last.pbs || []).length ? html`<div class="chips">${last.pbs.slice(0, 4).map((p) => html`<span class="badge gold">${icon('trophy', ' width="13" height="13"')} ${(getExercise(p.exId) || { name: 'Exercise' }).name}</span>`)}</div>` : ''}</div>`;
  }

  ctx.mount(html`
    <div class="search" style="margin-bottom:12px">${icon('search')}<input class="input" type="search" id="home-q" placeholder="Search exercises and workouts" autocomplete="off" enterkeyhint="search"></div>
    <div id="home-results"></div>
    <div id="home-main">
      <div class="hero">
        <div class="avatar" aria-hidden="true">${avatarHTML(s)}</div>
        <div class="hello">${greeting(s.name)}</div>
        <div><span class="big">${streak}</span><span class="unit">${streak === 1 ? 'week' : 'weeks'} streak</span></div>
        <div class="line">${streakLine(streak, week.length > 0)}</div>
      </div>
      ${nudge ? html`<div class="card warn"><div class="banner">${icon('shield')}<div class="grow small"><b>Time for a backup?</b> Phones can clear app data when an app sits unused. A backup file keeps your history safe.</div></div>
        <div class="btn-row" style="margin-top:10px"><button class="btn small" data-act="backup">Back up now</button><button class="btn ghost small" data-act="later">Later</button></div></div>` : ''}
      ${todayCard}
      ${lastCard}
      <div class="grid2" style="margin-top:10px">
        <div class="card stat" style="margin:0"><div class="value">${week.length}<span class="muted" style="font-size:16px"> / ${s.weeklyTarget}</span></div><div class="label">sessions this week</div><div class="bar"><span style="width:${pct}%"></span></div></div>
        <div class="card stat" style="margin:0"><div class="value">${fmtBig(all.kg)}</div><div class="label">${unit()} lifted in total</div></div>
      </div>
      ${plan ? html`<div class="section-title">Coming up</div>
        ${next.length ? html`<div class="list">${next.map((n) => html`<a class="item" href="#/plan/${encodeURIComponent(plan.id)}"><div class="lead">${icon('calendar')}</div><div class="body"><div class="title">${n.day.name}</div><div class="sub">${raw(metaJoin([fmtDateLong(n.date), `${n.day.exercises.length} exercises`]))}</div></div></a>`)}</div>` : html`<div class="card flat"><p class="meta">Nothing planned in the next two weeks.</p></div>`}`
        : html`<div class="card tinted" style="margin-top:10px"><h3>Pick a plan</h3><p class="small">Choose a ready-made plan or build your own, and Kuat will show what’s on each day.</p><a class="btn small" href="#/plans">See plans</a></div>`}
      <div class="section-title">Quick tools</div>
      <div class="tool-grid">
        <a class="tool" href="#/tool/rest">${icon('timer')}<b>Rest timer</b><span class="meta">Presets or custom</span></a>
        <a class="tool" href="#/tool/interval">${icon('interval')}<b>Intervals</b><span class="meta">Work · rest · rounds</span></a>
        <a class="tool" href="#/tool/calc">${icon('calc')}<b>Weight calc</b><span class="meta">Dial settings</span></a>
        <a class="tool" href="#/tool/warmup">${icon('flame')}<b>Warm-up</b><span class="meta">Matched to today</span></a>
      </div>
    </div>
  `);

  ctx.on('start', () => startWorkout(plan, todayDay, ctx));
  ctx.on('quick', () => ctx.go('#/workout'));
  ctx.on('backup', async () => { await doExport(); renderHome(ctx); });
  ctx.on('later', async () => { await Data.saveSettings({ backupNudgeAt: Date.now() }); renderHome(ctx); });

  const q = $('#home-q', ctx.view), res = $('#home-results', ctx.view), main = $('#home-main', ctx.view);
  q.addEventListener('input', async () => {
    const term = q.value.trim().toLowerCase();
    if (!term) { res.innerHTML = ''; main.classList.remove('hidden'); return; }
    main.classList.add('hidden');
    const exs = searchExercises(term);
    const pls = await searchPlans(term);
    const past = sessions.filter((x) => (x.dayName || '').toLowerCase().includes(term) || x.exercises.some((e) => ((getExercise(e.exId) || {}).name || '').toLowerCase().includes(term))).slice(-5).reverse();
    res.innerHTML = String(exs.length || pls.length || past.length ? html`
      ${exs.length ? html`<div class="section-title">Exercises</div><div class="list">${exs.map((e) => html`<a class="item" href="#/exercise/${encodeURIComponent(e.id)}"><div class="lead">${icon('dumbbell')}</div><div class="body"><div class="title">${e.name}</div><div class="sub">${partName(e.part)}</div></div></a>`)}</div>` : ''}
      ${pls.length ? html`<div class="section-title">Plans and workouts</div><div class="list">${pls.map((r) => html`<a class="item" href="#/plan/${encodeURIComponent(r.plan.id)}"><div class="lead teal">${icon('clipboard')}</div><div class="body"><div class="title">${r.day ? r.day.name : r.plan.name}</div><div class="sub">${r.day ? raw(metaJoin([r.plan.name, DAYS_SHORT[r.day.weekday]])) : `${r.plan.days.length} days`}</div></div></a>`)}</div>` : ''}
      ${past.length ? html`<div class="section-title">Past sessions</div><div class="list">${past.map((x) => html`<a class="item" href="#/progress/day/${encodeURIComponent(dayKey(x.startedAt))}"><div class="lead">${icon('calendar')}</div><div class="body"><div class="title">${x.dayName || 'Workout'}</div><div class="sub">${fmtDateLong(x.startedAt)}</div></div></a>`)}</div>` : ''}`
      : emptyState('search', 'Nothing found. Try another word.'));
  });
}
