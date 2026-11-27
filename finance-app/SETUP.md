# Setting up Belanja on your phone

Belanja is your own money app. It does what Bluecoins does (accounts, categories, budgets, reports, bills, a calendar, CSV import and export, and a PIN lock), and adds the smart parts you wanted:

- **Smart inbox:** payments are read from your bank and e-wallet notifications. Codes, promos and duplicates are skipped, and you tap once to save.
- **Receipt scanning:** take a photo and AI fills in the shop, the total and the items.
- **It learns:** after you pick a category for a shop once, it remembers it.

Everything below can be done on your phone. Some screens are easier with Chrome's "Desktop site" option ticked.
Do the steps in order. Steps 1 to 4 give you a working app; 5 to 7 add the automatic parts.

A few words used below:
- **Cloudflare Worker:** a small program that runs on Cloudflare's computers. It is your Belanja "server": it hosts the app and receives your notifications.
- **Secret:** a password stored inside Cloudflare, never in the code.
- **MacroDroid:** a free Android app that can react to notifications. It sends each bank notification to your server.
- **Firebase:** Google's free database. Optional; it keeps a backup copy in the cloud.

---

## 1. Put Belanja on Cloudflare (about 10 minutes)

1. Open **dash.cloudflare.com** and sign in. You already have an account from your other app.
2. Go to **Workers & Pages** and tap **Create**. Choose **Import a repository**, the option that connects to GitHub.
3. Pick the GitHub repository **abeash00/MIND**.
4. Fill in the settings. The labels may look slightly different:
   - **Project name:** `belanja`
   - **Production branch:** `ccr-78abda8d-frt4ra`
   - **Root directory** (sometimes called "Path", under advanced settings): `finance-app`
   - **Build command:** leave empty
   - **Deploy command:** `npx wrangler deploy`
5. Tap **Deploy** and wait for the green tick.
6. Note your address. It looks like `https://belanja.YOURNAME.workers.dev`.

From now on, every time Claude saves changes to that branch, Cloudflare updates your app by itself.

## 2. Add your secrets (2 minutes)

In Cloudflare open **Workers & Pages › belanja › Settings › Variables and Secrets** and add:

| Name | Type | What to put |
|---|---|---|
| `APP_KEY` | Secret | A long password only you know, at least 20 characters, e.g. `teh-tarik-kurang-manis-2026-Q9x`. Write it down; you'll type it twice more. |
| `ANTHROPIC_API_KEY` | Secret | Optional, only for the AI parts. Create one at **console.anthropic.com › API keys** and add some credit under Billing. |

The app works without `ANTHROPIC_API_KEY`. Notifications are still read by the built-in rules; only receipt photos and very unclear messages need the AI.

## 3. Install the app (1 minute)

1. Open your `workers.dev` address in **Chrome** on your phone.
2. Tap the **⋮** menu, then **Add to Home screen** (or **Install app**).
3. Open Belanja from the new icon.

## 4. Bring in your Bluecoins history (5 minutes)

1. In **Bluecoins**: **Settings › Data › Export**, choose **CSV**, **all time**. Save the file to Downloads or Google Drive.
2. In **Belanja**, the first screen asks how to start. Tap **Bring in my Bluecoins history**, then choose the file.
3. Check the summary (number of transactions, dates, any new accounts or categories), then tap **Import**.
4. Check balances: open **More › Accounts**, and compare each account with Bluecoins. If one is off (usually because of a starting balance), open it and tap **Set balance**.

Made a mistake? **More › Import & export › Undo that import** takes it all back out.

## 5. Connect the app to your server (1 minute)

In Belanja: **More › Settings › Automatic capture**

- **Server:** leave empty (the app already runs on it).
- **App key:** your `APP_KEY`.
- Tap **Test the connection**. You should see "Connected".

## 6. Forward notifications with MacroDroid (about 10 minutes)

