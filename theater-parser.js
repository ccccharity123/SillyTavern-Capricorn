import { compositions } from './theater-scenography.js';
import { hasOwn } from './compat.js';
import { legacyData } from './theater-legacy.js';
import { START, theaterBlock } from './theater-payload.js';
import { validateBranch } from './theater-flow.js';
import { themes } from './theater-theme.js';

export const moduleNames = { scene: '场景探索', phone: '仿真手机', objects: '物件互动', random: '随机事件', game: '小游戏', talk: '对话回放', views: '多视角' };
export const appNames = { chat: '聊天', photos: '相册', notes: '备忘录', calls: '通话', calendar: '日历', mail: '邮件', files: '文件', music: '音乐' };
export const objectNames = {
  clue: '查看', letter: '展开信件', diary: '打开日记', album: '翻开相册',
  drawer: '打开抽屉', gift: '打开礼物盒', recorder: '播放文字记录',
  dossier: '拆开档案袋', lock: '检查锁', puzzle: '展开拼图', wheel: '查看转盘',
  note: '揭开便签', collection: '打开收集册', use: '使用物品', combine: '组合物品',
  lever: '拨动开关', lamp: '检查灯具', slot: '检查机关',
};

const own = (catalog, value) => typeof value === 'string' && hasOwn(catalog, value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit = 700) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(value) && value;
const invalid = () => { throw new Error('invalid-data'); };
function list(value, limit, map, min = 0) {
  if (value === undefined && !min) return [];
  if (!Array.isArray(value) || value.length > limit || value.length < min) invalid();
  return value.map(map);
}
function ids(value, min = 0, max = 16) {
  const result = list(value, max, entry => id(entry) || invalid(), min);
  if (new Set(result).size !== result.length) invalid();
  return result;
}
function label(value) { return text(value, 80) || invalid(); }
function item(value) {
  if (!object(value)) invalid();
  return { id: id(value.id) || invalid(), label: label(value.label), text: text(value.text) };
}
const tokenId = '[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}';
const flagCondition = new RegExp('^' + tokenId + '\\.' + tokenId + '=' + tokenId + '$');
const logCondition = new RegExp('^@' + tokenId + '(/' + tokenId + ')?$');
const spaces = ['room', 'bench', 'garden', 'control', 'street', 'study', 'shop', 'wild'];

function conditions(value, branch) {
  return branch ? list(value, 8, token => typeof token === 'string' &&
    (flagCondition.test(token) || logCondition.test(token)) ? token : invalid()) : [];
}

function variables(value, prefix = '') {
  if (value === undefined) return {};
  if (!object(value) || Object.keys(value).length > 8) invalid();
  return Object.fromEntries(Object.entries(value).map(([key, val]) =>
    id(key) && id(val) ? [prefix + key, val] : invalid()));
}

function toolIds(value, kind, optional = false) {
  const count = kind === 'use' ? 1 : kind === 'combine' ? 2 : 0;
  if (!count || optional && value === undefined) return [];
  return ids(value, count, count);
}

function expandProp(value) {
  if (!Array.isArray(value) || value.length < 4 || value.length > 5 || value[4] !== undefined && !object(value[4])) invalid();
  const [propId, kind, name, description, options] = value;
  return { ...options, id: propId, kind, label: name, text: description };
}

