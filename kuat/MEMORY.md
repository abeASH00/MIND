# Kuat — build memory (read this first in any new chat)

## What this is
Kuat: a private, offline indoor dumbbell workout PWA (Progressive Web App: a website
that installs on a phone like an app) for one person. Plain HTML/CSS/JS, no frameworks,
no CDN, IndexedDB storage, bundled fonts. Full spec is the user's first message in the
original chat (the "BUILD THIS APP ALL THE WAY TO DONE" brief).

## Where it lives
- Repo: abeASH00/MIND, branch `claude/kuat-workout-pwa-ernkqb`, folder `kuat/`
  (MIND is an unrelated Python project; kuat/ is self-contained and is the folder to deploy).

## User preferences
- Not a developer: plain words, explain any technical term the first time.
- Works from the phone.
- Wants this MEMORY.md kept up to date in every chat.
- Work schedule: if usage runs out, resume at 3:30am and stop at 7:00am
  (assumed Malaysia time, Asia/Kuala_Lumpur — not confirmed by user).

## Decisions made (one line each)
- Dumbbell settings = min, min+step, ... below max, then max itself (2.5…22.5, 24).
- Weights stored internally in kg per dumbbell; converted for display when lb is chosen.
- Streak = weeks in a row with at least one session (never counts rest days against you).
- Reminders: in-app + calendar (.ics) file export + optional periodic background check;
  honest that true scheduled push needs a server.

