# Belanja

A personal expense app for Android (installs from the browser), built for one person in Malaysia.
It does what Bluecoins does, in its own design, and adds a smart inbox that reads bank and
e-wallet notifications, AI receipt scanning, and shops it learns.

- **Set it up:** [SETUP.md](SETUP.md), step by step from a phone.
- **How it's built and what's next:** [BUILD-PLAN.md](BUILD-PLAN.md).
- **Try the demo** (example data): https://claude.ai/artifact/16JTfHjTjvdRvQnCYcTcV7

## Folders

| Path | What's in it |
|---|---|
| `app/` | The app itself: `index.html`, `css/`, `js/` (logic) and `js/views/` (screens), offline helper `sw.js`, `manifest.webmanifest`, `icons/` |
| `worker/` | The Cloudflare server: `index.js` (notifications, routes) and `ai.js` (asks Claude to read receipts and messages) |
| `tests/` | `node --test tests/*.test.mjs` |
| `tools/build-demo.mjs` | Builds `dist/demo.html`, the one-file demo |
| `wrangler.jsonc`, `package.json` | Cloudflare deploy settings |