function action(value, options, implicitKind) {
  const base = item(value);
  const kind = implicitKind || (own(objectNames, value.kind) ? value.kind : 'clue');
  const { branch, scope } = options;
  const routes = branch ? list(value.routes, 4, route => {
    if (!object(route) || !id(route.id)) invalid();
    return {
      id: route.id, tools: toolIds(route.tools ?? value.tools, kind), give: ids(route.give),
      need: ids(route.need), when: conditions(route.when, branch), text: text(route.text),
      set: variables(route.set, scope + '.'),
    };
  }) : [];
  if (routes.length && (implicitKind || new Set(routes.map(route => route.id)).size !== routes.length)) invalid();
  const tools = toolIds(value.tools, kind, routes.length > 0);
  const pages = list(value.pages, 8, page => text(page) || invalid());
  if (!base.text && !pages.length && (!routes.length || !routes.every(route => route.text))) invalid();
  const at = Array.isArray(value.at) && value.at.length === 2 &&
    value.at.every(number => Number.isInteger(number) && number >= 1 && number <= 3) ? value.at : null;
  const signal = branch && value.signal !== undefined ? value.signal : '';
  if (signal && (typeof signal !== 'string' || !flagCondition.test(signal) || !signal.startsWith(scope + '.'))) invalid();
  return { ...base, kind, pages, tools, at, need: ids(value.need), give: ids(value.give),
    when: conditions(value.when, branch), set: branch ? variables(value.set, scope + '.') : {},
    routes, branch, signal,
    scale: ['hero', 'small'].includes(value.scale) ? value.scale : '',
    alert: branch ? conditions(value.alert === undefined ? undefined : [value.alert], branch)[0] : undefined };

}
function normalizeGame(value, options) {
  if (!object(value)) invalid();
  const mode = value.mode;
  const game = action(value, options, 'game');
  if (mode === 'code') {
    if (typeof value.answer !== 'string' || !/^\d{2,8}$/.test(value.answer)) invalid();
    return { ...game, mode, answer: value.answer };
  }
  if (mode !== 'order' && mode !== 'choose') invalid();
  const choices = list(value.choices, 8, label, 2);
  if (new Set(choices).size !== choices.length) invalid();
  const answer = list(value.answer, choices.length, x =>
    Number.isInteger(x) && x >= 0 && x < choices.length ? x : invalid(), mode === 'order' ? choices.length : 1);
  if (new Set(answer).size !== answer.length) invalid();
  return { ...game, mode, choices, answer };
}
function normalizeModule(value, branch) {
  if (!object(value) || !own(moduleNames, value.type)) invalid();
  const base = { ...item(value), type: value.type, need: ids(value.need),
    when: conditions(value.when, branch), vars: branch ? variables(value.vars) : {} };
  const options = { branch, scope: base.id };
  if (base.type === 'phone') {
    const apps = list(value.apps, 8, app => {
      if (!object(app) || !own(appNames, app.kind)) invalid();
      return { ...item({ ...app, label: app.label ?? appNames[app.kind] }), kind: app.kind,
        need: ids(app.need), when: conditions(app.when, branch), entries: list(app.entries, 10, entry => action(entry, options, 'entry'), 1) };
    }, 1);
    return { ...base, apps };
  }
  if (base.type === 'random') {
    const mode = ['draw', 'dice', 'event'].includes(value.mode) ? value.mode : 'draw';
    const repeat = mode === 'dice' || value.repeat === true;
    const results = list(value.results, mode === 'dice' ? 6 : 12, result => {
      const entry = action(result, options, 'result');
      if (entry.need.length || entry.when.length || entry.pages.length) invalid();
      const rarity = ['common', 'rare', 'epic'].includes(result.rarity) ? result.rarity : 'common';
      return { ...entry, rarity };
    }, mode === 'dice' ? 6 : 2);
    return { ...base, mode, repeat, results };
  }
  if (base.type === 'game') return { ...base, game: normalizeGame(value.game, options) };
  // RC23: dialogue replay and multi-perspective modules reuse the action pipeline.
  if (base.type === 'talk') return { ...base, speaker: text(value.speaker, 24), prompt: text(value.prompt, 400),
    actions: list(value.lines, 8, entry => action(entry, options, 'line'), 1) };
  if (base.type === 'views') return { ...base, actions: list(value.views, 6, entry => action(entry, options, 'view'), 1) };
  if (value.props !== undefined && value.actions !== undefined) invalid();
  const entries = value.props === undefined ? value.actions : list(value.props, 12, expandProp, 1);
  const view = own(compositions, value.view) ? value.view : '';
  const cues = Object.fromEntries((compositions[view] ?? []).flatMap(key => {
    const token = value.cues?.[key];
    return branch && token !== undefined ? [[key, conditions([token], branch)[0]]] : [];
  }));
  return { ...base, view, cues, space: spaces.includes(value.space) ? value.space : value.type === 'objects' ? 'bench' : 'room',
    actions: list(entries, 12, entry => action(entry, options), 1) };
}

