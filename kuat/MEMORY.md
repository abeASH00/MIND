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
- [ ] 1. index.html, manifest.json, icons/, sw.js, js/app.js (router, nav, theme)
- [x] 2. js/data.js — IndexedDB + backup export/import (done early; written before step 1)
- [ ] 3. js/exercises.js — 30+ exercises, SVG figures, library + detail
- [ ] 4. js/plans.js — presets + builder
- [ ] 5. js/workout.js — set logging, rest timer, resume
- [ ] 6. js/suggest.js — weight suggestions
- [ ] 7. js/progress.js + js/stats.js
- [ ] 8. js/tools.js — warm-up, cool-down, timers, calculator
- [ ] 9. js/settings.js — settings + backup
- [ ] 10. reminders
- [ ] 11. final offline/empty-data/keyboard pass, then final report to user
      (file list, phone test checklist, deploy steps, security review)

## Planned file layout
index.html, _headers (Netlify security headers), manifest.json, sw.js, css/app.css,
js/{app,ui,data,stats,exercises,figures,plans,workout,suggest,progress,tools,settings,home}.js,
icons/, fonts/

## Log
- 2026-11-27 (chat 1): set up folder, fonts, CSS, data.js. Session restarted mid-build; paused at 7am MYT per user. Auto-resume scheduled 2026-11-28 03:30 MYT.
- NEXT: step 1 (index.html, manifest, icons via PIL, sw.js, app.js, ui.js), then 3 onward.
