import { bm25 } from './hybrid.js';
import { clearIndex } from './index-store.js';
import {
  RETRIEVAL_BLOCK_CHARS, RETRIEVAL_BLOCK_DOCS, RETRIEVAL_MAX_PAGES,
  addStats, corpusStats, documentBlocks, projectionSize, queryTerms, streamScores, topCandidates, yieldRetrieval,
} from './retrieval-blocks.js';

export { RETRIEVAL_BLOCK_CHARS, RETRIEVAL_BLOCK_DOCS };

export function createRetrieval() {
  let worker, pending, active, clearing;
  let sequence = 0, retryAt = 0, failures = 0, fallbacks = 0, lastMs = 0;
  let warmed = { documents: 0, blocks: 0, reused: 0, peakChars: 0 };

  function reset() {
    const previous = worker;
    worker = undefined;
    previous?.terminate();
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(Error('检索已取消'));
      pending = undefined;
    }
  }

  function stop() {
    active = undefined;
    reset();
  }

  function fault(candidate) {
    if (worker !== candidate) return;
    failures++;
    retryAt = Date.now() + 30000;
    reset();
  }

  const timeout = request => setTimeout(() => {
    if (pending === request) fault(worker);
  }, 10000);

  function start() {
    if (worker) return worker;
    if (Date.now() < retryAt || typeof Worker === 'undefined') return null;
    try {
      const candidate = new Worker(new URL('./retrieval-worker.js', import.meta.url), { type: 'module' });
      worker = candidate;
      candidate.onmessage = ({ data }) => {
        const request = pending;
        if (worker !== candidate || !request || request.id !== data?.id) return;
        clearTimeout(request.timer);
        if (data.progress) {
          request.timer = timeout(request);
          return;
        }
        pending = undefined;
        if (data.error) request.reject(Error(data.error));
        else request.resolve(data.result);
      };
      candidate.onerror = candidate.onmessageerror = () => fault(candidate);
      return candidate;
    } catch {
      failures++;
      retryAt = Date.now() + 30000;
      return null;
    }
  }

  function request(candidate, message) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const ticket = { id, resolve, reject };
      ticket.timer = timeout(ticket);
      pending = ticket;
      try { candidate.postMessage({ ...message, id }); }
      catch (error) {
        clearTimeout(ticket.timer);
        pending = undefined;
        reject(error);
      }
    });
  }

  async function task(background, guard, execute) {
    if (background && active) return null;
    if (active) reset();
    const ticket = {};
    active = ticket;
    const began = Date.now();
    const check = () => {
      if (active !== ticket) throw Error('检索已被更新任务替代');
      guard();
    };
    try {
      if (clearing) await clearing;
      check();
      return await execute(check);
    } finally {
      if (active === ticket) {
        active = undefined;
        lastMs = Date.now() - began;
      }
    }
  }

  async function inWorker(check, execute) {
    const candidate = start();
    if (!candidate) return null;
    async function send(message) {
      check();
      const result = await request(candidate, message);
      check();
      return result;
    }
    try { return await execute(send); }
    catch (error) {
      check();
      fault(candidate);
      return null;
    }
  }

  async function workerScores(docs, query, scope, check, send) {
    const scores = new Array(docs.length).fill(0);
    const terms = queryTerms(query);
    if (!terms.length) return scores;
    const stats = corpusStats(terms);
    for await (const block of documentBlocks(docs, check)) {
      if (block.some(doc => projectionSize(doc) > RETRIEVAL_BLOCK_CHARS)) return null;
      const value = await send({ type: 'stats', scope, terms, block });
      addStats(stats, value);
    }
    let ordinal = 0;
    for await (const block of documentBlocks(docs, check)) {
      const blockScores = await send({ type: 'scores', scope, terms, block, stats });
      if (!Array.isArray(blockScores) || blockScores.length !== block.length || !blockScores.every(Number.isFinite)) {
        throw Error('无效检索结果');
      }
      for (const score of blockScores) scores[ordinal++] = score;
    }
    await send({ type: 'release' });
    return scores;
  }

  function scores(docs, query, scope, store, guard = () => {}, workerOnly = false) {
    if (workerOnly) return warm(docs, scope, store, guard);
    return task(false, guard, async check => {
      const result = await inWorker(check, send => workerScores(docs, query, scope, check, send));
      if (result !== null) return result;
      fallbacks++;
      if (docs.length <= RETRIEVAL_BLOCK_DOCS &&
          docs.reduce((sum, doc) => sum + projectionSize(doc), 0) <= RETRIEVAL_BLOCK_CHARS) {
        await store?.activate(scope);
        check();
        return bm25(docs, query, store);
      }
      const resultScores = new Array(docs.length).fill(0);
      let index = 0;
      await streamScores(() => docs, query, check, (_id, value) => { resultScores[index++] = value; });
      return resultScores;
    });
  }

  function warmBlocks(source, scope, guard = () => {}, revision = '', hooks = {}) {
    return task(true, guard, check => inWorker(check, async send => {
      const generation = globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random();
      const header = { scope, generation, revision };
      if (!await send({ ...header, type: 'begin' })) return null;
      const metrics = { documents: 0, blocks: 0, reused: 0, peakChars: 0 };
      let committed = false;
      try {
        for await (const block of documentBlocks(source, check)) {
          const chars = block.reduce((sum, doc) => sum + projectionSize(doc), 0);
          if (chars > RETRIEVAL_BLOCK_CHARS || metrics.blocks >= RETRIEVAL_MAX_PAGES) return null;
          const release = hooks.reserve?.(chars * 64 + block.length * 128 + 131072);
          if (hooks.reserve && !release) return null;
          try {
            const value = await send({ ...header, type: 'page', block });
            if (!value) return null;
            metrics.blocks++;
            metrics.documents += block.length;
            metrics.reused += Number(value.reused);
            metrics.peakChars = Math.max(metrics.peakChars, chars);
          } finally { release?.(); }
          if (hooks.yield) await hooks.yield();
          else await yieldRetrieval();
          check();
        }
        const result = await send({ ...header, type: 'commit' });
        if (!result) return null;
        committed = true;
        warmed = metrics;
        return { ...result, ...metrics };
      } finally {
        if (!committed) await send({ ...header, type: 'abandon' });
      }
    }));
  }

  const warm = (docs, scope, _store, guard) => warmBlocks(docs, scope, guard);

  function top(query, scope, revision, limit, guard = () => {}) {
    return task(false, guard, check => inWorker(check, async send => {
      const result = await send({ type: 'top', query, scope, revision, limit });
      if (result === null) return null;
      if (result.revision !== revision || !Number.isSafeInteger(result.documents) || !Array.isArray(result.matches) ||
          !result.matches.every(match => typeof match.id === 'string' && Number.isFinite(match.score))) {
        throw Error('无效检索结果');
      }
      return result;
    }));
  }

  function topBlocks(source, query, limit, guard = () => {}, hooks = {}) {
    return task(false, guard, async check => {
      fallbacks++;
      const top = topCandidates(limit);
      const documents = await streamScores(source, query, check, top.add, hooks.yield);
      return { matches: top.matches, documents };
    });
  }

  async function clear(scope) {
    stop();
    retryAt = 0;
    warmed = { documents: 0, blocks: 0, reused: 0, peakChars: 0 };
    const previous = clearing;
    const task = Promise.resolve(previous).then(() => clearIndex(scope));
    clearing = task;
    try { return await task; }
    finally { if (clearing === task) clearing = undefined; }
  }

  function info() {
    const status = worker ? '运行中' : Date.now() < retryAt ? '冷却中' : '未启动';
    return '后台线程：' + status + '；故障 ' + failures + ' 次；本地回退 ' + fallbacks + ' 次；最近检索 ' +
      lastMs + 'ms；已提交 ' + warmed.blocks + ' 块 / ' + warmed.documents + ' 文档，复用 ' + warmed.reused + ' 块';
  }

  return { scores, warm, warmBlocks, top, topBlocks, stop, clear, info, metrics: () => ({ ...warmed, failures, fallbacks, lastMs }) };
}
