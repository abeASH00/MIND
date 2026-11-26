# Claude memory: read this first in every new chat

Updated: 2026-11-26

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
- Nothing built yet. Waiting on: three-lane slot, Bluecoins CSV export.

### Open questions
1. (answered: replace)
2. One transaction per receipt, or split by line item?
3. Receipt reading: on the phone (free, weaker) or a cloud AI model (better, small cost per receipt)?
4. Which current project comes off the three-lane list to make room?

## Log
- 2026-11-26: Memory file created. Handoff from earlier chat absorbed.
- 2026-11-26: User chose to replace Bluecoins. Plan and phases proposed.
