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

## Files

Done:
- `app/js/util.js`: money in sen, dates, escaping, hashing, tidyName, seeded random
- `app/js/csv.js`: CSV read/write, Bluecoins import (tested: transfers paired, splits merged, re-import skipped), exports, backup
- `app/js/smart.js`: notification reader (tested on 10 Malaysian examples: payments, card charge duplicate, transfer, reload, TAC, promos, statement, salary)
- `app/js/seed.js`: default categories (with keys + colour slots c1..c8), the user's 7 accounts with aliases/notification apps, example data (270 tx over ~3 months, budgets, repeating rules, inbox), sample receipt
- `app/js/db.js`: IndexedDB wrapper (stores: accounts, categories, transactions, budgets, recurring, inbox, memory, attachments, kv, outbox, shares) with in-memory fallback; `upgrade()` shared with the service worker
- `app/js/store.js`: in-memory state + save/soft-delete/purge, settings, selectors, attachments, cloud outbox, merchant learning, repeating rules (auto + remind), import apply/undo, start fresh, example data load/clear, wipe, restore (tested in Node with memory fallback)
- `app/js/cloud.js`: Firebase 10.12.2 from gstatic (loaded on demand), Google sign-in (popup, redirect fallback), pull/push last-write-wins on updatedAt with an outbox; parseConfig accepts the pasted firebaseConfig block
- `app/js/icons.js`: original line icons (`icon(name, size)`), ACCOUNT_ICON map
- `app/js/ui.js`: toast (with undo action), bottom sheets, confirmBox, badges, pickFrom/pickAccount/pickCategory (recent + search), calculator keypad (evalAmount tested), header(), shrinkImage, blobToBase64, saveFile (share or download)
- `app/js/charts.js`: columns (grouped, rounded tops, hairline grid, legend, slot tooltips), line (area wash, end dot + label, crosshair tooltip, arrow keys), segBar (tall segmented bar with % inside, legend), meter, mountCharts(root). CSS still needs classes: .chart .tip .grid .axis .tick .mark .band .hit .area(10% opacity) .line(2px) .dot(2px surface ring) .cross .endlab .legend .lg .lg-rect .segbar .seg .ink-dark .meter.ok/.near/.over; colour tokens --inc --exp --c0..--c8
- `tests/core.test.mjs`: 13 passing (`node --test tests/*.test.mjs`)
- `app/js/calc.js`: periods (payday month start), balances, net worth, category totals, splits,
  label totals, period series, net worth series, budgets, repeating rules, search filter

To do, in this order:
1. `app/js/csv.js`: CSV parse/write. Bluecoins import with fuzzy headers (strip "(n)" prefixes),
   date format detection (YMD/MDY/DMY plus month names), transfer pairing (negative row = from),
   split grouping by the Split column, opening-balance rows, duplicate skipping via `importKey` hash,
   and a summary before anything is saved, with Undo by `importBatch`.
   Export formats: the Bluecoins 14-column advanced template
   `(1)Type,(2)Date,(3)Item or Payee,(4)Amount,(5)Currency,(6)ConversionRate,(7)Parent Category,(8)Category,(9)Account Type,(10)Account,(11)Notes,(12) Label,(13) Status,(14) Split`,
   a plain Belanja CSV, and a full JSON backup.
2. `app/js/smart.js`: notification rules engine. Junk (TAC/OTP, promos, delivery, login alerts),
   amount regex, direction verbs (Malay too), account from app name, card last-4 digits or aliases,
   merchant extraction, category from merchant memory and then a keyword map (Malaysian merchants),
   duplicates (same amount within 10 min), "already recorded" check, confidence, a plain reason
   sentence, learning, and AI merge.
7. Views in `app/js/views/`: home, history, edit (transaction form with keypad, autocomplete,
   splits, labels, attachment, repeat), accounts and account detail (set balance), reports
   (spending, income, cash flow, net worth, labels), budgets, calendar, bills (repeating rules,
   due and upcoming), inbox (smart cards, paste text, skipped list), receipt (photo, AI or manual,
   one entry or split), categories, prefs, data (import/export/backup/restore), more,
   onboarding, lock (PIN).
8. `app/index.html`, `app/css/app.css`, `app/manifest.webmanifest` (with share_target POST `./share`),
   `app/sw.js` (offline cache, saves shared items to the `shares` store), and the icons.
9. `worker/index.js`, `wrangler.jsonc`, `package.json` (wrangler 4.159.0).
10. `SETUP.md`: plain-words phone guide covering Cloudflare Git deploy, secrets, Firebase,
    MacroDroid, installing the app, and importing from Bluecoins.
11. Bundle a demo with esbuild into one self-contained page and publish it as an artifact
    (same URL as the preview: claude.ai/artifact/16JTfHjTjvdRvQnCYcTcV7). Check it with
    Playwright at 400px in light and dark mode.
