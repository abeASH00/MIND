# Claude memory: read this first in every new chat

Updated: 2026-11-27 06:40 MYT

## About the user
- Not a developer. Wants plain-word steps and complete copy-paste files, not diffs.
- Builds from an Android phone only. No desktop IDE.
- Usual stack: plain HTML/CSS/JS, no frameworks. Firebase (Firestore, Google sign-in).
  Cloudflare Worker for anything that needs a secret. PWA (installs to home screen).
- Works in small phases: a clickable preview first, then one feature at a time.
- Lives in Malaysia, uses MYR. Explain technical terms the first time they come up.
- Keeps a "three-lane focus rule": only three active projects at a time.

## Project: personal finance / expense app (started 2026-11-26)
### Background (settled, don't redo)
- Uses Bluecoins (Android) daily and likes it.
- Bluecoins has no API. The only way in from outside is CSV import
  (Settings → Data → CSV Import). Columns: Date, Content, Notes, Account, Category, Amount, Type
  (Type: e = expense, i = income, t = transfer). It's a bulk import, not per-transaction.
- Bluecoins can already auto-log from bank SMS / app notifications (Settings → Notifications).
  The user hasn't said yet whether this is on.
- Writing straight into the Bluecoins backup file was REJECTED: restoring replaces the whole ledger.
- Accounts: RHB Bank, CIMB Bank, CIMB Petronas Visa-i, Affin Bank, TnG, SETEL, Wallet.
- Categories (parent → child): Food & Drinks (Dining Out, Take Away, Grocery),
  Transportation (Fuel, Toll), Shopping, Utilities, Housing, Debt, ...
  Get the exact list from a Bluecoins CSV export before writing import code.

### Routes on the table (receipt-scanner idea)
- A (recommended): app stores receipts, weekly CSV export → one Bluecoins import a week.
- B: app reads the receipt and shows a filled card; user types it into Bluecoins.
- C: write into the backup database. Rejected.

### Status
- 2026-11-26: DECIDED: build own app that REPLACES Bluecoins (routes A/B/C above are now moot).
- Bluecoins notification auto-log IS on, but user finds it bad: it logs every notification blindly.
  User wants it "intelligent" (skip junk, guess category/account, merge duplicates).
- Key limit told to user: a web app (PWA) cannot read Android notifications by itself.
  Proposed: free Android automation app (MacroDroid) forwards bank/e-wallet notifications
  to a Cloudflare Worker; an AI model filters and drafts the transaction; user taps to confirm
  in an "Inbox" screen. Receipts: share photo to the app (PWA share target) → AI reads it.
- Proposed phases: 1 clickable preview (fake data) → 2 manual entry + Firebase save →
  3 import Bluecoins history from CSV → 4 receipt photo reading → 5 smart notification inbox
  → 6 reports/budgets.
- App name (working): "Belanja".
- PHASE 1 DONE: clickable preview, example data only.
  File: finance-app/preview.html (in this repo). Live link: https://claude.ai/artifact/16JTfHjTjvdRvQnCYcTcV7
  Screens: Home (month spent vs RM2,500 budget, account balances, recent), Inbox (smart
  notification cards: Looks right / Possible duplicate / Transfer, plus "Skipped by Belanja" junk list
  with "Not junk"), Add (expense/income/transfer, keypad, category + account pickers, note, date),
  Receipt scan (sample Lotus's receipt, one entry vs split by category), History (search + account filter),
  Reports (by category bars, last-14-days bars).
  Preview saves taps in the browser only. Types use Bluecoins letters e / i / t.
- User said "just do it first" and skip the questions for now. Still open: three-lane slot,
  Bluecoins CSV export (needed for exact category names in phase 2/3).
- 2026-11-26/27: User asked for a COMPLETE app that does everything Bluecoins does, plus their smart
  features ("use as many tokens as you need"). Own name, look and code; nothing copied from Bluecoins.
  Full plan and design decisions: finance-app/BUILD-PLAN.md. Read that before continuing.
- WORK WINDOW: user wants the build to run 3:30am–7:00am Malaysia time and stop at 7am. A reminder
  is scheduled for 2026-11-28 03:30 MYT to resume. Commit + push after every file.
- Build progress: util.js, calc.js, csv.js (Bluecoins import/export), smart.js (notification reader),
  seed.js are done and tested in Node. Next: tests, db/store/cloud, UI, views, PWA files, Worker, SETUP.md, demo artifact.

### Open questions
1. (answered: replace)
2. One transaction per receipt, or split by line item?
3. Receipt reading: on the phone (free, weaker) or a cloud AI model (better, small cost per receipt)?
4. Which current project comes off the three-lane list to make room?

## Log
- 2026-11-26: Memory file created. Handoff from earlier chat absorbed.
- 2026-11-26: User chose to replace Bluecoins. Plan and phases proposed.
- 2026-11-26: Built and published phase 1 clickable preview (Belanja).
- 2026-11-27: Started the full app (core logic modules done). Resume 3:30am 28 Nov.
