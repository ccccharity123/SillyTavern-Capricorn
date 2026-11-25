const historyBatchSize = 8;
const checkpointBatchSize = 64;
const maximumTextBytes = 16384;
const encoder = new TextEncoder();

// Keep legacy cache keys readable. Credentials are session data and never part of the key.
export function vectorScope(scope, config) {
  return JSON.stringify([scope, config.vectorUrl, config.vectorModel]);
}

export function embeddingText(text) {
  return typeof text === 'string' && text.length > 0 && text.length <= maximumTextBytes &&
    (text.length * 3 <= maximumTextBytes || encoder.encode(text).length <= maximumTextBytes);
}

export function validVector(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 8192 && value.every(Number.isFinite);
}

export function estimateMigration(texts) {
  let eligible = 0, skipped = 0, estimatedTokens = 0;
  for (const text of new Set(texts)) {
    if (!embeddingText(text)) {
      skipped++;
      continue;
    }
    eligible++;
    estimatedTokens += Math.ceil(encoder.encode(text).length / 2);
  }
  return { eligible, skipped, estimatedTokens, requests: Math.ceil(eligible / historyBatchSize) };
}

export function embeddingRetryDelay(error, failures) {
  return Math.max(error?.retryAfterMs || 0, Math.min(900000, 60000 * 2 ** Math.min(failures - 1, 4)));
}

export async function embedBatch(texts, config, signal, onRequest) {
  const url = new URL(config.vectorUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw Error('无效向量接口');
  signal?.throwIfAborted();
  onRequest?.();
  const response = await fetch(url.href, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...(config.vectorKey ? { Authorization: `Bearer ${config.vectorKey}` } : {}),
    },
    body: JSON.stringify({ model: config.vectorModel, input: texts }),
    signal,
  });
  if (!response.ok) {
    const error = Error(`HTTP ${response.status}`);
    error.status = response.status;
    const retryAfter = response.headers?.get('Retry-After');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      error.retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
    }
    throw error;
  }
  const { data } = await response.json();
  signal?.throwIfAborted();
  if (!Array.isArray(data) || data.length !== texts.length) throw Error('向量响应无效');
  const vectors = new Array(texts.length);
  let dimensions;
  for (const item of data) {
    const { index, embedding } = item || {};
    if (!Number.isInteger(index) || index < 0 || index >= vectors.length || vectors[index] ||
        !validVector(embedding) || (dimensions !== undefined && dimensions !== embedding.length)) {
      throw Error('向量响应无效');
    }
    vectors[index] = embedding;
    dimensions = embedding.length;
  }
  return vectors;
}

// Existing IndexedDB vectors act as the durable checkpoint after a reload.
export function createMigration(store, embed, clock = () => Date.now(), lane = null) {
  const completed = new Set();
  let scope = '', input, ordered = [], cursor = 0, skipped = 0;
  let active, retryAt = 0, failures = 0, requests = 0;
  let manualPaused = false, quotaPaused = false, status = '未启动';

  function cancel() {
    const previous = active;
    active = undefined;
    previous?.controller.abort();
    previous?.release();
  }

  function reset() {
    cancel();
    completed.clear();
    scope = '';
    input = undefined;
    ordered = [];
    cursor = skipped = retryAt = failures = requests = 0;
    manualPaused = quotaPaused = false;
    status = '未启动';
  }

  function pause(manual = false) {
    cancel();
    if (manual) manualPaused = true;
    status = '已暂停';
  }

  function resume() {
    manualPaused = quotaPaused = false;
    retryAt = failures = 0;
    status = '等待下一批';
  }

  function revise(key, texts) {
    if (scope !== key) {
      reset();
      scope = key;
    } else cancel();
    const unique = new Set(texts);
    const eligible = [...unique].filter(embeddingText);
    for (const text of completed) if (!unique.has(text)) completed.delete(text);
    input = texts;
    ordered = [...eligible.filter(text => completed.has(text)), ...eligible.filter(text => !completed.has(text))];
    cursor = completed.size;
    skipped = unique.size - eligible.length;
    return ordered;
  }

  function advance(texts, saved) {
    for (const text of texts) {
      if (!saved.has(text)) break;
      completed.add(text);
      cursor++;
    }
    status = cursor >= ordered.length ? '本轮完成' : '等待下一批';
  }

  async function step(key, texts, config, allowed = () => true) {
    if (!key || config.vectorEnabled === false || config.vectorMigration === false) {
      if (active) pause();
      return;
    }
    if (scope !== key || (texts !== input && texts !== ordered)) revise(key, texts);
    if (active || manualPaused || quotaPaused || !allowed() || clock() < retryAt) return;
    if (cursor >= ordered.length) {
      status = '本轮完成';
      return;
    }
    const release = lane ? lane.acquire('background', () => pause()) : () => {};
    if (!release) return;
    const controller = new AbortController();
    const ticket = { controller, release };
    active = ticket;
    const current = () => active === ticket && !controller.signal.aborted && allowed();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      status = '检查历史索引';
      const batch = ordered.slice(cursor, cursor + checkpointBatchSize);
      const stored = await store.read(key, batch, controller.signal);
      if (!current()) return;
      if (!stored) throw Error('持久存储不可用');
      const saved = new Set(batch.filter(text => validVector(stored.get(text))));
      if (batch.slice(0, historyBatchSize).every(text => saved.has(text))) {
        advance(batch, saved);
        return;
      }
      const missing = batch.filter(text => !saved.has(text)).slice(0, historyBatchSize);
      const minimumBytes = missing.reduce((bytes, text) => bytes + encoder.encode(text).length, 0);
      const capacity = await store.estimate?.();
      if (!current()) return;
      if (capacity && capacity.available <= minimumBytes) {
        quotaPaused = true;
        status = '存储空间不足，已暂停';
        return;
      }
      if (lane && !lane.beginRequest(release)) {
        advance(batch, saved);
        return;
      }
      status = '构建历史索引';
      const vectors = await embed(missing, config, controller.signal, () => requests++);
      if (!current()) return;
      if (vectors.length !== missing.length || !vectors.every(validVector)) throw Error('向量响应无效');
      const written = await store.write(key, missing, vectors, controller.signal);
      if (!current()) return;
      if (!written) {
        if (store.lastWriteError?.() === 'QuotaExceededError') {
          quotaPaused = true;
          status = '存储空间不足，已暂停';
          return;
        }
        throw Error('持久存储写入失败');
      }
      for (const text of missing) saved.add(text);
      failures = retryAt = 0;
      advance(batch, saved);
    } catch (error) {
      if (active === ticket && allowed()) {
        retryAt = clock() + embeddingRetryDelay(error, ++failures);
        status = '构建失败，等待重试';
      }
    } finally {
      clearTimeout(timeout);
      release();
      if (active === ticket) active = undefined;
    }
  }

  function state() {
    return {
      done: cursor, total: ordered.length, busy: Boolean(active), status, skipped, requests,
      paused: manualPaused || quotaPaused, quotaPaused, retryAt,
    };
  }

  return {
    step, reset, pause, resume, revise, estimate: estimateMigration, state,
    info: () => `${status} · ${cursor}/${ordered.length}${skipped ? ` · 跳过 ${skipped} 条` : ''}${requests ? ` · 请求 ${requests} 次` : ''}`,
  };
}
