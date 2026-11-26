// Kuat — weight suggestions. Only ever suggests weights your dumbbells can actually make.
import { toDisplay, unit } from './ui.js';

// Every setting your adjustable dumbbell can be dialled to, in kg, lightest first.
// Example: min 2.5, max 24, step 2.5 → 2.5, 5, 7.5 … 22.5, 24.
export function dumbbellSettings(s) {
  const min = Math.max(0.5, Number(s.dbMin) || 2.5);
  const max = Math.max(min, Number(s.dbMax) || 24);
  const step = Math.max(0.25, Number(s.dbStep) || 2.5);
  const out = [];
  for (let w = min; w < max - 1e-6 && out.length < 200; w = Math.round((w + step) * 1000) / 1000) out.push(w);
  out.push(max);
  return out;
}

export function nearestSetting(kg, s) {
  const list = dumbbellSettings(s);
  let best = list[0];
  for (const w of list) if (Math.abs(w - kg) < Math.abs(best - kg)) best = w;
  return best;
}
export function settingIndex(kg, s) { return dumbbellSettings(s).findIndex((w) => Math.abs(w - kg) < 1e-6); }
export function stepSetting(kg, dir, s) {
  const list = dumbbellSettings(s);
  if (kg === null || kg === undefined) return list[Math.min(1, list.length - 1)];
  const near = nearestSetting(kg, s);
  let i = list.indexOf(near);
  if (Math.abs(near - kg) > 1e-6) { // typed weight between settings: move to the neighbour in that direction
    if (dir > 0 && near < kg) i++; else if (dir < 0 && near > kg) i--;
    return list[Math.max(0, Math.min(list.length - 1, i))];
  }
  return list[Math.max(0, Math.min(list.length - 1, i + dir))];
}

// Rep ranges shaped by the goal chosen in Settings.
export const GOALS = {
  strength: { name: 'Get stronger', reps: [5, 8], note: 'Fewer reps with heavier weight.' },
  muscle: { name: 'Build muscle', reps: [8, 12], note: 'The classic middle range.' },
  active: { name: 'Stay active', reps: [10, 15], note: 'Comfortable weights, steady reps.' },
  lose: { name: 'Lose weight', reps: [12, 15], note: 'Lighter weights, more reps and shorter rests.' },
};
export function repRange(goal) { return (GOALS[goal] || GOALS.muscle).reps; }
export function repText(target, goal) { if (target) return String(target); const [a, b] = repRange(goal); return `${a}–${b}`; }
export function targetLow(target, goal) {
  if (target) { const m = String(target).match(/\d+/); if (m) return Number(m[0]); }
  return repRange(goal)[0];
}
export function targetHigh(target, goal) {
  if (target) { const m = String(target).match(/(\d+)\D+(\d+)/); if (m) return Number(m[2]); const n = String(target).match(/\d+/); if (n) return Number(n[0]); }
  return repRange(goal)[1];
}

// The heaviest completed set from the most recent session that included this exercise.
export function lastPerformance(sessions, exId) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const ex = (sessions[i].exercises || []).find((e) => e.exId === exId);
    if (ex && ex.sets && ex.sets.length) {
      let top = null;
      for (const st of ex.sets) {
        if (!top || (st.w || 0) > (top.w || 0) || ((st.w || 0) === (top.w || 0) && (st.r || 0) > (top.r || 0))) top = st;
      }
      return { date: sessions[i].startedAt, sets: ex.sets, topW: top.w ?? null, topReps: top.r ?? null, feel: ex.feel || null };
    }
  }
  return null;
}

const HARDER = ['Slow the lowering to 3 seconds.', 'Add 2–3 more reps per set.', 'Try it single-arm or single-leg.', 'Pause for 2 seconds at the bottom.'];

function settingLabel(kg, s, suffix = '') {
  const list = dumbbellSettings(s);
  const i = settingIndex(kg, s);
  const each = `${toDisplay(kg)} ${unit()}${suffix}`;
  return i >= 0 ? `${each} (setting ${i + 1} of ${list.length})` : each;
}

