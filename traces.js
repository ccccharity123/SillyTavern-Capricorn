export const normalize=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu,'');
export function fuzzy(text,q){const t=normalize(text);return String(q??'').trim().split(/\s+/).every(w=>{const n=normalize(w);if(!n||t.includes(n))return true;if(n.length<4)return false;let i=0;for(const c of t)if(c===n[i])i++;return i===n.length;});}
export function table(text){const m=[...String(text).matchAll(/<(table|摩羯留痕)\s*>\s*([\s\S]*?)<\/\1\s*>/g)].pop();if(!m)return null;try{const v=JSON.parse(m[2].trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));return v&&typeof v==='object'&&!Array.isArray(v)?v:null;}catch{return null;}}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' ? value.trim() : '';
const exactName = value => string(value).normalize('NFKC');
const describe = value => Array.isArray(value) ? value.join('、') : String(value);
const restrictedFields = ['认知', '秘密', '客观事实', '人物认知', '知情者', '知情人'];
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const isRestricted = row => (Object.hasOwn(row, '公开') && row.公开 !== true) ||
  restrictedFields.some(field => Object.hasOwn(row, field));
const pastFrames = new Set(['过去', '倒叙', '回忆', '历史']);

function temporalFrame(row, tableValue) {
  if (Object.hasOwn(row, '叙事时态')) return string(row.叙事时态) || '未确认';
  if (Object.hasOwn(tableValue, '叙事时态')) return string(tableValue.叙事时态) || '未确认';
  return '当前';
}

const isCurrentFrame = frame => frame === '当前' || frame === '现在';

export function traces(messages, records, hash, hidden = {}) {
  const entities = new Map();
  const historyById = new Map();
  const restrictedIds = new Set();
  for (const message of [...messages].sort((a, b) => a.message_id - b.message_id)) {
    const key = `${message.message_id}:${hash(String(message.message ?? ''))}`;
    if (!records[key]) continue;
    const value = records[key].value ?? table(message.message);
    if (!value) continue;
    for (const kind of ['人物', '关系', '事件', '物品', '伏笔', '成长', '地点']) {
      if (!Array.isArray(value[kind])) continue;
      for (const row of value[kind]) {
        if (!record(row)) continue;
        const people = Array.isArray(row.人物) ? row.人物.filter(person => typeof person === 'string') : [];
        const title = String(row.姓名 || row.名称 || (kind === '关系' ? people.slice().sort().join(' × ') : '')).trim();
        if (!title) continue;
        const id = `trace:${kind}:${normalize(title)}`;
        const frame = temporalFrame(row, value);
        const current = isCurrentFrame(frame);
        if (hidden[id] || !current && !pastFrames.has(frame)) continue;
        if (isRestricted(row)) {
          if (current) {
            entities.delete(id);
            historyById.delete(id);
            restrictedIds.add(id);
          }
          continue;
        }
        if (restrictedIds.has(id)) {
          if (!current || row.公开 !== true) continue;
          restrictedIds.delete(id);
        }
        const fields = Object.entries(row).filter(([key]) => key !== '叙事时态' && !unsafeKeys.has(key));
        if (!historyById.has(id)) historyById.set(id, { sources: new Set(), lines: [] });
        const history = historyById.get(id);
        history.sources.add(key);
        const when = string(row.时间) || string(value.时间);
        const label = current && !when ? '' : `｜${frame}${when ? ` · ${when}` : ''}`;
        history.lines.push(`${message.message_id}楼${label}：${fields.map(([name, content]) => `${name}：${describe(content)}`).join('；')}`);
        if (!current) continue;
        if (!entities.has(id)) {
          entities.set(id, { id, kind, title, people: '', auto: true, fields: {}, stateFloor: message.message_id });
        }
        const entry = entities.get(id);
        for (const [name, content] of fields) {
          if (typeof content === 'string' && content.trim()) entry.fields[name] = content;
          if (Array.isArray(content) && content.every(item => typeof item === 'string')) {
            const previous = name === '别名' && Array.isArray(entry.fields[name]) ? entry.fields[name] : [];
            entry.fields[name] = [...new Set([...previous, ...content])];
          }
        }
        if (string(row.状态)) entry.stateFloor = message.message_id;
        if (Array.isArray(row.人物) && people.length === row.人物.length) entry.people = people.join('、');
      }
    }
  }
  return [...entities.values()].map(entry => {
    const history = historyById.get(entry.id);
    return {
      ...entry,
      sources: [...history.sources],
      history: history.lines,
      status: entry.fields.状态 || '',
      body: Object.entries(entry.fields).map(([key, value]) => `${key}：${describe(value)}`).join('\n') +
        '\n\n变化记录\n' + history.lines.join('\n'),
    };
  });
}

export function buildKnowledge(rows) {
  const topics = new Map();
  const relevant = Object.values(rows).filter(({ value }) => Array.isArray(value.认知));
  for (const { floor, value } of relevant.sort((a, b) => a.floor - b.floor)) {
    for (const [index, patch] of value.认知.entries()) {
      if (!record(patch) || !isCurrentFrame(temporalFrame(patch, value))) continue;
      const name = exactName(patch.名称);
      if (!name) continue;
      if (!topics.has(name)) {
        topics.set(name, { id: `knowledge:${floor}:${index}`, title: name, fact: '', public: false, knowers: [], beliefs: [] });
      }
      const topic = topics.get(name);
      topic.floor = floor;
      if (Object.hasOwn(patch, '客观事实')) {
        const fact = string(patch.客观事实);
        if (topic.fact !== fact) {
          topic.fact = fact;
          topic.public = false;
          topic.knowers = [];
        }
      }
      if (Object.hasOwn(patch, '公开')) topic.public = patch.公开 === true;
      if (Object.hasOwn(patch, '知情者')) {
        topic.knowers = Array.isArray(patch.知情者) ? [...new Set(patch.知情者.map(exactName).filter(Boolean))] : [];
      }
      if (Object.hasOwn(patch, '人物认知')) {
        const beliefs = new Map();
        if (Array.isArray(patch.人物认知)) {
          for (const belief of patch.人物认知) {
            if (!record(belief)) continue;
            const character = exactName(belief.人物), view = string(belief.看法);
            if (character) beliefs.set(character, { character, view, topic: string(belief.主题) });
          }
        }
        topic.beliefs = [...beliefs.values()].filter(belief => belief.view);
      }
    }
  }
  return [...topics.values()];
}
