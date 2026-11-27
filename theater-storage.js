export function fingerprint(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

export function theaterStorage(host, diagnose) {
  const ephemeral = new Map();
  const failures = new Set();
  function mark(key) {
    failures.add(key);
    diagnose('storage');
  }
  function access(key, persistent, legacy) {
    return {
      load() {
        if (ephemeral.has(key)) return structuredCopy(ephemeral.get(key));
        if (!persistent) return {};
        try {
          const value = JSON.parse(host.localStorage.getItem(key) ?? (legacy && host.localStorage.getItem(legacy)) ?? '{}');
          return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch { mark(key); return {}; }
      },
      save(value) {
        if (!persistent || failures.has(key)) ephemeral.set(key, structuredCopy(value));
        if (!persistent) return true;
        try {
          host.localStorage.setItem(key, JSON.stringify(value));
          ephemeral.delete(key);
          failures.delete(key);
          return true;
        } catch {
          ephemeral.set(key, structuredCopy(value));
          mark(key);
          return false;
        }
      },
      reset() {
        ephemeral.delete(key);
        if (!persistent) return true;
        try {
          if (legacy) host.localStorage.removeItem(legacy);
          host.localStorage.removeItem(key);
          failures.delete(key);
          return true;
        } catch {
          ephemeral.set(key, {});
          mark(key);
          return false;
        }
      },
      failed: () => failures.has(key),
    };
  }
  function prune(prefix, valid) {
    for (const key of ephemeral.keys()) {
      if (key.startsWith(prefix) && !valid.has(key.slice(prefix.length).split(':')[0])) ephemeral.delete(key);
    }
    try {
      const storage = host.localStorage;
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (key?.startsWith(prefix) && !valid.has(key.slice(prefix.length).split(':')[0])) storage.removeItem(key);
      }
    } catch { diagnose('storage'); }
  }
  return { access, prune };
}

function structuredCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

export function messageKeys(chat) {
  const base = chat.map(message => {
    const native = message?.extra?.message_uuid ?? message?.uuid ?? message?.send_date;
    return typeof native === 'string' || typeof native === 'number'
      ? 'm' + fingerprint(String(native)) : '';
  });
  const counts = new Map();
  base.forEach(key => counts.set(key, (counts.get(key) || 0) + 1));
  return base.map((key, index) => key && counts.get(key) === 1 ? key : 'f' + index + key);
}
