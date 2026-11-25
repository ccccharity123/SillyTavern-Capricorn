import { embedBatch, embeddingRetryDelay, embeddingText, validVector, vectorScope } from './migration.js';
import { createVectorStore } from './vector-store.js';

const maximumHotEntries = 256;
const maximumHotBytes = 2000000;

function cosine(left, right) {
  if (!right || left.length !== right.length) return -1;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : -1;
}

export function createVector(store = createVectorStore(), lane = null, clock = () => Date.now(), embed = embedBatch) {
  const cache = new Map();
  let scope = '', bytes = 0, task;
  let status = '未启用', requests = 0, retryAt = 0, failures = 0;

  function forget(text) {
    const previous = cache.get(text);
    if (!previous) return;
    bytes -= text.length * 2 + previous.length * 8;
    cache.delete(text);
  }

  function remember(text, vector) {
    forget(text);
    cache.set(text, vector);
    bytes += text.length * 2 + vector.length * 8;
    while (cache.size > maximumHotEntries || bytes > maximumHotBytes) forget(cache.keys().next().value);
  }

  function setScope(next) {
    const previous = task;
    task = undefined;
    previous?.controller.abort();
    previous?.release();
    retryAt = failures = 0;
    scope = next;
    status = '本地检索';
    cache.clear();
    bytes = 0;
    if (!next) return;
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem('capricorn-vector:' + next) || '[]');
      for (const item of saved.slice(-maximumHotEntries)) {
        if (Array.isArray(item) && typeof item[0] === 'string' && validVector(item[1])) remember(item[0], item[1]);
      }
    } catch { /* Older local cache is optional. New vectors are persisted in IndexedDB. */ }
  }

  async function hydrate(key, missing, config, ticket) {
    const { controller, release } = ticket;
    const { signal } = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    const current = () => task === ticket && !signal.aborted;
    try {
      const stored = await store.read(key, missing, signal);
      if (!current()) return;
      for (const text of missing) {
        const vector = stored?.get(text);
        if (validVector(vector)) remember(text, vector);
      }
      const send = missing.filter(text => !cache.has(text));
      if (!send.length) {
        status = '持久索引可用';
        return;
      }
      if (lane && !lane.beginRequest(release)) {
        status = '等待向量请求限速';
        return;
      }
      status = '索引更新中';
      const vectors = await embed(send, config, signal, () => requests++);
      if (!current()) return;
      for (const [index, text] of send.entries()) remember(text, vectors[index]);
      const written = await store.write(key, send, vectors, signal);
      if (!current()) return;
      failures = retryAt = 0;
      status = written ? '向量可用' : '向量可用，浏览器存储不可用';
    } catch (error) {
      if (task === ticket) {
        retryAt = clock() + embeddingRetryDelay(error, ++failures);
        status = '向量失败，暂用本地检索';
      }
    } finally {
      clearTimeout(timeout);
      release();
      if (task === ticket) task = undefined;
    }
  }

  function rank(docs, query, config, chat) {
    if (!config.vectorEnabled || !chat || !config.vectorUrl || !config.vectorModel) {
      if (scope) setScope('');
      else status = '本地检索';
      return new Map();
    }
    const key = vectorScope(chat, config);
    if (scope !== key) setScope(key);
    if (!embeddingText(query) || !docs.length) return new Map();
    const candidates = [...new Set([query, ...docs.map(doc => doc.search).filter(embeddingText)])];
    for (const text of candidates) {
      const vector = cache.get(text);
      if (vector) remember(text, vector);
    }
    const missing = candidates.filter(text => !cache.has(text)).slice(0, 16);
    if (missing.length && !task && clock() >= retryAt) {
      const release = lane ? lane.acquire('foreground') : () => {};
      if (release) {
        task = { controller: new AbortController(), release };
        void hydrate(key, missing, config, task);
      }
    }
    const queryVector = cache.get(query);
    if (!queryVector) return new Map();
    return new Map(docs.map(doc => [doc.id, cosine(queryVector, cache.get(doc.search))])
      .filter(([, score]) => score > 0.35)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id], index) => [id, index + 1]));
  }

  return {
    rank, reset: () => setScope(''),
    info: () => `${status}；请求 ${requests} 次；缓存 ${cache.size} 条`,
  };
}
