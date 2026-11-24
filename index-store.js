// Derived per-document cache. Old snapshot databases are left untouched.
export function createIndexStore(factory = globalThis.indexedDB) {
  let opening, retryAfter = 0, closed = false;
  function open() {
    if (!factory || closed || Date.now() < retryAfter) return Promise.resolve(null);
    if (opening) return opening;
    let dropped = false;
    const attempt = new Promise(resolve => {
      try {
        const request = factory.open('capricorn-inverted-v2', 1);
        request.onupgradeneeded = () => {
          const docs = request.result.createObjectStore('docs', { keyPath: ['scope', 'id'] });
          docs.createIndex('scope', 'scope');
        };
        request.onsuccess = () => {
          const db = request.result;
          if (closed || dropped) { db.close(); resolve(null); return; }
          db.onversionchange = () => { db.close(); opening = undefined; };
          resolve(db);
        };
        request.onerror = request.onblocked = () => { dropped = true; resolve(null); };
      } catch { resolve(null); }
    });
    opening = attempt.then(db => {
      if (!db) { retryAfter = Date.now() + 30000; opening = undefined; }
      return db;
    });
    return opening;
  }

  async function read(scope) {
    try {
      const db = await open();
      if (!db) return [];
      const request = db.transaction('docs').objectStore('docs').index('scope').getAll(scope);
      return await new Promise(resolve => {
        request.onsuccess = () => resolve(request.result.map(row => [row.id, row.b]));
        request.onerror = () => resolve([]);
      });
    } catch { return []; }
  }

  async function write(change) {
    try {
      const db = await open();
      if (!db || closed) return false;
      const transaction = db.transaction('docs', 'readwrite');
      return await new Promise(resolve => {
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = transaction.onabort = () => resolve(false);
        try {
          change(transaction.objectStore('docs'));
        } catch {
          // Roll back earlier queued operations when a later put/delete throws synchronously.
          try { transaction.abort(); } catch { resolve(false); }
        }
      });
    } catch { return false; }
  }

  function patch(scope, rows, removed = []) {
    if (!rows.length && !removed.length) return Promise.resolve(true);
    return write(docs => {
      for (const id of removed) docs.delete([scope, id]);
      for (const [id, b] of rows) docs.put({ scope, id, b });
    });
  }

  function clear(scope) {
    if (!scope) return Promise.resolve(false);
    return write(docs => {
      // Every document ID is a string. Array keys sort after string keys.
      if (globalThis.IDBKeyRange) {
        docs.delete(IDBKeyRange.bound([scope], [scope, []]));
        return;
      }
      const request = docs.index('scope').openKeyCursor(scope);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        docs.delete(cursor.primaryKey);
        cursor.continue();
      };
    });
  }

  function close() {
    closed = true;
    void opening?.then(db => db?.close());
  }

  return { read, patch, clear, close };
}

export async function clearIndex(scope) {
  const store = createIndexStore();
  try { return await store.clear(scope); }
  finally { store.close(); }
}