// Returns { kg, reps, headline, why, ideas[] } — a plain-words suggestion for today.
export function suggestFor(ex, last, s, target) {
  const goal = s.goal;
  const lo = targetLow(target, goal), hi = targetHigh(target, goal);
  const list = dumbbellSettings(s);
  const maxKg = list[list.length - 1];

  if (ex.type === 'bw' || ex.type === 'time') {
    const what = ex.type === 'time' ? 'seconds' : 'reps';
    if (!last) return { kg: null, reps: ex.type === 'time' ? 20 : lo, headline: `First time: aim for ${ex.type === 'time' ? '20 seconds' : lo + ' reps'} with good form.`, why: 'Learn the movement first — there’s no rush.', ideas: [] };
    const base = last.topReps || lo;
    if (last.feel === 'hard') return { kg: null, reps: base, headline: `Match last time: ${base} ${what}.`, why: 'It felt hard, so stay here until it feels steadier.', ideas: [] };
    const add = ex.type === 'time' ? 5 : 1;
    return { kg: null, reps: base + add, headline: `Try ${base + add} ${what} (last time ${base}).`, why: last.feel === 'easy' ? 'It felt easy last time, so a little more.' : 'Beat last time by a small step.', ideas: last.feel === 'easy' ? [ex.harder] : [] };
  }

  // Weighted exercise.
  if (!last || last.topW === null || last.topW === undefined) {
    const startIdx = ex.small || ex.dbs === 1 && !ex.heavy ? 0 : Math.min(1, list.length - 1);
    const kg = list[startIdx];
    return { kg, reps: lo, headline: `Start at ${settingLabel(kg, s, ex.dbs === 2 ? ' each' : '')}.`, why: 'First time — start lighter than you think and learn the movement.', ideas: [] };
  }

  const w = nearestSetting(last.topW, s);
  const reps = last.topReps || lo;
  const next = list[list.indexOf(w) + 1];
  const each = ex.dbs === 2 ? ' each' : '';

  if (last.feel === 'hard') {
    return { kg: w, reps, headline: `Stay at ${settingLabel(w, s, each)}, aim for ${reps} reps.`, why: 'It felt hard last time. Same weight until it feels steadier.', ideas: [] };
  }

  if (last.feel === 'easy') {
    if (ex.small && reps < hi) {
      const r = Math.min(hi, reps + 2);
      return { kg: w, reps: r, headline: `Keep ${settingLabel(w, s, each)}, go for ${r} reps.`, why: `For ${ex.part === 'core' ? 'smaller muscles' : 'smaller muscles like ' + ex.part} a ${toDisplay(s.dbStep)} ${unit()} jump is a big percentage, so add reps first.`, ideas: [] };
    }
    if (next === undefined) {
      return { kg: w, reps: Math.min(hi + 3, reps + 2), headline: `You’re at your top setting (${toDisplay(w)} ${unit()}).`, why: 'Your dumbbells don’t go heavier, so make it harder another way:', ideas: [...HARDER, ex.harder].filter(Boolean), atMax: true };
    }
    return { kg: next, reps: lo, headline: `Go up to ${settingLabel(next, s, each)}, aim for ${lo} reps.`, why: 'It felt easy, so one setting up.', ideas: [] };
  }

  // "Just right" or no feeling recorded: same weight, beat the reps.
  if (reps >= hi) {
    if (next === undefined) {
      return { kg: w, reps: reps + 1, headline: `You’re at your top setting (${toDisplay(w)} ${unit()}).`, why: 'Your dumbbells don’t go heavier, so make it harder another way:', ideas: [...HARDER, ex.harder].filter(Boolean), atMax: true };
    }
    if (ex.small) {
      return { kg: w, reps: reps + 1, headline: `Keep ${settingLabel(w, s, each)}, try ${reps + 1} reps.`, why: `You’ve reached the top of your range. When ${reps + 2} reps feel easy, try the next setting.`, ideas: [] };
    }
    return { kg: next, reps: lo, headline: `Try ${settingLabel(next, s, each)} for ${lo} reps.`, why: 'You hit the top of your rep range, so it’s time for one setting up.', ideas: [] };
  }
  return { kg: w, reps: reps + 1, headline: `Same weight, ${settingLabel(w, s, each)}. Try for ${reps + 1} reps.`, why: `Last time you did ${reps}. Beat it by one.`, ideas: [] };
}

// Weight calculator: the closest pair of settings for a target total.
export function calcForTotal(totalKg, s, pair = true) {
  const per = pair ? totalKg / 2 : totalKg;
  const kg = nearestSetting(per, s);
  return { perDumbbell: kg, total: pair ? kg * 2 : kg, exact: Math.abs(kg - per) < 1e-6, index: settingIndex(kg, s), count: dumbbellSettings(s).length, maxKg: dumbbellSettings(s).slice(-1)[0] };
}
