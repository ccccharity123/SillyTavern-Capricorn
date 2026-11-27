import { indexStoryTracks, groupStoryTracks } from './story-soundtrack.js';
import { createScheduler, maintenancePriority } from './scheduler.js';
import { mountPresetControls } from './preset.js';
import { mountGlobalRegexControl } from './regex-global.js';
import { createGenerationLifecycle } from './generation-lifecycle.js';
import { getChatIdentity, getHostContext } from './host-context.js';
import {
  createBackup, parseBackup, readStoredMemory, readStoredMusic, restoreAppearanceBackup,
  restoreStoredMemory, restoreStoredMusic,
} from './backup.js';
import { clearIndex } from './index-store.js';
import { clearLexicalCache } from './lexical-store.js';
import {fuzzy} from './traces.js';
import { createRecall } from './recall.js';
import { icon } from './icons.js';
import { mountAppearance } from './appearance.js';
import { mountCloud } from './cloud.js';
import { mountNetease } from './netease.js';
import { detachDisabledMemory, startMemory } from './memory.js';
import { startMusic } from './music.js';
import { mountMobile, readFloatSettings } from './mobile.js';
import { mountLauncher } from './ui-launcher.js';
import { mountSelects, nativeSelectsEnabled, refreshSelect, setNativeSelects } from './ui-select.js';
import { popover } from './ui-popover.js';
import { mountSettings } from './ui-settings.js';
import { viewport } from './viewport.js';
import { mountMemoryDock } from './ui-memory-dock.js';
import { attachSegmentSlider, prefersReducedMotion } from './ui-motion.js';
import { uiAlert, uiConfirm, uiToast } from './ui-dialog.js';
import { createSpotlight } from './ui-spotlight.js';

const W = window, D = document;
W.__capricornExtension?.destroy?.();
delete D.body.dataset.capVisualLite;
const flags = { memory: true, music: true };
try {
  const x = JSON.parse(W.localStorage.getItem('capricorn_modules') || '{}');
  for (const k of Object.keys(flags)) if (typeof x[k] === 'boolean') flags[k] = x[k];
} catch {}

const context = () => getHostContext(W);
const chatIdentity = () => getChatIdentity(context());
const scope = () => chatIdentity().scope;
const shared = { flags, onIslandUpdate: null, scope, chatIdentity };
let nativeControlsCleanup;
const selectAdapters = [];
let settingsUi;
let refreshUnifiedStatus = null;
let memoryDock, appearanceApi, cloud, cleanupMobile, launcher, cleanupNetease, cleanupUnifiedRegex, spotlight, memory, music, timer, dead = false, tab = '';
let memoryStartup;
let preparingGeneration = 0;
let changingModule = false;
let lastGeneration = '尚未生成';

const root = D.createElement('div');
root.id = 'capricorn-hub';
root.dataset.floatMode = readFloatSettings().mode;
root.innerHTML = `
  <button class="cap-island" aria-expanded="false" data-playing="false" aria-label="声屿音乐播放器" title="声屿">
    <span class="cap-island-colors" aria-hidden="true"></span>
    <span class="cap-island-lyric-wrap">
      <span class="cap-island-lyric">声屿</span>
      <span class="cap-island-translation" hidden></span>
    </span>
  </button>
  <nav aria-label="声屿" hidden>
    <header class="cap-hub-header">
      <div class="cap-hub-primary" role="tablist" aria-label="声屿面板">
        <button type="button" data-tab="library" role="tab" aria-controls="cap-hub-content"><span aria-hidden="true">${icon('library', 15)}</span><span>曲库</span></button>
        <button type="button" data-tab="resonance" role="tab" aria-controls="cap-hub-content"><span aria-hidden="true">${icon('resonance', 15)}</span><span>共鸣</span></button>
        <button type="button" data-tab="settings" role="tab" aria-controls="cap-hub-settings"><span aria-hidden="true">${icon('settings', 15)}</span><span>设置</span></button>
      </div>
      <div class="cap-hub-actions">
        <button type="button" data-spotlight aria-label="全局功能速达（Alt+K）" title="功能速达（Alt+K）">${icon('search', 16)}</button>
        <button type="button" data-open-player aria-label="打开播放器" title="打开播放器">${icon('play', 17)}</button>
        <button type="button" data-close aria-label="关闭声屿" title="关闭声屿">${icon('close', 17)}</button>
      </div>
    </header>
    <small role="status"></small>
    <section class="cap-settings" id="cap-hub-settings" role="tabpanel" aria-label="摩羯座统一设置" hidden>
      <label data-cap-settings-section="appearance">外观模式
        <select data-cap-select="segment">
          <option value="auto">跟随系统</option>
          <option value="light">日间浅色</option>
          <option value="dark">夜间深色</option>
        </select>
      </label>
    </section>
    <div id="cap-hub-content" class="cap-content" role="tabpanel" aria-label="声屿内容"></div>
  </nav>
`;
D.body.append(root);

const nav = root.querySelector('nav'), island = root.querySelector('.cap-island');
const islandLyric = root.querySelector('.cap-island-lyric');
const islandTranslation = root.querySelector('.cap-island-translation');
const content = root.querySelector('.cap-content'), settings = root.querySelector('.cap-settings');
const primaryTabs = nav.querySelector('.cap-hub-primary');
const spotlightButton = nav.querySelector('[data-spotlight]');
const playerButton = nav.querySelector('[data-open-player]');
const closeButton = nav.querySelector('[data-close]');

function mountSelectRoot(element) {
  if (!element) return;
  try { selectAdapters.push(mountSelects(element)); }
  catch (error) { console.warn('[Capricorn] 下拉框回退原生控件', error); }
}

function fitHub() {
  if (nav.hidden) return;
  const rect = viewport(W);
  nav.style.setProperty('--cap-hub-vx', rect.x + 'px');
  nav.style.setProperty('--cap-hub-vy', rect.y + 'px');
  nav.style.setProperty('--cap-hub-vw', rect.w + 'px');
  nav.style.setProperty('--cap-hub-vh', rect.h + 'px');
}
const visualViewport = W.visualViewport;
W.addEventListener('resize', fitHub);
if (visualViewport) {
  visualViewport.addEventListener('resize', fitHub);
  visualViewport.addEventListener('scroll', fitHub);
}

