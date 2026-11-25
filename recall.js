import { appendMemoryProvenance } from './memory-provenance.js';
import { mountSelects, refreshSelect } from './ui-select.js';
import { icon } from './icons.js';

export function createRecall({ D, W, scope, memory, music, shared }) {
  let panel = null, timer = null, epoch = 0, key = '', prior = false, rows = [], songs = [], pos = 0, auto = false, lastSong = '', touch = null;
  let chapter, star, person, body, progress, prev, next, run, sound, caption, captionText, cover, people = [];
  let selects;
  const el = (tag, text, parent, cls = '') => {
    const n = D.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    parent?.append(n);
    return n;
  };
  const stop = () => { clearTimeout(timer); timer = null; };
  const syncRunButton = () => {
    if (!run) return;
    run.setAttribute('aria-pressed', String(auto));
    run.innerHTML = `${icon(auto ? 'pause' : 'play', 14)}<span>${auto ? '暂停漫游' : '自动漫游'}</span>`;
  };
  function close() {
    epoch++;
    stop();
    if (!panel) return;
    if (selects) { selects.destroy(); selects = null; }
    panel.remove();
    panel = null;
    shared.recallLocked = prior;
    D.removeEventListener('keydown', keyboard);
  }
  function keyboard(e) {
    if (!panel || /INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target?.tagName)) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  }
  const filtered = () => rows.filter(r =>
    (!chapter.value || r.chapter === chapter.value) &&
    (!star.checked || r.star) &&
    (!person.value || people.find(p => p.id === person.value)?.sources?.includes(r.sourceKey))
  );
  function schedule() {
    stop();
    if (auto && panel && !D.hidden) {
      const r = filtered()[pos];
      if (r && pos < filtered().length - 1) {
        timer = setTimeout(() => step(1), Math.max(6000, Math.min(45000, Array.from(r.content || '').length * 180)));
      } else {
        auto = false;
        syncRunButton();
      }
    }
  }
  function renderSource(row) {
    const openedScope = key;
    appendMemoryProvenance(D, body, () => panel && scope() === openedScope && memory.provenance('summary', row.sourceKey), source => {
      if (!memory.jumpToSource(source)) return false;
      close();
      return true;
    });
  }
  function render(play = false) {
    if (!panel) return;
    if (scope() !== key) return close();
    const list = filtered();
    pos = Math.max(0, Math.min(pos, list.length - 1));
    const r = list[pos];
    body.replaceChildren();
    body.classList.remove('is-swap');
    void body.offsetWidth;
    body.classList.add('is-swap');
    progress.textContent = r ? `${pos + 1} / ${list.length}` : '0 / 0';
    prev.disabled = pos === 0;
    next.disabled = pos >= list.length - 1;
    captionText.textContent = '';
    caption.dataset.empty = 'true';
    cover.removeAttribute('src');
    cover.hidden = true;
    if (!r) {
      el('p', '没有符合筛选条件的有效记忆', body, 'cap-recall-empty');
      schedule();
      return;
    }
    const meta = el('div', null, body, 'cap-recall-meta');
    el('span', r.chapter || '未分章', meta, 'cap-recall-badge');
    el('span', r.when, meta, 'cap-recall-when');
    if (r.star) {
      const st = el('span', null, meta, 'cap-recall-star');
      st.innerHTML = icon('star', 13, { weight: 'fill' });
    }
    el('h2', r.title, body);
    el('p', r.content, body, 'cap-recall-text');
    renderSource(r);
    body.scrollTop = 0;

    const tracks = songs.filter(t => String(t.floor) === String(r.floor));
    const t = tracks.find(track => track.playable);
    if (tracks.length) {
      caption.dataset.empty = 'false';
      captionText.textContent = tracks.map(track => `${track.title} · ${track.artist}`).join(' / ');
    } else {
      caption.dataset.empty = 'true';
      captionText.textContent = '此节点无关联音乐';
    }
    if (t?.coverUrl) {
      try {
        const u = new URL(t.coverUrl);
        if (['http:', 'https:'].includes(u.protocol)) {
          cover.src = u.href;
          cover.hidden = false;
        }
      } catch {}
    }
    if (play && sound.checked && t && t.id !== lastSong) {
      lastSong = t.id;
      Promise.resolve(music.playStoryQueue([t.id], '回响')).catch(() => { lastSong = ''; });
    }
    try { W.localStorage.setItem('capricorn_recall_' + key, JSON.stringify({ floor: r.floor, hash: r.sourceHash })); } catch {}
    schedule();
  }
  function step(delta) {
    if (!panel) return;
    pos += delta;
    render(true);
  }
  async function refresh() {
    if (!panel) return;
    if (scope() !== key) return close();
    const n = ++epoch;
    const old = filtered()[pos];
    try {
      const data = await memory.timelineRows();
      if (!panel || n !== epoch || scope() !== key) return;
      const nextSongs = await music?.timelineSongs() || [];
      if (!panel || n !== epoch || scope() !== key) return;
      rows = data.sort((a, b) => a.floor - b.floor);
      songs = nextSongs;
      people = memory.recallPeople?.() || [];
      const c = chapter.value, p = person.value;
      chapter.replaceChildren();
      person.replaceChildren();
      for (const v of ['', ...new Set(rows.map(r => r.chapter).filter(Boolean))]) {
        const o = el('option', v || '全部章节', chapter);
        o.value = v;
      }
      el('option', '全部人物', person).value = '';
      for (const v of people) el('option', v.title, person).value = v.id;
      chapter.value = [...chapter.options].some(o => o.value === c) ? c : '';
      person.value = [...person.options].some(o => o.value === p) ? p : '';
      refreshSelect(chapter);
      refreshSelect(person);
      let target = old;
      if (!target) {
        try {
          const legacy = shared.chatIdentity?.().legacyUiScope;
          const saved = W.localStorage.getItem('capricorn_recall_' + key) ?? (legacy ? W.localStorage.getItem('capricorn_recall_' + legacy) : null);
          const s = JSON.parse(saved || 'null');
          if (s) target = { floor: s.floor, sourceHash: s.hash };
        } catch {}
      }
      pos = Math.max(0, filtered().findIndex(r => r.floor === target?.floor && r.sourceHash === target?.sourceHash));
      render(false);
    } catch (e) {
      if (panel && n === epoch) {
        body.textContent = '读取失败：' + e.message;
        stop();
      }
    }
  }
  async function open() {
    close();
    key = scope();
    prior = !!shared.recallLocked;
    shared.recallLocked = true;
    rows = []; songs = []; people = []; pos = 0; auto = false; lastSong = '';
    panel = el('section', null, D.body, 'cap-recall');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '回响 · 剧情漫游');

    cover = el('img', null, panel, 'cap-recall-cover');
    cover.hidden = true;
    cover.onerror = () => { cover.hidden = true; };

    const top = el('header', null, panel, 'cap-recall-header');
    const title = el('strong', null, top);
    title.innerHTML = `${icon('sparkle', 17, { weight: 'duotone' })}<span>回响 · 剧情漫游</span>`;
    const exitBtn = el('button', null, top, 'cap-recall-close');
    exitBtn.type = 'button';
    exitBtn.innerHTML = `${icon('close', 15)}<span>退出</span>`;
    exitBtn.onclick = close;

    const filters = el('div', null, panel, 'cap-recall-controls');
    chapter = el('select', null, filters);
    chapter.setAttribute('aria-label', '章节');
    person = el('select', null, filters);
    person.setAttribute('aria-label', '人物');
    chapter.dataset.capSelect = person.dataset.capSelect = 'search';

    const toggles = el('div', null, filters, 'cap-recall-toggles');
    const label = el('label', null, toggles, 'cap-recall-toggle');
    star = el('input', null, label);
    star.type = 'checkbox';
    el('span', '仅看星标', label);

    const audio = el('label', null, toggles, 'cap-recall-toggle');
    sound = el('input', null, audio);
    sound.type = 'checkbox';
    sound.disabled = !music;
    el('span', '音乐随行', audio);
    sound.onchange = () => { lastSong = ''; render(true); };
    for (const f of [chapter, person, star]) f.onchange = () => { pos = 0; render(true); };

    body = el('article', '正在读取记忆…', panel);
    body.addEventListener('touchstart', e => { touch = [e.touches[0].clientX, e.touches[0].clientY]; }, { passive: true });
    body.addEventListener('touchend', e => {
      if (!touch) return;
      const x = e.changedTouches[0].clientX - touch[0], y = e.changedTouches[0].clientY - touch[1];
      touch = null;
      if (Math.abs(x) > 65 && Math.abs(x) > Math.abs(y) * 1.5) step(x < 0 ? 1 : -1);
    }, { passive: true });

    caption = el('div', null, panel, 'cap-recall-caption');
    caption.dataset.empty = 'true';
    const capIcon = el('span', null, caption, 'cap-recall-caption-icon');
    capIcon.innerHTML = icon('music', 14);
    captionText = el('span', '', caption, 'cap-recall-caption-text');

    const foot = el('footer', null, panel, 'cap-recall-footer');
    prev = el('button', null, foot);
    prev.type = 'button';
    prev.innerHTML = `${icon('left', 15)}<span>上一幕</span>`;
    prev.onclick = () => step(-1);
    progress = el('span', '0 / 0', foot, 'cap-recall-progress');
    next = el('button', null, foot);
    next.type = 'button';
    next.innerHTML = `<span>下一幕</span>${icon('right', 15)}`;
    next.onclick = () => step(1);
    run = el('button', null, foot, 'cap-recall-auto');
    run.type = 'button';
    syncRunButton();
    run.onclick = () => { auto = !auto; syncRunButton(); schedule(); };

    D.addEventListener('keydown', keyboard);
    selects = mountSelects(panel);
    await refresh();
  }
  return {
    open, close, refresh,
    check() {
      if (panel && scope() !== key) close();
      else if (panel && auto && !timer && !D.hidden) schedule();
    },
  };
}
