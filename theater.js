/* 摩羯座小剧场：只读取助手正文中的独立结构；没有任何剧情写入或消息发送。 */
import { getHostContext, getChatIdentity } from './host-context.js';

const START = '<cap-theater>', END = '</cap-theater>';
const memory = new Map();
const MAX_CACHE = 100;

function hash(value) {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return (n >>> 0).toString(36);
}
function short(value, n = 160) { return String(value ?? '').slice(0, n); }
function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = ['flip', 'reveal', 'slide'].includes(raw.type) ? raw.type : null;
  if (!type) return null;
  const title = short(raw.title || '今日小剧场', 65);
  const note = short(raw.note || '', 180);
  if (type === 'slide') {
    if (!Array.isArray(raw.steps)) return null;
    const steps = raw.steps.slice(0, 8).map(x => ({
      title: short(x?.title, 80), text: short(x?.text, 320), symbol: short(x?.symbol || '✦', 4),
    })).filter(x => x.title || x.text);
    return steps.length >= 2 ? { type, title, note, steps } : null;
  }
  if (!Array.isArray(raw.items)) return null;
  const items = raw.items.slice(0, 8).map(x => ({
    front: short(x?.front || x?.label || '翻开', 90), back: short(x?.back || x?.text || '', 350),
  })).filter(x => x.back);
  return items.length ? { type, title, note, items } : null;
}
export function parseTheater(source) {
  const str = String(source ?? '');
  const i = str.lastIndexOf(START);
  if (i < 0) return null;
  const j = str.indexOf(END, i + START.length);
  if (j < 0 || j - i > 14000) return null;
  try { return normalize(JSON.parse(str.slice(i + START.length, j).trim())); }
  catch { return null; }
}
// Hide the JSON payload that SillyTavern has already rendered as plain text.
// DOMPurify may strip unknown <cap-theater> tags, leaving the JSON visible.
// Work on text nodes, not innerHTML, to avoid disturbing user themes/formatting.
function hideRawTheater(target, source) {
  const start = source.lastIndexOf(START);
  if (start < 0) return false;
  const end = source.indexOf(END, start + START.length);
  if (end < 0) return false;
  const payload = source.slice(start + START.length, end).trim();
  if (!payload || payload.length > 14000) return false;

  // Some ST renderers preserve custom elements, others unwrap them.
  const wrappers = target.querySelectorAll('cap-theater');
  if (wrappers.length) {
    wrappers.forEach(node => node.remove());
    return true;
  }

  const walker = target.ownerDocument.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let textNode;
  while ((textNode = walker.nextNode())) {
    if (textNode.parentElement?.closest('.cap-theater-panel,script,style')) continue;
    nodes.push(textNode);
  }
  // Build a whitespace-insensitive stream with per-character DOM positions.
  // Markdown and sanitizer can split payload across arbitrary inline elements.
  const stream = [];
  const positions = [];
  for (const node of nodes) {
    const value = node.nodeValue || '';
    for (let i = 0; i < value.length; i++) {
      if (/\s/.test(value[i])) continue;
      stream.push(value[i]);
      positions.push([node, i]);
    }
  }
  const compact = stream.join('');
  const expected = payload.replace(/\s/g, '');
  let offset = compact.lastIndexOf(expected);
  if (offset < 0) return false;
  let from = offset, to = offset + expected.length;
  // Remove literal delimiters too, if the HTML renderer kept them as text.
  const startTag = START.replace(/\s/g, '');
  const endTag = END.replace(/\s/g, '');
  if (compact.slice(Math.max(0, from - startTag.length), from) === startTag) from -= startTag.length;
  if (compact.slice(to, to + endTag.length) === endTag) to += endTag.length;
  const first = positions[from], last = positions[to - 1];
  if (!first || !last) return false;
  const range = target.ownerDocument.createRange();
  range.setStart(first[0], first[1]);
  range.setEnd(last[0], last[1] + 1);
  range.deleteContents();
  return true;
}

