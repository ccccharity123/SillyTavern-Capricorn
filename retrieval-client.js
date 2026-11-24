import { bm25 } from './hybrid.js';
import { clearIndex } from './index-store.js';

export function createRetrieval() {
  let snapshot = new Map();
  let worker = null, pending = null, activeScope = '', clearing = null;
  let epoch = 0, retryAt = 0, failures = 0, fallbacks = 0, lastMs = 0;

  function reset() {
    const previous = worker;
    worker = null;
    snapshot.clear();
    activeScope = '';
    previous?.terminate();
    if (!pending) return;
    const request = pending;
    pending = null;
    clearTimeout(request.timer);
    request.reject(Error('检索已取消'));
  }

  function stop() {
    epoch++;
    reset();
  }

  function fault(candidate) {
    if (worker !== candidate) return;
    failures++;
    retryAt = Date.now() + 30000;
    reset();
  }

  function start() {
    if (Date.now() < retryAt || typeof Worker === 'undefined') return null;
    if (worker) return worker;
    try {
      const candidate = new Worker(new URL('./retrieval-worker.js', import.meta.url), { type: 'module' });
      worker = candidate;
      candidate.onmessage = ({ data }) => {
        if (worker !== candidate || !pending || pending.id !== data?.id) return;
        const request = pending;
        pending = null;
        clearTimeout(request.timer);
        if (data.error) request.reject(Error(data.error));
        else request.resolve(data.scores);
      };
      candidate.onerror = candidate.onmessageerror = () => fault(candidate);
      return candidate;
    } catch {
      failures++;
      retryAt = Date.now() + 30000;
      return null;
    }
  }

  function requestScores(candidate, message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending?.id === message.id) fault(candidate);
      }, 10000);
      pending = { id: message.id, resolve, reject, timer };
      try {
        candidate.postMessage(message);
      } catch (error) {
        clearTimeout(timer);
        pending = null;
        reject(error);
      }
    });
  }

  async function scores(docs, query, scope, store, guard = () => {}) {
    const ticket = ++epoch, began = Date.now();
    if (pending) reset();
    const check = () => {
      if (ticket !== epoch) throw Error('检索已被更新任务替代');
      guard();
    };
    if (clearing) await clearing;
    check();
    const current = start();
    if (current) {
      try {
        if (activeScope !== scope) {
          activeScope = scope;
          snapshot.clear();
        }
        const next = new Map(docs.map(doc => [doc.id, doc.search]));
        const changed = [...next].filter(([id, keyword]) => snapshot.get(id) !== keyword);
        const removed = [...snapshot.keys()].filter(id => !next.has(id));
        const result = await requestScores(current, { id: ticket, scope, query, changed, removed, ids: docs.map(doc => doc.id) });
        if (ticket !== epoch) throw Error('检索已被替代');
        if (!Array.isArray(result) || result.length !== docs.length || !result.every(Number.isFinite)) {
          throw Error('无效检索结果');
        }
        // Worker updates can be reused even if the incoming request was superseded on the host.
        snapshot = next;
        check();
        lastMs = Date.now() - began;
        return result;
      } catch {
        check();
        fault(current);
      }
    }
    await store.activate(scope);
    check();
    fallbacks++;
    const result = bm25(docs, query, store);
    lastMs = Date.now() - began;
    return result;
  }

  async function clear(scope) {
    stop();
    retryAt = 0;
    const previous = clearing;
    const task = Promise.resolve(previous).then(() => clearIndex(scope));
    clearing = task;
    try { return await task; }
    finally { if (clearing === task) clearing = null; }
  }

  function info() {
    const status = worker ? '运行中' : Date.now() < retryAt ? '冷却中' : '未启动';
    return `后台线程：${status}；故障 ${failures} 次；本地回退 ${fallbacks} 次；最近检索 ${lastMs}ms`;
  }

  return { scores, stop, clear, info };
}
