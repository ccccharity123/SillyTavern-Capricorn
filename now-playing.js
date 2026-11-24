export function parseLrc(text) {
  const out = [];
  const offset = Number(String(text).match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  for (const line of String(text || '').split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!words) continue;
    for (const t of tags) {
      out.push({
        time: Math.max(0, +t[1] * 60 + +t[2] + Number('0.' + (t[3] || '0')) + offset),
        text: words
      });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

const ICONS = {
  prev: `<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>`,
  next: `<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>`,
  play: `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  lyrics: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4V5zm4 4v2h8V9H8zm0 4v2h5v-2H8z"/></svg>`,
  queue: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 6h14v2H3V6zm0 5h14v2H3v-2zm0 5h10v2H3v-2zm16-1v-4h2v6a3 3 0 1 1-2-2.83z"/></svg>`
};

export function mountNowPlaying({ D, W, audio, shared, state, toggle, next, play, move, remove }) {
  const panel = D.createElement('section');
  panel.className = 'cap-full-player';
  panel.hidden = true;
  panel.setAttribute('aria-label', '声屿全屏播放器');
  panel.innerHTML = `
    <div class="cap-ambient" aria-hidden="true"><img alt="" hidden></div>
    <div class="cap-fp-shell">
      <div class="cap-grabber" data-close title="收起播放器"></div>
      <header>
        <button data-close class="cap-fp-pill">⌄ 收起</button>
        <span data-heading class="cap-fp-heading">声屿</span>
        <button data-diagnostic class="cap-fp-pill" title="复制播放诊断">诊断</button>
      </header>
      <div class="cap-art">
        <img alt="专辑封面" hidden>
        <span>♫</span>
      </div>
      <div class="cap-meta">
        <div class="cap-meta-text">
          <h2></h2>
          <p data-artist></p>
        </div>
        <span class="cap-badge" data-quality></span>
      </div>
      <p data-status role="status" class="cap-fp-status"></p>
      <div class="cap-scrubber">
        <input data-seek type="range" min="0" max="0" step="0.1" aria-label="播放进度">
        <div class="cap-clock-row">
          <span data-elapsed>0:00</span>
          <span data-duration>0:00</span>
        </div>
      </div>
      <div class="cap-transport">
        <button data-prev aria-label="上一首">${ICONS.prev}</button>
        <button data-toggle class="cap-play-btn" aria-label="播放或暂停">${ICONS.play}</button>
        <button data-next aria-label="下一首">${ICONS.next}</button>
      </div>
      <div data-detail class="cap-fp-detail"></div>
      <nav class="cap-fp-tabs">
        <button data-lyrics aria-selected="true">${ICONS.lyrics}<span>歌词</span></button>
        <button data-queue aria-selected="false">${ICONS.queue}<span>待播队列</span></button>
      </nav>
    </div>
  `;
  D.body.append(panel);

  const q = x => panel.querySelector(x);
  const detail = q('[data-detail]');
  const img = q('.cap-art img');
  const bgImg = q('.cap-ambient img');
  const seek = q('[data-seek]');
  let tab = 'lyrics', identity = '', epoch = 0, lines = [], translations = [], active = -1, dead = false, dragging = false, queueSignature = '';

  const clock = n => Number.isFinite(n) ? `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}` : '0:00';
  function button(label, fn) { const b = D.createElement('button'); b.textContent = label; b.onclick = fn; return b; }

  function updateTabState() {
    q('[data-lyrics]').setAttribute('aria-selected', String(tab === 'lyrics'));
    q('[data-queue]').setAttribute('aria-selected', String(tab === 'queue'));
  }

  function drawQueue() {
    const { queue, queueIndex } = state();
    const sig = JSON.stringify([queue.map(t => [t.id, t.title, t.artist]), queueIndex]);
    if (sig === queueSignature) return;
    queueSignature = sig;
    detail.replaceChildren();
    queue.forEach((t, i) => {
      const row = D.createElement('div');
      row.className = 'cap-queue-row' + (i === queueIndex ? ' is-current' : '');
      const name = button((i === queueIndex ? '♫ ' : '') + t.title + ' — ' + t.artist, () => play(i));
      row.append(name, button('↑', () => move(i, i - 1)), button('↓', () => move(i, i + 1)));
      const del = button('×', () => remove(i));
      del.disabled = i === queueIndex;
      row.append(del);
      detail.append(row);
    });
    if (!queue.length) detail.innerHTML = '<div class="cap-fp-empty">播放队列为空</div>';
  }

  function drawLyrics() {
    detail.replaceChildren();
    active = -1;
    if (!lines.length) {
      detail.innerHTML = '<div class="cap-fp-empty">暂无同步歌词</div>';
      return;
    }
    for (const l of lines) {
      const b = button(l.text, () => {
        if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, l.time);
      });
      b.className = 'cap-lyric';
      const tr = translations.find(t => Math.abs(t.time - l.time) < 0.15);
      if (tr) {
        const small = D.createElement('small');
        small.textContent = tr.text;
        b.append(small);
      }
      detail.append(b);
    }
    updateTime();
  }

  async function loadLyrics() {
    const n = ++epoch;
    lines = []; translations = []; active = -1;
    if (tab === 'lyrics') detail.innerHTML = '<div class="cap-fp-empty">正在读取歌词…</div>';
    const t = state().playing;
    if (!t?.neteaseId || !shared.online?.ready()) {
      if (tab === 'lyrics') detail.innerHTML = '<div class="cap-fp-empty">未关联网易云或服务未连接</div>';
      return;
    }
    try {
      const d = await shared.online.get('/music/lyric?id=' + encodeURIComponent(t.neteaseId));
      if (dead || n !== epoch) return;
      lines = parseLrc(d.lyric);
      translations = parseLrc(d.translation);
      if (tab === 'lyrics') drawLyrics();
    } catch {
      if (!dead && n === epoch && tab === 'lyrics') {
        detail.innerHTML = '<div class="cap-fp-empty">歌词读取失败，可重新点击歌词重试</div>';
      }
    }
  }

  function updateTime() {
    if (panel.hidden) return;
    const time = audio.currentTime || 0;
    const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
    seek.max = dur;
    if (!dragging) seek.value = time;
    const pct = dur > 0 ? Math.min(100, Math.max(0, (time / dur) * 100)) : 0;
    seek.style.setProperty('--cap-progress', pct + '%');
    q('[data-elapsed]').textContent = clock(time);
    q('[data-duration]').textContent = clock(audio.duration);
    if (tab !== 'lyrics' || !lines.length) return;
    let i = -1;
    for (let j = 0; j < lines.length && lines[j].time <= time; j++) i = j;
    if (i === active) return;
    detail.children[active]?.classList.remove('active');
    active = i;
    const el = detail.children[i];
    if (el) {
      el.classList.add('active');
      detail.scrollTo({
        top: el.offsetTop - detail.offsetTop - detail.clientHeight / 2 + el.offsetHeight / 2,
        behavior: 'smooth'
      });
    }
  }

  function refresh() {
    if (dead || panel.hidden) return;
    const { playing: t, actualQuality, resolving, started, statusText } = state();
    q('[data-heading]').textContent = resolving ? '正在加载' : started && !audio.paused ? '正在播放' : '声屿';
    q('[data-status]').textContent = statusText || '';
    q('h2').textContent = t?.title || '尚未播放';
    q('[data-artist]').textContent = t?.artist || '选择一首歌曲';
    q('[data-quality]').textContent = actualQuality || '标准音质';
    q('[data-toggle]').innerHTML = resolving ? ICONS.stop : audio.paused ? ICONS.play : ICONS.pause;
    panel.dataset.playing = String(!audio.paused);

    const id = JSON.stringify([t?.id, t?.neteaseId, t?.coverUrl]);
    if (id !== identity) {
      identity = id;
      img.hidden = true; img.removeAttribute('src');
      bgImg.hidden = true; bgImg.removeAttribute('src');
      panel.style.removeProperty('--cap-art-color');
      try {
        const u = new URL(t?.coverUrl);
        if (u.protocol === 'https:' || u.protocol === 'http:') {
          img.src = u.href; img.hidden = false;
          bgImg.src = u.href; bgImg.hidden = false;
        }
      } catch {}
      if (tab === 'lyrics') void loadLyrics();
      else { epoch++; lines = []; translations = []; }
    }
    if (tab === 'queue') drawQueue();
    updateTime();
  }

  img.onerror = () => { img.hidden = true; bgImg.hidden = true; img.alt = '封面加载失败'; };
  img.onload = () => {
    try {
      const c = D.createElement('canvas'); c.width = c.height = 1;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, 1, 1);
      const [r, g, b] = x.getImageData(0, 0, 1, 1).data;
      panel.style.setProperty('--cap-art-color', `rgb(${r},${g},${b})`);
    } catch {}
  };

  q('[data-diagnostic]').onclick = () => W.prompt('复制播放诊断', state().diagnostic());
  for (const el of panel.querySelectorAll('[data-close]')) {
    el.onclick = () => { panel.hidden = true; epoch++; identity = ''; };
  }
  q('[data-toggle]').onclick = toggle;
  q('[data-prev]').onclick = () => next(-1);
  q('[data-next]').onclick = () => next(1);
  q('[data-lyrics]').onclick = () => { tab = 'lyrics'; updateTabState(); void loadLyrics(); };
  q('[data-queue]').onclick = () => { tab = 'queue'; updateTabState(); queueSignature = ''; drawQueue(); };
  seek.oninput = () => {
    dragging = true;
    const dur = Number(seek.max) || 0;
    seek.style.setProperty('--cap-progress', (dur > 0 ? (Number(seek.value) / dur) * 100 : 0) + '%');
    q('[data-elapsed]').textContent = clock(Number(seek.value));
  };
  seek.onchange = () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Number(seek.value);
    dragging = false;
  };
  seek.onpointercancel = () => { dragging = false; };

  const events = ['timeupdate', 'durationchange', 'play', 'pause', 'loadedmetadata'];
  for (const ev of events) audio.addEventListener(ev, refresh);
  return {
    open() { panel.hidden = false; identity = ''; queueSignature = ''; updateTabState(); refresh(); },
    refresh,
    destroy() { dead = true; epoch++; for (const ev of events) audio.removeEventListener(ev, refresh); panel.remove(); }
  };
}