function element(name, className = '', label = '') {
  const e = document.createElement(name);
  if (className) e.className = className;
  if (label) e.textContent = label;
  return e;
}
function load(key) {
  try { return JSON.parse(window.localStorage.getItem(key) || '{}'); } catch { return {}; }
}
function store(key, state) {
  try { window.localStorage.setItem(key, JSON.stringify(state)); } catch { /* private mode */ }
}
function renderActivity(frame, data, key) {
  const state = load(key);
  const body = element('div', 'cap-theater-body');
  const note = data.note && element('p', 'cap-theater-note', data.note);
  if (note) body.append(note);
  if (data.type === 'flip' || data.type === 'reveal') {
    const grid = element('div', `cap-theater-grid cap-theater-${data.type}`);
    data.items.forEach((item, index) => {
      const button = element('button', 'cap-theater-card');
      button.type = 'button';
      button.setAttribute('aria-pressed', state[index] ? 'true' : 'false');
      const front = element('span', 'cap-theater-front', item.front);
      const back = element('span', 'cap-theater-back', item.back);
      const show = () => {
        button.classList.toggle('cap-theater-uncovered', Boolean(state[index]));
        button.setAttribute('aria-pressed', state[index] ? 'true' : 'false');
        front.hidden = Boolean(state[index]);
        back.hidden = !state[index];
      };
      button.append(front, back);
      button.addEventListener('click', () => {
        state[index] = data.type === 'reveal' ? true : !state[index];
        store(key, state); show();
      });
      show(); grid.append(button);
    });
    body.append(grid);
  } else {
    const scene = element('div', 'cap-theater-slide-scene');
    const symbol = element('div', 'cap-theater-slide-symbol');
    const title = element('strong', 'cap-theater-slide-title');
    const text = element('p', 'cap-theater-slide-text');
    const stepCount = element('span', 'cap-theater-step-count');
    const range = element('input', 'cap-theater-range');
    range.type = 'range'; range.min = '0'; range.max = String(data.steps.length - 1);
    range.step = '1'; range.setAttribute('aria-label', '拖动探索小剧场');
    const prev = element('button', 'cap-theater-step-button', '‹');
    const next = element('button', 'cap-theater-step-button', '›');
    prev.type = next.type = 'button';
    const controls = element('div', 'cap-theater-slide-controls');
    const setIndex = x => {
      const index = Math.max(0, Math.min(data.steps.length - 1, Number(x) || 0));
      state.index = index; store(key, state);
      const step = data.steps[index];
      symbol.textContent = step.symbol; title.textContent = step.title; text.textContent = step.text;
      range.value = String(index); stepCount.textContent = `${index + 1} / ${data.steps.length}`;
      prev.disabled = index === 0; next.disabled = index === data.steps.length - 1;
    };
    range.addEventListener('input', () => setIndex(range.value));
    prev.addEventListener('click', () => setIndex((state.index ?? 0) - 1));
    next.addEventListener('click', () => setIndex((state.index ?? 0) + 1));
    scene.append(symbol, title, text); controls.append(prev, range, next, stepCount);
    body.append(scene, controls); setIndex(state.index || 0);
  }
  const foot = element('div', 'cap-theater-foot', '独立趣味片段 · 不影响正文与人物状态');
  body.append(foot);
  frame.append(body);
}

export function mountTheater({ doc = document, context = () => getHostContext(window), scope = () => getChatIdentity(context()).scope } = {}) {
  let destroyed = false, timer = 0, observer, events, eventTypes;
  const listeners = [];
  const hostChat = () => context()?.chat || [];
  function bind() {
    const c = context(), source = c?.eventSource, types = c?.eventTypes || c?.event_types;
    if (source === events) return;
    for (const unbind of listeners.splice(0)) unbind();
    events = source; eventTypes = types;
    if (!source?.on || !types) return;
    for (const name of ['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED', 'MESSAGE_UPDATED', 'GENERATION_ENDED']) {
      if (!types[name]) continue;
      const listener = () => schedule();
      source.on(types[name], listener);
      listeners.push(() => (source.off || source.removeListener)?.call(source, types[name], listener));
    }
  }
  function scan() {
    if (destroyed) return;
    bind();
    const chat = hostChat(), identity = scope();
    if (!Array.isArray(chat)) return;
    const nodes = doc.querySelectorAll('#chat .mes[mesid]');
    for (const node of nodes) {
      const id = Number(node.getAttribute('mesid'));
      const message = chat[id];
      const target = node.querySelector('.mes_text');
      const old = node.querySelector(':scope .cap-theater-panel');
      if (!message || message.is_user || message.is_system || !target) {
        old?.remove(); continue;
      }
      const source = String(message.mes ?? message.message ?? '');
      const mark = source.lastIndexOf(START);
      if (mark < 0) { old?.remove(); continue; }
      const token = hash(source.slice(mark));
      const unique = hash((identity || 'current-chat-session') + ':' + id + ':' + token);
      if (old?.dataset.key === unique) { hideRawTheater(target, source); continue; }
      old?.remove();
      let data = memory.get(token);
      if (!data) {
        data = parseTheater(source);
        if (!data) continue;
        memory.set(token, data);
        if (memory.size > MAX_CACHE) memory.delete(memory.keys().next().value);
      }
      const panel = element('details', 'cap-theater-panel');
      panel.dataset.key = unique;
      const heading = element('summary', 'cap-theater-heading');
      const star = element('span', 'cap-theater-star', '✧');
      const headingText = element('span', 'cap-theater-heading-text', data.title);
      const kind = element('span', 'cap-theater-kind', { flip: '翻牌', reveal: '揭示', slide: '探索' }[data.type]);
      heading.append(star, headingText, kind);
      panel.append(heading);
      renderActivity(panel, data, 'cap_theater_1:' + unique);
      hideRawTheater(target, source);
      target.append(panel);
    }
  }
  function schedule() {
    if (destroyed || timer) return;
    timer = window.setTimeout(() => { timer = 0; scan(); }, 180);
  }
  observer = new MutationObserver(mutations => {
    if (mutations.some(m => {
      const element = m.target?.nodeType === 1 ? m.target : m.target?.parentElement;
      if (element?.closest?.('.cap-theater-panel')) return false;
      if (m.type === 'characterData') return Boolean(element?.closest?.('#chat .mes_text'));
      return [...m.addedNodes].some(n => n.nodeType === 1 && (n.matches?.('.mes, .mes_text, #chat') || n.closest?.('#chat .mes_text') || n.querySelector?.('.mes, .mes_text')));
    })) schedule();
  });
  const chatRoot = doc.querySelector('#chat');
  if (chatRoot) observer.observe(chatRoot, { childList: true, characterData: true, subtree: true });
  else observer.observe(doc.body, { childList: true, characterData: true, subtree: true });
  bind(); schedule();
  return { refresh: schedule, destroy() {
    destroyed = true; window.clearTimeout(timer); observer?.disconnect();
    for (const unbind of listeners.splice(0)) unbind();
    doc.querySelectorAll('.cap-theater-panel').forEach(n => n.remove());
  } };
}
