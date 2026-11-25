import { RETRIEVAL_MAX_PAGES } from './retrieval-blocks.js';

const DATABASE = 'capricorn-retrieval-shards-v1';

export function createShardStore(factory = globalThis.indexedDB, ranges = globalThis.IDBKeyRange) {
  let opening, closed = false, retryAfter = 0;
  function open() {
    if (!factory || !ranges || closed || Date.now() < retryAfter) return Promise.resolve(null);
    if (opening) return opening;
    let dropped = false;
    opening = new Promise(resolve => {
      try {
        const request = factory.open(DATABASE, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('scopes');
          request.result.createObjectStore('pages');
        };
        request.onsuccess = () => {
          const db = request.result;
          if (closed || dropped) { db.close(); resolve(null); return; }
          db.onversionchange = () => { db.close(); opening = undefined; };
          resolve(db);
        };
        request.onerror = request.onblocked = () => { dropped = true; resolve(null); };
      } catch { resolve(null); }
    }).then(db => {
      if (!db) { opening = undefined; retryAfter = Date.now() + 30000; }
      return db;
    });
    return opening;
  }

  async function transact(mode, action) {
    try {
      const db = await open();
      if (!db || closed) return false;
      const tx = db.transaction(['scopes', 'pages'], mode);
      const scopes = tx.objectStore('scopes'), pages = tx.objectStore('pages');
      return await new Promise(resolve => {
        let result = false;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => resolve(false);
        const abort = () => { try { tx.abort(); } catch { resolve(false); } };
        const complete = value => { result = value; };
        try { action(scopes, pages, complete, abort); }
        catch { abort(); }
      });
    } catch { return false; }
  }

  const stagedPages = (scope, generation) => ranges.bound([scope, generation], [scope, generation, []]);
  function current(scopes, scope, next, abort) {
    const request = scopes.get(scope);
    request.onerror = abort;
    request.onsuccess = () => {
      try { next(request.result || {}); } catch { abort(); }
    };
  }

  function active(scope) {
    return transact('readonly', (scopes, _pages, done, abort) => {
      current(scopes, scope, metadata => done(metadata.active ?? null), abort);
    });
  }

  function stage(scope, generation) {
    return transact('readwrite', (scopes, pages, done, abort) => {
      current(scopes, scope, metadata => {
        if (metadata.pending) pages.delete(stagedPages(scope, metadata.pending));
        scopes.put({ ...metadata, pending: generation }, scope);
        done(metadata.active ?? null);
      }, abort);
    });
  }

  function read(scope, generation, ordinal) {
    return transact('readonly', (_scopes, pages, done, abort) => {
      const request = pages.get([scope, generation, ordinal]);
      request.onerror = abort;
      request.onsuccess = () => done(request.result ?? null);
    });
  }

  function write(scope, generation, ordinal, bags) {
    return transact('readwrite', (scopes, pages, done, abort) => {
      current(scopes, scope, metadata => {
        if (metadata.pending !== generation) return;
        pages.put(bags, [scope, generation, ordinal]);
        done(true);
      }, abort);
    });
  }

  function publish(scope, generation, snapshot) {
    if (snapshot.pages.length > RETRIEVAL_MAX_PAGES) return Promise.resolve(false);
    return transact('readwrite', (scopes, pages, done, abort) => {
      current(scopes, scope, metadata => {
        if (metadata.pending !== generation) return;
        for (const [index, owner] of (metadata.active?.pages || []).entries()) {
          if (snapshot.pages[index] !== owner) pages.delete([scope, owner, index]);
        }
        scopes.put({ active: snapshot }, scope);
        done(true);
      }, abort);
    });
  }

  function abandon(scope, generation) {
    return transact('readwrite', (scopes, pages, done, abort) => {
      current(scopes, scope, metadata => {
        if (metadata.pending !== generation) return;
        pages.delete(stagedPages(scope, generation));
        if (metadata.active) scopes.put({ active: metadata.active }, scope);
        else scopes.delete(scope);
        done(true);
      }, abort);
    });
  }

  function clear(scope) {
    if (!scope) return Promise.resolve(false);
    return transact('readwrite', (scopes, pages, done) => {
      scopes.delete(scope);
      pages.delete(ranges.bound([scope], [scope, []]));
      done(true);
    });
  }

  function close() {
    closed = true;
    void opening?.then(db => db?.close());
  }

  return { active, stage, read, write, publish, abandon, clear, close };
}
