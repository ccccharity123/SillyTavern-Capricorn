import { hasOwn, lastItem } from './compat.js';
export const normalize=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu,'');
export function fuzzy(text,q){const t=normalize(text);return String(q??'').trim().split(/\s+/).every(w=>{const n=normalize(w);if(!n||t.includes(n))return true;if(n.length<4)return false;let i=0;for(const c of t)if(c===n[i])i++;return i===n.length;});}
export function table(text){const m=[...String(text).matchAll(/<(table|摩羯留痕)\s*>\s*([\s\S]*?)<\/\1\s*>/g)].pop();if(!m)return null;try{const v=JSON.parse(m[2].trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));return v&&typeof v==='object'&&!Array.isArray(v)?v:null;}catch{return null;}}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' ? value.trim() : '';
const exactName = value => string(value).normalize('NFKC');
function describe(value, separator = '、') {
  try { return Array.isArray(value) ? value.join(separator) : String(value); }
  catch { return ''; }
}
const restrictedFields = ['认知', '秘密', '客观事实', '人物认知', '知情者', '知情人'];
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const isRestricted = row => (hasOwn(row, '公开') && row.公开 !== true) ||
  restrictedFields.some(field => hasOwn(row, field));
const pastFrames = new Set(['过去', '倒叙', '回忆', '历史']);

function temporalFrame(row, tableValue) {
  if (hasOwn(row, '叙事时态')) return string(row.叙事时态) || '未确认';
  if (hasOwn(tableValue, '叙事时态')) return string(tableValue.叙事时态) || '未确认';
  return '当前';
}

const isCurrentFrame = frame => frame === '当前' || frame === '现在';

const traceKinds = ['人物', '关系', '事件', '物品', '伏笔', '成长', '地点'];

function* traceContributions(key, { floor, value }) {
  let index = 0;
  for (const kind of traceKinds) {
    if (!Array.isArray(value[kind])) continue;
    for (const row of value[kind]) {
      if (!record(row)) continue;
      const people = Array.isArray(row.人物) ? row.人物.filter(person => typeof person === 'string') : [];
      const title = describe(row.姓名 || row.名称 || (kind === '关系' ? people.slice().sort().join(' × ') : ''), ',').trim();
      if (!title) continue;
      const frame = temporalFrame(row, value);
      const current = isCurrentFrame(frame);
      if (!current && !pastFrames.has(frame)) continue;
      yield {
        id: `trace:${kind}:${normalize(title)}`, key, floor, index: index++, kind, title, row, people, frame, current,
        when: string(row.时间) || string(value.时间),
      };
    }
  }
}

function newTrace() {
  return { entry: null, order: null, sources: new Set(), history: [], relationshipTimeline: [], restricted: false };
}

function applyTrace(state, contribution) {
  const { row, id, key, floor, kind, title, people, frame, current, when } = contribution;
  if (isRestricted(row)) {
    if (current) Object.assign(state, newTrace(), { restricted: true });
    return;
  }
  if (state.restricted) {
    if (!current || row.公开 !== true) return;
    state.restricted = false;
  }
  const fields = Object.entries(row).filter(([name]) => name !== '叙事时态' && !unsafeKeys.has(name));
  state.sources.add(key);
  const label = current && !when ? '' : `｜${frame}${when ? ` · ${when}` : ''}`;
  state.history.push(`${floor}楼${label}：${fields.map(([name, content]) => `${name}：${describe(content)}`).join('；')}`);
  if (kind === '关系') {
    const changes = Object.fromEntries(fields.filter(([name, value]) => ['类型','状态','变化','情感','情感变化'].includes(name) && typeof value === 'string' && value.trim()));
    if (Object.keys(changes).length) state.relationshipTimeline.push({floor, source:key, frame, current, when, changes});
  }
  if (!current) return;
  if (!state.entry) {
    state.entry = { id, kind, title, people: '', auto: true, fields: {}, stateFloor: floor };
    state.order = contribution;
  }
  const entry = state.entry;
  for (const [name, content] of fields) {
    if (typeof content === 'string' && content.trim()) entry.fields[name] = content;
    if (Array.isArray(content) && content.every(item => typeof item === 'string')) {
      const previous = name === '别名' && Array.isArray(entry.fields[name]) ? entry.fields[name] : [];
      entry.fields[name] = [...new Set([...previous, ...content])];
    }
  }
  if (string(row.状态)) entry.stateFloor = floor;
  if (Array.isArray(row.人物) && people.length === row.人物.length) entry.people = people.join('、');
}