let islandCover='', currentIslandCover='', islandColorEpoch=0, islandImage, islandFrame;
function stopIslandArtwork() {
  ++islandColorEpoch;
  if (islandImage) {
    islandImage.onload = islandImage.onerror = null;
    islandImage.removeAttribute('src');
    islandImage = null;
  }
  if (islandFrame != null) cancelAnimationFrame(islandFrame);
  islandFrame = null;
}
function colorIsland(url){
  if(url===islandCover)return;
  stopIslandArtwork();
  islandCover=url; const epoch=islandColorEpoch;
  const host=island.querySelector('.cap-island-colors');
  function show(background){
    if(epoch!==islandColorEpoch)return;
    const layer=D.createElement('span');
    layer.style.background=background;
    host.replaceChildren(layer);
    islandFrame=requestAnimationFrame(()=>{
      islandFrame=null;
      if(epoch===islandColorEpoch)layer.style.opacity='1';
    });
  }
  host.replaceChildren(); if(!url)return;
  let u;try{u=new URL(url);if(!['https:','http:'].includes(u.protocol))throw Error();}catch{show('transparent');return;}
  const img=new Image();islandImage=img;img.crossOrigin='anonymous';img.onload=()=>{try{const c=D.createElement('canvas');c.width=c.height=24;const x=c.getContext('2d');x.drawImage(img,0,0,24,24);const d=x.getImageData(0,0,24,24).data;const bins=new Map();for(let i=0;i<d.length;i+=4){if(d[i+3]<128)continue;const rgb=[d[i],d[i+1],d[i+2]];const k=rgb.map(v=>v>>5).join(',');const v=bins.get(k)||[0,0,0,0];v[0]+=rgb[0];v[1]+=rgb[1];v[2]+=rgb[2];v[3]++;bins.set(k,v);}const colors=[...bins.values()].sort((a,b)=>b[3]-a[3]).slice(0,3).map(v=>'rgb('+v.slice(0,3).map(n=>Math.round(n/v[3])).join(',')+')');if(!colors.length)throw Error();show('linear-gradient(135deg,'+[colors[0],colors[1]||colors[0],colors[2]||colors[0]].join(',')+')');}catch{show('transparent');}};img.onerror=()=>show('transparent');img.src=u.href;
}
function refreshIslandArtwork() {
  colorIsland(root.dataset.islandArtwork === 'true' ? currentIslandCover : '');
}
root.addEventListener('capricorn-island-artwork', refreshIslandArtwork);
shared.onIslandUpdate = ({ playing, text, title, coverUrl, translation }) => {
  if (dead) return;
  currentIslandCover = coverUrl || '';
  refreshIslandArtwork();
  const playbackChanged=island.dataset.playing !== String(playing);
  const bilingualChanged=island.dataset.bilingual !== String(!!(playing && translation));
  island.dataset.playing = playing ? 'true' : 'false';
  island.title = playing ? `${title || '正在播放'} · 点击展开声屿` : '声屿（点击打开播放器）';
  const translated = playing ? (translation || '') : '';
  if (islandTranslation.textContent !== translated) islandTranslation.textContent = translated;
  islandTranslation.hidden = !translated;
  island.dataset.bilingual = String(!!translated);
  if (playing && text) {
    if (islandLyric.textContent !== text) {
      islandLyric.classList.remove('is-swap');
      // Avoid forced synchronous layout on every lyric change.
      islandLyric.textContent = text;
      islandLyric.classList.add('is-swap');
    }
  }
  if(playbackChanged || bilingualChanged) cleanupMobile?.fit?.();
  if(playbackChanged) launcher?.onPlayback(playing);
};

const libraryNav = D.createElement('div');
libraryNav.hidden = true;
libraryNav.className = 'cap-library-switch';
libraryNav.setAttribute('role', 'tablist');
libraryNav.setAttribute('aria-label', '曲库来源');
for (const [key,label] of [['library','本地 / 角色'],['cloud','网易云']]) {
  const b = D.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.dataset.tab = key;
  b.setAttribute('role', 'tab');
  b.setAttribute('aria-controls', 'cap-hub-content');
  libraryNav.append(b);
}
content.before(libraryNav);
const primarySlider = attachSegmentSlider(primaryTabs, {
  itemSelector: 'button[role="tab"]:not([hidden])',
  isActive: el => el.getAttribute('aria-selected') === 'true',
});
const librarySlider = attachSegmentSlider(libraryNav, {
  itemSelector: 'button[role="tab"]:not([hidden])',
  isActive: el => el.getAttribute('aria-selected') === 'true',
});
let memoryViewFrame;
const resonance=D.createElement('section');resonance.className='cap-resonance';resonance.hidden=true;content.append(resonance);
let resonanceEpoch=0;
let recall;
function unlockRecall(){shared.recallLocked=false;}
function refreshMemoryViews() {
  if (dead || !flags.memory || memoryViewFrame != null) return;
  memoryViewFrame = requestAnimationFrame(() => {
    memoryViewFrame = null;
    if (!flags.memory || dead) return;
    void recall?.refresh();
    if (memoryDock?.isOpen()) void memoryDock.refresh();
    if (tab === 'resonance') void showResonance();
  });
}
async function showResonance(){
  const epoch = ++resonanceEpoch, key = scope();
  resonance.dataset.scope = key;
  resonance.replaceChildren();
  const el = (tag, text, parent = resonance, cls = '') => {
    const n = D.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    parent?.append(n);
    return n;
  };
  const skWrap = el('div', null, resonance, 'cap-res-list');
  skWrap.setAttribute('aria-label', '正在读取剧情原声');
  for (let s = 0; s < 3; s++) {
    const sk = el('div', null, skWrap, 'cap-skeleton-row');
    sk.setAttribute('aria-hidden', 'true');
    sk.innerHTML = '<span class="cap-sk-art"></span><span class="cap-sk-lines"><i></i><i></i></span>';
  }
  try {
    const [memories, soundtrack] = await Promise.all([memory?.timelineRows(), music?.timelineSongs()]);
    const rows = (memories || []).sort((a, b) => a.floor - b.floor);
    const songs = indexStoryTracks(soundtrack || []);
    if (epoch !== resonanceEpoch || key !== scope() || tab !== 'resonance') return;
    resonance.replaceChildren();

    const head = el('div', null, resonance, 'cap-res-header');
    el('h3', '共鸣 · 剧情原声', head);
    const recallBtn = el('button', null, head, 'cap-res-recall');
    recallBtn.type = 'button';
    recallBtn.innerHTML = `${icon('sparkle', 14, { weight: 'duotone' })}<span>回响</span>`;
    recallBtn.title = '打开回响 · 沉浸式剧情漫游';
    recallBtn.onclick = () => recall?.open();

    const actions = el('div', null, resonance, 'cap-res-actions');
    const play = el('button', null, actions, 'cap-res-play-all');
    play.type = 'button';
    play.innerHTML = `${icon('play', 14)}<span>播放原声带</span>`;

    const lock = el('button', null, actions, 'cap-res-lock');
    lock.type = 'button';
    const syncLock = () => {
      const locked = !!shared.recallLocked;
      lock.setAttribute('aria-pressed', String(locked));
      lock.innerHTML = `${icon('lock-simple', 14, { active: locked })}<span>${locked ? '已锁切歌' : '跟随剧情'}</span>`;
      lock.title = locked ? '点击解除音乐锁定，恢复跟随剧情切歌' : '点击锁定当前音乐，暂停剧情自动切歌';
    };
    syncLock();
    lock.onclick = () => { shared.recallLocked = !shared.recallLocked; syncLock(); };

    const filters = el('div', null, resonance, 'cap-res-filters');
    const searchWrap = el('div', null, filters, 'cap-res-search-wrap');
    const searchIco = el('span', null, searchWrap, 'cap-res-search-icon');
    searchIco.innerHTML = icon('search', 14);
    const q = el('input', null, searchWrap, 'cap-res-search');
    q.type = 'search';
    q.placeholder = '搜索歌曲、歌手或剧情';
    q.setAttribute('aria-label', '搜索歌曲、歌手、剧情');

    const chapter = el('select', null, filters, 'cap-res-chapter');
    chapter.dataset.capSelect = 'search';
    chapter.setAttribute('aria-label', '章节');
    for (const c of ['', ...new Set(rows.map(r => r.chapter).filter(Boolean))]) {
      const o = el('option', c || '全部章节', chapter);
      o.value = c;
    }

    const list = el('div', null, resonance, 'cap-res-list');
    const valid = () => epoch === resonanceEpoch && key === scope() && tab === 'resonance';

    let limit = 40;
    function render() {
      if (!valid()) return;
      list.replaceChildren();
      const grouped = groupStoryTracks(rows, songs, {chapter: chapter.value, query: q.value, match: fuzzy});
      const playableIds = [...grouped.values()].filter(g => g.t.playable).map(g => g.t.id);
      play.disabled = !playableIds.length;
      play.onclick = () => {
        if (valid()) {
          shared.recallLocked = true;
          syncLock();
          music.playStoryQueue(playableIds, chapter.value || '剧情原声带');
        }
      };
      if (!grouped.size) {
        el('p', '暂无匹配的已归档剧情音乐', list, 'cap-res-empty');
        return;
      }
      for (const { t, rows: matches } of [...grouped.values()].slice(0, limit)) {
        const d = el('details', null, list, 'cap-res-card');
        const sum = el('summary', null, d, 'cap-res-summary');

        const art = el('span', null, sum, 'cap-res-art');
        art.setAttribute('aria-hidden', 'true');
        let validCover = '';
        try {
          if (t.coverUrl) {
            const u = new URL(t.coverUrl);
            if (['https:', 'http:'].includes(u.protocol)) validCover = u.href.replace(/^http:/, 'https:');
          }
        } catch {}
        if (validCover) {
          const img = D.createElement('img');
          img.loading = 'lazy';
          img.decoding = 'async';
          img.alt = '';
          img.src = validCover;
          img.onerror = () => { art.innerHTML = icon('music-note', 16); };
          art.append(img);
        } else {
          art.innerHTML = icon('music-note', 16);
        }

        const info = el('div', null, sum, 'cap-res-track-info');
        el('strong', t.title, info);
        el('small', `${t.artist} · ${matches.length} 幕`, info);

        const playBtn = el('button', null, sum, 'cap-res-play-btn');
        playBtn.type = 'button';
        playBtn.innerHTML = icon('play', 14);
        playBtn.disabled = !t.playable;
        playBtn.title = t.playable ? '播放此曲' : '暂无可用音源';
        playBtn.setAttribute('aria-label', '播放 ' + t.title);
        playBtn.onclick = event => {
          event.preventDefault();
          event.stopPropagation();
          if (valid()) {
            shared.recallLocked = true;
            syncLock();
            music.playStoryQueue([t.id], t.title);
          }
        };

        const body = el('div', null, d, 'cap-res-moments');
        let momentLimit = 30;
        const renderMoments = () => {
        body.replaceChildren();
        for (const r of matches.slice(0, momentLimit)) {
          const item = el('div', null, body, 'cap-res-moment');
          const meta = el('div', null, item, 'cap-res-moment-text');
          el('strong', `${r.chapter ? r.chapter + ' · ' : ''}${r.title}`, meta);
          el('small', r.when, meta);
          const j = el('button', null, item, 'cap-res-jump');
          j.type = 'button';
          j.innerHTML = `<span>便签</span>${icon('external', 12)}`;
          j.title = '查看剧情便签';
          j.onclick = () => {
            if (!valid()) return;
            close();
            if (memoryDock) void memoryDock.open(r.floor);
            else memory.root.classList.remove('shiyi-collapsed');
          };
        }
        if (matches.length > momentLimit) {
          const more = el('button', `查看更多剧情（${momentLimit}/${matches.length}）`, body, 'cap-res-jump');
          more.type = 'button';
          more.onclick = () => { if (valid()) { momentLimit += 30; renderMoments(); } };
        }
        };
        d.addEventListener('toggle', () => { if (d.open && valid() && !body.childNodes.length) renderMoments(); });
      }
      if (grouped.size > limit) {
        const more = el('button', `查看更多歌曲（${limit}/${grouped.size}）`, list, 'cap-res-jump');
        more.type = 'button';
        more.onclick = () => { limit += 40; render(); };
      }
    }
    q.oninput = chapter.onchange = () => { limit = 40; render(); };
    render();
  } catch (e) {
    if (epoch === resonanceEpoch) resonance.textContent = '读取失败：' + e.message;
  }
}
let theme = 'auto';
try { theme = W.localStorage.getItem('capricorn_theme') || 'auto'; } catch {}
const themeSelect = settings.querySelector('select');
themeSelect.value = theme;
root.dataset.theme = theme;
themeSelect.onchange = () => {
  root.dataset.theme = themeSelect.value;
  try { W.localStorage.setItem('capricorn_theme', themeSelect.value); } catch {}
};

