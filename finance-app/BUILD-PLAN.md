# Belanja full app: build plan

The user asked for an app that does everything Bluecoins does, plus their own smart features.
It has its own name, look and code. Nothing is copied from Bluecoins: no name, logo, art or code.
Work window: 3:30am to 7:00am Malaysia time. Commit and push after every finished file.

## Decisions already made (don't revisit)

- Stack: plain HTML/CSS/JS ES modules, no framework, no build step for the real app.
- Data lives on the phone in IndexedDB (database name `belanja`; the demo uses `belanja-demo`).
  Firebase is optional cloud backup and sync, loaded from gstatic 10.12.2 only after the user turns it on.
- Amounts are stored as whole sen (integers). Dates are `YYYY-MM-DD` strings, times `HH:MM`.
- Hosting: one Cloudflare Worker serves both the app (Workers Static Assets, folder `app/`) and the API (`/api/*`).
  It deploys from GitHub through Cloudflare's Git integration, so the user never pastes code.
- Notification queue: a SQLite-backed Durable Object (`Inbox`), so no KV IDs need copying.
- AI: `@anthropic-ai/sdk` 1.8.0 in the Worker. Model comes from env var `MODEL`, default `claude-opus-5-5`.
  Use effort `low` and `output_config.format` json_schema. Add server-side fallbacks
  (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`) and tell the user they're on.
  Check `stop_reason` before reading content.
  Cost estimate: about RM0.10 per receipt and RM0.05 per batch of unclear notifications on Opus 5.5,
  roughly RM10 a month. Haiku 5.5 (`claude-haiku-5-5`) would be about 40x cheaper. That's the user's
  call: change the `MODEL` variable.
- Worker secrets: `ANTHROPIC_API_KEY` and `APP_KEY`. The app and MacroDroid send `APP_KEY` in the
  `x-belanja-key` header or a `?key=` query.
- MacroDroid sends notifications with query params `app`, `title`, `text` (URL-encoded automatically).
  The Worker also accepts form, JSON or plain-text bodies.
- Charts follow the dataviz skill: blue `#257de0`/`#338ced` = income, orange `#f47230`/`#e76624` = expense.
  The green/orange pair FAILS colour-blind checks, so never use it. Category colours use the validated
  8-slot palette in order: blue, orange, aqua, yellow, magenta, green, violet, red.
  Spending is shown as a tall segmented bar (top 5 + Other) plus ranked bars, not a pie.
  Hairline grid, bars ≤24px thick with 4px rounded ends, 2px lines, tooltips on hover and tap.
- Routes are hash-based (`#home`, `#history`, `#add`, `#tx-<id>`, `#inbox`, `#more`, `#accounts`,
  `#account-<id>`, `#reports`, `#budgets`, `#calendar`, `#bills`, `#categories`, `#prefs`, `#data`, `#receipt`).
  Never use `#settings`: claude.ai reserves it.
- Bottom tabs: Home, History, +, Inbox, More.
- Default accounts (from the user's Bluecoins): RHB Bank (bank), CIMB Bank (bank),
  CIMB Petronas Visa-i (credit), Affin Bank (bank), TnG (e-wallet), SETEL (e-wallet), Wallet (cash).

## Status (28 Nov 2026, 3:55am): first full version DONE

Everything in the original plan is built, tested and pushed:
- Core logic: `app/js/util.js`, `calc.js`, `csv.js`, `smart.js`, `seed.js`, `db.js`, `store.js`, `cloud.js`, `capture.js`, `app.js`
- Screen pieces: `ui.js` (sheets, pickers, calculator keypad), `charts.js`, `icons.js`, `main.js` (router, PIN lock, start-up)
- Screens (`app/js/views/`): home, history, edit (add/edit transaction), inbox, more, accounts, account,
  reports, budgets, calendar, bills, bill, categories, prefs (settings), data (import/export), receipt, welcome
- App shell: `app/index.html`, `app/css/app.css`, `app/manifest.webmanifest` (share target), `app/sw.js` (offline), `app/icons/`
- Server: `worker/index.js` (Durable Object `Inbox`, `/api/notify`, `/api/inbox`, `/api/inbox/ack`, `/api/health`,
  `/api/ai/notifications`, `/api/ai/receipt`), `wrangler.jsonc`, `package.json` + lockfile
- Docs: `SETUP.md` (phone guide for the user)
- Demo: `node tools/build-demo.mjs` -> `dist/demo.html` (gitignored), published at
  https://claude.ai/artifact/16JTfHjTjvdRvQnCYcTcV7 (republish with the same file path, or pass that url)

## How it was tested
- `node --test tests/*.test.mjs`: 13 unit tests (money, periods, budgets, repeats, search, CSV, Bluecoins import, notification reader)
- Playwright against `python3 -m http.server` in `app/`: every screen renders at 400px with no errors;
  Bluecoins CSV import, add expense with keypad, paste notification, save from inbox, PIN lock, offline reload
- `npx wrangler dev` with `.dev.vars` APP_KEY: all API routes, MacroDroid-style query params, duplicates, ack,
  plain-text body, share redirect, and the app's Inbox pulling from the server
- NOT yet tested with a real Anthropic key (no key in this environment) or a real Cloudflare deploy / Firebase project.

## Ideas for next (ask the user first)
- Real-world check once the user deploys: MacroDroid message formats from their actual bank apps
  (tune `smart.js` keyword/regex lists with real samples), and their real Bluecoins export columns.
- (Done) Categories › Shops: see and forget the shops Belanja has learned.
- Move the app into its own GitHub repo (e.g. abeash00/belanja) instead of the MIND fork.
