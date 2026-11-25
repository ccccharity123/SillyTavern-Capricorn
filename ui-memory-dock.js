import { icon } from './icons.js';
import { popover } from './ui-popover.js';
import { fuzzy } from './traces.js';
import { viewport } from './viewport.js';

const destinations = [
  ['timeline', '便签', '搜索剧情便签', 'note'],
  ['table', '表格', '搜索人物、事件或字段', 'table'],
  ['dossier', '档案', '搜索人物、关系、伏笔、事件', 'user-list'],
];

function mountPosition(dock, button) {
  const W = dock.ownerDocument.defaultView;
  const key = 'capricorn_memory_tab_y';
  const visual = W.visualViewport;
  let ratio = 0.42, drag = null, suppress = false;
  let safe = {top:0, right:0, bottom:0, left:0};
  try {
    const saved = W.localStorage.getItem(key);
    if (saved !== null && Number.isFinite(Number(saved))) ratio = Math.max(0, Math.min(1, Number(saved)));
  } catch (_) {}

  function bounds(v) {
    const margin = Math.min(12, v.h / 4);
    const min = Math.max(v.y + margin, safe.top);
    const bottom = Math.min(v.y + v.h - margin, W.innerHeight - safe.bottom);
    return { min, max: Math.max(min, bottom - 46), bottom };
  }
  function fit() {
    const v = viewport(W);
    const b = bounds(v);
    const right = Math.max(safe.right, W.innerWidth - v.x - v.w);
    const left = Math.max(safe.left, v.x) + Math.min(12, v.w / 4);
    dock.style.setProperty('--cap-memory-tab-top', b.min + ratio * (b.max - b.min) + 'px');
    dock.style.setProperty('--cap-memory-panel-top', b.min + 'px');
    dock.style.setProperty('--cap-memory-panel-height', Math.max(1, b.bottom - b.min) + 'px');
    dock.style.setProperty('--cap-memory-panel-width', Math.max(1, W.innerWidth - left - right) + 'px');
    dock.style.setProperty('--cap-memory-right', right + 'px');
  }
  function resize() {
    const styles = W.getComputedStyle(dock);
    for (const side of Object.keys(safe)) safe[side] = parseFloat(styles.getPropertyValue('--cap-memory-safe-' + side)) || 0;
    fit();
  }
  function down(event) {
    if (!event.isPrimary || event.button !== 0 || !dock.classList.contains('shiyi-collapsed')) return;
    suppress = false;
    drag = { id: event.pointerId, y: event.clientY, top: dock.getBoundingClientRect().top, moved: false };
    try { button.setPointerCapture(event.pointerId); } catch (_) {}
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 7) return;
    drag.moved = true;
    const b = bounds(viewport(W));
    ratio = Math.max(0, Math.min(1, (drag.top + dy - b.min) / Math.max(1, b.max - b.min)));
    fit();
  }
  function end(event) {
    if (!drag || event.pointerId !== drag.id) return;
    suppress = drag.moved;
    drag = null;
    if (suppress) try { W.localStorage.setItem(key, String(ratio)); } catch (_) {}
  }
  function click(event) {
    if (!suppress || event.detail === 0) return;
    suppress = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', end], ['pointercancel', end], ['lostpointercapture', end]];
  for (const [name, handler] of listeners) button.addEventListener(name, handler);
  button.addEventListener('click', click, true);
  W.addEventListener('resize', resize);
  if (visual) {
    visual.addEventListener('resize', resize);
    visual.addEventListener('scroll', fit);
  }
  resize();
  return () => {
    for (const [name, handler] of listeners) button.removeEventListener(name, handler);
    button.removeEventListener('click', click, true);
    W.removeEventListener('resize', resize);
    if (visual) {
      visual.removeEventListener('resize', resize);
      visual.removeEventListener('scroll', fit);
    }
  };
}

