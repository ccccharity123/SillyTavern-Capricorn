/* Capricorn Apple Spotlight · 全局功能速达与指令搜索 */
import { icon } from './icons.js';
import { fuzzy } from './traces.js';
import { prefersReducedMotion } from './ui-motion.js';

export function createSpotlight({ D, W, getItems }) {
  let overlay = null;
  let closing = false;
  let priorFocus = null;
  let activeIndex = 0;
  let visibleEntries = [];
  let listNode = null;
  let inputNode = null;

  function focusSafe(el) {
    if (!el || typeof el.focus !== 'function') return;
    try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }
  }

  function close(instant = false) {
    if (!overlay || closing) return;
    closing = true;
    const node = overlay;
    D.removeEventListener('keydown', onKey, true);
    const done = () => {
      node.remove();
      if (overlay === node) overlay = null;
      closing = false;
      if (priorFocus && priorFocus.isConnected) focusSafe(priorFocus);
      priorFocus = null;
    };
    if (instant || prefersReducedMotion(W)) {
      done();
    } else {
      node.classList.add('is-closing');
      W.setTimeout(done, 165);
    }
  }

  function highlight(nextIndex, scroll = true) {
    if (!visibleEntries.length) {
      activeIndex = -1;
      return;
    }
    activeIndex = Math.max(0, Math.min(nextIndex, visibleEntries.length - 1));
    visibleEntries.forEach((entry, idx) => {
      entry.button.dataset.active = String(idx === activeIndex);
    });
    if (scroll && visibleEntries[activeIndex]) {
      try { visibleEntries[activeIndex].button.scrollIntoView({ block: 'nearest' }); } catch {}
    }
  }

  function runEntry(entry) {
    if (!entry || entry.item.disabled) return;
    const action = entry.item.action;
    close(true);
    try { action?.(); } catch (err) { console.warn('[Capricorn] Spotlight action failed', err); }
  }

  function render() {
    if (!listNode) return;
    const query = (inputNode?.value || '').trim();
    const all = (typeof getItems === 'function' ? getItems() : []).filter(item => item && !item.hidden);
    const matched = query
      ? all.filter(item => fuzzy([item.title, item.subtitle || '', item.group || '', item.keywords || ''].join(' '), query))
      : all;

    listNode.replaceChildren();
    visibleEntries = [];

    if (!matched.length) {
      const empty = D.createElement('p');
      empty.className = 'cap-spot-empty';
      empty.textContent = '没有匹配的功能，试试搜索“字体”“封面”“归档”“网易云”';
      listNode.append(empty);
      activeIndex = -1;
      return;
    }

    const grouped = new Map();
    for (const item of matched) {
      const g = item.group || '快捷功能';
      if (!grouped.has(g)) grouped.set(g, []);
      grouped.get(g).push(item);
    }

    for (const [groupName, items] of grouped) {
      const section = D.createElement('div');
      section.className = 'cap-spot-group';
      const head = D.createElement('div');
      head.className = 'cap-spot-group-title';
      head.textContent = groupName;
      section.append(head);

      const box = D.createElement('div');
      box.className = 'cap-spot-rows';
      for (const item of items) {
        const btn = D.createElement('button');
        btn.type = 'button';
        btn.className = 'cap-spot-row';
        btn.disabled = Boolean(item.disabled);
        const ico = D.createElement('span');
        ico.className = 'cap-spot-ico';
        ico.setAttribute('aria-hidden', 'true');
        ico.innerHTML = icon(item.icon || 'sparkle', 17);

        const meta = D.createElement('span');
        meta.className = 'cap-spot-meta';
        const title = D.createElement('strong');
        title.textContent = item.title;
        meta.append(title);
        if (item.subtitle) {
          const sub = D.createElement('small');
          sub.textContent = item.subtitle;
          meta.append(sub);
        }

        btn.append(ico, meta);
        if (item.badge) {
          const b = D.createElement('span');
          b.className = 'cap-spot-badge';
          b.textContent = item.badge;
          btn.append(b);
        }
        const chev = D.createElement('span');
        chev.className = 'cap-spot-chev';
        chev.setAttribute('aria-hidden', 'true');
        chev.innerHTML = icon('right', 13);
        btn.append(chev);

        const entry = { item, button: btn };
        if (!item.disabled) {
          const idx = visibleEntries.length;
          visibleEntries.push(entry);
          btn.onmouseenter = () => highlight(idx, false);
          btn.onclick = () => runEntry(entry);
        }
        box.append(btn);
      }
      section.append(box);
      listNode.append(section);
    }
    highlight(0, false);
  }

  function onKey(event) {
    if (!overlay || closing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight(activeIndex + 1 >= visibleEntries.length ? 0 : activeIndex + 1, true);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(activeIndex - 1 < 0 ? visibleEntries.length - 1 : activeIndex - 1, true);
    } else if (event.key === 'Enter' && !event.isComposing) {
      if (visibleEntries[activeIndex]) {
        event.preventDefault();
        event.stopPropagation();
        runEntry(visibleEntries[activeIndex]);
      }
    }
  }

  function open(initialQuery = '') {
    if (overlay && !closing) {
      focusSafe(inputNode);
      return;
    }
    if (overlay) overlay.remove();
    closing = false;
    priorFocus = D.activeElement;

    overlay = D.createElement('div');
    overlay.className = 'cap-spotlight-overlay';
    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) close();
    });

    const card = D.createElement('section');
    card.className = 'cap-spotlight-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', '摩羯座功能速达');

    const head = D.createElement('div');
    head.className = 'cap-spot-head';
    const ico = D.createElement('span');
    ico.className = 'cap-spot-search-ico';
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = icon('search', 18);

    inputNode = D.createElement('input');
    inputNode.type = 'search';
    inputNode.className = 'cap-spot-input';
    inputNode.placeholder = '搜索功能、视图或设置（如：归档、字体、封面、正则）';
    inputNode.setAttribute('aria-label', '搜索摩羯座功能');
    inputNode.value = initialQuery;
    inputNode.oninput = render;

    const closeBtn = D.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cap-spot-close';
    closeBtn.setAttribute('aria-label', '关闭功能速达');
    closeBtn.innerHTML = icon('close', 16);
    closeBtn.onclick = () => close();

    head.append(ico, inputNode, closeBtn);

    listNode = D.createElement('div');
    listNode.className = 'cap-spot-body';

    const foot = D.createElement('div');
    foot.className = 'cap-spot-foot';
    foot.innerHTML = '<span>↑↓ 选择</span><span>Enter 进入</span><span>Alt + K / 长按悬浮球呼出</span>';

    card.append(head, listNode, foot);
    overlay.append(card);
    D.body.append(overlay);
    D.addEventListener('keydown', onKey, true);
    render();
    W.requestAnimationFrame(() => focusSafe(inputNode));
  }

  return {
    open,
    close,
    isOpen: () => Boolean(overlay && !closing),
    destroy: () => close(true),
  };
}
