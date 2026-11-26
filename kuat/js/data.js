// Kuat — all data access lives here.
// Everything is stored on this device in IndexedDB (the browser's built-in database).
// Nothing is sent anywhere. If cloud sync is ever added, only this file needs to change.

const DB_NAME = 'kuat';
const DB_VERSION = 1;
const STORES = ['kv', 'sessions', 'plans', 'custom', 'exmeta', 'body', 'measure', 'photos'];
const ACTIVE_MIRROR = 'kuat.active.v1';
const BACKUP_FORMAT = 'kuat-backup';
const BACKUP_VERSION = 1;

export const DEFAULT_SETTINGS = {
  name: '',
  photo: '',
  units: 'kg',
  dbMin: 2.5,
  dbMax: 24,
  dbStep: 2.5,
  gear: { mat: true, chair: true, bench: false, band: false },
  weeklyTarget: 3,
  goal: 'muscle',
  restHeavy: 120,
  restLight: 60,
  theme: 'auto',
  sound: true,
  vibrate: true,
  activePlanId: 'preset-full3',
  onboarded: false,
  lastBackupAt: 0,
  backupNudgeAt: 0,
  reminders: { enabled: false, time: '18:00' },
};

let dbPromise = null;
let memoryFallback = null; // used only if IndexedDB is unavailable (some private modes)

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!('indexedDB' in self)) { memoryFallback = makeMemoryStore(); resolve(null); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { memoryFallback = makeMemoryStore(); resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, name === 'kv' ? undefined : { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => { memoryFallback = makeMemoryStore(); resolve(null); };
    req.onblocked = () => {};
  });
  return dbPromise;
}

function makeMemoryStore() {
  const m = {};
  for (const s of STORES) m[s] = new Map();
  return m;
}

export function usingFallback() { return !!memoryFallback; }

