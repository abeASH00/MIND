// Belanja: saving data on the phone with IndexedDB.
// If the browser blocks storage (some private windows), data is kept in memory
// for that visit only, and the app shows a warning.

export const STORES = ['accounts', 'categories', 'transactions', 'budgets', 'recurring', 'inbox', 'memory', 'attachments', 'kv', 'outbox', 'shares'];
const VERSION = 1;

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
  tx.onabort = () => rej(tx.error || new Error('Saving was cancelled'));
});

// The service worker opens the same database to drop in things shared from other apps,
// so both sides must create the same stores.
export function upgrade(db) {
  for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
}

export async function openDB(name) {
  if (typeof indexedDB === 'undefined') return memoryDB();
  try {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name, VERSION);
      r.onupgradeneeded = () => upgrade(r.result);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Storage is blocked by another open copy of the app'));
    });
    return wrap(db);
  } catch (e) {
    console.warn('Storage unavailable, keeping data in memory only:', e);
    return memoryDB();
  }
}

function wrap(db) {
  return {
    persistent: true,
    all: (store) => req(db.transaction(store).objectStore(store).getAll()),
    get: (store, id) => req(db.transaction(store).objectStore(store).get(id)),
    put(store, items) {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const it of [].concat(items)) os.put(it);
      return done(tx);
    },
    del(store, ids) {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const id of [].concat(ids)) os.delete(id);
      return done(tx);
    },
    clear(store) {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      return done(tx);
    },
    close: () => db.close(),
  };
}

function memoryDB() {
  const m = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  const copy = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
  return {
    persistent: false,
    all: async (store) => [...m[store].values()].map(copy),
    get: async (store, id) => (m[store].has(id) ? copy(m[store].get(id)) : undefined),
    put: async (store, items) => { for (const it of [].concat(items)) m[store].set(it.id, copy(it)); },
    del: async (store, ids) => { for (const id of [].concat(ids)) m[store].delete(id); },
    clear: async (store) => m[store].clear(),
    close() {},
  };
}

export function deleteDB(name) {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise((res) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = () => res();
  });
}

// Asks the browser not to clear our data when the phone runs low on space.
export async function askPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch {
    /* not supported */
  }
  return false;
}
