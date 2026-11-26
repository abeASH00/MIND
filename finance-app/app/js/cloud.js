// Belanja: optional cloud backup and sync with Firebase (Google sign-in + Firestore).
// None of this loads until the user pastes their Firebase settings and signs in.
// The phone stays the main copy; the cloud keeps a copy and passes changes between devices.
// Receipt photos stay on the phone and are not uploaded.

import * as st from './store.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
let fb = null;
let user = null;
let syncing = false;
let timer = null;
let status = { state: 'off', message: 'Cloud backup is off' };
const watchers = new Set();

export const onStatus = (fn) => { watchers.add(fn); return () => watchers.delete(fn); };
export const getStatus = () => status;
export const currentUser = () => user;
const setStatus = (s) => {
  status = { ...status, ...s };
  for (const fn of watchers) fn(status);
};

// Accepts the firebaseConfig block from the Firebase console, pasted as JSON or as JavaScript.
export function parseConfig(text) {
  const src = String(text || '');
  const pick = (k) => {
    const m = new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`).exec(src);
    return m ? m[1] : '';
  };
  const cfg = {
    apiKey: pick('apiKey'), authDomain: pick('authDomain'), projectId: pick('projectId'),
    storageBucket: pick('storageBucket'), messagingSenderId: pick('messagingSenderId'), appId: pick('appId'),
  };
  if (!cfg.apiKey || !cfg.authDomain || !cfg.projectId) throw new Error('Paste the whole firebaseConfig block. It needs apiKey, authDomain and projectId.');
  return cfg;
}

async function boot(cfg) {
  if (fb) return fb;
  // The address is built at run time so no bundler tries to pull Firebase in.
  const load = (name) => import(/* @vite-ignore */ FB + name);
  const [appMod, A, F] = await Promise.all([load('firebase-app.js'), load('firebase-auth.js'), load('firebase-firestore.js')]);
  const app = appMod.initializeApp(cfg);
  fb = { app, auth: A.getAuth(app), db: F.getFirestore(app), A, F };
  return fb;
}

// Runs at start-up when cloud backup is on.
export async function start() {
  const cfg = st.S.settings.cloud;
  if (!cfg) { setStatus({ state: 'off', message: 'Cloud backup is off' }); return; }
  try {
    setStatus({ state: 'connecting', message: 'Connecting…' });
    const { auth, A } = await boot(cfg);
    try { await A.getRedirectResult(auth); } catch { /* nothing waiting */ }
    A.onAuthStateChanged(auth, (u) => {
      user = u;
      if (u) {
        st.setCloudHook((store, ids) => { st.outbox.add(store, ids).then(() => schedule()); });
        setStatus({ state: 'on', message: `Signed in as ${u.email}` });
        sync();
      } else {
        st.setCloudHook(null);
        setStatus({ state: 'signedout', message: 'Not signed in yet' });
      }
    });
    window.addEventListener('online', () => schedule(500));
  } catch (e) {
    console.warn(e);
    setStatus({ state: 'error', message: "Couldn't reach Firebase. Check the settings you pasted and your internet." });
  }
}

export async function signIn() {
  const { auth, A } = fb || (await boot(st.S.settings.cloud));
  const provider = new A.GoogleAuthProvider();
  try {
    await A.signInWithPopup(auth, provider);
  } catch (e) {
    const code = e && e.code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/cancelled-popup-request') {
      await A.signInWithRedirect(auth, provider);
    } else throw e;
  }
}

export async function signOut() {
  if (fb) await fb.A.signOut(fb.auth);
  await st.setSettings({ cloudUid: null, cloudSince: {} });
}

export function schedule(ms = 3000) {
  clearTimeout(timer);
  timer = setTimeout(() => sync(), ms);
}

export async function sync() {
  if (!fb || !user || syncing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  syncing = true;
  setStatus({ state: 'syncing', message: 'Syncing…' });
  try {
    const first = st.S.settings.cloudUid !== user.uid;
    if (first) await st.setSettings({ cloudSince: {}, cloudUid: user.uid }, true);
    const pulled = await pull();
    // First time on this phone: send up everything it has, so nothing is left behind.
    if (first) for (const c of st.SYNCED) if (st.S[c].length) await st.outbox.add(c, st.S[c].map((x) => x.id));
    const pushed = await push();
    await st.setSettings({ cloudLastSync: Date.now() }, true);
    setStatus({ state: 'on', message: `Signed in as ${user.email}`, lastSync: Date.now(), pulled, pushed });
    if (pulled) st.emit('all');
  } catch (e) {
    console.warn('Sync failed', e);
    const denied = e && e.code === 'permission-denied';
    setStatus({ state: 'error', message: denied ? 'Firebase refused access. Check the security rules step in SETUP.md.' : "Sync didn't finish. It will try again in a minute." });
    schedule(60000);
  } finally {
    syncing = false;
  }
}

async function pull() {
  const { db, F } = fb;
  const since = { ...(st.S.settings.cloudSince || {}) };
  let count = 0;
  for (const c of st.SYNCED) {
    const snap = await F.getDocs(F.query(F.collection(db, 'users', user.uid, c), F.where('updatedAt', '>', since[c] || 0)));
    const incoming = [];
    snap.forEach((d) => {
      const r = d.data();
      const local = st.S[c].find((x) => x.id === r.id);
      if (!local || (local.updatedAt || 0) < (r.updatedAt || 0)) incoming.push(r);
      since[c] = Math.max(since[c] || 0, r.updatedAt || 0);
    });
    if (incoming.length) {
      await st.save(c, incoming, { quiet: true, fromCloud: true });
      count += incoming.length;
    }
  }
  await st.setSettings({ cloudSince: since }, true);
  return count;
}

async function push() {
  const { db, F } = fb;
  const items = await st.outbox.all();
  let count = 0;
  for (let i = 0; i < items.length; i += 400) {
    const chunk = items.slice(i, i + 400);
    const batch = F.writeBatch(db);
    for (const it of chunk) {
      const rec = st.S[it.store] && st.S[it.store].find((x) => x.id === it.docId);
      if (rec) batch.set(F.doc(db, 'users', user.uid, it.store, it.docId), JSON.parse(JSON.stringify(rec)));
    }
    await batch.commit();
    await st.outbox.remove(chunk.map((x) => x.id));
    count += chunk.length;
  }
  return count;
}
