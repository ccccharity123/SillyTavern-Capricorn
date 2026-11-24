export function createScheduler(host, hidden = () => false) {
  const jobs = new Map();
  const stats = new Map();
  let closed = false;
  let handle = null;
  let running = false;
  const clock = () => host.performance?.now?.() ?? Date.now();

  function arm() {
    if (closed || running || handle !== null || jobs.size === 0 || hidden()) return;
    const run = () => {
      handle = null;
      void drain();
    };
    handle = typeof host.requestIdleCallback === 'function'
      ? ['idle', host.requestIdleCallback(run, { timeout: 1500 })]
      : ['timer', host.setTimeout(run, 0)];
  }

  async function drain() {
    if (closed || hidden() || running || jobs.size === 0) return;
    let next = jobs.entries().next().value;
    for (const job of jobs.entries()) {
      if (job[1].priority > next[1].priority) next = job;
    }
    const [key, { fn }] = next;
    jobs.delete(key);
    running = true;
    const result = stats.get(key) ?? { runs: 0, errors: 0, lastMs: 0 };
    const start = clock();
    try {
      await fn();
    } catch (error) {
      result.errors++;
      console.warn('[Capricorn maintenance]', key, error);
    } finally {
      result.runs++;
      result.lastMs = Math.round(clock() - start);
      stats.set(key, result);
      running = false;
      arm();
    }
  }

  return {
    enqueue(key, fn, priority = 0) {
      if (closed) return;
      jobs.set(key, { fn, priority });
      arm();
    },
    resume: arm,
    status: () => ({ pending: jobs.size, running, stats: Object.fromEntries(stats) }),
    close() {
      closed = true;
      jobs.clear();
      if (handle?.[0] === 'idle') host.cancelIdleCallback?.(handle[1]);
      if (handle?.[0] === 'timer') host.clearTimeout(handle[1]);
      handle = null;
    },
  };
}
