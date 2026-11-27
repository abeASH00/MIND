# Kuat — private dumbbell workout app

Kuat is a workout log that lives entirely on your phone. It works with no internet,
has no account, and sends nothing anywhere. This folder (`kuat/`) is the whole app:
upload this folder and nothing else.

A few words used below:
- **PWA (Progressive Web App)**: a website that can be added to your home screen and then
  behaves like a normal app, including working offline.
- **Service worker**: a small helper file (`sw.js`) the browser keeps in the background.
  It stores a copy of the app on your phone so it opens without internet.
- **IndexedDB**: the storage space every browser gives a website, on the device itself.
  Your workouts are kept there.
- **HTTPS**: the secure version of a web address (the padlock). Phones only allow
  offline apps on HTTPS sites. Both hosts below give you HTTPS for free.

## Files

| File | What it does |
|---|---|
| `index.html` | The page that loads everything; includes the content security rules |
| `manifest.json` | Name, colours and icons used when you add Kuat to your home screen |
| `sw.js` | Service worker: keeps the app working offline; optional reminder check |
| `_headers` | Extra security headers (used by Netlify) |
| `css/app.css` | All the styling: light and dark themes, cards, buttons, layout |
| `js/app.js` | Starts the app and switches between screens |
| `js/ui.js` | Shared helpers: safe text, icons, pop-up sheets, number formatting, keyboard handling |
| `js/data.js` | **All data storage** (IndexedDB), backup export and import. The only file to change if cloud sync is ever added |
| `js/stats.js` | Totals, streaks and personal bests |
| `js/exercise-data.js` | The 46 built-in exercises, warm-ups, cool-downs and rest-day ideas |
| `js/figures.js` | The stick-figure drawings for each exercise |
| `js/exercises.js` | Exercise library screens, favourites, notes, your own exercises |
| `js/plans.js` | The 5 ready-made plans and the plan builder |
| `js/workout.js` | Today's workout: sets, rest timer, supersets, swaps, finish screen |
| `js/suggest.js` | Weight suggestions based on your dumbbell settings |
| `js/progress.js` | Progress: charts, records, calendar, body weight, measurements, photos |
| `js/charts.js` | Charts, drawn by hand |
| `js/tools.js` | Rest timer, interval timer, weight calculator, warm-up, cool-down |
| `js/settings.js` | More tab, Settings, backup screen, reminders |
| `js/home.js` | Home screen |
| `fonts/` | Fraunces and DM Sans font files plus their licences (free OFL licence) |
| `icons/` | App icons for Android, iPhone and the browser tab |
| `MEMORY.md` | Build notes, so a future chat knows what's been done |

## Put it online (free)

### Option A — Netlify, linked to GitHub (easiest from a phone)
1. Go to **netlify.com** and tap **Sign up**. Choose **Sign up with GitHub** and allow access.
2. Tap **Add new site**, then **Import an existing project**, then **GitHub**.
3. Pick the repository **MIND**. (If you don't see it, tap the link to configure the
   Netlify app on GitHub and give it access to MIND.)
4. Fill in the settings like this:
   - **Branch to deploy:** `claude/kuat-workout-pwa-ernkqb` (or `Main` later, if you merge it)
   - **Base directory:** `kuat`
   - **Build command:** leave empty
   - **Publish directory:** `kuat`
5. Tap **Deploy**. After a minute you get an address like `https://something-random.netlify.app`.
   You can rename it under **Site configuration → Change site name** (e.g. `my-kuat`).
6. Every time new changes are pushed to that branch, Netlify updates the site by itself.

Netlify Drop (dragging the folder onto **app.netlify.com/drop**) also works, but it needs a computer.

### Option B — GitHub Pages
Your MIND repository already uses GitHub Pages for its documentation, so Kuat needs its own repository:
1. On github.com tap **+ → New repository**. Name it `kuat`. Choose Public (GitHub Pages
   is free only for public repositories on a free plan; the code has no personal data in it).
2. Tap **uploading an existing file** and upload everything inside this `kuat/` folder,
   keeping the `css`, `js`, `fonts` and `icons` folders. (This is easier on a computer.)
3. Go to **Settings → Pages**. Under **Source** pick **Deploy from a branch**, branch `main`,
   folder `/ (root)`, then **Save**.
