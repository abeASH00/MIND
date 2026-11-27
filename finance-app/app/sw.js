// Belanja service worker: keeps the app working offline, and receives things
// shared to Belanja from other apps (a bank SMS, a receipt photo).
// Change VERSION whenever the app's files change, so phones pick up the new copy.

const VERSION = 'belanja-1.0.0';
const FONTS = 'belanja-fonts';
const STORES = ['accounts', 'categories', 'transactions', 'budgets', 'recurring', 'inbox', 'memory', 'attachments', 'kv', 'outbox', 'shares'];
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './icons/icon.svg', './icons/icon-192.png',
  './js/main.js', './js/app.js', './js/util.js', './js/calc.js', './js/csv.js', './js/smart.js', './js/seed.js', './js/db.js',
  './js/store.js', './js/cloud.js', './js/capture.js', './js/ui.js', './js/charts.js', './js/icons.js',
  './js/views/parts.js', './js/views/home.js', './js/views/history.js', './js/views/edit.js', './js/views/inbox.js',
  './js/views/more.js', './js/views/accounts.js', './js/views/account.js', './js/views/reports.js', './js/views/budgets.js',
  './js/views/calendar.js', './js/views/bills.js', './js/views/bill.js', './js/views/categories.js', './js/views/prefs.js',
  './js/views/data.js', './js/views/receipt.js', './js/views/welcome.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share')) {
    e.respondWith(takeShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(cacheFirst(req, FONTS));
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(req.mode === 'navigate' ? networkFirst(req) : staleWhileRevalidate(req));
});

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch {
    return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req)
    .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => hit);
  return hit || fresh;
}

// Saves what was shared, then opens the app; the app picks it up on start.
async function takeShare(req) {
  const form = await req.formData();
  const file = form.get('image');
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: Date.now(),
    title: String(form.get('title') || ''), text: String(form.get('text') || ''), url: String(form.get('url') || ''),
    file: file && typeof file === 'object' && file.size ? file : null,
  };
  await new Promise((resolve, reject) => {
    const r = indexedDB.open('belanja', 1);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('shares', 'readwrite');
      tx.objectStore('shares').put(item);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
  return Response.redirect(new URL(item.file ? './#receipt' : './#inbox', self.registration.scope).href, 303);
}
