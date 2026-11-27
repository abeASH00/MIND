// Kuat — numbers worked out from your saved sessions: totals, streaks, personal bests.
import { dayKey } from './ui.js';

// Volume ("total lifted") for one set: weight per dumbbell × number of dumbbells × reps.
export function setVolume(st, dbs) {
  if (!st || !st.w || !st.r || !dbs) return 0;
  return st.w * st.r * dbs;
}
export function sessionVolume(session, lookup) {
  let v = 0;
  for (const e of session.exercises || []) {
    const ex = lookup(e.exId);
    const dbs = ex ? ex.dbs : (e.dbs ?? 2);
    if (ex && ex.type !== 'w') continue;
    for (const st of e.sets || []) v += setVolume(st, dbs);
  }
  return v;
}

// Estimated one-rep max — a common way to compare sets with different weights and reps.
export const e1rm = (w, r) => (w && r ? w * (1 + r / 30) : 0);

// Monday-start week key, e.g. "2026-11-23".
export function weekKey(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return dayKey(x);
}

// Weeks in a row with at least one session. The current week never breaks the streak
// just because you haven't trained yet — it only counts once you do.
export function weekStreak(sessions, now = new Date()) {
  const weeks = new Set(sessions.map((s) => weekKey(s.startedAt)));
  const cur = new Date(weekKey(now) + 'T00:00:00');
  let streak = 0;
  const d = new Date(cur);
  if (!weeks.has(dayKey(d))) d.setDate(d.getDate() - 7);
  while (weeks.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 7); }
  return streak;
}
export function bestWeekStreak(sessions) {
  const weeks = [...new Set(sessions.map((s) => weekKey(s.startedAt)))].sort();
  let best = 0, run = 0, prev = null;
  for (const w of weeks) {
    const dt = new Date(w + 'T00:00:00');
    if (prev && Math.round((dt - prev) / 864e5) === 7) run++; else run = 1;
    best = Math.max(best, run); prev = dt;
  }
  return best;
}

export function sessionsInRange(sessions, from, to) {
  return sessions.filter((s) => s.startedAt >= from && s.startedAt < to);
}
export function weekRange(now = new Date()) {
  const start = new Date(weekKey(now) + 'T00:00:00');
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return [start.getTime(), end.getTime()];
}
export function monthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return [start.getTime(), end.getTime()];
}

export function totals(list, lookup) {
  let kg = 0, sec = 0, sets = 0;
  const parts = {};
  for (const s of list) {
    kg += s.totalKg || sessionVolume(s, lookup);
    sec += s.duration || 0;
    for (const e of s.exercises || []) {
      const ex = lookup(e.exId);
      const n = (e.sets || []).length;
      sets += n;
      const part = ex ? ex.part : 'other';
      parts[part] = (parts[part] || 0) + n;
    }
  }
  return { sessions: list.length, kg, sec, sets, parts };
}

// Personal bests per exercise: heaviest weight, best estimated set, most reps (bodyweight), longest hold.
export function personalBests(sessions, lookup) {
  const pbs = {};
  for (const s of sessions) {
    for (const e of s.exercises || []) {
      const ex = lookup(e.exId);
      const type = ex ? ex.type : 'w';
      const cur = pbs[e.exId] || (pbs[e.exId] = { exId: e.exId, type });
      for (const st of e.sets || []) {
        if (type === 'w' && st.w) {
          if (!cur.heaviest || st.w > cur.heaviest.w || (st.w === cur.heaviest.w && st.r > cur.heaviest.r)) cur.heaviest = { w: st.w, r: st.r, date: s.startedAt, sessionId: s.id };
          const est = e1rm(st.w, st.r);
          if (!cur.best || est > cur.best.est) cur.best = { w: st.w, r: st.r, est, date: s.startedAt, sessionId: s.id };
        } else if (st.r) {
          if (!cur.reps || st.r > cur.reps.r) cur.reps = { r: st.r, date: s.startedAt, sessionId: s.id };
        }
      }
    }
  }
  return pbs;
}

// Which new records a just-finished session sets, compared with all earlier sessions.
export function newRecords(session, earlier, lookup) {
  const before = personalBests(earlier, lookup);
  const out = [];
  for (const e of session.exercises || []) {
    const ex = lookup(e.exId);
    const type = ex ? ex.type : 'w';
    const prev = before[e.exId];
    let heavy = null, best = null, reps = null;
    for (const st of e.sets || []) {
      if (type === 'w' && st.w) {
        if (!heavy || st.w > heavy.w) heavy = st;
        if (!best || e1rm(st.w, st.r) > e1rm(best.w, best.r)) best = st;
      } else if (st.r && (!reps || st.r > reps.r)) reps = st;
    }
    if (!prev) continue; // first time doing it — no "beat" to report
    if (heavy && (!prev.heaviest || heavy.w > prev.heaviest.w)) out.push({ exId: e.exId, kind: 'heaviest', w: heavy.w, r: heavy.r });
    else if (best && prev.best && e1rm(best.w, best.r) > prev.best.est + 0.01) out.push({ exId: e.exId, kind: 'best', w: best.w, r: best.r });
    if (reps && (!prev.reps || reps.r > prev.reps.r)) out.push({ exId: e.exId, kind: type === 'time' ? 'hold' : 'reps', r: reps.r });
  }
  return out;
}

// One point per session for a given exercise: top weight and best estimated set.
export function exerciseSeries(sessions, exId) {
  const pts = [];
  for (const s of sessions) {
    const e = (s.exercises || []).find((x) => x.exId === exId);
    if (!e || !e.sets || !e.sets.length) continue;
    let topW = 0, best = null, topR = 0;
    for (const st of e.sets) {
      topW = Math.max(topW, st.w || 0);
      topR = Math.max(topR, st.r || 0);
      if (!best || e1rm(st.w, st.r) > e1rm(best.w, best.r)) best = st;
    }
    pts.push({ date: s.startedAt, sessionId: s.id, topW, topR, best, est: best ? e1rm(best.w, best.r) : 0, sets: e.sets });
  }
  return pts;
}

export function trainedDays(sessions) {
  const m = new Map();
  for (const s of sessions) {
    const k = dayKey(s.startedAt);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  }
  return m;
}
