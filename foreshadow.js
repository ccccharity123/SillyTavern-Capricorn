import { normalize } from './traces.js';

const active = new Set(['未解决', '发展中']);
const closed = new Set(['已回收', '已废弃']);
const labels = ['伏笔直中', '场景伏笔', '相关伏笔', '延续伏笔'];

function names(value) {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? [value] : [];
}

function matchKeys(values) {
  return values.map(normalize).filter(name => name.length >= 2);
}

function lastSourceFloor(sources) {
  let latest = -1;
  for (const source of sources || []) {
    const floor = typeof source === 'string' ? source.match(/^(\d+):/)?.[1] : undefined;
    if (floor !== undefined) latest = Math.max(latest, Number(floor));
  }
  return latest;
}

// The caller supplies canonical entity documents and the current turn's text.
// Return up to five document IDs with their recall reasons in priority order.
export function selectForeshadow(docs, {
  query = '', sceneHints = [], lexicalRanks = new Map(), echo = {},
  allowFallback = false, limit = 3,
} = {}) {
  const capacity = Math.max(0, Math.min(5, Math.floor(Number(limit) || 0)));
  if (!capacity) return new Map();

  const threads = new Map();
  const hidden = new Set();
  for (const doc of docs) {
    if (doc.kind !== 'entity' || doc.canonical === false || (!doc.thread && !doc.mainline)) continue;
    const thread = doc.thread || { title: doc.names?.[0], aliases: doc.names?.slice(1), status: '未解决' };
    const title = normalize(thread.title);
    if (!title) continue;
    if (doc.hidden || doc.rejected || thread.hidden || thread.rejected) {
      hidden.add(title);
      continue;
    }
    const status = normalize(thread.status);
    if (!active.has(status) && !closed.has(status)) continue;
    const resolved = closed.has(status);
    const floor = Number.isSafeInteger(thread.floor) ? thread.floor : lastSourceFloor(doc.sources);
    const existing = threads.get(title);
    if (!existing || floor > existing.floor || floor === existing.floor &&
      (resolved && !existing.resolved || resolved === existing.resolved && doc.pin && !existing.doc.pin)) {
      threads.set(title, { doc, thread, floor, resolved });
    }
  }

  const text = normalize(query);
  const scene = new Set(matchKeys(sceneHints));
  const ranked = [];
  const continuity = [];
  for (const [title, { doc, thread, floor, resolved }] of threads) {
    if (resolved || hidden.has(title)) continue;
    const referenceNames = matchKeys([thread.title, ...names(thread.aliases)]);
    const people = matchKeys(names(thread.people));
    const lexical = lexicalRanks.get(doc.id) ?? Infinity;
    const candidate = { id: doc.id, floor: floor < 0 ? Infinity : floor, lexical };
    if (referenceNames.some(name => text.includes(name))) ranked.push({ ...candidate, priority: 0 });
    else if (referenceNames.some(name => scene.has(name)) ||
      people.some(name => scene.has(name) || text.includes(name))) ranked.push({ ...candidate, priority: 1 });
    else if (text.length >= 2 && lexical <= 8) ranked.push({ ...candidate, priority: 2 });
    else if (allowFallback && (doc.pin || echo[doc.id] > 0)) {
      continuity.push({ ...candidate, priority: 3, pin: !!doc.pin, echo: Number(echo[doc.id]) || 0 });
    }
  }

  ranked.sort((a, b) => a.priority - b.priority || a.lexical - b.lexical || a.floor - b.floor);
  if (!ranked.length && continuity.length) {
    continuity.sort((a, b) => Number(b.pin) - Number(a.pin) || b.echo - a.echo || a.floor - b.floor);
    ranked.push(continuity[0]);
  }
  const result = new Map();
  for (const { id, priority } of ranked) {
    if (!result.has(id)) result.set(id, labels[priority]);
    if (result.size === capacity) break;
  }
  return result;
}
