import { icon } from './icons.js';
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

const ICONS = Object.fromEntries(["prev","next","play","pause","stop","lyrics","queue"].map(k=>[k,icon(k,k==="play"||k==="pause"?32:24)]));

export function mountNowPlaying({ D, W, audio, shared, state, toggle, next, play, move, remove, volume, mode }) {
  const panel = D.createElement('section');
  panel.className = 'cap-full-player';
  panel.hidden = true;
  panel.setAttribute('aria-label', '声屿全屏播放器');
  panel.innerHTML = `
    <div class="cap-ambient" aria-hidden="true"><img alt="" hidden></div>
    <div class="cap-fp-shell">
      
      <header>
        <button data-close class="cap-fp-pill" aria-label="收起播放器">${icon("down")}</button>
        <span data-heading class="cap-fp-heading">声屿</span>
        <div class="cap-fp-tools"><button data-size-switch aria-label="切换尺寸" >${icon("size")}</button><button data-settings aria-label="设置">${icon("settings")}</button></div>
      </header>
      <div class="cap-art">
        <img alt="专辑封面" hidden>
        <span>${icon("music",32)}</span>
      </div>
      <div class="cap-meta">
        <div class="cap-meta-text">
          <h2></h2>
          <p data-artist></p>
        </div>
        <span class="cap-badge" data-quality></span>
      </div>
      <p data-status role="status" class="cap-fp-status"></p><p data-current-lyric class="cap-current-lyric"></p>
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
      <div class="cap-volume"><span aria-hidden="true">${icon("volumeLow",16)}</span><input data-volume type="range" min="0" max="1" step="0.01" aria-label="音量"><span aria-hidden="true">${icon("volumeHigh",19)}</span></div><small data-volume-note class="cap-volume-note"></small><small class="cap-color-note">封面跨域限制，已使用模糊封面代替取色</small>
      <div data-detail class="cap-fp-detail" hidden></div>
      <nav class="cap-fp-tabs">
        <button data-mode aria-label="播放模式">${icon("repeat")}</button><button data-lyrics aria-label="歌词" aria-selected="false">${ICONS.lyrics}</button>
        <button data-queue aria-label="播放队列" aria-selected="false">${ICONS.queue}</button>
      <button data-library aria-label="曲库">${icon("library")}</button></nav>
    </div>
  `;
  D.body.append(panel);

  const q = x => panel.querySelector(x);
  const detail = q('[data-detail]');
  const sizes = ['compact','half','large'];
  let size = 'half'; try { const saved = W.localStorage.getItem('capricorn_player_size'); if(sizes.includes(saved)) size=saved; } catch {}
  panel.dataset.size=size;
  const reduce=()=>W.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  let closing=null;
  function animateFrom(rect, target=panel){if(!rect||reduce()||!target.animate)return;const r=target.getBoundingClientRect();if(!r.width||!r.height)return;target.animate([{transformOrigin:'top left',transform:`translate(${rect.left-r.left}px,${rect.top-r.top}px) scale(${rect.width/r.width},${rect.height/r.height})`,opacity:.65},{transformOrigin:'top left',transform:'none',opacity:1}],{duration:340,easing:'cubic-bezier(.22,1,.36,1)'});}
  function setSize(){const before=q('.cap-art').getBoundingClientRect();size=sizes[(sizes.indexOf(size)+1)%sizes.length];panel.dataset.size=size;try{W.localStorage.setItem('capricorn_player_size',size)}catch{};animateFrom(before,q('.cap-art'));q('[data-size-switch]').title='当前：'+({compact:'悬浮卡片',half:'半屏',large:'大半屏'}[size]);}
  function closePanel(){if(panel.hidden)return;panel.hidden=true;shared.onPlayerClose?.();}
  function openAux(t){closePanel();shared.openPlayerAux?.(t);}
  function setTab(t){tab=tab===t?'':t;detail.hidden=!tab;panel.dataset.detail=tab;updateTabState();if(tab==='lyrics')void loadLyrics(true);if(tab==='queue'){queueSignature='';drawQueue();}}
  q('[data-size-switch]').onclick=setSize;
  q('[data-settings]').onclick=()=>openAux('settings');
  q('[data-library]').onclick=()=>openAux('library');
  q('[data-mode]').onclick=()=>{mode?.();refresh();};
  const volumeSlider=q('[data-volume]');let volumeDragging=false;
  volumeSlider.onpointerdown=()=>{volumeDragging=true};
  volumeSlider.oninput=e=>volume?.(Number(e.target.value));
  volumeSlider.onchange=e=>{volume?.(Number(e.target.value));volumeDragging=false};
  volumeSlider.onpointerup=volumeSlider.onpointercancel=volumeSlider.onblur=()=>{volumeDragging=false};

  const img = q('.cap-art img');
  const ambient=q('.cap-ambient');
  ambient.replaceChildren();
  let bgEpoch=0, bgURL='', bgActive=null;
  function setAmbient(url){if(url===bgURL)return;bgURL=url;const e=++bgEpoch;
    const retire=el=>{if(!el)return;el.style.opacity='0';setTimeout(()=>{if(el!==bgActive)el.remove()},1300)};
    if(!url){const old=bgActive;bgActive=null;retire(old);return;}
    const layer=D.createElement('div');layer.className='cap-ambient-layer';layer.style.opacity='0';const art=D.createElement('img');art.alt='';layer.append(art);
    art.onload=()=>{if(dead||e!==bgEpoch)return;const old=bgActive;ambient.append(layer);bgActive=layer;void layer.offsetWidth;W.requestAnimationFrame(()=>W.requestAnimationFrame(()=>{if(dead||bgActive!==layer)return;layer.style.opacity='1';retire(old)}));};
    art.onerror=()=>{if(e!==bgEpoch)return;const old=bgActive;bgActive=null;retire(old)};art.src=url;
  }
  const seek = q('[data-seek]');
  let tab = '', identity = '', lyricIdentity = '', epoch = 0;
  let lines = [], translations = [], active = -1, dead = false, dragging = false, queueSignature = '';
  let lastIslandSig = '';

  const clock = n => Number.isFinite(n) ? `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}` : '0:00'; function button(label, fn) { const b = D.createElement('button'); const key = ({'↑':'up','↓':'arrowdown','×':'close'})[label]; if(key && ['↑','↓','×'].includes(label)){b.innerHTML=icon(key,18);b.setAttribute('aria-label',({'↑':'上移','↓':'下移','×':'移除'})[label]);}else b.textContent = label; b.onclick = fn; return b; }  function currentLyricIndex(time) { let i = -1; for (let j = 0; j < lines.length && lines[j].time <= time; j++) i = j; return i; }  function emitIsland() { if (dead || typeof shared.onIslandUpdate !== 'function') return; const t = state().playing; const isPlaying = !audio.paused && !audio.ended && !!t; const idx = isPlaying && lines.length ? currentLyricIndex(audio.currentTime || 0) : -1; const lyric = idx >= 0 ? lines[idx].text : ''; const fallback = t ? (t.artist ? `${t.title} · ${t.artist}` : t.title) : '声屿'; const text = lyric || fallback; const sig = `${isPlaying ? 1 : 0}|${text}`; if (sig === lastIslandSig) return; lastIslandSig = sig; shared.onIslandUpdate({ playing: isPlaying, lyric, title: t?.title || '声屿', artist: t?.artist || '', text }); }  function updateTabState() { q('[data-lyrics]').setAttribute('aria-selected', String(tab === 'lyrics')); q('[data-queue]').setAttribute('aria-selected', String(tab === 'queue')); }  function drawQueue() { const { queue, queueIndex } = state(); const sig = JSON.stringify([queue.map(t => [t.id, t.title, t.artist]), queueIndex]); if (sig === queueSignature) return; queueSignature = sig; detail.replaceChildren(); queue.forEach((t, i) => { const row = D.createElement('div'); row.className = 'cap-queue-row' + (i === queueIndex ? ' is-current' : ''); const name = button((i === queueIndex ? '♫ ' : '') + t.title + ' — ' + t.artist, () => play(i)); row.append(name, button('↑', () => move(i, i - 1)), button('↓', () => move(i, i + 1))); const del = button('×', () => remove(i)); del.disabled = i === queueIndex; row.append(del); detail.append(row); }); if (!queue.length) detail.innerHTML = '<div class="cap-fp-empty">播放队列为空</div>'; }  function drawLyrics() { if (panel.hidden || tab !== 'lyrics') return; detail.replaceChildren(); active = -1; if (!lines.length) { detail.innerHTML = '<div class="cap-fp-empty">暂无同步歌词</div>'; return; } for (const l of lines) { const b = button(l.text, () => { if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, l.time); }); b.className = 'cap-lyric'; const tr = translations.find(t => Math.abs(t.time - l.time) < 0.15); if (tr) { const small = D.createElement('small'); small.textContent = tr.text; b.append(small); } detail.append(b); } updateTime(); }  async function loadLyrics(force = false) { const t = state().playing; const key = t ? `${t.id || ''}|${t.neteaseId || ''}` : ''; if (!force && key && key === lyricIdentity && lines.length) { drawLyrics(); emitIsland(); return; } lyricIdentity = key; const n = ++epoch; lines = []; translations = []; active = -1; emitIsland(); if (!panel.hidden && tab === 'lyrics') detail.innerHTML = '<div class="cap-fp-empty">正在读取歌词…</div>'; if (!t?.neteaseId || !shared.online?.ready()) { if (!panel.hidden && tab === 'lyrics') detail.innerHTML = '<div class="cap-fp-empty">未关联网易云或服务未连接</div>'; return; } try { const d = await shared.online.get('/music/lyric?id=' + encodeURIComponent(t.neteaseId)); if (dead || n !== epoch) return; lines = parseLrc(d.lyric); translations = parseLrc(d.translation); drawLyrics(); emitIsland(); } catch { if (!dead && n === epoch && !panel.hidden && tab === 'lyrics') { detail.innerHTML = '<div class="cap-fp-empty">歌词读取失败，可重新点击歌词重试</div>'; } } }  function updateTime() { emitIsland(); if (panel.hidden) return; const time = audio.currentTime || 0; const dur = Number.isFinite(audio.duration) ? audio.duration : 0; seek.max = dur; if (!dragging) seek.value = time; const pct = dur > 0 ? Math.min(100, Math.max(0, (time / dur) * 100)) : 0; seek.style.setProperty('--cap-progress', pct + '%'); q('[data-elapsed]').textContent = clock(time); q('[data-duration]').textContent = clock(audio.duration); q('[data-current-lyric]').textContent=lines[currentLyricIndex(time)]?.text || ''; if(!volumeDragging)volumeSlider.value=state().userVolume??audio.volume;q('[data-volume-note]').textContent=state().volumeSupported===false?'当前音源仅支持系统音量键':'';volumeSlider.title=state().volumeSupported===false?'当前音源可能需要系统音量键':'音量'; if (tab !== 'lyrics' || !lines.length) return; const i = currentLyricIndex(time); if (i === active) return; detail.children[active]?.classList.remove('active'); active = i; const el = detail.children[i]; if (el) { el.classList.add('active'); detail.scrollTo({ top: el.offsetTop - detail.offsetTop - detail.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' }); } }  function refresh() { if (dead) return; const { playing: t, actualQuality, resolving, started, statusText } = state(); const key = t ? `${t.id || ''}|${t.neteaseId || ''}` : ''; if (key !== lyricIdentity && (!audio.paused || !panel.hidden)) { void loadLyrics(); } emitIsland(); if (panel.hidden) {setAmbient(t?.coverUrl || "");return;}  q('[data-heading]').textContent = resolving ? '正在加载' : started && !audio.paused ? '正在播放' : '声屿'; q('[data-status]').textContent = statusText || ''; q('h2').textContent = t?.title || '尚未播放'; q('[data-artist]').textContent = t?.artist || '选择一首歌曲'; q('[data-quality]').textContent = actualQuality || '标准音质'; q('[data-toggle]').innerHTML = resolving ? ICONS.stop : audio.paused ? ICONS.play : ICONS.pause; panel.dataset.playing = String(!audio.paused); const m=state().playMode; const mb=q("[data-mode]"); const mk=m==="shuffle"?"shuffle":m==="one"?"one":"repeat"; if(mb.dataset.icon!==mk){mb.innerHTML=icon(mk);mb.dataset.icon=mk;mb.title=m==="shuffle"?"随机播放":m==="one"?"单曲循环":"顺序播放";mb.setAttribute("aria-label",mb.title+"，点击切换");}  const id = JSON.stringify([t?.id, t?.neteaseId, t?.coverUrl]); if (id !== identity) { identity = id; img.hidden = true; img.removeAttribute('src'); let ambientUrl=''; panel.style.removeProperty('--cap-art-color'); try { const u = new URL(t?.coverUrl); if (u.protocol === 'https:' || u.protocol === 'http:') { img.src = u.href; img.hidden = false; ambientUrl=u.href; } } catch {} setAmbient(ambientUrl); if (tab === 'lyrics' && key === lyricIdentity) drawLyrics(); } if (tab === 'queue') drawQueue(); updateTime(); }  img.onerror = () => { img.hidden = true; img.alt = '封面加载失败'; }; img.onload = () => { const url=img.src; const probe=new W.Image(); probe.crossOrigin='anonymous'; panel.dataset.colorStatus='loading'; probe.onload=()=>{if(dead||img.src!==url)return;try{const c=D.createElement('canvas');c.width=c.height=24;const x=c.getContext('2d');x.drawImage(probe,0,0,24,24);const d=x.getImageData(0,0,24,24).data;let r=0,g=0,b=0,n=0;for(let i=0;i<d.length;i+=4){if(d[i+3]<128)continue;const w=1+(Math.max(d[i],d[i+1],d[i+2])-Math.min(d[i],d[i+1],d[i+2]))/80;r+=d[i]*w;g+=d[i+1]*w;b+=d[i+2]*w;n+=w}if(!n)throw Error('empty');panel.style.setProperty('--cap-art-color',`rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})`);panel.dataset.colorStatus='ready'}catch{panel.dataset.colorStatus='fallback'}};probe.onerror=()=>{if(img.src===url)panel.dataset.colorStatus='fallback'};probe.src=url; };

  
  for (const el of panel.querySelectorAll('[data-close]')) {
    el.onclick = closePanel;
  }
  q('[data-toggle]').onclick = toggle;
  q('[data-prev]').onclick = () => next(-1);
  q('[data-next]').onclick = () => next(1);
  q('[data-lyrics]').onclick = () => { setTab('lyrics'); };
  q('[data-queue]').onclick = () => { setTab('queue'); };
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

  const events = ['timeupdate', 'durationchange', 'play', 'pause', 'ended', 'loadedmetadata', 'volumechange'];
  for (const ev of events) audio.addEventListener(ev, refresh);
  emitIsland();
  return {
    open() { if(!panel.hidden)return;const r=D.querySelector('#capricorn-hub .cap-island')?.getBoundingClientRect();panel.hidden=false;tab='';detail.hidden=true;panel.dataset.detail='';identity='';queueSignature='';updateTabState();refresh();animateFrom(r); }, close:closePanel, isOpen:()=>!panel.hidden,
    refresh,
    destroy() { dead = true; epoch++; for (const ev of events) audio.removeEventListener(ev, refresh); panel.remove(); }
  };
}