function select(t) {
  if (t === 'cloud' && !shared.accountReady?.()) t = 'library';
  if ((t === 'library' || t === 'music' || t === 'cloud') && !music) t = 'settings';
  if (t === 'resonance' && (!memory || !music)) t = 'settings';
  if (t === 'music') t = 'library';
  if (t !== tab) popover.closeWithin(nav);
  tab = t;
  root.dataset.tab = t;
  D.body.dataset.capricornTab = t;
  settings.hidden = t !== 'settings';
  if (t === 'settings') settingsUi?.sync?.(true);
  content.hidden = !['library', 'cloud', 'resonance'].includes(t);
  resonance.hidden = t !== 'resonance';
  if (t === 'resonance') void showResonance();
  if (t === 'cloud') cloud?.show(); else cloud?.hide();
  libraryNav.hidden = !['library','cloud'].includes(t)||!shared.accountReady?.();
  for (const b of primaryTabs.querySelectorAll('[data-tab]')) {
    const selected = b.dataset.tab === (t === 'cloud' ? 'library' : t);
    if (b.getAttribute('aria-selected') !== String(selected)) {
      b.firstElementChild.innerHTML = icon(b.dataset.tab, 15, { active: selected });
    }
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
  }
  for (const b of libraryNav.querySelectorAll('[data-tab]')) {
    const selected = b.dataset.tab === t;
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
  }
  if (t === 'library') music?.show(); else music?.hide();
  if (t === 'memory' && flags.memory) memoryDock?.open();
}

function cancelHubClose() {
  for (const animation of nav.getAnimations?.() || []) {
    try { animation.cancel(); } catch (_) {}
  }
  nav.classList.remove('is-closing');
}
function close() {
  cancelHubClose();
  popover.closeWithin(nav);
  if (nav.hidden) return;
  nav.hidden = true;
  root.dataset.panelOpen = 'false';
  island.setAttribute('aria-expanded', 'false');
  select('');
  launcher?.onPanelChange();
}

shared.onPlayerClose=()=>{island.setAttribute('aria-expanded','false');launcher?.onPanelChange();};
let hubOpenedAt = -Infinity;
function openHub(t) {
  hubOpenedAt = performance.now();
  cancelHubClose();
  nav.hidden = false;
  root.dataset.panelOpen = 'true';
  island.setAttribute('aria-expanded', 'true');
  fitHub();
  select(t);
  primarySlider.sync(true);
  librarySlider.sync(true);
  if (tab === 'settings') settingsUi?.sync?.(true);
  launcher?.wake();
  launcher?.onPanelChange();
}
shared.openPlayerAux = openHub;
function openPlayer() {
  if (!music) return;
  close(true);
  music.openPlayer();
  island.setAttribute('aria-expanded', 'true');
  launcher?.onPanelChange();
}

// Click outside hub nav smoothly dismisses it
function onOutsideHubPointerDown(event) {
  if (nav.hidden || dead || performance.now() - hubOpenedAt < 650) return;
  const t = event.target;
  if (!t || root.contains(t) || t.closest?.('.cap-full-player, .si-edge-handle')) return;
  if (t.closest?.('.cap-ui-portal, .cap-dialog-overlay, .cap-spotlight-overlay, .cap-song-picker-overlay, .shiyi-overlay, .cap-recall')) return;
  close();
}
let lastIslandClick = -Infinity;
island.onclick = (event) => {
  event?.stopPropagation();
  const now = performance.now();
  if (now - lastIslandClick < 450) return;
  lastIslandClick = now;
  if (cleanupMobile?.consumeDrag()) return;
  if(music?.isPlayerOpen()){music.closePlayer();return;}
  openPlayer();
};
closeButton.onclick = () => close();
if (spotlightButton) spotlightButton.onclick = () => spotlight?.open();
playerButton.onclick = openPlayer;
nav.querySelectorAll('[data-tab]').forEach(button => {
  button.onclick = () => {
    const target = button.dataset.tab;
    if (target === 'settings' && tab === 'settings' && settingsUi && !settingsUi.isHome?.()) {
      settingsUi.home();
      return;
    }
    select(target);
  };
});
function navigateTabs(event) {
  const buttons = Array.from(event.currentTarget.querySelectorAll('button:not([hidden])'));
  const current = buttons.indexOf(event.target);
  if (current < 0) return;
  let next;
  switch (event.key) {
    case 'ArrowLeft': next = (current + buttons.length - 1) % buttons.length; break;
    case 'ArrowRight': next = (current + 1) % buttons.length; break;
    case 'Home': next = 0; break;
    case 'End': next = buttons.length - 1; break;
    default: return;
  }
  event.preventDefault();
  buttons[next].click();
  buttons[next].focus();
}
primaryTabs.onkeydown = libraryNav.onkeydown = navigateTabs;
nav.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented) close(); });

