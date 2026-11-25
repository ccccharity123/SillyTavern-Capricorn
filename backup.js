import { getChatIdentity, getHostContext } from './host-context.js';

const FORMAT = 'capricorn-backup';
const MUSIC_KEY = 'sound_isle_v01_library';
const APPEARANCE_KEY = 'capricorn_appearance_v1';
const THEME_KEY = 'capricorn_theme';
const sourceKey = /^([0-9]+):([a-f0-9]{8})$/i;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const has = (object, key) => Object.hasOwn(object, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string';
const nonemptyText = value => text(value) && value.length > 0;
const number = value => Number.isFinite(value);
const boolean = value => typeof value === 'boolean';
const strings = value => Array.isArray(value) && value.every(text);

function requireValue(valid, message) {
  if (!valid) throw Error(message);
}

function dictionary(value, convert, label) {
  if (value === undefined) return {};
  requireValue(record(value), `${label}格式无效`);
  return Object.fromEntries(Object.entries(value).map(([key, row]) => {
    requireValue(nonemptyText(key) && !forbidden.has(key), `${label}标识无效`);
    return [key, convert(row, key)];
  }));
}

function list(value, convert, label) {
  if (value === undefined) return [];
  requireValue(Array.isArray(value), `${label}格式无效`);
  return value.map(convert);
}

function fields(value, schema, label) {
  if (value === undefined) return {};
  requireValue(record(value), `${label}格式无效`);
  const output = {};
  for (const [key, validate] of Object.entries(schema)) {
    if (!has(value, key) || value[key] === undefined) continue;
    requireValue(validate(value[key]), `${label}字段无效（${key}）`);
    output[key] = value[key];
  }
  return output;
}

function keyedSource(value, key) {
  requireValue(record(value) && (value.title === undefined || text(value.title)) && text(value.content), '摘要格式无效');
  const match = key.match(sourceKey);
  if (match) {
    const floor = Number(match[1]);
    requireValue(Number.isSafeInteger(floor) && (value.sourceMessage == null || value.sourceMessage === floor)
      && (value.sourceHash == null || value.sourceHash === match[2]), '摘要来源与标识不一致');
  } else {
    requireValue(value.sourceMessage == null && !/^\d+:/.test(key), '摘要缺少有效来源');
  }
  const row = fields(value, {
    title: text, content: text, storyTime: value => value === null || text(value),
    createdAt: text, savedAt: text, kind: text, deletedAt: text,
  }, '摘要');
  row.title ??= '';
  if (match) return { ...row, sourceMessage: Number(match[1]), sourceHash: match[2] };
  return row;
}

function archiveData(input = {}) {
  requireValue(record(input), '剧情档案格式无效');
  return {
    meta: dictionary(input.meta, row => fields(row, { star: boolean, chapter: text }, '剧情便签'), '剧情便签'),
    history: dictionary(input.history, (rows, key) => list(rows, row => keyedSource(row, key), '摘要历史'), '摘要历史'),
    trash: dictionary(input.trash, keyedSource, '摘要回收站'),
    dossier: list(input.dossier, row => {
      requireValue(record(row) && nonemptyText(row.id) && !forbidden.has(row.id) && text(row.title), '手动档案格式无效');
      return fields(row, { id: text, kind: text, title: text, people: text, status: text, body: text, sources: strings, updatedAt: text }, '手动档案');
    }, '手动档案'),
    traceHidden: dictionary(input.traceHidden, marked => {
      requireValue(boolean(marked), '档案隐藏标记无效');
      return marked;
    }, '档案隐藏标记'),
    weavePins: list(input.weavePins, value => {
      requireValue(nonemptyText(value), '档案星标无效');
      return value;
    }, '档案星标'),
  };
}

export function memoryBackupSnapshot(scope, input) {
  requireValue(nonemptyText(scope) && record(input), '记忆备份缺少聊天标识或数据');
  return { scope, data: {
    records: dictionary(input.records, keyedSource, '摘要'),
    deletedKeys: dictionary(input.deletedKeys, marked => {
      requireValue(boolean(marked), '摘要删除标记无效');
      return marked;
    }, '摘要删除标记'),
    archiveUI: archiveData(input.archiveUI),
    settings: fields(input.settings, {
      start: nonemptyText, end: nonemptyText, keep: number, storyYear: value => text(value) || number(value),
      weaveMode: value => ['archive', 'compact', 'smart', 'deep'].includes(value),
      weaveBudget: number, weaveKinds: strings,
      summaryMode: value => ['auto', 'legacy', 'unified', 'local', 'enhanced'].includes(value), engine: value => ['classic', 'hybrid'].includes(value),
      adaptive: boolean, layers: boolean, modeAdvice: boolean,
    }, '拾忆设置'),
  } };
}

function safeWebUrl(value) {
  if (value === '') return true;
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function track(row) {
  requireValue(record(row) && text(row.title) && text(row.artist), '歌曲格式无效');
  const data = fields(row, {
    id: nonemptyText, title: text, artist: text, neteaseId: value => text(value) || number(value),
    audioUrl: safeWebUrl, coverUrl: safeWebUrl, metadataSource: text, metadataTitle: text,
    metadataArtist: text, metadataUrl: safeWebUrl, previewUrl: safeWebUrl, added: number, at: number,
    autoMatchDisabled: boolean,
    source: value => value === null || record(value),
  }, '歌曲');
  if (data.source) data.source = fields(data.source, { chat: text, character: text, floor: value => text(value) || number(value) }, '歌曲来源');
  return { ...data, id: data.id ?? `${data.title}|${data.artist}`.trim().toLocaleLowerCase().replace(/\s+/g, ' ') };
}

function musicData(input) {
  requireValue(record(input) && record(input.playlists), '音乐库格式无效');
  requireValue(input.version === undefined || input.version === 1, '音乐库版本不受支持');
  const settings = fields(input.settings, {
    playMode: value => ['order', 'shuffle', 'one'].includes(value), volume: value => number(value) && value >= 0 && value <= 1,
    preferredQuality: text, position: value => record(value) && text(value.left) && text(value.top),
  }, '声屿设置');
  if (settings.position) settings.position = { left: settings.position.left, top: settings.position.top };
  return {
    version: 1,
    playlists: dictionary(input.playlists, (row, key) => {
      requireValue(record(row) && row.id === key && text(row.name) && Array.isArray(row.songs), '歌单格式无效');
      return { ...fields(row, { id: text, name: text, kind: text, created: number }, '歌单'), songs: row.songs.map(track) };
    }, '歌单'),
    favorites: list(input.favorites, row => {
      if (nonemptyText(row)) return row;
      return track(row);
    }, '收藏歌曲'),
    recent: list(input.recent, track, '最近播放'),
    settings,
  };
}

function appearanceData(input) {
  if (input == null) return null;
  return fields(input, {
    material: text, playerTheme: text, playerBgColor: text, bgSource: text, coverShape: text,
    coverSize: number, coverPadding: number, coverOpacity: number, coverFit: text, coverPlate: text,
    coverRadius: number, coverBorder: number, coverBorderColor: text, coverBorderStyle: text,
    coverShadow: number, bgSaturation: number, bgShade: number, playerBgOpacity: number, playerBgBlur: number,
    playerIslandCss: text, playerThemeCss: text, playerCustomCss: text, sharedFontId: text,
    noteFontId: text, paper: text, paperMode: text, paperPattern: text, noteDecor: text, side: text, note: text, custom: text,
  }, '外观');
}

function themeData(value) {
  requireValue(value == null || ['auto', 'light', 'dark'].includes(value), '外观主题无效');
  return value ?? null;
}

function v1ChatRecords(memory) {
  if (memory.entries == null) return {};
  requireValue(Array.isArray(memory.entries), '旧版世界书备份格式无效');
  const rows = {};
  for (const entry of memory.entries) {
    if (entry?.extra?.shiyi_chat !== memory.scope) continue;
    const legacyKey = entry.extra.shiyi_key;
    if (typeof legacyKey === 'string' && sourceKey.test(legacyKey) && !has(rows, legacyKey)) {
      rows[legacyKey] = keyedSource({
        title: entry.name,
        content: entry.content,
        sourceMessage: entry.extra.shiyi_message_id,
      }, legacyKey);
    }
    for (const [key, row] of Object.entries(dictionary(entry.extra.shiyi_rows, keyedSource, '旧版世界书摘要'))) {
      if (!has(rows, key)) rows[key] = row;
    }
  }
  return rows;
}

function payload(input, fromLegacy = false) {
  let memory = null;
  if (input.memory != null) {
    requireValue(record(input.memory) && record(input.memory.data), '拾忆备份格式无效');
    memory = memoryBackupSnapshot(input.memory.scope, input.memory.data);
    if (fromLegacy) memory.data.records = { ...v1ChatRecords(input.memory), ...memory.data.records };
  }
  return { memory, music: input.music == null ? null : musicData(input.music),
    appearance: appearanceData(input.appearance), theme: themeData(input.theme) };
}

export function createBackup(input) {
  return { format: FORMAT, version: 2, created: new Date().toISOString(), ...payload(input) };
}

export function parseBackup(input) {
  const data = JSON.parse(input, (key, value) => {
    requireValue(!forbidden.has(key), '备份含不安全的字段名');
    return value;
  });
  requireValue(record(data) && data.format === FORMAT && [1, 2].includes(data.version), '不支持的摩羯座备份');
  return payload(data, data.version === 1);
}

function appendMissing(current = [], incoming, key) {
  const known = new Set(current.map(key));
  return current.concat(incoming.filter(row => {
    const id = key(row);
    if (known.has(id)) return false;
    known.add(id);
    return true;
  }));
}

export function mergeMemoryBackup(current, incoming) {
  const data = memoryBackupSnapshot('restore', incoming).data;
  const existingRecords = current.records || {};
  const deleted = current.deletedKeys || {};
  const oldArchive = current.archiveUI || {};
  const newArchive = data.archiveUI;
  const records = { ...existingRecords };
  for (const [key, row] of Object.entries(data.records)) {
    if (!has(records, key) && !deleted[key]) records[key] = row;
  }
  const deletedKeys = { ...deleted };
  for (const [key, marked] of Object.entries(data.deletedKeys)) {
    if (!has(deletedKeys, key) && !has(existingRecords, key)) deletedKeys[key] = marked;
  }
  const history = { ...oldArchive.history };
  for (const [key, rows] of Object.entries(newArchive.history)) {
    history[key] = appendMissing(history[key], rows, row => JSON.stringify([row.savedAt, row.title, row.content]));
  }
  const meta = { ...oldArchive.meta };
  for (const [key, row] of Object.entries(newArchive.meta)) meta[key] = { ...row, ...meta[key] };
  return {
    ...current,
    records,
    deletedKeys,
    settings: { ...data.settings, ...current.settings },
    archiveUI: {
      ...oldArchive,
      meta,
      history,
      trash: { ...newArchive.trash, ...oldArchive.trash },
      dossier: appendMissing(oldArchive.dossier, newArchive.dossier.filter(row => !oldArchive.traceHidden?.[row.id]), row => row.id),
      traceHidden: { ...newArchive.traceHidden, ...oldArchive.traceHidden },
      weavePins: appendMissing(oldArchive.weavePins, newArchive.weavePins, value => value),
    },
  };
}

export async function restoreMemoryBackup(payload, { getIdentity, read, write, persist }) {
  const identity = getIdentity();
  requireValue(identity.scope && [identity.scope, identity.legacyScope].includes(payload.scope), '记忆备份属于另一个聊天');
  const check = () => requireValue(getIdentity().scope === identity.scope, '聊天已切换，请重试');
  const current = read();
  const before = JSON.stringify(current);
  const next = mergeMemoryBackup(current, payload.data);
  const expected = JSON.stringify(next);
  const recordsAdded = Object.keys(next.records).length - Object.keys(current.records || {}).length;
  const conflicts = Object.entries(payload.data.records || {}).filter(([key, row]) => {
    const existing = current.records?.[key];
    return current.deletedKeys?.[key] || (existing && (existing.title !== row.title || existing.content !== row.content));
  }).length;
  if (before === expected) return { changed: false, recordsAdded, conflicts };
  check();
  try {
    await write(next);
    check();
    requireValue(JSON.stringify(read()) === expected, '记忆恢复写入未确认');
    await persist?.();
    check();
    requireValue(JSON.stringify(read()) === expected, '保存期间记忆已变化，请核对后重试');
  } catch (error) {
    if (getIdentity().scope === identity.scope && JSON.stringify(read()) === expected) {
      try {
        await write(JSON.parse(before));
        check();
        requireValue(JSON.stringify(read()) === before, '记忆恢复回滚未确认');
        await persist?.();
        check();
      } catch {
        throw Error(`${error.message}；记忆恢复回滚失败`);
      }
    }
    throw error;
  }
  return { changed: true, recordsAdded, conflicts };
}

function helperMethod(window, key) {
  const source = typeof window.TavernHelper?.[key] === 'function' ? window.TavernHelper : window;
  return typeof source[key] === 'function' ? source[key].bind(source) : null;
}

function memoryAccess(window) {
  const get = helperMethod(window, 'getVariables');
  if (!get) return null;
  const write = helperMethod(window, 'replaceVariables');
  const options = { type: 'chat' };
  const vars = () => get(options) || {};
  return {
    getIdentity: () => getChatIdentity(getHostContext(window)),
    read: () => vars().shiyi_v01 || {},
    write: data => {
      requireValue(write, '酒馆助手未就绪，无法恢复当前聊天记忆');
      return write({ ...vars(), shiyi_v01: data }, options);
    },
    persist() {
      const context = getHostContext(window);
      return context.saveMetadata?.();
    },
  };
}

export function readStoredMemory(window) {
  const identity = getChatIdentity(getHostContext(window));
  if (!identity.scope) return null;
  const access = memoryAccess(window);
  return access ? memoryBackupSnapshot(identity.scope, access.read()) : null;
}

export async function restoreStoredMemory(window, payload) {
  const access = memoryAccess(window);
  requireValue(access, '酒馆助手未就绪，无法恢复当前聊天记忆');
  return restoreMemoryBackup(payload, access);
}

export function mergeMusicBackup(current, incoming) {
  const data = musicData(incoming);
  const playlists = { ...current.playlists };
  for (const [id, playlist] of Object.entries(data.playlists)) {
    if (!has(playlists, id)) {
      playlists[id] = { ...playlist, songs: appendMissing([], playlist.songs, song => song.id) };
      continue;
    }
    const old = playlists[id];
    playlists[id] = { ...old, songs: appendMissing(old.songs, playlist.songs, song => song.id) };
  }
  return {
    ...current,
    version: 1,
    playlists,
    favorites: appendMissing(current.favorites, data.favorites, row => text(row) ? row : row.id),
    recent: appendMissing(current.recent, data.recent, row => row.id),
    processed: current.processed || {},
    settings: { ...data.settings, ...current.settings },
  };
}

export function readStoredMusic(storage) {
  const source = storage.getItem(MUSIC_KEY);
  if (source === null) return null;
  const value = JSON.parse(source);
  musicData(value);
  return value;
}

function musicHasChanged(stored, current) {
  const defaults = { version: 1, favorites: [], recent: [], processed: {}, settings: {} };
  const left = { ...defaults, ...stored };
  const right = { ...defaults, ...current };
  return Object.keys(left).length !== Object.keys(right).length ||
    Object.keys(left).some(key => !has(right, key) || JSON.stringify(left[key]) !== JSON.stringify(right[key]));
}

export function commitMusicBackup(storage, current, incoming) {
  // Refuse to overwrite a stored library that failed to load in the UI.
  const stored = readStoredMusic(storage);
  requireValue(!stored || !musicHasChanged(stored, current), '音乐库已变化，请刷新页面后重试');
  const next = mergeMusicBackup(current, incoming);
  if (JSON.stringify(next) === JSON.stringify(current)) return current;
  const recoveryKey = 'sound_isle_before_import_backup';
  const previous = storage.getItem(recoveryKey);
  storage.setItem(recoveryKey, JSON.stringify({ at: Date.now(), db: stored ?? current }));
  try { storage.setItem(MUSIC_KEY, JSON.stringify(next)); }
  catch (error) {
    if (previous === null) storage.removeItem(recoveryKey);
    else storage.setItem(recoveryKey, previous);
    throw error;
  }
  return next;
}

export function restoreStoredMusic(storage, input) {
  return commitMusicBackup(storage, readStoredMusic(storage) ?? { version: 1, playlists: {}, favorites: [], recent: [], processed: {}, settings: {} }, input);
}

export function restoreAppearanceBackup(storage, { appearance, theme }) {
  const oldAppearance = storage.getItem(APPEARANCE_KEY);
  const oldTheme = storage.getItem(THEME_KEY);
  const current = oldAppearance === null ? {} : JSON.parse(oldAppearance);
  requireValue(record(current), '当前外观设置无法读取');
  const next = { ...appearanceData(appearance), ...current };
  const appearanceChanged = JSON.stringify(next) !== JSON.stringify(current);
  const nextTheme = oldTheme === null ? themeData(theme) : oldTheme;
  try {
    if (appearanceChanged) storage.setItem(APPEARANCE_KEY, JSON.stringify(next));
    if (nextTheme !== oldTheme) storage.setItem(THEME_KEY, nextTheme);
  } catch (error) {
    if (appearanceChanged && storage.getItem(APPEARANCE_KEY) === JSON.stringify(next)) {
      if (oldAppearance === null) storage.removeItem(APPEARANCE_KEY);
      else storage.setItem(APPEARANCE_KEY, oldAppearance);
    }
    throw error;
  }
  return { changed: appearanceChanged || nextTheme !== oldTheme, theme: nextTheme };
}