export function mountMemoryDock({memory, music, scope, openAppearance, closeAppearance, openRecall}) {
  const dock = memory.root;
  if (!dock) return null;
  const D = dock.ownerDocument, W = D.defaultView;
  const find = id => dock.querySelector('#shiyi-' + id);
  const expand = find('expand'), collapse = find('collapse'), status = find('status');
  const scan = find('scan'), original = dock.querySelector('.shiyi-dock-content');
  const tabs = destinations.map(([id]) => find(id));
  const brand = original && original.querySelector('.shiyi-brand');
  if (!expand || !collapse || !status || !scan || !original || !brand || tabs.some(tab => !tab)) return null;
  const tools = scan.parentElement;
  let active = 'timeline', key = '', loaded = false, closed = false, epoch = 0, jumpFrame = 0;
  let searchCurrent = null, disposeView = null, endDossier = null;
  const searches = new Map();
  const filters = {};
  function make(tag, className, parent) {
    const node = D.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.append(node);
    return node;
  }
  function label(node, text) {
    node.setAttribute('aria-label', text);
    node.title = text;
  }
  function iconButton(node, text, glyph) {
    node.type = 'button';
    node.classList.add('cap-shiyi-icon-btn');
    node.innerHTML = icon(glyph, 18);
    label(node, text);
    return node;
  }

  dock.classList.add('cap-memory-side', 'cap-memory-dock');
  brand.hidden = true;
  const heading = make('header', 'cap-shiyi-header');
  original.prepend(heading);
  const primary = make('div', 'cap-shiyi-primary', heading);
  const nav = make('nav', 'cap-memory-primary-nav', primary);
  nav.setAttribute('aria-label', '拾忆主要功能');
  const tabIcons = destinations.map(([id, text], index) => {
    const button = tabs[index];
    button.type = 'button';
    button.classList.add('cap-memory-primary-btn');
    button.replaceChildren();
    const pictogram = make('span', 'cap-memory-tab-icon', button);
    const name = make('span', '', button);
    name.textContent = text;
    label(button, id === 'timeline' ? '便签 / 时间轴' : text);
    button.addEventListener('click', event => {
      // Native buttons remain available when the dock enhancement cannot mount.
      event.stopImmediatePropagation();
      show(id);
    }, true);
    nav.append(button);
    return pictogram;
  });
  const actions = make('div', 'cap-shiyi-icon-actions', primary);
  const style = iconButton(make('button', 'cap-note-style-btn', actions), '拾忆外观、字体与自定义 CSS', 'palette');
  style.onclick = () => { if (openAppearance) openAppearance(); };
  const more = iconButton(make('button', '', actions), '拾忆管理与设置', 'more');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  const badge = make('span', 'cap-shiyi-dot', more);
  badge.hidden = true;
  actions.append(iconButton(collapse, '收起拾忆', 'right'));

  const searchBox = make('div', 'cap-shiyi-search', heading);
  const magnifier = make('span', 'cap-shiyi-search-icon', searchBox);
  magnifier.innerHTML = icon('search', 17);
  const search = make('input', '', searchBox);
  search.type = 'search';
  const count = make('span', 'cap-shiyi-count', searchBox);
  count.hidden = true;
  const refresh = iconButton(make('button', '', searchBox), '刷新当前内容', 'refresh');
  refresh.onclick = () => void render();

  expand.innerHTML = icon('bookmark', 20);
  const tabBadge = make('span', 'cap-shiyi-dot', expand);
  tabBadge.hidden = true;
  const cleanupPosition = mountPosition(dock, expand);

  const scroller = make('div', 'cap-shiyi-scroll', original);
  const timeline = make('section', 'cap-timeline', scroller);
  const content = make('section', 'cap-shiyi-view', scroller);
  status.setAttribute('role', 'status');
  scroller.append(status);
  tools.className = 'cap-memory-tools';
  tools.hidden = true;
  heading.append(tools);
  if (openRecall) {
    const recall = make('button', '', tools);
    recall.type = 'button';
    recall.id = 'shiyi-recall';
    recall.textContent = '回响';
    recall.onclick = openRecall;
  }
  const management = [
    ['scan', 'search'], ['import', 'folder-open'], ['archive', 'archive'],
    ['review', 'check'], ['manage', 'user-list'], ['recall', 'sparkle'], ['settings', 'settings'],
  ];
  function closeFallback() {
    tools.hidden = true;
    more.setAttribute('aria-expanded', 'false');
  }
  more.onclick = () => {
    if (!tools.hidden) return closeFallback();
    const items = management.map(([id, glyph]) => {
      const button = find(id);
      if (!button) return null;
      const n = id === 'review' ? Number(memory.pending()) : 0;
      return {
        label: button.textContent + (n ? ' · ' + n : ''),
        icon: glyph,
        disabled: button.disabled,
        action: () => { button.click(); updateBadges(); },
      };
    }).filter(Boolean);
    if (!popover.open({anchor: more, items, role: 'menu', label: '拾忆管理与设置'})) {
      tools.hidden = false;
      more.setAttribute('aria-expanded', 'true');
      const button = tools.querySelector('button');
      if (button) button.focus();
    }
  };
  tools.addEventListener('click', () => { closeFallback(); updateBadges(); });
  function fallbackPointer(event) {
    if (!tools.hidden && !tools.contains(event.target) && !more.contains(event.target)) closeFallback();
  }
  function fallbackKey(event) {
    if (event.key === 'Escape' && !tools.hidden) {
      closeFallback();
      more.focus();
      event.stopPropagation();
    }
  }
  const pointerEvents = W.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'];
  for (const name of pointerEvents) D.addEventListener(name, fallbackPointer);
  D.addEventListener('keydown', fallbackKey);

  function updateBadges() {
    const pending = Number(memory.pending()) || 0;
    const text = pending > 9 ? '9+' : String(pending);
    for (const node of [badge, tabBadge]) {
      node.hidden = pending <= 0;
      if (node.textContent !== text) node.textContent = text;
    }
    const suffix = pending ? '（' + pending + ' 条待审核）' : '';
    expand.dataset.pending = pending ? String(pending) : '';
    label(expand, '展开拾忆' + suffix + '，可拖动调整位置');
    label(more, '拾忆管理与设置' + suffix);
  }
  function setCount(value) {
    count.hidden = value == null;
    count.textContent = value == null ? '' : String(value);
  }
  function clearView() {
    ++epoch;
    if (jumpFrame) W.cancelAnimationFrame(jumpFrame);
    jumpFrame = 0;
    if (disposeView) disposeView();
    if (endDossier) endDossier('close');
    disposeView = null;
    searchCurrent = null;
  }
  function isOpen() {
    return !closed && dock.isConnected && !dock.classList.contains('shiyi-collapsed');
  }
  function bindSearch(callback) {
    searchCurrent = callback;
    callback(search.value);
  }
  search.oninput = () => {
    searches.set(active, search.value);
    if (searchCurrent) searchCurrent(search.value);
  };

  function renderTimeline(rows, soundtrack, targetFloor, renderEpoch, valid) {
    const songs = new Map();
    for (const song of soundtrack) {
      const floor = String(song.floor);
      if (!songs.has(floor)) songs.set(floor, []);
      songs.get(floor).push(song);
    }
    rows.sort((a, b) => a.floor - b.floor);
    const empty = make('p', 'cap-timeline-empty');
    const cards = make('div', 'cap-story-list');
    const pages = make('div', 'shiyi-view-pagination');
    const previous = make('button', '', pages), next = make('button', '', pages);
    previous.type = next.type = 'button';
    previous.textContent = '上一页';
    next.textContent = '下一页';
    timeline.replaceChildren(empty, cards, pages);
    const pageSize = 40;
    const targetIndex = rows.findIndex(row => row.floor === targetFloor);
    let offset = targetIndex < 0 ? 0 : Math.floor(targetIndex / pageSize) * pageSize;
    let filtered = rows, jump = targetIndex >= 0;
    function draw() {
      cards.replaceChildren();
      setCount(filtered.length);
      empty.hidden = filtered.length > 0;
      empty.textContent = rows.length ? '暂无匹配的剧情便签' : '暂无已归档摘要，请检测或导入历史。';
      previous.hidden = offset === 0;
      next.hidden = filtered.length <= offset + pageSize;
      for (const row of filtered.slice(offset, offset + pageSize)) {
        const card = make('details', 'cap-story', cards);
        const head = make('summary', '', card);
        const getField = name => {
          const matched = row.content.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>'));
          return matched && matched[1] ? matched[1].trim() : '';
        };
        const tracks = songs.get(String(row.floor)) || [];
        const when = make('span', 'cap-story-time', head);
        when.textContent = getField('时间') || row.when;
        const title = make('span', 'cap-story-title', head);
        if (row.star) {
          title.insertAdjacentHTML('beforeend', icon('star', 15, {weight:'fill'}));
          const hidden = make('span', 'cap-shiyi-visually-hidden', title);
          hidden.textContent = '已星标 ';
        }
        title.append(D.createTextNode((row.chapter ? row.chapter + ' · ' : '') +
          (getField('标题') || row.title.replace(/^记忆\d+｜/, ''))));
        const song = make('span', 'cap-story-song', head);
        if (tracks.length) song.insertAdjacentHTML('beforeend', icon('music', 15));
        song.append(D.createTextNode(tracks.length ? tracks.map(track => track.title + ' — ' + track.artist).join(' / ') : '暂无音乐记录'));
        const body = make('p', '', card);
        body.textContent = getField('摘要') || row.content;
        for (const track of tracks) {
          const button = make('button', 'cap-story-play', card);
          button.type = 'button';
          button.innerHTML = icon('play', 15);
          button.append(D.createTextNode('播放 · ' + track.title));
          button.disabled = !track.playable;
          button.onclick = () => { if (valid() && music) music.playTimeline(track.id); };
        }
        const source = make('button', '', card);
        source.type = 'button';
        source.textContent = '查看原楼层';
        source.onclick = () => { if (valid() && !memory.jump(row.floor)) W.alert('请先加载该历史楼层'); };
        if (jump && row.floor === targetFloor) {
          card.open = true;
          jumpFrame = W.requestAnimationFrame(() => {
            jumpFrame = 0;
            if (card.isConnected && epoch === renderEpoch) scroller.scrollTop += card.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
          });
        }
      }
      jump = false;
    }
    previous.onclick = () => { offset -= pageSize; draw(); scroller.scrollTop = 0; };
    next.onclick = () => { offset += pageSize; draw(); scroller.scrollTop = 0; };
    searchCurrent = text => {
      const term = text.trim();
      filtered = term ? rows.filter(row => {
        const tracks = songs.get(String(row.floor)) || [];
        return fuzzy([row.title, row.content, row.chapter, row.traceText || '', ...tracks.map(track => track.title + ' ' + track.artist)].join(' '), term);
      }) : rows;
      offset = 0;
      draw();
    };
    if (search.value) searchCurrent(search.value);
    else draw();
  }

  async function render(targetFloor) {
    if (!isOpen()) return;
    if (memory.open && active === 'dossier') return;
    clearView();
    const renderEpoch = epoch;
    const scoped = scope();
    const valid = () => isOpen() && epoch === renderEpoch && scoped === scope();
    key = scoped;
    loaded = true;
    const host = active === 'timeline' ? timeline : content;
    host.replaceChildren();
    setCount(null);
    function failure(cause) {
      if (valid()) host.textContent = '读取失败：' + (cause.message || cause);
      console.warn('[拾忆] 无法读取面板', cause);
    }
    try {
      if (!scoped) {
        make('p', 'cap-timeline-empty', host).textContent = '请先打开聊天';
      } else if (active === 'timeline') {
        make('p', 'cap-timeline-empty', host).textContent = '正在读取剧情便签…';
        const [rows, songs] = await Promise.all([memory.timelineRows(), music ? music.timelineSongs() : []]);
        if (valid()) renderTimeline(rows, songs, targetFloor, renderEpoch, valid);
      } else if (active === 'table') {
        const view = memory.tableView({bindSearch, setCount, filters});
        if (view && valid()) {
          disposeView = view.destroy;
          host.append(view.element);
        }
      } else {
        await memory.openDossier((title, body, buttons, registerFinish) => {
          if (!valid()) return Promise.resolve('close');
          host.replaceChildren();
          const commands = make('div', 'cap-shiyi-dossier-actions', host);
          host.append(body);
          return new Promise(resolve => {
            const finish = value => {
              endDossier = null;
              resolve(value);
            };
            endDossier = finish;
            registerFinish(finish);
            for (const action of buttons) {
              if (action.value === 'close') continue;
              const button = make('button', action.kind, commands);
              button.type = 'button';
              button.textContent = action.label;
              button.onclick = () => finish(action.value);
            }
          });
        }, {
          bindSearch: callback => { if (valid()) bindSearch(callback); },
          setCount: total => { if (valid()) setCount(total); },
          filters,
          active: valid,
        });
      }
    } catch (cause) { failure(cause); }
  }

  function show(id, targetFloor) {
    const previous = active;
    active = id;
    const destination = destinations.find(item => item[0] === id);
    search.placeholder = destination[2];
    search.setAttribute('aria-label', destination[2]);
    search.value = searches.get(id) || '';
    tabs.forEach((tab, index) => {
      const pressed = String(destinations[index][0] === id);
      if (tab.getAttribute('aria-pressed') === pressed) return;
      tab.setAttribute('aria-pressed', pressed);
      tabIcons[index].innerHTML = icon(destinations[index][3], 15, {active: pressed === 'true'});
    });
    timeline.hidden = id !== 'timeline';
    content.hidden = !timeline.hidden;
    if (previous !== id) scroller.scrollTop = 0;
    void render(targetFloor);
  }
  function open(targetFloor) {
    memory.setCollapsed(false);
    if (targetFloor != null) searches.delete('timeline');
    show(targetFloor == null ? active : 'timeline', targetFloor);
  }
  function onExpand() { open(); }
  function onCollapse(event) {
    loaded = false;
    setCount(null);
    clearView();
    popover.closeWithin(dock);
    closeFallback();
    if (closeAppearance) closeAppearance();
    if (event) expand.focus();
  }
  expand.addEventListener('click', onExpand);
  collapse.addEventListener('click', onCollapse);
  show(active);
  updateBadges();
  return {
    refresh(targetFloor) {
      if (targetFloor != null) { if (isOpen()) open(targetFloor); }
      else void render();
    },
    tick() {
      updateBadges();
      const current = scope();
      if (isOpen() && (!loaded || key !== current)) {
        if (key !== current) {
          searches.clear();
          delete filters.table;
          delete filters.dossier;
          popover.closeWithin(dock);
          closeFallback();
        }
        show(active);
      }
    },
    isOpen,
    open,
    destroy() {
      closed = true;
      onCollapse();
      cleanupPosition();
      for (const name of pointerEvents) D.removeEventListener(name, fallbackPointer);
      D.removeEventListener('keydown', fallbackKey);
      expand.removeEventListener('click', onExpand);
      collapse.removeEventListener('click', onCollapse);
    },
  };
}