function stateTimelineCopy(items) { return items.map(item => ({...item, changes:{...item.changes}})); }

function renderTrace({ entry, order, sources, history, relationshipTimeline }) {
  if (!entry) return null;
  return {
    order,
    value: {
      ...entry,
      fields: Object.fromEntries(Object.entries(entry.fields).map(([key, value]) => [key, Array.isArray(value) ? value.slice() : value])),
      sources: [...sources],
      history: history.slice(),
      ...(entry.kind === '关系' ? {relationshipTimeline: stateTimelineCopy(relationshipTimeline)} : {}),
      status: entry.fields.状态 || '',
      body: Object.entries(entry.fields).map(([key, value]) => `${key}：${describe(value)}`).join('\n') +
        '\n\n变化记录\n' + history.join('\n'),
    },
  };
}

// Full recomputation is the reference for mutations applied by the index.
export function buildTraces(rows, hidden = {}) {
  const states = new Map();
  for (const key of Object.keys(rows).sort((a, b) => rows[a].floor - rows[b].floor)) {
    for (const contribution of traceContributions(key, rows[key])) {
      const { id } = contribution;
      if (hidden[id]) continue;
      if (!states.has(id)) states.set(id, newTrace());
      applyTrace(states.get(id), contribution);
    }
  }
  return [...states.values()].map(renderTrace).filter(Boolean)
    .sort((a, b) => contributionOrder(a.order, b.order)).map(item => item.value);
}

export function traces(messages, records, hash, hidden = {}, keys) {
  const rows = {};
  for (const message of messages) {
    const key = keys?.get(message) ?? `${message.message_id}:${hash(String(message.message ?? ''))}`;
    if (!records[key]) continue;
    const value = records[key].value ?? table(message.message);
    if (value) rows[key] = { floor: message.message_id, value };
  }
  return buildTraces(rows, hidden);
}

export function createTraceAccumulator() {
  return createContributionIndex(traceContributions, newTrace,
    state => ({
      ...state,
      entry: state.entry && { ...state.entry, fields: { ...state.entry.fields } },
      sources: new Set(state.sources), history: state.history.slice(), relationshipTimeline: state.relationshipTimeline.slice(),
    }),
    applyTrace, renderTrace);
}

function* knowledgeContributions(key, { floor, value }) {
  if (!Array.isArray(value.认知)) return;
  for (const [index, patch] of value.认知.entries()) {
    if (!record(patch) || !isCurrentFrame(temporalFrame(patch, value))) continue;
    const id = exactName(patch.名称);
    if (id) yield { id, key, floor, index, patch };
  }
}

function newKnowledge({ id, floor, index }) {
  return {
    id: `knowledge:${floor}:${index}`, title: id, fact: '', public: false, knowers: [], beliefs: [], sources: [],
    publicDisclosureSource: null, knowersSource: null, beliefsSource: null,
  };
}

function applyKnowledge(topic, { key, floor, patch }) {
  topic.floor = floor;
  if (lastItem(topic.sources) !== key) topic.sources.push(key);
  if (hasOwn(patch, '客观事实')) {
    const fact = string(patch.客观事实);
    if (topic.fact !== fact) {
      topic.fact = fact;
      topic.public = false;
      topic.knowers = [];
      topic.publicDisclosureSource = null;
      topic.knowersSource = null;
    }
  }
  if (hasOwn(patch, '公开')) {
    topic.public = patch.公开 === true;
    topic.publicDisclosureSource = topic.public ? key : null;
  }
  if (hasOwn(patch, '知情者')) {
    topic.knowers = Array.isArray(patch.知情者) ? [...new Set(patch.知情者.map(exactName).filter(Boolean))] : [];
    topic.knowersSource = topic.knowers.length ? key : null;
  }
  if (hasOwn(patch, '人物认知')) {
    const beliefs = new Map();
    if (Array.isArray(patch.人物认知)) {
      for (const belief of patch.人物认知) {
        if (!record(belief)) continue;
        const character = exactName(belief.人物), view = string(belief.看法);
        if (character) beliefs.set(character, { character, view, topic: string(belief.主题) });
      }
    }
    topic.beliefs = [...beliefs.values()].filter(belief => belief.view);
    topic.beliefsSource = topic.beliefs.length ? key : null;
  }
}