async function tx(store, mode, fn) {
  const db = await openDB();
  if (!db) return fn(null, memoryFallback[store]);
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    Promise.resolve(fn(os, null)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqP(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

async function get(store, key) {
  return tx(store, 'readonly', (os, mem) => mem ? clone(mem.get(key)) : reqP(os.get(key)));
}
async function put(store, value, key) {
  return tx(store, 'readwrite', (os, mem) => {
    if (mem) { mem.set(key ?? value.id, clone(value)); return; }
    return reqP(key === undefined ? os.put(value) : os.put(value, key));
  });
}
async function del(store, key) {
  return tx(store, 'readwrite', (os, mem) => mem ? mem.delete(key) : reqP(os.delete(key)));
}
async function getAll(store) {
  return tx(store, 'readonly', (os, mem) => mem ? [...mem.values()].map(clone) : reqP(os.getAll()));
}
async function clearStore(store) {
  return tx(store, 'readwrite', (os, mem) => mem ? mem.clear() : reqP(os.clear()));
}
function clone(v) { return v === undefined ? undefined : (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))); }

export function uid(prefix = 'id') {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}-${Date.now().toString(36)}-${r[0].toString(36)}${r[1].toString(36)}`;
}

// ---------- Settings ----------
let settingsCache = null;
export async function getSettings() {
  if (settingsCache) return settingsCache;
  const saved = (await get('kv', 'settings')) || {};
  settingsCache = { ...DEFAULT_SETTINGS, ...saved, gear: { ...DEFAULT_SETTINGS.gear, ...(saved.gear || {}) }, reminders: { ...DEFAULT_SETTINGS.reminders, ...(saved.reminders || {}) } };
  return settingsCache;
}
export function settingsNow() { return settingsCache || { ...DEFAULT_SETTINGS }; }
export async function saveSettings(patch) {
  const cur = await getSettings();
  settingsCache = { ...cur, ...patch };
  await put('kv', settingsCache, 'settings');
  return settingsCache;
}

export async function getKV(key) { return get('kv', key); }
export async function setKV(key, value) { return put('kv', value, key); }

// ---------- Active (half-finished) workout ----------
// Saved twice: to IndexedDB and, synchronously, to localStorage, so a number typed a
// split second before the app is closed is still there next time.
export function saveActiveSync(active) {
  active.updatedAt = Date.now();
  try { localStorage.setItem(ACTIVE_MIRROR, JSON.stringify(active)); } catch { /* storage full or blocked */ }
  put('kv', active, 'active').catch(() => {});
}
export async function getActive() {
  let fromDb = null, fromLs = null;
  try { fromDb = await get('kv', 'active'); } catch { /* ignore */ }
  try { const s = localStorage.getItem(ACTIVE_MIRROR); if (s) fromLs = JSON.parse(s); } catch { /* ignore */ }
  if (fromDb && fromLs) return (fromLs.updatedAt || 0) >= (fromDb.updatedAt || 0) ? fromLs : fromDb;
  return fromDb || fromLs || null;
}
export async function clearActive() {
  try { localStorage.removeItem(ACTIVE_MIRROR); } catch { /* ignore */ }
  await del('kv', 'active');
}

// ---------- Sessions (finished workouts) ----------
export async function listSessions() {
  const all = await getAll('sessions');
  return all.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
}
export const getSession = (id) => get('sessions', id);
export const saveSession = (s) => put('sessions', s);
export const deleteSession = (id) => del('sessions', id);

// ---------- Plans ----------
export const listPlans = () => getAll('plans');
export const getPlan = (id) => get('plans', id);
export const savePlan = (p) => put('plans', p);
export const deletePlan = (id) => del('plans', id);

// ---------- Custom exercises & per-exercise notes/favourites ----------
export const listCustom = () => getAll('custom');
export const saveCustom = (e) => put('custom', e);
export const deleteCustom = (id) => del('custom', id);
export const listExMeta = () => getAll('exmeta');
export const getExMeta = async (id) => (await get('exmeta', id)) || { id, fav: false, notes: '' };
export const saveExMeta = (m) => put('exmeta', m);

// ---------- Body weight, measurements, photos ----------
export const listBody = async () => (await getAll('body')).sort((a, b) => a.date.localeCompare(b.date));
export const saveBody = (e) => put('body', e);
export const deleteBody = (id) => del('body', id);
export const listMeasure = async () => (await getAll('measure')).sort((a, b) => a.date.localeCompare(b.date));
export const saveMeasure = (e) => put('measure', e);
export const deleteMeasure = (id) => del('measure', id);
export const listPhotos = async () => (await getAll('photos')).sort((a, b) => b.date.localeCompare(a.date));
export const savePhoto = (e) => put('photos', e);
export const deletePhoto = (id) => del('photos', id);

// ---------- Ask the browser not to clear our data ----------
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* not supported */ }
  return false;
}

// ---------- Backup: export ----------
function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
async function dataURLToBlob(url) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

export async function exportBackup({ includePhotos = true } = {}) {
  const out = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data: {} };
  out.data.settings = await getSettings();
  out.data.active = await getActive();
  for (const s of ['sessions', 'plans', 'custom', 'exmeta', 'body', 'measure']) out.data[s] = await getAll(s);
  out.data.photos = [];
  if (includePhotos) {
    for (const p of await getAll('photos')) {
      out.data.photos.push({ id: p.id, date: p.date, note: p.note || '', image: p.blob ? await blobToDataURL(p.blob) : '' });
    }
  }
  await saveSettings({ lastBackupAt: Date.now() });
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

// ---------- Backup: import ----------
// The file is checked carefully before anything is replaced. Unknown fields are dropped.
const isStr = (v, max = 5000) => typeof v === 'string' && v.length <= max;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isId = (v) => isStr(v, 200) && v.length > 0;
const isDate = (v) => isStr(v, 40) && /^\d{4}-\d{2}-\d{2}/.test(v);

function cleanArray(arr, check) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((x) => x && typeof x === 'object' && check(x));
}

export async function importBackup(file) {
  if (!file) throw new Error('No file chosen.');
  if (file.size > 200 * 1024 * 1024) throw new Error('That file is too big to be a Kuat backup.');
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('That file isn’t a Kuat backup (it couldn’t be read).'); }
  if (!parsed || parsed.format !== BACKUP_FORMAT || !parsed.data) throw new Error('That file isn’t a Kuat backup.');
  if (parsed.version > BACKUP_VERSION) throw new Error('This backup is from a newer version of Kuat. Update the app first.');
  const d = parsed.data;

  const sessions = cleanArray(d.sessions, (s) => isId(s.id) && isNum(s.startedAt) && Array.isArray(s.exercises));
  const plans = cleanArray(d.plans, (p) => isId(p.id) && isStr(p.name, 200) && Array.isArray(p.days));
  const custom = cleanArray(d.custom, (e) => isId(e.id) && isStr(e.name, 200));
  const exmeta = cleanArray(d.exmeta, (m) => isId(m.id));
  const body = cleanArray(d.body, (b) => isId(b.id) && isDate(b.date) && isNum(b.kg));
  const measure = cleanArray(d.measure, (m) => isId(m.id) && isDate(m.date));
  const photos = [];
  for (const p of cleanArray(d.photos, (x) => isId(x.id) && isDate(x.date))) {
    const blob = await dataURLToBlob(p.image);
    if (blob) photos.push({ id: p.id, date: p.date, note: isStr(p.note, 1000) ? p.note : '', blob });
  }

  // Replace everything only after the whole file has been checked.
  for (const s of STORES) await clearStore(s);
  const st = d.settings && typeof d.settings === 'object' ? d.settings : {};
  const safeSettings = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in st && typeof st[k] === typeof DEFAULT_SETTINGS[k]) safeSettings[k] = st[k];
  if (safeSettings.photo && !/^data:image\/(jpeg|png|webp);base64,/.test(safeSettings.photo)) safeSettings.photo = '';
  settingsCache = null;
  await saveSettings({ ...safeSettings, onboarded: true, lastBackupAt: Date.now() });
  for (const x of sessions) await put('sessions', x);
  for (const x of plans) await put('plans', x);
  for (const x of custom) await put('custom', x);
  for (const x of exmeta) await put('exmeta', x);
  for (const x of body) await put('body', x);
  for (const x of measure) await put('measure', x);
  for (const x of photos) await put('photos', x);
  try { localStorage.removeItem(ACTIVE_MIRROR); } catch { /* ignore */ }
  if (d.active && typeof d.active === 'object' && Array.isArray(d.active.exercises)) await put('kv', d.active, 'active');
  await setKV('seeded', 1);
  return { sessions: sessions.length, plans: plans.length, photos: photos.length };
}

// ---------- Delete everything ----------
export async function resetAll() {
  for (const s of STORES) await clearStore(s);
  try { localStorage.clear(); } catch { /* ignore */ }
  settingsCache = null;
}
