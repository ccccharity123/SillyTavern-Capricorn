import { hasOwn, lastItem } from './compat.js';
import { entityProjection, entityScene, excerpt, summaryProjection } from './hybrid.js';

const chapterSize = 12;
const candidateChars = 512 * 1024;
const candidateCount = 512;
export const shardThreshold = 4000;

function chapterDocument(keys, rows, name) {
  const items = keys.map(key => rows[key]);
  const title = name || `阶段 ${items[0].sourceMessage}–${lastItem(items).sourceMessage}`;
  const key = JSON.stringify(keys);
  return {
    id: 'c:' + key, key, kind: 'chapter', sources: keys,
    search: items.map(row => row.title + ' ' + row.content).join('\n'),
    line: `章节｜${title}：${items.map(row => `${row.title}：${Array.from(String(row.content || '').slice(0, 200)).slice(0, 100).join('')}`).join('；')}`,
  };
}

// Keep summary bodies in their authoritative rows. The index and ranking only request projections in bounded runs.
export function createDocumentCorpus(rows, entities, options = {}) {
  const entries = Object.keys(rows).sort((a, b) => (rows[a].sourceMessage ?? -1) - (rows[b].sourceMessage ?? -1));
  const recent = new Set(entries.slice(-3));
  const categories = new Set(options.categories || []);
  const pins = new Set(options.pins || []);
  const entityRows = new Map();
  const history = options.mode === 'deep' ? 5 : options.mode === 'smart' ? 2 : 0;
  if (options.mode !== 'archive') {
    for (const row of entities) if (categories.has(row.kind)) entityRows.set(row.id, row);
  }
  const summary = key => ({ ...summaryProjection(key, rows[key]), pin: !!options.meta?.[key]?.star, recent: recent.has(key) });
  const entity = row => ({ ...entityProjection(row, history), pin: pins.has(row.id) });

  function* chapters() {
    let group = [], name;
    for (let i = 0; i < entries.length - chapterSize; i++) {
      const key = entries[i];
      const next = options.meta?.[key]?.chapter || '';
      if (group.length && (next !== name || group.length === chapterSize)) {
        if (group.length > 1) yield chapterDocument(group, rows, name);
        group = [];
      }
      name = next;
      group.push(key);
    }
    if (group.length > 1) yield chapterDocument(group, rows, name);
  }

  function* documents() {
    for (const key of entries) yield summary(key);
    for (const row of entityRows.values()) yield entity(row);
    if (options.layers) yield* chapters();
  }

  function resolve(id) {
    const key = id.slice(2);
    if (id.startsWith('s:') && hasOwn(rows, key)) return summary(key);
    if (id.startsWith('e:') && entityRows.has(key)) return entity(entityRows.get(key));
    if (!id.startsWith('c:') || !options.layers) return;
    try {
      const keys = JSON.parse(key);
      if (Array.isArray(keys) && keys.length >= 2 && keys.length <= chapterSize && keys.every(key => hasOwn(rows, key))) {
        return chapterDocument(keys, rows, options.meta?.[keys[0]]?.chapter);
      }
    } catch { /* Ignore invalid derived index IDs. */ }
  }

  function* sceneEntities() {
    for (const row of entityRows.values()) yield entityScene(row);
  }

  function candidates(ranks, scene, echo) {
    const chosen = new Map();
    let used = 0;
    const add = doc => {
      if (!doc || chosen.has(doc.id) || chosen.size >= candidateCount) return;
      const size = doc.search.length + doc.line.length;
      if (used + size > candidateChars) {
        // Keep the source body available for a query-relevant summary excerpt.
        if (doc.kind !== 'summary' || chosen.size >= candidateCount - 1) return;
        const visible = excerpt(doc.line, scene.query, 1600) || doc.line.slice(0, 1024);
        doc = { ...doc, search: doc.search.slice(0, 2048), line: visible };
        if (used + doc.search.length + doc.line.length > candidateChars) return;
      }
      chosen.set(doc.id, doc);
      used += doc.search.length + doc.line.length;
    };
    for (const key of recent) add(summary(key));
    for (const id of [...ranks.keys(), ...Object.keys(echo || {})]) add(resolve(id));
    for (const key in options.meta) if (options.meta[key]?.star && hasOwn(rows, key)) add(summary(key));
    const mentioned = scene.query.normalize('NFKC').toLowerCase();
    for (const row of entityRows.values()) {
      if (chosen.size >= candidateCount || used >= candidateChars) break;
      if (pins.has(row.id) || row.kind === '伏笔' || entityScene(row).names.some(name => mentioned.includes(name))) add(entity(row));
    }
    return [...chosen.values()];
  }

  return { documents, resolve, candidates, sceneEntities };
}
