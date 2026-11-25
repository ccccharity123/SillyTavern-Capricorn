import { hasOwn } from './compat.js';
const encoder = new TextEncoder();

function rowCost(row) {
  return Math.ceil(encoder.encode(`【${row.storyTime || '日期未识别'}｜${row.title || '剧情摘要'}】\n${row.content || ''}\n\n`).length / 2);
}

export function createSummaryStatistics() {
  const entries = new Map();
  let estimate = 0;
  let encoded = 0;
  let revision = 0;

  function update(key, row) {
    const old = entries.get(key);
    if (!row) {
      if (old) {
        estimate -= old.cost;
        revision++;
      }
      entries.delete(key);
    } else if (!old || old.content !== row.content || old.title !== row.title || old.storyTime !== row.storyTime) {
      const cost = rowCost(row);
      estimate += cost - (old?.cost || 0);
      entries.set(key, { title: row.title, content: row.content, storyTime: row.storyTime, cost });
      encoded++;
      revision++;
    }
  }

  return {
    update,
    reconcile(rows) {
      for (const key of entries.keys()) if (!hasOwn(rows, key)) update(key, null);
      for (const key in rows) if (hasOwn(rows, key)) update(key, rows[key]);
    },
    read: () => ({ count: entries.size, estimate, encoded, revision }),
  };
}

export function routeMemoryFromStats(mode, stats = {}, budget = 3000, previous = 'legacy', vectorAvailable = false) {
  const profile = mode === 'local' ? 'local' : vectorAvailable ? 'enhanced' : 'local';
  if (mode === 'legacy') return { mode: 'legacy', reason: '手动选择' };
  if (['local', 'enhanced', 'unified'].includes(mode)) {
    const reason = mode === 'enhanced' && !vectorAvailable ? '向量服务未就绪，使用本地召回' : '手动选择';
    return { mode: 'unified', profile, reason };
  }
  const { count = 0, estimate = 0 } = stats;
  const limit = Math.max(0, Number(budget) || 0);
  const long = count >= 500 || estimate > limit || previous === 'unified' && (count >= 200 || estimate > limit * .7);
  return {
    mode: long ? 'unified' : 'legacy', profile: long ? profile : 'legacy',
    reason: long ? '摘要规模或预算达到切换条件' : '摘要规模较小', estimate, count,
  };
}

export function routeMemory(mode, rows, budget = 3000, previous = 'legacy') {
  const stats = createSummaryStatistics();
  if (mode !== 'legacy' && mode !== 'unified') stats.reconcile(rows || {});
  const { profile, ...route } = routeMemoryFromStats(mode, stats.read(), budget, previous);
  return route;
}