4. After a minute or two your app is at `https://<your-username>.github.io/kuat/`.
Note: GitHub Pages ignores the `_headers` file, so a couple of extra security headers don't apply
(the main content rules still do, because they're inside `index.html`).

### Add it to your phone
- **Android (Chrome):** open your address, tap **⋮ → Install app** (or **Add to Home screen**).
- **iPhone (Safari only):** open your address, tap **Share → Add to Home Screen**.
Open it once while online so it can save itself for offline use.

### Updating later
When files change, also change the line `const VERSION = 'kuat-v1';` in `sw.js` (to `kuat-v2` and so on).
That tells phones to fetch the new version. The app then shows "A new version of Kuat is ready — Refresh".

## Phone test checklist
1. Open the site. The "Before you start" note appears. Tap **Got it**.
2. Add to home screen, open it from the icon. It opens full screen, without the browser bar.
3. **More → Settings**: type your name and add a photo. Check the dumbbell list reads 2.5 … 22.5, 24.
4. **More → Plans**: open "Full body, 3 days", tap **Follow this plan**.
5. **Workout**: start a day. Type a weight, use − and + on weight and reps, tick a set.
   The circle fills and the rest timer appears at the bottom.
6. While the rest timer runs, lock the phone for 30 seconds, unlock. The time should be correct.
7. Tap a reps box near the bottom of the screen. The keyboard must not cover the row you're typing in.
8. Type a number, then swipe the app closed completely. Reopen: the workout and the number are still there.
9. Tick every set of one exercise, answer **How did that feel?**
10. Use the edit (pencil) button on an exercise to make a superset; swap an exercise; add one.
11. Tap **Finish**. You see time, total lifted and anything you beat.
12. Start the same day again next time: the suggestion box should reflect your answer (easy → one setting up, etc.).
13. Turn on **airplane mode**, close and reopen Kuat. Everything still works.
14. **Progress**: check Overview, Exercises (chart), Records, Calendar (tap a day), Body (add a weight, a photo).
15. **More → Interval timer**: start it, lock the phone, unlock — still on time; beeps if sound is on.
16. **Settings → Appearance → Dark**, then Automatic.
17. **Settings → Export backup**. Find the file in Downloads/Files and save it somewhere safe.
18. (Optional, on a second browser or after a reset) **Import** that file and check your history is back.

## Security and privacy
**What's protected**
- Nothing leaves the phone. There is no server code, no analytics, no tracking, and no outside scripts,
  fonts or images. Tested: with the app loaded, zero requests go to any other website.
- A content security policy (rules inside `index.html`, also sent as a header on Netlify) only lets the
  page run its own scripts and talk only to its own site, even if something sneaky got into your data.
- Everything you type is escaped (shown as plain text, never run as code). Tested with a fake
  exercise named `<img src=x onerror=alert(1)>` — nothing ran.
- Only `http` and `https` links become tappable in notes; `javascript:` and other link types are ignored.
- Backup files are checked before anything is replaced; unknown or broken files are refused.
- Extra headers on Netlify: no framing by other sites, no MIME sniffing, no referrer, camera/mic/location off.

**Limits — please read**
- Data is stored **unencrypted** in the browser on the phone. Anyone who can unlock your phone and open
  Kuat can see it. That's why the app asks you not to store ID numbers, bank details or medical records.
- The **backup file is plain text** (JSON) and includes your photos. Anyone with the file can read it.
  Keep it somewhere private.
- Phone browsers may **clear stored data** for sites not opened in a while (especially iPhone,
  after about seven days without use for sites not on the home screen). Kuat asks the browser to keep the data,
  installs best from the home screen, and reminds you to back up — but only a backup is a guarantee.
- Styles are allowed inline (`style-src 'unsafe-inline'`) because the app sets a few sizes and colours
  directly; scripts are not. This is a small, common relaxation.
- On GitHub Pages, the `_headers` file is ignored, so framing protection and the other extra headers
  aren't sent (the in-page content policy still applies).
- The hosting company (Netlify or GitHub) sees ordinary visit logs, such as your IP address, when the
  app files are downloaded. It never sees your workouts.

**What I could not check**
- Real phones. Testing was done in an emulated Android phone and iPhone screen in a desktop browser.
  The real on-screen keyboard, iPhone home-screen install, screen wake lock, vibration (iPhones don't
  support it from websites) and notifications all need checking on your actual phone with the list above.
- Reminders: a website can't reliably schedule a notification without a server. Kuat shows a reminder
  while it's open, may check in the background on some Android phones, and on iPhone notifications only
  work once installed to the home screen — and even then aren't guaranteed. The calendar export
  (Settings → Reminders) is the dependable option.
- Long-term storage behaviour on your specific phone and browser version.
