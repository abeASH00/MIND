// Kuat service worker: keeps a copy of every app file on the phone so the app opens
// with no internet. It never contacts any other website.
const VERSION = 'kuat-v1';
const FILES = [
  './', './index.html', './manifest.json', './css/app.css',
  './js/app.js', './js/ui.js', './js/data.js', './js/stats.js', './js/exercises.js', './js/figures.js',
  './js/plans.js', './js/workout.js', './js/suggest.js', './js/progress.js', './js/tools.js',
  './js/settings.js', './js/home.js',
  './fonts/fraunces-latin-600-normal.woff2', './fonts/dm-sans-latin-400-normal.woff2',
  './fonts/dm-sans-latin-500-normal.woff2', './fonts/dm-sans-latin-700-normal.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch other sites
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (req.mode === 'navigate') {
      return (await cache.match('./index.html')) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});

// ---------- Optional reminder check ----------
// Some Android phones let an installed app wake up now and then ("periodic sync").
// When that happens we check whether today is a planned day you haven't trained yet.
// This is best effort only; the phone decides when (or if) it runs.
function readKV(key) {
  return new Promise((resolve) => {
    const open = indexedDB.open('kuat');
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      try {
        const db = open.result;
        const r = db.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => { resolve(r.result || null); db.close(); };
        r.onerror = () => { resolve(null); db.close(); };
      } catch { resolve(null); }
    };
  });
}

async function maybeRemind() {
  const info = await readKV('reminderInfo');
  if (!info || !info.enabled) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [hh, mm] = String(info.time || '18:00').split(':').map(Number);
  if (!Array.isArray(info.days) || !info.days.includes(now.getDay())) return;
  if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return;
  if (info.lastTrained === today || info.lastNotified === today) return;
  await self.registration.showNotification('Kuat', {
    body: 'There’s a workout planned for today, whenever suits you.',
    icon: './icons/icon-192.png', badge: './icons/favicon-32.png', tag: 'kuat-reminder',
  });
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'kuat-reminder') event.waitUntil(maybeRemind());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) return all[0].focus();
    return self.clients.openWindow('./index.html#/home');
  })());
});