1. Install **MacroDroid** from the Play Store. Allow **Notification access** when it asks.
2. Tap **Add Macro**.
3. **Trigger:** Device Events (or Notifications) › **Notification Received**. Select your money apps: TNG eWallet, SETEL, RHB, CIMB OCTO, Affin, and so on. Content: **Any**.
4. **Action:** Web Interactions › **HTTP Request**.
   - Method: **POST**
   - URL: `https://belanja.YOURNAME.workers.dev/api/notify`
   - Add **query parameters**. For the last three, use MacroDroid's **…** (magic text) button and pick the notification's matching value:
     - `key` = your APP_KEY
     - `app` = notification app name
     - `title` = notification title
     - `text` = notification text
5. Name it "Belanja" and save.
6. In Android settings, set MacroDroid's battery use to **Unrestricted**, so it isn't stopped in the background.
7. Test it: pay something small with TnG. Within a minute, Belanja's **Inbox** shows it filled in. Tap **Save**.

Once you're happy, turn off Bluecoins' own notification logging so you don't get everything twice.

**Sharing also works:** from any app, tap **Share › Belanja**. A bank SMS goes to the Inbox, and a receipt photo opens the receipt scanner.

## 7. Cloud backup with Firebase (optional, about 10 minutes)

This keeps a copy of everything in your own Google Firebase. You can then use Belanja on a second phone, and nothing is lost if your phone is.

1. Go to **console.firebase.google.com › Add project** and name it `belanja`. Google Analytics isn't needed.
2. **Build › Authentication › Get started › Sign-in method › Google › Enable**.
3. **Authentication › Settings › Authorized domains › Add domain:** `belanja.YOURNAME.workers.dev`
4. **Build › Firestore Database › Create database**. Choose production mode and the **asia-southeast1 (Singapore)** location.
5. **Firestore › Rules**: replace everything with the rules below, then tap **Publish**.

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

   These rules mean only you, signed in with your Google account, can read or write your data.
6. Tap **Project settings** (the gear) **› Your apps › Web (</>)**. Register an app called Belanja and copy the `firebaseConfig` block.
7. In Belanja: **More › Settings › Cloud backup**. Paste the block, tap **Save**, then **Sign in with Google**.

Receipt photos stay on your phone and aren't uploaded.

---

## What it costs

- **Cloudflare:** free. The free Workers plan covers this.
- **Firebase:** free. The Spark plan is far more than one person needs.
- **Anthropic (AI):** pay as you go, only when the AI is used. Estimates on the current setting (Claude Opus 5.5):
  - about RM0.10 to RM0.15 per receipt
  - about RM0.05 to RM0.10 each time it reads a batch of unclear messages
  - most bank messages are read by the free built-in rules and cost nothing
  - 40 receipts and 40 unclear batches a month comes to roughly RM8 to RM10
- **Want it cheaper?** Claude Haiku 5.5 costs about 40 times less (well under RM1 a month), but reads messy receipts less well. To switch, ask Claude to change `MODEL` in `wrangler.jsonc` to `claude-haiku-5-5`.
- **Automatic fallback is on:** if the main model declines to read something, Anthropic passes it to another model automatically.

## Updates

When Claude improves Belanja, Cloudflare deploys it on its own. On your phone, close Belanja completely and open it again (twice, if you don't see the change).

## If something doesn't work

| What you see | What to do |
|---|---|
| "Wrong or missing app key" | The App key in Settings must exactly match the `APP_KEY` secret. |
| "Set the APP_KEY secret in Cloudflare first" | Do step 2. |
| "AI is off" | Add `ANTHROPIC_API_KEY` (step 2), or just fill receipts in by hand. |
| Inbox stays empty after paying | In MacroDroid, check the macro is on, Notification access is allowed, and battery use is Unrestricted. Then tap the refresh button in Belanja's Inbox. |
| Google sign-in says the domain isn't authorized | Do step 7.3. |
| Forgot the PIN | Clear Belanja's site data in Chrome settings. If cloud backup was on, sign in again to get your data back. |
