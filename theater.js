/* Capricorn theater lifecycle. Assistant messages and Tavern state are read-only. */
import { getHostContext, getChatIdentity } from './host-context.js';
import { inspectTheater } from './theater-parser.js';
import { START } from './theater-payload.js';
import { hideRawTheater } from './theater-raw-dom.js';
import { renderLegacy } from './theater-legacy.js';
import { renderTheater } from './theater-renderer.js';
import { fingerprint, messageKeys, theaterStorage } from './theater-storage.js';
import { theaterTheme } from './theater-theme.js';
import { diagnostics, messages } from './theater-diagnostics.js';
import { node } from './theater-dom.js';

export { parseTheater } from './theater-parser.js';

const kinds = { flip: '翻牌', reveal: '揭示', slide: '滑动探索' };
const lifecycleEvents = [
  'CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED',
  'MESSAGE_SWIPE_DELETED', 'MESSAGE_UPDATED', 'GENERATION_ENDED',
];

export function mountTheater({ doc = document, context = () => getHostContext(window), scope = () => getChatIdentity(context()).scope } = {}) {
  const host = doc.defaultView;
  const diagnostic = diagnostics(host);
  const mark = diagnostic.mark;
  const storage = theaterStorage(host, mark);
  const theme = theaterTheme(host);
  const listeners = [];
  const mounted = new Map();
  const inspected = new WeakMap();
  const deletions = new Set();
  let destroyed = false, timer = 0, events, eventTypes, root, snapshot, ephemeralChat = 0;
  let bound = false, absenceReported = false;

  function bind(c) {
    const source = c?.eventSource;
    const types = c?.eventTypes || c?.event_types;
    if (bound && source === events && types === eventTypes) return;
    bound = true;
    for (const unbind of listeners.splice(0)) unbind();
    events = source;
    eventTypes = types;
    if (!source?.on || !types || !(source.off || source.removeListener)) {
      mark('binding');
      return;
    }
    for (const name of lifecycleEvents) {
      if (!types[name]) continue;
      const listener = () => {
        if (name === 'MESSAGE_DELETED' && scope()) deletions.add(scope());
        if (name === 'CHAT_CHANGED') {
          mounted.forEach(record => record.panel.remove());
          mounted.clear();
          ephemeralChat++;
          snapshot = undefined;
        }
        schedule();
      };
      source.on(types[name], listener);
      listeners.push(() => (source.off || source.removeListener).call(source, types[name], listener));
    }
  }

  function attach(target, message, source, record, key, persistence, identity) {
    const data = record.data;
    const panel = node(target, 'details', 'cap-theater-panel');
    panel.dataset.key = key;
    panel.dataset.storyTheme = data?.theme || 'cozy';
    if (data?.version === 2) panel.classList.add('ct-v2');
    theme.apply(panel);
    const heading = node(panel, 'summary', 'cap-theater-heading');
    heading.append(node(heading, 'span', 'cap-theater-star', '✧'),
      node(heading, 'span', 'cap-theater-heading-text', data?.title || '幕间小剧场'),
      node(heading, 'span', 'cap-theater-kind', data?.version === 2 ? '' : kinds[data?.type] || '读取提示'));
    panel.append(heading);
    const renderedText = new WeakMap();
    const isCurrent = () => !destroyed && panel.isConnected && scope() === identity &&
      (context()?.chat?.[Number(panel.closest('.mes')?.getAttribute('mesid'))] === message) &&
      String(message.mes ?? message.message ?? '') === source;
    function removeBody() { panel.querySelector('.cap-theater-body')?.remove(); }
    function render() {
      removeBody();
      try {
        if (!data) panel.append(node(panel, 'p', 'cap-theater-body', messages[record.status]));
        else if (data.version === 2) renderTheater(panel, data, persistence, theme, mark, isCurrent);
        else {
          renderLegacy(panel, data, persistence.load(),
            value => {
              if (isCurrent() && !persistence.save(value)) showStorageIssue();
            },
            () => {
              if (!isCurrent()) return;
              const ok = persistence.reset();
              render();
              if (!ok) showStorageIssue();
            });
          if (persistence.failed()) showStorageIssue();
        }
      } catch {
        mark('render');
        removeBody();
        panel.append(node(panel, 'p', 'cap-theater-body', messages.render));
      }
    }
    function showStorageIssue() {
      if (!panel.querySelector('.ct-storage-issue')) panel.querySelector('.cap-theater-body')?.append(
        node(panel, 'p', 'ct-storage-issue', messages.storage));
    }
    panel.addEventListener('toggle', () => {
      if (!panel.open) removeBody();
      else if (isCurrent() && !panel.querySelector('.cap-theater-body')) render();
    });
    function hideRaw() {
      if (renderedText.get(target) === target.textContent) return;
      hideRawTheater(target, record.payload);
      renderedText.set(target, target.textContent);
    }
    hideRaw();
    target.append(panel);
    return { panel, key, hideRaw, message, source };
  }

  const observer = new host.MutationObserver(mutations => {
    if (mutations.some(mutation => {
      const element = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
      if (element?.closest('.cap-theater-panel')) return false;
      if (element?.closest('#chat .mes_text')) {
        return mutation.type === 'characterData' ||
          [...mutation.addedNodes, ...mutation.removedNodes].some(n => !n.classList?.contains('cap-theater-panel'));
      }
      return [...mutation.addedNodes, ...mutation.removedNodes].some(n =>
        n.matches?.('#chat, .mes, .mes_text') || n.querySelector?.('#chat, .mes, .mes_text'));
    })) schedule();
  });

  function scan() {
    if (destroyed) return;
    const c = context(), identity = scope(), chat = c?.chat;
    bind(c);
    const nextRoot = doc.querySelector('#chat');
    if (nextRoot !== root) {
      root = nextRoot;
      observer.disconnect();
      observer.observe(doc.body, { childList: true, subtree: true });
      if (root) observer.observe(root, { childList: true, characterData: true, subtree: true });
    }
    if (!Array.isArray(chat) || !root) return;
    if (snapshot && snapshot.identity !== identity && snapshot.chat === chat &&
        snapshot.first === chat[0] && snapshot.last === chat[chat.length - 1]) {
      mounted.forEach(record => record.panel.remove());
      mounted.clear();
      return;
    }
    if (!snapshot || snapshot.chat !== chat || snapshot.identity !== identity) ephemeralChat++;
    snapshot = { identity, chat, first: chat[0], last: chat[chat.length - 1] };
    const prefix = 'cap_theater_2:' + encodeURIComponent(identity || 'session-' + ephemeralChat) + ':';
    let keys;
    if (deletions.delete(identity)) {
      keys = messageKeys(chat);
      storage.prune(prefix, new Set(keys));
    }
    const live = new Set();
    for (const floor of root.querySelectorAll('.mes[mesid]')) {
      const index = Number(floor.getAttribute('mesid'));
      const message = chat[index];
      const target = floor.querySelector('.mes_text');
      if (!message || message.is_user || message.is_system || !target) continue;
      const source = String(message.mes ?? message.message ?? '');
      if (!source.includes(START)) continue;
      live.add(target);
      let parsed = inspected.get(message);
      if (!parsed || parsed.source !== source) {
        parsed = { source, ...inspectTheater(source) };
        inspected.set(message, parsed);
        if (parsed.status !== 'ok') mark(parsed.status);
      }
      const old = mounted.get(target);
      keys ||= messageKeys(chat);
      const variant = fingerprint(parsed.fingerprint ?? source);
      const key = prefix + keys[index] + ':' + variant;
      if (old?.key === key && old.message === message && old.source === source && old.panel.parentNode === target) {
        old.hideRaw();
        continue;
      }
      old?.panel.remove();
      const legacy = identity && parsed.data && !parsed.data.version
        ? 'cap_theater_1:' + fingerprint(identity + ':' + index + ':' + fingerprint(source.slice(source.lastIndexOf(START))))
        : undefined;
      mounted.set(target, attach(target, message, source, parsed, key, storage.access(key, !!identity, legacy), identity));
    }
    for (const [target, record] of mounted) {
      if (live.has(target)) continue;
      record.panel.remove();
      mounted.delete(target);
    }
    if (!live.size && !absenceReported) {
      absenceReported = true;
      mark('absent');
    }
  }

  function schedule() {
    if (destroyed || timer) return;
    timer = host.setTimeout(() => {
      timer = 0;
      try { scan(); } catch { mark('render'); }
    }, 90);
  }
  observer.observe(doc.body, { childList: true, subtree: true });
  scan();
  return {
    refresh: schedule,
    diagnostics: diagnostic.read,
    destroy() {
      destroyed = true;
      host.clearTimeout(timer);
      observer.disconnect();
      for (const unbind of listeners.splice(0)) unbind();
      mounted.forEach(record => record.panel.remove());
      mounted.clear();
    },
  };
}
