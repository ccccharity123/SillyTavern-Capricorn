// Derived lexical cache keyed by exact candidate text and chat scope.
export function createLexicalStore(factory = globalThis.indexedDB) {
  const limit = 12000;
  const bags = new Map(), dirty = new Map();
  let opening, timer, clearing, scope = '', epoch = 0, activation = 0, retryAfter = 0, closed = false;

  function open() {
    if (!factory || closed || Date.now() < retryAfter) return Promise.resolve(null);
    if (opening) return opening;
    let dropped = false;
    const attempt = new Promise(resolve => {
      try {
        const request = factory.open('capricorn-lexical-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('scopes');
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

  async function write(change) {
    try {
      const db = await open();
      if (!db || closed) return false;
      return await change(db);
    } catch { return false; }
  }

  function update(db, change) {
    const transaction = db.transaction('scopes', 'readwrite');
    return new Promise(resolve => {
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = transaction.onabort = () => resolve(false);
      try { change(transaction.objectStore('scopes')); }
      catch { try { transaction.abort(); } catch { resolve(false); } }
    });
  }

  function validBag(value) {
    if (!(value?.f instanceof Map) || !Number.isSafeInteger(value.n) || value.n < 0) return false;
    let total = 0;
    for (const [key, frequency] of value.f) {
      if (typeof key !== 'string' || !Number.isSafeInteger(frequency) || frequency <= 0) return false;
      total += frequency;
    }
    return total === value.n;
  }

  function reset(nextScope = '') {
    epoch++;
    scope = nextScope;
    bags.clear();
    dirty.clear();
    clearTimeout(timer);
    timer = null;
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    const savedScope = scope, ticket = epoch;
    if (!savedScope || !dirty.size || closed) return;
    let snapshot;
    const committed = await write(db => {
      if (ticket !== epoch) return false;
      snapshot = [...bags];
      return update(db, scopes => scopes.put(snapshot, savedScope));
    });
    if (committed && ticket === epoch) {
      for (const [key, value] of snapshot) if (dirty.get(key) === value) dirty.delete(key);
    }
  }

  async function activate(nextScope) {
    const activationTicket = ++activation;
    if (clearing) await clearing;
    if (nextScope === scope || closed || activationTicket !== activation) return;
    await flush();
    if (closed || activationTicket !== activation) return;
    reset(nextScope);
    if (!nextScope) return;
    const ticket = epoch;
    try {
      const db = await open();
      if (!db || ticket !== epoch || closed) return;
      const request = db.transaction('scopes').objectStore('scopes').get(nextScope);
      const rows = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = reject;
      });
      if (ticket !== epoch || closed || !Array.isArray(rows)) return;
      for (const entry of rows.slice(-limit)) {
        if (!Array.isArray(entry)) continue;
        const [key, value] = entry;
        if (bags.size >= limit) break;
        if (typeof key === 'string' && validBag(value) && !bags.has(key)) bags.set(key, value);
      }
    } catch { /* cache loss does not affect recall */ }
  }

  function get(key) {
    const value = bags.get(key);
    if (value) { bags.delete(key); bags.set(key, value); }
    return value;
  }

  function set(key, value) {
    if (!scope || closed) return;
    bags.set(key, value);
    dirty.set(key, value);
    while (bags.size > limit) {
      const oldest = bags.keys().next().value;
      bags.delete(oldest);
      dirty.delete(oldest);
    }
    if (!timer) timer = setTimeout(() => void flush(), 2000);
  }

  async function clear(target) {
    if (!target || closed) return false;
    activation++;
    if (target === scope) reset();
    const previous = clearing;
    const task = Promise.resolve(previous).then(() => write(db => update(db, scopes => scopes.delete(target))));
    clearing = task;
    try { return await task; }
    finally { if (clearing === task) clearing = undefined; }
  }

  function close() {
    closed = true;
    reset();
    void opening?.then(db => db?.close());
  }

  return { activate, get, set, flush, clear, close };
}

export async function clearLexicalCache(scope) {
  const store = createLexicalStore();
  try { return await store.clear(scope); }
  finally { store.close(); }
}
