// Just enough IndexedDB for src/key-storage.js. Every value goes through
// structuredClone on the way in and out, as in a real browser, so class
// instances come back as plain objects and CryptoKeys survive.

function request(fn) {
  const req = { result: undefined, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    try {
      req.result = fn();
      req.onsuccess?.();
    } catch (err) {
      req.error = err;
      req.onerror?.();
    }
  });
  return req;
}

function objectStore(store) {
  const keyOf = (value) => value[store.keyPath];
  return {
    put: (value) => request(() => { store.rows.set(keyOf(value), structuredClone(value)); return keyOf(value); }),
    get: (key) => request(() => (store.rows.has(key) ? structuredClone(store.rows.get(key)) : undefined)),
    getAll: () => request(() => [...store.rows.values()].map((v) => structuredClone(v))),
    getAllKeys: () => request(() => [...store.rows.keys()]),
    delete: (key) => request(() => { store.rows.delete(key); }),
    clear: () => request(() => { store.rows.clear(); }),
    createIndex: () => {},
  };
}

export function fakeIndexedDB() {
  const databases = new Map();
  return {
    /** The stored rows of one store, for tests that look inside. */
    rows: (dbName, storeName) => databases.get(dbName)?.stores.get(storeName)?.rows,
    open(name) {
      const req = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        let db = databases.get(name);
        const fresh = !db;
        if (fresh) {
          db = { stores: new Map() };
          databases.set(name, db);
        }
        req.result = {
          objectStoreNames: { contains: (s) => db.stores.has(s) },
          createObjectStore(s, { keyPath }) {
            const store = { keyPath, rows: new Map() };
            db.stores.set(s, store);
            return objectStore(store);
          },
          transaction: (s) => ({ objectStore: () => objectStore(db.stores.get(s)) }),
          close() {},
        };
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}
