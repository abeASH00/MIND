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
- 2026-11-26: User said "I want to build my own finance app so I can key in my daily expense."
  Unclear whether this means (a) the receipt-scanner add-on for Bluecoins, or
  (b) a full app that replaces Bluecoins. Asked the user. Nothing built yet.

### Open questions
1. Replace Bluecoins, or add on to it?
2. One transaction per receipt, or split by line item?
3. Receipt reading: on the phone (free, weaker) or a cloud AI model (better, small cost per receipt)?
4. Which current project comes off the three-lane list to make room?

## Log
- 2026-11-26: Memory file created. Handoff from earlier chat absorbed.