function graph(module) {
  if (module.type === 'phone') return module.apps.flatMap(app => app.entries.map(entry =>
    ({ entry, parents: [module, app] })));
  return (module.actions ?? module.results ?? [module.game]).map(entry => ({ entry, parents: [module] }));
}

function validate(data) {
  const inventory = new Set(data.items.map(item => item.id));
  if (inventory.size !== data.items.length) invalid();
  const keys = new Set();
  function unique(value) {
    if (keys.has(value.id)) invalid();
    keys.add(value.id);
  }
  for (const module of data.modules) {
    unique(module);
    module.apps?.forEach(unique);
  }
  data.endings.forEach(unique);
  const graphSteps = data.modules.flatMap(graph);
  graphSteps.forEach(({ entry }) => unique(entry));
  if (data.flow) return validateBranch(data, graphSteps, inventory);
  const steps = graphSteps.map(({ entry, parents }) =>
    ({ ...entry, need: [...parents.flatMap(parent => parent.need), ...entry.need, ...entry.tools] }));
  if ([...steps, ...data.endings].some(step =>
    [...step.need, ...(step.give || [])].some(key => !inventory.has(key)))) invalid();
  const reached = new Set(), played = new Set();
  for (;;) {
    const before = played.size;
    for (const step of steps) {
      if (!step.need.every(key => reached.has(key))) continue;
      played.add(step.id);
      step.give.forEach(key => reached.add(key));
    }
    if (before === played.size) break;
  }
  // Every authored step, reward and ending has a path. Runtime never consumes rewards.
  if (played.size !== steps.length || reached.size !== inventory.size ||
      data.endings.some(ending => !ending.need.every(key => reached.has(key)))) invalid();
  return data;
}

function versionTwo(raw) {
  const theme = own(themes, raw.theme) && raw.theme !== 'auto' ? raw.theme : 'cozy';
  const flow = raw.flow === true;
  return validate({
    version: 2, flow, id: id(raw.id) || '', title: text(raw.title, 65) || '幕间小剧场',
    description: text(raw.description, 480), theme,
    items: list(raw.items, 32, item),
    modules: list(raw.modules, 8, module => normalizeModule(module, flow), 1),
    endings: list(raw.endings, 6, value => {
      const ending = item(value);
      if (!ending.text) invalid();
      return { ...ending, need: ids(value.need, flow ? 0 : 1), when: conditions(value.when, flow), hidden: value.hidden === true };
    }),
  });
}

export function inspectTheater(source) {
  const text = String(source ?? '');
  let block, offset = -1;
  for (let i = text.indexOf(START); i >= 0; i = text.indexOf(START, block.end)) {
    offset = i;
    block = theaterBlock(text, i);
  }
  if (!block) return { status: 'absent' };
  const result = { status: 'format', ...block, offset, fingerprint: text.slice(offset, block.end) };
  if (block.incomplete) return result;
  try {
    const raw = JSON.parse(block.payload);
    if (!object(raw)) return result;
    if (raw.version === 2) return { ...result, status: 'ok', data: versionTwo(raw) };
    if (raw.version != null && raw.version !== 1) return result;
    const data = legacyData(raw);
    return data ? { ...result, status: 'ok', data } : { ...result, status: 'legacy' };
  } catch { return result; }
}
export const parseTheater = source => inspectTheater(source).data ?? null;