const maintenance=createScheduler(W,()=>D.hidden);
shared.maintenance = maintenance;
function tick() {
  if (dead) return;
  try {
    generation.bind();
    if (flags.memory) recall?.check();
    const key = scope();
    maintenance.setContext(key, memory?.messageVersion?.());
    if (music) maintenance.enqueue('声屿', task => music.tick(task), maintenancePriority.audio,
      { lane: 'audio', scoped: true, duringForeground: true });
    if (memory && flags.memory) maintenance.enqueue('拾忆', task => memory.tick(task), maintenancePriority.memory, { scoped: true });
    if (flags.memory) memoryDock?.tick();
    if (!nav.hidden && tab === 'settings') refreshUnifiedStatus?.();
    if (flags.memory && tab === 'resonance' && resonance.dataset.scope !== key) {
      unlockRecall();
      void showResonance();
    }
  } catch (e) {
    const status = nav.querySelector(':scope > small');
    if (status && status.textContent !== e.message) status.textContent = e.message;
  }
}

const generation = createGenerationLifecycle({
  context, scope, flags,
  ready: () => memoryStartup,
  memory: () => memory,
  async disableMemory() {
    const worldbooks = W.TavernHelper?.getGlobalWorldbookNames || W.getGlobalWorldbookNames;
    if (typeof worldbooks === 'function') await detachDisabledMemory(shared);
    else context().setExtensionPrompt?.('capricorn_weave', '', 1, 4, false, 0);
  },
  report({ type, result, enabled, error }) {
    const status = nav.querySelector(':scope > small');
    if (error) {
      lastGeneration = '已停止本轮生成，拾忆校验失败：' + error.message;
      status.textContent = lastGeneration;
      W.toastr?.error?.(lastGeneration);
      return;
    }
    const label = type || 'normal';
    lastGeneration = enabled
      ? `${result?.content ? '已注入' : '本轮无动态注入'}（${label}）`
      : '拾忆已停用';
    status.textContent = '';
  },
  refresh: tick,
});
async function prepareGeneration(...args) {
  if (changingModule) { args[2]?.(true); W.toastr?.warning?.('模块正在切换，请稍后重新发送'); return; }
  maintenance.setContext(scope(), memory?.messageVersion?.());
  const release = maintenance.beginForeground();
  preparingGeneration++;
  try { return await generation.prepare(...args); }
  finally { preparingGeneration--; release(); }
}
W.capricornPrepareGeneration = prepareGeneration;

W.__capricornExtension = {
  destroy() {
    if (dead) return;
    dead = true;
    if (W.capricornPrepareGeneration === prepareGeneration) delete W.capricornPrepareGeneration;
    generation.destroy();
    stopIslandArtwork();
    if (memoryViewFrame != null) cancelAnimationFrame(memoryViewFrame);
    ++resonanceEpoch;
    recall?.close();
    popover.destroy();
    for (const adapter of selectAdapters) adapter.destroy();
    settingsUi?.destroy();
    W.removeEventListener('resize', fitHub);
    if (visualViewport) {
      visualViewport.removeEventListener('resize', fitHub);
      visualViewport.removeEventListener('scroll', fitHub);
    }
    maintenance.close();
    cancelHubClose();
    primarySlider.destroy();
    librarySlider.destroy();
    D.removeEventListener('visibilitychange', resume);
    D.removeEventListener('input', deferMaintenance, true);
    D.removeEventListener('keydown', onGlobalKeyDown);
    D.removeEventListener('pointerdown', onOutsideHubPointerDown);
    appearanceApi?.destroy();
    launcher?.destroy();
    cleanupMobile?.destroy();
    memoryDock?.destroy();
    spotlight?.destroy();
    cleanupUnifiedRegex?.();
    cleanupNetease?.();
    cloud?.destroy();
    clearInterval(timer);
    memory?.destroy();
    music?.destroy();
    nativeControlsCleanup?.();
    root.remove();
    delete D.body.dataset.capricornTab;
    delete D.body.dataset.capVisualLite;
  }
};

function deferMaintenance(event) {
  if (event.target?.closest?.('textarea, input[type=text], [contenteditable=true]')) maintenance.noteInput();
}
function resume() {
  if (dead) return;
  if (D.hidden) { maintenance.suspend(); return; }
  maintenance.resume();
  tick();
}

function onGlobalKeyDown(event) {
  if (event.defaultPrevented || dead) return;
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key?.toLowerCase() === 'k') {
    if (event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    event.preventDefault();
    if (spotlight?.isOpen?.()) spotlight.close();
    else spotlight?.open();
    return;
  }
  if (event.key !== 'Escape') return;
  if (D.querySelector('.cap-dialog-overlay, .cap-spotlight-overlay, .cap-ui-portal, .shiyi-overlay, .cap-song-picker-overlay, .cap-recall')) return;
  if (!nav.hidden) {
    if (tab === 'settings' && settingsUi && !settingsUi.isHome?.()) {
      settingsUi.home();
      return;
    }
    close();
    return;
  }
  if (music?.isPlayerOpen?.()) { music.closePlayer(); return; }
  if (memoryDock?.isOpen?.()) { if (memoryDock.close) memoryDock.close(); else memory?.setCollapsed?.(true); }
}

