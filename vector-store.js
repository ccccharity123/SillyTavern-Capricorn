// Derived vectors retain the original database, store, and key format on upgrade.
export function createVectorStore(factory = globalThis.indexedDB) {
  let opening;
  let retryAfter = 0;
  let closed = false;
  let lastWriteError = '';

  function open() {
    if (!factory || closed || Date.now() < retryAfter) return Promise.resolve(null);
    if (opening) return opening;
    let abandoned = false;
    const attempt = new Promise(resolve => {
      try {
        const request = factory.open('capricorn-vectors-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('vectors');
        request.onsuccess = () => {
          const db = request.result;
          if (closed || abandoned) {
            db.close();
            resolve(null);
            return;
          }
          db.onversionchange = () => { db.close(); opening = undefined; };
          resolve(db);
        };
        request.onerror = request.onblocked = () => {
          abandoned = true;
          resolve(null);
        };
      } catch { resolve(null); }
    });
    opening = attempt.then(db => {
      if (!db) {
        retryAfter = Date.now() + 30000;
        opening = undefined;
      }
      return db;
    });
    return opening;
  }

  async function transact(mode, action, signal) {
    try {
      const db = await open();
      if (!db || closed || signal?.aborted) return null;
      const tx = db.transaction('vectors', mode);
      return await new Promise(resolve => {
        let result;
        let transactionError;
        function cancel() {
          try { tx.abort(); } catch { /* The transaction already completed. */ }
        }
        function finish(value) {
          signal?.removeEventListener('abort', cancel);
          if (mode === 'readwrite') lastWriteError = value === null ? transactionError || tx.error?.name || '' : '';
          resolve(value);
        }
        tx.oncomplete = () => finish(result);
        tx.onerror = event => { transactionError = event.target.error?.name; };
        tx.onabort = () => finish(null);
        signal?.addEventListener('abort', cancel, { once: true });
        try {
          result = action(tx.objectStore('vectors'));
        } catch (error) {
          transactionError = error.name;
          cancel();
        }
      });
    } catch (error) {
      if (mode === 'readwrite') lastWriteError = error.name;
      return null;
    }
  }

  function read(scope, texts, signal) {
    return transact('readonly', store => {
      const vectors = new Map();
      for (const text of texts) {
        const request = store.get([scope, text]);
        request.onsuccess = () => { if (request.result) vectors.set(text, request.result); };
      }
      return vectors;
    }, signal);
  }

  function write(scope, texts, vectors, signal) {
    if (texts.length !== vectors.length) return Promise.resolve(null);
    return transact('readwrite', store => {
      for (const [index, text] of texts.entries()) store.put(vectors[index], [scope, text]);
      return true;
    }, signal);
  }

  function clear(scope) {
    if (!scope) return Promise.resolve(false);
    return transact('readwrite', store => {
      const range = globalThis.IDBKeyRange?.bound([scope], [scope, []]);
      if (range) store.delete(range);
      else {
        const request = store.openKeyCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (Array.isArray(cursor.primaryKey) && cursor.primaryKey[0] === scope) store.delete(cursor.primaryKey);
          cursor.continue();
        };
      }
      return true;
    }).then(Boolean);
  }

  async function estimate() {
    try {
      const { usage, quota } = await globalThis.navigator.storage.estimate();
      return Number.isFinite(usage) && Number.isFinite(quota) && usage >= 0 && quota >= 0
        ? { usage, quota, available: Math.max(0, quota - usage) } : null;
    } catch { return null; }
  }

  function close() {
    closed = true;
    void opening?.then(db => db?.close());
  }

  return { read, write, clear, estimate, close, lastWriteError: () => lastWriteError };
}