export function buildKnowledge(rows) {
  const topics = new Map();
  const keys = Object.keys(rows).filter(key => Array.isArray(rows[key].value.认知));
  for (const key of keys.sort((a, b) => rows[a].floor - rows[b].floor)) {
    for (const contribution of knowledgeContributions(key, rows[key])) {
      const { id } = contribution;
      if (!topics.has(id)) topics.set(id, newKnowledge(contribution));
      applyKnowledge(topics.get(id), contribution);
    }
  }
  return [...topics.values()];
}

function contributionOrder(a, b) {
  return a.floor - b.floor || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || a.index - b.index;
}

// Changing existing history replays the affected item only. Ordered appends add one contribution to its current state.
function createContributionIndex(collect, initialize, copy, apply, present) {
  const sources = new Map();
  const items = new Map();
  const ordered = [];
  let snapshot = [], applied = 0, replayed = 0;

  function clear() {
    sources.clear();
    items.clear();
    ordered.length = 0;
    snapshot = [];
  }

  function position(order) {
    let start = 0, end = ordered.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (contributionOrder(ordered[middle].order, order) < 0) start = middle + 1;
      else end = middle;
    }
    return start;
  }

  function update(changes) {
    const affected = new Map();
    function change(id) {
      if (!affected.has(id)) affected.set(id, { removed: false, added: [] });
      return affected.get(id);
    }

    for (const [key, row] of changes) {
      const previous = sources.get(key);
      if (previous && row && previous.row.floor === row.floor && previous.row.value === row.value) continue;
      if (previous) {
        for (const id of previous.ids) {
          items.get(id).bySource.delete(key);
          change(id).removed = true;
        }
        sources.delete(key);
      }
      if (!row) continue;
      const ids = new Set();
      for (const contribution of collect(key, row)) {
        const { id } = contribution;
        ids.add(id);
        if (!items.has(id)) items.set(id, { bySource: new Map() });
        const { bySource } = items.get(id);
        if (!bySource.has(key)) bySource.set(key, []);
        bySource.get(key).push(contribution);
        change(id).added.push(contribution);
      }
      sources.set(key, { row, ids });
    }

    if (!affected.size) return snapshot;
    for (const [id, { removed, added }] of affected) {
      const item = items.get(id);
      const previous = item.result;
      if (!item.bySource.size) {
        if (previous) ordered.splice(position(previous.order), 1);
        items.delete(id);
        continue;
      }
      added.sort(contributionOrder);
      const append = !removed && item.last && contributionOrder(item.last, added[0]) < 0;
      const patches = append ? added : [...item.bySource.values()].flat().sort(contributionOrder);
      if (!append && item.state) replayed++;
      const state = append ? copy(item.state) : initialize(patches[0]);
      for (const contribution of patches) apply(state, contribution);
      applied += patches.length;
      item.last = lastItem(patches);
      item.state = state;
      item.first = append ? item.first : patches[0];
      item.result = present(state, item.first);
      if (previous && item.result && !contributionOrder(previous.order, item.result.order)) {
        ordered[position(previous.order)] = item.result;
      } else {
        if (previous) ordered.splice(position(previous.order), 1);
        if (item.result) ordered.splice(position(item.result.order), 0, item.result);
      }
    }
    snapshot = ordered.map(item => item.value);
    return snapshot;
  }

  function build(rows) {
    function* changes() {
      for (const key of Object.keys(rows)) yield [key, rows[key]];
      for (const key of sources.keys()) if (!hasOwn(rows, key)) yield [key, null];
    }
    return update(changes());
  }

  return { build, update, clear, info: () => ({ sources: sources.size, items: items.size, applied, replayed }) };
}

export function createKnowledgeAccumulator() {
  return createContributionIndex(knowledgeContributions, newKnowledge,
    state => ({ ...state, sources: state.sources.slice() }), applyKnowledge,
    (value, order) => ({ value, order }));
}