## Progress (build order from the brief)
- [x] Fonts bundled: fonts/ (Fraunces 600, DM Sans 400/500/700, OFL licences)
- [x] css/app.css — full design system (light/dark, cards, nav, sheets, set rows, charts, calendar)
- [x] 1. index.html, manifest.json, icons/ (PIL), sw.js, _headers, js/ui.js, js/app.js (router with ctx, nav highlight, SW register + update toast, safety note on first open, persist request).
- [x] 2. js/data.js — IndexedDB + backup export/import (done early; written before step 1)
- [~] 3. DONE: js/exercise-data.js (46 exercises + warm-ups/cool-downs/rest-day ideas), js/figures.js (stick-figure poses). DONE js/exercises.js (loadExercises, getExercise, allExercises, partName, isFav, renderLibrary(ctx), renderExercise(ctx,id), exercisePicker, searchExercises; custom exercises; favourites; notes). Polish poses: one-arm row & hip thrust look off.
- [x] 4. js/plans.js — 5 presets (seeded to DB via ensurePresets), builder, reorder/swap/remove, day edit, reset preset. Exports: ensurePresets, activePlan, dayFor, upcoming, dayParts, renderPlans(ctx), renderPlan(ctx,id), searchPlans, PRESETS. Imports from exercises.js: getExercise, allExercises, exercisePicker({title, part, exclude, onPick}) — exercises.js MUST export these.
- [x] 5. js/workout.js — written, NOT yet browser-tested: start screen, set rows w/ steppers, tick → rest (heavy/light), supersets, swap (offer to remember in plan), add/remove set/exercise, feel prompt, finish summary w/ PBs, resume via focusUid, wake lock. Re-exports restoreTimer/startRest from tools.js.
- [x] 6. js/suggest.js — dumbbellSettings, nearestSetting, stepSetting, GOALS, repRange/repText/targetLow/targetHigh, lastPerformance(sessions,exId), suggestFor(ex,last,settings,target) -> {kg,reps,headline,why,ideas,atMax}, calcForTotal. Tested in node.
- [~] 7. DONE js/stats.js (setVolume, sessionVolume, e1rm, weekKey, weekStreak, bestWeekStreak, weekRange, monthRange, totals, personalBests, newRecords, exerciseSeries, trainedDays; tested). DONE js/charts.js (lineChart(points,{unitKg,pbIndex,second,label}), barChart(bars,{format})). DONE js/progress.js (overview week/month, per-exercise charts #/progress/ex/ID, records, calendar + day sheet #/progress/day/KEY, body weight, measurements, photos).
- [x] 8. js/tools.js — global rest timer bar (startRest, stopRest, restoreTimer; real-clock endAt in localStorage), renderTool(ctx,name) rest|interval|calc|warmup|cooldown. NOTE: app.js imports restoreTimer from workout.js → workout.js must re-export it from tools.js (or change app.js import).
- [x] 9. js/settings.js — More tab, Settings (all fields), backup export/import UI, delete-all (double confirm), photo resize helper (pickPhoto, resizeImage(file,max,q,asBlob)), applyTheme, backupAgeDays, doExport.
- [x] 10. reminders — in settings.js: syncReminderInfo (kv 'reminderInfo' for sw.js), in-app timer, periodicSync if granted, .ics calendar export. sw.js still needs to record lastNotified (it can't write kv yet; uses notification tag).
- [ ] 11. final offline/empty-data/keyboard pass, then final report to user
      (file list, phone test checklist, deploy steps, security review)

## Screen convention (app.js provides this ctx)
Every screen fn gets ctx = { view, params, mount(htmlRaw), on(act, fn(btnEl, event)) (delegated click on [data-act]; re-registering overwrites), go(hash), refresh() (re-renders; keeps scroll on same hash), onLeave(fn), listen(type, fn) — ALWAYS use ctx.listen for listeners on #view itself, never ctx.view.addEventListener (they'd pile up) }.
Session record: {id, startedAt, endedAt, duration(sec), planId, dayName, exercises:[{exId, sets:[{w(kg per dumbbell), r}], feel:'easy'|'right'|'hard'|null}], totalKg, pbs:[]}.

## Planned file layout
index.html, _headers (Netlify security headers), manifest.json, sw.js, css/app.css,
js/{app,ui,data,stats,exercise-data,exercises,figures,plans,workout,suggest,progress,tools,settings,home}.js,
(remember: add js/exercise-data.js AND js/charts.js to the FILES list in sw.js; bump VERSION when files change)
icons/, fonts/

## Log
- 2026-11-27 (chat 1, 06:34–07:00 MYT): built most files. REMAINING: workout.js, progress.js, then sw.js FILES list, Playwright test, final report.
- earlier same chat: set up folder, fonts, CSS, data.js. Session restarted mid-build; paused at 7am MYT per user. Auto-resume scheduled 2026-11-28 03:30 MYT.
- ui.js exports: esc, html`` (auto-escape tag), raw, safeUrl, linkify, $, $$, icon(name), toast, openSheet, confirmSheet, closeTopSheet, unit/toDisplay/fromDisplay/fmtW/fmtBig/fmtDur/fmtClock/dayKey/metaJoin, beep, buzz, unlockAudio, keepAwake, setupKeyboardHandling, downloadBlob, emptyState, avatarHTML, revealSelectedPills.
- data.js exports: getSettings/saveSettings/settingsNow, getKV/setKV, saveActiveSync/getActive/clearActive, sessions/plans/custom/exmeta/body/measure/photos CRUD, exportBackup/importBackup/resetAll, requestPersist, uid.
- NEXT: (1) visual polish pass with Playwright screenshots on a phone viewport (light+dark); (2) check keyboard behaviour, empty-data screens, offline (SW) load; (3) tidy poses (one-arm row, hip thrust); (4) sw.js lastNotified; (5) final report to user: file list, phone test checklist, deploy steps (Netlify Drop + GitHub Pages), security/privacy review.
- Session ended 06:55 MYT (user's 7am stop). Auto-resume scheduled 2026-11-28 03:30 MYT (trigger trig_01EBf7SvYHaSm3RhprSLWw3p).
- SMOKE TEST PASSED 06:53 MYT: all 15 routes render with zero console errors (Pixel 7 emulation); typed reps + ticked set survive reload.