async function boot() {
D.body.dataset.capricornTab = '';
generation.bind();
memoryStartup = flags.memory ? startMemory(shared).then(module => {
  if (dead) module.destroy();
  else memory = module;
}).catch(e => console.error('[Capricorn] memory', e)) : Promise.resolve();
const musicStartup = flags.music ? startMusic(shared).then(module => {
  if (dead) module.destroy();
  else music = module;
}).catch(e => console.error('[Capricorn] music', e)) : Promise.resolve();
await Promise.all([memoryStartup, musicStartup]);
if (dead) return;

if (memory?.root) {
  recall = createRecall({ D, W, scope, memory, music, shared });
  memory.onChange = refreshMemoryViews;
  try {
    memoryDock = mountMemoryDock({
      memory, music, scope,
      openAppearance: () => appearanceApi?.toggleInlineDrawer(),
      closeAppearance: () => appearanceApi?.closeInlineDrawer(),
      openRecall: () => recall.open(),
    });
  } catch (error) {
    console.warn('[Capricorn] 拾忆界面回退', error);
  }
}

if (music?.root) { content.append(music.root); }
D.addEventListener('visibilitychange',resume);
D.addEventListener('input',deferMaintenance,true);
D.addEventListener('keydown',onGlobalKeyDown);
D.addEventListener('pointerdown',onOutsideHubPointerDown);
timer = setInterval(() => { if (!D.hidden) tick(); }, 4000);
tick();

const controls = D.createElement('div');
controls.className = 'cap-backup';
controls.dataset.capSettingsSection = 'backup';
controls.innerHTML = '<h4>数据与索引</h4><button data-backup>导出统一备份</button><button data-restore>从备份恢复</button><button data-cache>重建聊天检索索引</button><input type="file" accept=".json,application/json" hidden><p data-result role="status"></p>';
settings.append(controls);
const services = D.createElement('section');
services.className = 'cap-backup cap-ios-section';
services.dataset.capSettingsSection = 'services';
services.innerHTML = `
  <h4>运行与兼容性</h4>
  <div class="cap-ios-group">
    <label class="cap-ios-row">
      <span class="cap-ios-row-label">使用系统原生下拉菜单</span>
      <input type="checkbox" data-native-selects>
    </label>
  </div>
`;
const nativeSelects = services.querySelector('[data-native-selects]');
nativeSelects.checked = nativeSelectsEnabled(D);
nativeSelects.onchange = () => setNativeSelects(D, nativeSelects.checked);
settings.append(services);

// Unified controls: iOS Inset Grouped 3-part layout
const memoryPanel = D.createElement('section');
memoryPanel.className = 'cap-unified-module';
memoryPanel.dataset.capSettingsSection = 'memory';
memoryPanel.innerHTML = `
  <div class="cap-ios-module-head" data-module-head="memory">
    <div class="cap-ios-module-meta">
      <span class="cap-ios-module-icon">${icon('bookmark', 18)}</span>
      <div class="cap-ios-module-titles">
        <h4>拾忆 · 剧情记忆</h4>
        <span class="cap-ios-status-line" data-status-line><i class="cap-status-dot"></i><span class="cap-unified-status" role="status"></span></span>
      </div>
    </div>
    <input type="checkbox" data-module-toggle="memory" aria-label="启用拾忆">
  </div>
  <div class="cap-tile-grid cap-tile-grid-3">
    <button type="button" class="cap-tile-btn" data-view="timeline">${icon('note', 20)}<span>打开便签</span></button>
    <button type="button" class="cap-tile-btn" data-view="table">${icon('table', 20)}<span>查看表格</span></button>
    <button type="button" class="cap-tile-btn" data-view="dossier">${icon('users', 20)}<span>人物档案</span></button>
  </div>
  <div class="cap-ios-group cap-mem-tools-group">
    <button type="button" class="cap-ios-action-row" data-mem-action="recall"><span class="cap-ios-row-ico">${icon('sparkle', 16)}</span><span class="cap-ios-row-label">回响 · 剧情漫游</span><span class="cap-ios-row-chev">${icon('right', 14)}</span></button>
    <button type="button" class="cap-ios-action-row" data-mem-action="review"><span class="cap-ios-row-ico">${icon('check', 16)}</span><span class="cap-ios-row-label">审核待入库摘要</span><span class="cap-ios-row-badge" data-mem-pending hidden></span><span class="cap-ios-row-chev">${icon('right', 14)}</span></button>
    <button type="button" class="cap-ios-action-row" data-mem-action="import"><span class="cap-ios-row-ico">${icon('folder-open', 16)}</span><span class="cap-ios-row-label">全量检测 / 历史补录</span><span class="cap-ios-row-chev">${icon('right', 14)}</span></button>
    <button type="button" class="cap-ios-action-row" data-mem-action="archive"><span class="cap-ios-row-ico">${icon('archive', 16)}</span><span class="cap-ios-row-label">正文归档与隐藏</span><span class="cap-ios-row-chev">${icon('right', 14)}</span></button>
    <button type="button" class="cap-ios-action-row" data-mem-action="manage"><span class="cap-ios-row-ico">${icon('list', 16)}</span><span class="cap-ios-row-label">剧情档案管理与回收站</span><span class="cap-ios-row-chev">${icon('right', 14)}</span></button>
    <button type="button" class="cap-ios-action-row" data-mem-action="settings"><span class="cap-ios-row-ico">${icon('sliders-horizontal', 16)}</span><span class="cap-ios-row-label">拾忆核心与向量设置</span><span class="cap-ios-row-chev">${icon('right', 14)}</span></button>
  </div>
  <p class="cap-ios-footnote">便签、随层表格与留痕档案共享同一份聊天记忆；已启动的拾忆可免刷新暂停与恢复；首次启用及声屿开关仍需刷新。历史数据保留。</p>
`;
settings.append(memoryPanel);

const musicPanel = D.createElement('section');
musicPanel.className = 'cap-unified-module';
musicPanel.dataset.capSettingsSection = 'music';
musicPanel.innerHTML = `
  <div class="cap-ios-module-head" data-module-head="music">
    <div class="cap-ios-module-meta">
      <span class="cap-ios-module-icon">${icon('music', 18)}</span>
      <div class="cap-ios-module-titles">
        <h4>声屿 · 音乐播放</h4>
        <span class="cap-ios-status-line" data-status-line><i class="cap-status-dot"></i><span class="cap-unified-status" role="status"></span></span>
      </div>
    </div>
    <input type="checkbox" data-module-toggle="music" aria-label="启用声屿">
  </div>
  <div class="cap-tile-grid cap-tile-grid-2">
    <button type="button" class="cap-tile-btn" data-open-music>${icon('play', 20)}<span>打开播放器</span></button>
    <button type="button" class="cap-tile-btn" data-open-library>${icon('library', 20)}<span>打开曲库</span></button>
  </div>
  <div class="cap-ios-group" data-music-prefs></div>
  <p class="cap-ios-footnote" data-music-footnote></p>
`;
settings.append(musicPanel);

for (const button of memoryPanel.querySelectorAll('[data-view]')) {
  button.disabled = !memory;
  button.addEventListener('click', () => {
    const target = button.dataset.view;
    close(true);
    if (!flags.memory) return;
    if (memoryDock?.navigate) memoryDock.navigate(target);
    else if (memory) { memory.setCollapsed?.(false); memoryDock?.open?.(); }
  });
}
for (const button of memoryPanel.querySelectorAll('[data-mem-action]')) {
  button.disabled = !memory;
  button.addEventListener('click', () => {
    const action = button.dataset.memAction;
    close(true);
    if (!flags.memory || !memory) return;
    if (action === 'recall') { recall?.open(); return; }
    if (memoryDock?.trigger) memoryDock.trigger(action);
    else memory.root?.querySelector('#shiyi-' + action)?.click();
  });
}
musicPanel.querySelector('[data-open-music]').disabled = !music;
musicPanel.querySelector('[data-open-music]').onclick = openPlayer;
musicPanel.querySelector('[data-open-library]').disabled = !music;
musicPanel.querySelector('[data-open-library]').onclick = () => openHub('library');

function updateUnifiedStatus() {
  const memHead = memoryPanel.querySelector('[data-module-head="memory"]');
  const musHead = musicPanel.querySelector('[data-module-head="music"]');
  const memReady = Boolean(memory && flags.memory);
  memHead.dataset.active = String(memReady);
  for (const button of memoryPanel.querySelectorAll('[data-view], [data-mem-action]')) button.disabled = !memReady;
  const pendingEl = memoryPanel.querySelector('[data-mem-pending]');
  if (pendingEl) {
    const pending = memReady ? Number(memory?.pending?.() || 0) : 0;
    pendingEl.hidden = pending <= 0;
    pendingEl.textContent = pending > 0 ? String(pending) : '';
  }
  primaryTabs.querySelector('[data-tab="resonance"]').hidden = !(music && memReady);
  musHead.dataset.active = String(Boolean(music));
  memoryPanel.querySelector('.cap-unified-status').textContent = memReady ? '运行中 · 当前聊天已接入' : '已暂停 / 未启用';
  musicPanel.querySelector('.cap-unified-status').textContent = music ? '运行中 · 悬浮球 / 灵动岛就绪' : '未启用';
  settingsUi?.refreshSummaries?.();
}
refreshUnifiedStatus = updateUnifiedStatus;
updateUnifiedStatus();

const musicPrefs = musicPanel.querySelector('[data-music-prefs]');
const musicFootnote = musicPanel.querySelector('[data-music-footnote]');
musicPrefs.hidden = !music;

const followLabel = D.createElement('label');
followLabel.className = 'cap-ios-row';
const followText = D.createElement('span');
followText.className = 'cap-ios-row-label';
followText.textContent = '音乐跟随剧情自动切歌';
const followInput = D.createElement('input');
followInput.type = 'checkbox';
followInput.checked = W.localStorage.getItem('capricorn_follow_story') !== 'off';
followInput.onchange = () => W.localStorage.setItem('capricorn_follow_story', followInput.checked ? 'on' : 'off');
followLabel.append(followText, followInput);
musicPrefs.append(followLabel);
const characterFollowLabel=followLabel.cloneNode(true);
characterFollowLabel.querySelector('span').textContent='切换角色卡时自动切歌';
const characterFollowInput=characterFollowLabel.querySelector('input');
characterFollowInput.checked=W.localStorage.getItem('capricorn_follow_character')!=='off';
characterFollowInput.onchange=()=>W.localStorage.setItem('capricorn_follow_character',characterFollowInput.checked?'on':'off');
musicPrefs.append(characterFollowLabel);
for(const [key,label] of [['startup','进入酒馆时自动播放'],['open','打开播放器时自动播放'],['story','静止时允许剧情 BGM 自动播放']]){
 const row=D.createElement('label');row.className='cap-ios-row';const title=D.createElement('span');title.textContent=label;const input=D.createElement('input');input.type='checkbox';input.checked=W.localStorage.getItem('capricorn_auto_'+key)==='on';input.onchange=()=>W.localStorage.setItem('capricorn_auto_'+key,input.checked?'on':'off');row.append(title,input);musicPrefs.append(row);
}

if (music) {
  const backgroundLabel = D.createElement('label');
  backgroundLabel.className = 'cap-ios-row';
  const bgText = D.createElement('span');
  bgText.className = 'cap-ios-row-label';
  bgText.textContent = 'iOS 后台播放优先';
  const backgroundInput = D.createElement('input');
  backgroundInput.type = 'checkbox';
  backgroundInput.checked = music.backgroundPriority?.() === true;
  backgroundLabel.append(bgText, backgroundInput);
  musicPrefs.append(backgroundLabel);
  backgroundInput.addEventListener('change', () => music.setBackgroundPriority?.(backgroundInput.checked));
  musicFootnote.textContent = 'iOS 后台播放优先默认关闭（保留应用内音量）。需要锁屏、后台及系统灵动岛时建议开启，再切换歌曲：使用原生音频及系统音量键。后台播放还取决于宿主权限；关闭时尝试系统播放会话与网页音量并存。更改后下一首生效。';
} else {
  musicFootnote.textContent = '声屿已停用；重新开启将刷新页面并恢复原有歌单与设置。';
}

const health=D.createElement('details');health.innerHTML='<summary>运行诊断</summary><pre style="white-space:pre-wrap"></pre><button type="button">刷新诊断</button>';services.append(health);
const updateHealth=()=>{
  const m=maintenance.status();
  const buffer = maintenance.budget();
  const moduleInfo = [memory?.diagnostics?.(), music?.diagnostics?.()].flatMap(info =>
    typeof info === 'string' ? [info] : Object.entries(info || {}).map(([k,v])=>`${k}：${v}`));
  health.querySelector('pre').textContent=[
    `拾忆：${memory&&flags.memory?'已启动':'已暂停 / 未启动'}`,
    `声屿：${music?'已启动':'未启动'}`,
    `生成注入：${lastGeneration}`,
    `后台维护：${m.running?'执行中':'空闲'} / 等待 ${m.pending}`,
    `运行通道：${m.lanes.join('、') || '无'} / 输入让位：${m.inputDeferred ? '是' : '否'}`,
    `后台缓冲：${Math.ceil(buffer.reserved/1024)} KiB / ${buffer.maxBytes/1024/1024} MiB`,
    ...moduleInfo,
    ...Object.entries(m.stats).map(([k,v])=>`${k}：${v.runs} 次 / 异常 ${v.errors} / 取消 ${v.cancelled||0} / 最近 ${v.lastMs}ms`),
  ].join('\n');
};
health.querySelector('button').onclick=updateHealth;
health.addEventListener('toggle',()=>{if(health.open)updateHealth();});

island.hidden = !music;
playerButton.hidden = !music;
primaryTabs.querySelector('[data-tab="library"]').hidden = !music;
primaryTabs.querySelector('[data-tab="resonance"]').hidden = !(music && memory);

const result = (msg, kind = 'info') => { controls.querySelector('[data-result]').textContent = msg; if (msg) uiToast(msg, { doc: D, kind }); };
async function setModule(k, value) {
  if (changingModule) return false;
  changingModule = true;
  try {
    if (preparingGeneration || dataOperation) throw Error('请等待当前生成准备或数据操作完成');
    const next = {...flags, [k]: value};
    if (k === 'memory' && memory) {
      const previous = flags.memory;
      flags.memory = value;
      try {
        if (!value) {
          for (const key of ['拾忆', '拾忆索引', '拾忆向量']) maintenance.cancel(key);
          ++resonanceEpoch;
          recall?.close();
          unlockRecall();
          memoryDock?.close();
          await memory.suspend();
        } else {
          memory.resume();
        }
        W.localStorage.setItem('capricorn_modules', JSON.stringify(next));
      } catch (error) {
        flags.memory = previous;
        if (previous) memory.resume();
        else await memory.suspend();
        tick();
        throw error;
      }
      if (tab === 'resonance' && !value) select('settings');
      updateUnifiedStatus();
      tick();
      return true;
    }
    if (!await uiConfirm('此操作需要刷新酒馆页面，可能中断播放或 RP。是否继续？', {doc:D,title:'模块切换',confirmText:'刷新并应用'})) return false;
    W.localStorage.setItem('capricorn_modules', JSON.stringify(next));
    Object.assign(flags,next);
    W.location.reload();
    return true;
  } catch (error) {
    await uiAlert('无法更新模块设置：'+error.message, { doc: D, title: '模块更新失败' });
    return false;
  } finally {
    changingModule = false;
  }
}
for (const [kind, panel] of [['memory', memoryPanel], ['music', musicPanel]]) {
  const input = panel.querySelector(`[data-module-toggle="${kind}"]`);
  if (!input) continue;
  input.checked = flags[kind];
  input.addEventListener('change', async () => {
    if (!await setModule(kind, input.checked)) input.checked = flags[kind];
  });
}
function mountNativeControls(){
  const panel=D.createElement('div'); panel.id='capricorn-native-settings'; panel.className='inline-drawer';
  panel.innerHTML='<div class="inline-drawer-toggle inline-drawer-header"><b>摩羯座 · Capricorn</b><div class="inline-drawer-icon down">' + icon('down') + '</div></div><div class="inline-drawer-content" style="display:none"><p>统一设置与数据管理 · 拾忆和声屿共用一个控制中心。</p></div>';
  const body=panel.querySelector('.inline-drawer-content');
  // Android hosts compress nested menu wrappers into a narrow column.
  const menu=D.createElement('button');
  menu.id='capricorn-native-menu';
  menu.type='button';
  menu.className='menu_button';
  menu.textContent='摩羯座设置';
  menu.setAttribute('aria-label','打开摩羯座设置中心');
  menu.onclick=()=>openHub('settings');
  mountPresetControls(body,W,D);
  const cleanupRegex=mountGlobalRegexControl(body,W,D);
  const open=D.createElement('button');open.className='menu_button';open.textContent='打开统一设置';open.onclick=()=>openHub('settings');body.append(open);
  function attach(){
    if (!panel.isConnected) {
      const ext=D.querySelector('#extensions_settings2')||D.querySelector('#extensions_settings');
      ext?.append(panel);
    }
    if (!menu.isConnected) D.querySelector('#extensionsMenu')?.append(menu);
  }
  attach();
  mountSelectRoot(panel);
  let attachTimer=0;
  const observer=new MutationObserver(()=>{if(panel.isConnected&&menu.isConnected)return;if(!attachTimer)attachTimer=W.setTimeout(()=>{attachTimer=0;attach();},250);});observer.observe(D.body,{childList:true,subtree:true});
  return ()=>{observer.disconnect();W.clearTimeout(attachTimer);cleanupRegex();panel.remove();menu.remove();};
}
nativeControlsCleanup=mountNativeControls();
const backupButton = controls.querySelector('[data-backup]');
const restoreButton = controls.querySelector('[data-restore]');
const cacheButton = controls.querySelector('[data-cache]');
let dataOperation = false;
async function withDataOperation(action) {
  if (dataOperation) return;
  dataOperation = true;
  const buttons = [backupButton, restoreButton, cacheButton];
  for (const button of buttons) button.disabled = true;
  try {
    await action();
  } catch (error) {
    result(error.message);
  } finally {
    for (const button of buttons) button.disabled = false;
    dataOperation = false;
  }
}
backupButton.onclick = () => withDataOperation(async () => {
    const key = scope();
    const mem = await (memory ? memory.backup() : readStoredMemory(W));
    if (key !== scope()) throw Error('聊天已切换，请重试');
    const data = createBackup({
      music: music ? music.backup() : readStoredMusic(W.localStorage),
      memory: mem ?? null,
      theme: themeSelect.value,
      appearance: JSON.parse(W.localStorage.getItem('capricorn_appearance_v1') || 'null'),
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = D.createElement('a'); a.href = url; a.download = 'Capricorn-backup.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    const areas = [
      data.memory && '当前聊天记忆', data.music && '音乐库',
      (data.appearance || data.theme) && '外观设置',
    ].filter(Boolean);
    result(`已导出${areas.join('、')}。`);
});
const file = controls.querySelector('input[type=file]');
restoreButton.onclick = () => file.click();
file.onchange = () => withDataOperation(async () => {
  const source = file.files[0];
  file.value = '';
  if (!source) return;
  const requestedScope = scope();
  const backup = parseBackup(await source.text());
  if (requestedScope !== scope()) throw Error('聊天已切换，请重试');
  const areas = [
    backup.memory && ['聊天记忆', async () => {
      if (requestedScope !== scope()) throw Error('聊天已切换');
      const report = await (memory ? memory.restoreBackup(backup.memory) : restoreStoredMemory(W, backup.memory));
      const conflicts = report?.conflicts ? `，保留 ${report.conflicts} 项当前记录` : '';
      return report?.changed ? `已补齐 ${report.recordsAdded ?? 0} 条摘要${conflicts}` : `无需补齐${conflicts}`;
    }],
    backup.music && ['音乐库', async () => {
      await (music ? music.restoreBackup(backup.music) : restoreStoredMusic(W.localStorage, backup.music));
      return '已保留现有条目并补齐缺项';
    }],
    (backup.appearance || backup.theme) && ['外观', async () => {
      const report = restoreAppearanceBackup(W.localStorage, backup);
      if (report.theme) {
        themeSelect.value = report.theme;
        refreshSelect(themeSelect);
        root.dataset.theme = report.theme;
        appearanceApi?.refreshTheme();
      }
      return report.changed ? '已补齐缺项，刷新后应用全部样式' : '无需补齐';
    }],
  ].filter(Boolean);
  if (!areas.length) throw Error('备份中没有可恢复的数据');
  if (!await uiConfirm(`恢复${areas.map(([name])=>name).join('、')}？现有记录优先，缺失项目将从备份补入。`, { doc: D, title: '恢复统一备份', confirmText: '开始恢复' })) return;
  const messages = [];
  for (const [name, apply] of areas) {
    try {
      messages.push(`${name}：${await apply()}`);
    } catch (error) {
      messages.push(`${name}恢复失败：${error.message}`);
    }
  }
  result(messages.join('。'));
  tick();
});
cacheButton.onclick = () => withDataOperation(async () => {
  const key = scope();
  if (!key) throw Error('请先打开一个聊天');
  const rebuilt = memory?.clearDerivedCaches
    ? await memory.clearDerivedCaches()
    : (await Promise.all([clearIndex(key), clearLexicalCache(key)])).every(Boolean);
  if (rebuilt === false) throw Error('当前无法清理浏览器索引，请重试');
  result('已清理当前聊天的派生索引。后续检索时会自动重建。');
  tick();
});

shared.onAccountChange=()=>{cloud?.invalidate();if(tab==='cloud'&&!shared.accountReady?.())select('library');else libraryNav.hidden=!['library','cloud'].includes(tab)||!shared.accountReady?.();};
if(flags.music) cleanupNetease = mountNetease(settings, shared);
if (music) cloud = mountCloud(content, shared, music);
if(music) {
  cleanupMobile = mountMobile({ root, island, nav, onResume: () => void tick(), onLongPress: () => spotlight?.open() });
  launcher = mountLauncher({root,island,nav,onOpen:openPlayer,isPlayerOpen:()=>Boolean(music?.isPlayerOpen())});
  // Keep the existing Capricorn settings and backup controls; only extend the music appearance section.
  const floating = D.createElement('section');
  floating.dataset.capSettingsSection='appearance';
  floating.className='cap-float-settings';
  floating.innerHTML=`<h4>悬浮控件</h4>
    <label>显示样式<select data-float-mode data-cap-select="segment">
      <option value="orb">悬浮球 · 始终显示小球</option><option value="island">灵动岛 · 播放时展开歌词</option>
    </select></label>
    <label>停靠位置<select data-float-dock>
      <option value="free">自由拖动</option><option value="fixed">锁定当前位置</option>
      <option value="top">酒馆顶栏正中下方 · 自适应</option>
      <option value="composer">输入栏正中上方 · 自适应</option>
    </select></label>
    <p class="cap-float-hint">自由拖动可保存位置；自动停靠会随酒馆布局和视口调整。</p>`;
  settings.append(floating);
  const modeControl=floating.querySelector('[data-float-mode]');
  const dockControl=floating.querySelector('[data-float-dock]');
  const initial=cleanupMobile.settings();
  modeControl.value=initial.mode;
  dockControl.value=initial.dock;
  modeControl.addEventListener('change',()=>cleanupMobile?.update({mode:modeControl.value}));
  dockControl.addEventListener('change',()=>cleanupMobile?.update({dock:dockControl.value}));
  const wake=D.createElement('section');wake.className='si-launch-settings';
  wake.innerHTML=`<h4>隐藏与唤起</h4>
    <label>悬浮控件显示策略<select data-launch-policy>
      <option value="always">始终显示</option><option value="auto">自动隐藏 · 触碰时唤醒</option>
      <option value="edge">贴边隐藏 · 保留把手</option>
      <option value="hidden">完全隐藏 · 无入口时保留贴边把手</option>
    </select></label>
    <label>自动隐藏等待<select data-launch-delay><option value="3">3 秒</option><option value="5">5 秒</option><option value="10">10 秒</option><option value="20">20 秒</option></select></label>
    <label class="si-launch-toggle"><input type="checkbox" data-launch-shortcut>键盘 Alt + M 唤起</label>
    <label class="si-launch-toggle"><input type="checkbox" data-launch-gesture>屏幕边缘双击唤起（实验）</label>
    <p class="cap-float-hint">隐藏不停止播放。无可用唤起入口时保留窄把手，避免失联。</p>`;
  floating.append(wake);
  const launcherControls={policy:wake.querySelector('[data-launch-policy]'),delay:wake.querySelector('[data-launch-delay]'),shortcut:wake.querySelector('[data-launch-shortcut]'),gesture:wake.querySelector('[data-launch-gesture]')};
  const current=launcher.settings();
  for (const [key,element] of Object.entries(launcherControls)) {
    if(element.type==='checkbox')element.checked=current[key];else element.value=String(current[key]);
    element.addEventListener('change',()=>{
      const value=element.type==='checkbox'?element.checked:key==='delay'?Number(element.value):element.value;
      const applied=launcher?.update({[key]:value})||current;
      for(const [k,control] of Object.entries(launcherControls)) if(control.type==='checkbox')control.checked=applied[k];
    });
  }
}

const presetSection = D.createElement('section');
presetSection.className = 'cap-unified-preset';
presetSection.dataset.capSettingsSection = 'preset';
mountPresetControls(presetSection, W, D);
cleanupUnifiedRegex = mountGlobalRegexControl(presetSection, W, D);
settings.append(presetSection);

try {
  appearanceApi = mountAppearance(settings, root, themeSelect, memory?.root);
} catch (error) {
  console.warn('[Capricorn] 出现外观设置错误', error);
}

function readSettingsSummary(id) {
  const matMap = { glass: '液态玻璃', frost: '磨砂', solid: '实色' };
  const bgMap = { auto: '默认', album: '专辑铺满', color: '专辑取色', custom: '自定义图' };
  const privMap = { local: '本地', gd: 'GD 免登录', online: '在线', full: '完整云端' };
  if (id === 'memory') {
    if (!memory || !flags.memory) return { text: '已暂停', tone: 'muted' };
    const p = Number(memory.pending?.() || 0);
    return p > 0 ? { text: p + ' 条待审', tone: 'warn' } : { text: '运行中', tone: 'ok' };
  }
  if (id === 'music') return music ? { text: '运行中', tone: 'ok' } : { text: '未启用', tone: 'muted' };
  if (id === 'appearance') {
    const m = matMap[D.body.dataset.capMaterial] || '液态玻璃';
    const f = root.dataset.floatMode === 'orb' ? '悬浮球' : '灵动岛';
    return `${m} · ${f}`;
  }
  if (id === 'background') return bgMap[D.body.dataset.capBgSource] || '默认';
  if (id === 'fonts') return D.body.dataset.capHasPlayerFont === '1' || D.body.dataset.capHasNoteFont === '1' ? '自定义字体' : '系统默认';
  if (id === 'services') {
    let pm = 'local';
    try { pm = W.localStorage.getItem('capricorn_privacy_mode') || 'local'; } catch {}
    return privMap[pm] || '本地';
  }
  if (id === 'preset') return '条目与隐藏';
  if (id === 'backup') return '导出 / 恢复';
  return '';
}

try { settingsUi = mountSettings(settings, { getSummary: readSettingsSummary }); }
catch (error) { console.warn('[Capricorn] 设置分类回退', error); }

function openSettingsPage(pageId) {
  openHub('settings');
  if (pageId) settingsUi?.activate?.(pageId);
  else settingsUi?.home?.();
}

spotlight = createSpotlight({
  D, W,
  getItems() {
    const memReady = Boolean(memory && flags.memory);
    const pending = memReady ? Number(memory?.pending?.() || 0) : 0;
    return [
      { group: '常用速达', title: '打开音乐播放器', subtitle: '展开悬浮播控与歌词', icon: 'play', keywords: 'player play 播放 歌词', hidden: !music, action: openPlayer },
      { group: '常用速达', title: '打开拾忆便签', subtitle: '查看剧情时间轴与关联原声', icon: 'note', keywords: 'shiyi timeline note 记忆 便签', hidden: !memReady, badge: pending ? `${pending} 待审` : '', action: () => { close(true); memoryDock?.navigate?.('timeline'); } },
      { group: '常用速达', title: '回响 · 剧情漫游', subtitle: '沉浸式回顾章节、人物与伏笔线索', icon: 'sparkle', keywords: 'recall echo 漫游 伏笔 回忆', hidden: !memReady, action: () => { close(true); recall?.open(); } },
      { group: '常用速达', title: '共鸣 · 剧情原声', subtitle: '按曲目与章节回溯剧情 BGM', icon: 'resonance', keywords: 'soundtrack bgm 原声 音乐', hidden: !(music && memReady), action: () => openHub('resonance') },

      { group: '拾忆 · 剧情记忆', title: '审核待入库摘要', subtitle: pending ? `当前有 ${pending} 条待审核` : '核对最新剧情摘要', icon: 'check', keywords: 'review pending 审核 注入', hidden: !memReady, badge: pending ? String(pending) : '', action: () => { close(true); memoryDock?.trigger?.('review'); } },
      { group: '拾忆 · 剧情记忆', title: '随层表格档案', subtitle: '按楼层与分类检索结构化状态', icon: 'table', keywords: 'table ledger 表格 随层', hidden: !memReady, action: () => { close(true); memoryDock?.navigate?.('table'); } },
      { group: '拾忆 · 剧情记忆', title: '留痕 · 人物与伏笔档案', subtitle: '关系演变、关联档案与核心记忆', icon: 'users', keywords: 'dossier people 人物 关系 伏笔', hidden: !memReady, action: () => { close(true); memoryDock?.navigate?.('dossier'); } },
      { group: '拾忆 · 剧情记忆', title: '全量检测 / 补录历史', subtitle: '扫描历史楼层补齐未归档摘要', icon: 'folder-open', keywords: 'scan import 扫描 补录 历史', hidden: !memReady, action: () => { close(true); memoryDock?.trigger?.('import'); } },
      { group: '拾忆 · 剧情记忆', title: '正文归档与隐藏', subtitle: '预览并手动隐藏已归档旧楼层', icon: 'archive', keywords: 'archive hide 归档 隐藏 正文', hidden: !memReady, action: () => { close(true); memoryDock?.trigger?.('archive'); } },
      { group: '拾忆 · 剧情记忆', title: '剧情档案管理与回收站', subtitle: '批量删除、星标、章节与历史回退', icon: 'list', keywords: 'manage trash 管理 回收站 章节', hidden: !memReady, action: () => { close(true); memoryDock?.trigger?.('manage'); } },
      { group: '拾忆 · 剧情记忆', title: '拾忆核心与向量设置', subtitle: '标签、记忆运行模式、预算与向量 API', icon: 'sliders-horizontal', keywords: 'vector budget engine 向量 预算 凝忆', hidden: !memReady, action: () => { close(true); memoryDock?.trigger?.('settings'); } },

      { group: '声屿 · 音乐', title: '本地 / 角色曲库', subtitle: '管理角色歌单、手动音源与封面', icon: 'library', keywords: 'library playlist 曲库 歌单 封面', hidden: !music, action: () => openHub('library') },
      { group: '声屿 · 音乐', title: '网易云云端曲库', subtitle: '浏览并同步网易云歌单', icon: 'music', keywords: 'cloud netease 网易云 云端', hidden: !(music && shared.accountReady?.()), action: () => openHub('cloud') },

      { group: '设置中心', title: '设置首页', subtitle: '浏览全部模块与偏好设置', icon: 'settings', keywords: 'settings home 设置 首页', action: () => openSettingsPage('') },
      { group: '设置中心', title: '外观与悬浮控件', subtitle: '日夜模式、液态玻璃、悬浮球与隐身唤起', icon: 'swatches', keywords: 'theme glass orb island 外观 材质 悬浮球 灵动岛 贴边', action: () => openSettingsPage('appearance') },
      { group: '设置中心', title: '背景与封面定制', subtitle: '专辑铺满、模糊遮罩、封面形状与边框', icon: 'image', keywords: 'background cover 背景 封面 模糊 圆角', action: () => openSettingsPage('background') },
      { group: '设置中心', title: '字体与自定义 CSS', subtitle: '导入 TTF 字体、拾忆与播放器样式代码', icon: 'note-pencil', keywords: 'font ttf css 字体 样式', action: () => openSettingsPage('fonts') },
      { group: '设置中心', title: '音源与运行服务', subtitle: '隐私模式、GD 音源、网易云网关与诊断', icon: 'sliders-horizontal', keywords: 'netease gd privacy 音源 隐私 网易云 诊断', action: () => openSettingsPage('services') },
      { group: '设置中心', title: '预设与隐藏正则', subtitle: '安装摘要/档案/BGM 预设条目与全局隐藏正则', icon: 'package', keywords: 'preset regex 预设 正则 隐藏', action: () => openSettingsPage('preset') },
      { group: '设置中心', title: '数据备份与索引', subtitle: '导出/恢复统一备份、清理检索缓存', icon: 'archive', keywords: 'backup restore cache 备份 恢复 缓存', action: () => openSettingsPage('backup') },
      { group: '设置中心', title: '拾忆模块总控', subtitle: '免刷新暂停或恢复拾忆与快捷工具', icon: 'bookmark', keywords: 'memory module 拾忆 暂停 开关', action: () => openSettingsPage('memory') },
      { group: '设置中心', title: '声屿模块总控', subtitle: '剧情自动切歌、角色卡切歌与 iOS 后台策略', icon: 'music', keywords: 'music module 声屿 后台 音量 切歌', action: () => openSettingsPage('music') },
    ];
  },
});
mountSelectRoot(root);
mountSelectRoot(memory?.root);
}

void boot().catch(error => {
  if (!dead) nav.querySelector(':scope > small').textContent = '摩羯座启动失败：' + error.message;
  console.error('[Capricorn] startup', error);
});
