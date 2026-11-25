import { lastItem } from './compat.js';
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
import { mountMobile } from './mobile.js';
import { mountSelects, nativeSelectsEnabled, refreshSelect, setNativeSelects } from './ui-select.js';
import { popover } from './ui-popover.js';
import { mountSettings } from './ui-settings.js';
import { viewport } from './viewport.js';
import { mountMemoryDock } from './ui-memory-dock.js';

const W = window, D = document;
W.__capricornExtension?.destroy?.();
if (W.navigator.deviceMemory > 0 && W.navigator.deviceMemory <= 4) D.body.dataset.capVisualLite = '';
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
let memoryDock, appearanceApi, cloud, cleanupMobile, cleanupNetease, memory, music, timer, dead = false, tab = '';
let memoryStartup;
let lastGeneration = '尚未生成';

const root = D.createElement('div');
root.id = 'capricorn-hub';
root.innerHTML = `
  <button class="cap-island" aria-expanded="false" data-playing="false" aria-label="声屿音乐播放器" title="声屿">
    <span class="cap-island-colors" aria-hidden="true"></span>
    <span class="cap-island-orb" aria-hidden="true">
      <span class="cap-island-note-svg">${icon('music', 21)}</span>
      <span class="cap-island-bars"><i></i><i></i><i></i></span>
    </span>
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
        <button type="button" data-open-player aria-label="打开播放器" title="打开播放器">${icon('play', 17)}</button>
        <button type="button" data-close aria-label="关闭声屿" title="关闭声屿">${icon('close', 17)}</button>
      </div>
    </header>
    <small role="status"></small>
    <section class="cap-settings" id="cap-hub-settings" role="tabpanel" aria-label="声屿设置" hidden>
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
  island.dataset.playing = playing ? 'true' : 'false';
  island.title = playing ? `${title || '正在播放'} · 点击展开声屿` : '声屿（点击打开播放器）';
  const translated = playing ? (translation || '') : '';
  if (islandTranslation.textContent !== translated) islandTranslation.textContent = translated;
  islandTranslation.hidden = !translated;
  island.dataset.bilingual = String(!!translated);
  if (playing && text) {
    if (islandLyric.textContent !== text) {
      islandLyric.classList.remove('is-swap');
      void islandLyric.offsetWidth;
      islandLyric.textContent = text;
      islandLyric.classList.add('is-swap');
    }
  }
  cleanupMobile?.fit?.();
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
let memoryViewFrame;
const resonance=D.createElement('section');resonance.className='cap-resonance';resonance.hidden=true;content.append(resonance);
let resonanceEpoch=0;
let recall;
function unlockRecall(){shared.recallLocked=false;}
function refreshMemoryViews() {
  if (dead || memoryViewFrame != null) return;
  memoryViewFrame = requestAnimationFrame(() => {
    memoryViewFrame = null;
    void recall?.refresh();
    if (memoryDock?.isOpen()) void memoryDock.refresh();
    if (tab === 'resonance') void showResonance();
  });
}
function tracksByFloor(songs) {
  const byFloor = new Map();
  for (const song of songs) {
    const floor = String(song.floor);
    const tracks = byFloor.get(floor) ?? [];
    tracks.push(song);
    byFloor.set(floor, tracks);
  }
  return byFloor;
}
async function showResonance(){
 const epoch=++resonanceEpoch,key=scope();resonance.dataset.scope=key;resonance.replaceChildren();
 const el=(tag,text,parent=resonance)=>{const n=D.createElement(tag);n.textContent=text;parent.append(n);return n;};
 el('p','正在读取当前聊天的剧情原声…');
 try{
 const [memories,soundtrack]=await Promise.all([memory?.timelineRows(),music?.timelineSongs()]);
 const rows=(memories||[]).sort((a,b)=>a.floor-b.floor);
 const songs=tracksByFloor(soundtrack||[]);
 if(epoch!==resonanceEpoch||key!==scope()||tab!=='resonance')return;
 resonance.replaceChildren();el('h3','共鸣 · 剧情原声');el('button','回响 · 沉浸式回忆').onclick=()=>recall?.open();
 const lock=el('button',shared.recallLocked?'解除音乐锁定':'锁定音乐（暂停剧情切歌）');lock.onclick=()=>{shared.recallLocked=!shared.recallLocked;lock.textContent=shared.recallLocked?'解除音乐锁定':'锁定音乐（暂停剧情切歌）';};
 const q=el('input','');q.placeholder='搜索歌曲、歌手、剧情';q.setAttribute('aria-label','搜索歌曲、歌手、剧情');const chapter=el('select','');chapter.dataset.capSelect='search';chapter.setAttribute('aria-label','章节');for(const c of ['',...new Set(rows.map(r=>r.chapter).filter(Boolean))]){const o=el('option',c||'全部章节',chapter);o.value=c;}
 const play=el('button','播放筛选原声带');const list=el('div','');
 const valid=()=>key===scope()&&tab==='resonance';
 function render(){list.replaceChildren();const grouped=new Map();for(const r of rows){if(chapter.value&&r.chapter!==chapter.value)continue;for(const t of songs.get(String(r.floor))??[]){if(q.value&&!fuzzy(`${t.title} ${t.artist} ${r.title} ${r.content} ${r.chapter} ${r.traceText||''}`,q.value))continue;const g=grouped.get(t.id)||{t,rows:[]};if(lastItem(g.rows)!==r)g.rows.push(r);grouped.set(t.id,g);}}
 play.disabled=![...grouped.values()].some(g=>g.t.playable);play.onclick=()=>{if(valid()){shared.recallLocked=true;lock.textContent='解除音乐锁定';music.playStoryQueue([...grouped.values()].filter(g=>g.t.playable).map(g=>g.t.id),chapter.value||'剧情原声带');}};
 if(!grouped.size)el('p','暂无匹配的已归档剧情音乐',list);
 for(const {t,rows:matches} of grouped.values()){const d=el('details','',list);el('summary',`${t.title} · ${t.artist} (${matches.length})`,d);const b=el('button','播放此曲',d);b.disabled=!t.playable;b.onclick=()=>{if(valid()){shared.recallLocked=true;lock.textContent='解除音乐锁定';music.playStoryQueue([t.id],t.title);}};for(const r of matches){el('p',`${r.chapter||''} ${r.title} · ${r.when}`,d);const j=el('button','查看剧情便签',d);j.onclick=()=>{if(!valid())return;close();if(memoryDock)void memoryDock.open(r.floor);else memory.root.classList.remove('shiyi-collapsed');};}}
 }q.oninput=render;chapter.onchange=render;render();
 }catch(e){if(epoch===resonanceEpoch)resonance.textContent='读取失败：'+e.message;}
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

function close() {
  popover.closeWithin(nav);
  nav.hidden = true;
  root.dataset.panelOpen = 'false';
  island.setAttribute('aria-expanded', 'false');
  select('');
}

shared.onPlayerClose=()=>island.setAttribute('aria-expanded','false');
function openHub(t) {
  nav.hidden = false;
  root.dataset.panelOpen = 'true';
  island.setAttribute('aria-expanded', 'true');
  fitHub();
  select(t);
}
shared.openPlayerAux = openHub;
function openPlayer() {
  if (!music) return;
  close();
  music.openPlayer();
  island.setAttribute('aria-expanded', 'true');
}
island.onclick = () => {
  if (cleanupMobile?.consumeDrag()) return;
  if(music?.isPlayerOpen()){music.closePlayer();return;}
  openPlayer();
};
closeButton.onclick = close;
playerButton.onclick = openPlayer;
nav.querySelectorAll('[data-tab]').forEach(button => { button.onclick = () => select(button.dataset.tab); });
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
    recall?.check();
    const key = scope();
    maintenance.setContext(key, memory?.messageVersion?.());
    if (music) maintenance.enqueue('声屿', task => music.tick(task), maintenancePriority.audio,
      { lane: 'audio', scoped: true, duringForeground: true });
    if (memory) maintenance.enqueue('拾忆', task => memory.tick(task), maintenancePriority.memory, { scoped: true });
    memoryDock?.tick();
    if (tab === 'resonance' && resonance.dataset.scope !== key) {
      unlockRecall();
      void showResonance();
    }
  } catch (e) {
    root.querySelector('small').textContent = e.message;
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
    const status = root.querySelector('small');
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
  maintenance.setContext(scope(), memory?.messageVersion?.());
  const release = maintenance.beginForeground();
  try { return await generation.prepare(...args); }
  finally { release(); }
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
    D.removeEventListener('visibilitychange', resume);
    appearanceApi?.destroy();
    cleanupMobile?.destroy();
    memoryDock?.destroy();
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

function resume() {
  if (D.hidden || dead) return;
  maintenance.resume();
  tick();
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
timer = setInterval(() => { if (!D.hidden) tick(); }, 4000);
tick();

const controls = D.createElement('div');
controls.className = 'cap-backup';
controls.dataset.capSettingsSection = 'backup';
controls.innerHTML = '<h4>数据与索引</h4><button data-backup>导出统一备份</button><button data-restore>从备份恢复</button><button data-cache>重建聊天检索索引</button><input type="file" accept=".json,application/json" hidden><p data-result role="status"></p>';
settings.append(controls);
const services = D.createElement('section');
services.className = 'cap-backup';
services.dataset.capSettingsSection = 'services';
services.innerHTML = '<h4>运行与兼容性</h4><label><input type="checkbox" data-native-selects> 使用系统下拉菜单</label>';
const nativeSelects = services.querySelector('[data-native-selects]');
nativeSelects.checked = nativeSelectsEnabled(D);
nativeSelects.onchange = () => setNativeSelects(D, nativeSelects.checked);
settings.append(services);
const health=D.createElement('details');health.innerHTML='<summary>运行诊断</summary><pre style="white-space:pre-wrap"></pre><button type="button">刷新诊断</button>';services.append(health);
const updateHealth=()=>{
  const m=maintenance.status();
  const buffer = maintenance.budget();
  const moduleInfo = [memory?.diagnostics?.(), music?.diagnostics?.()].flatMap(info =>
    typeof info === 'string' ? [info] : Object.entries(info || {}).map(([k,v])=>`${k}：${v}`));
  health.querySelector('pre').textContent=[
    `拾忆：${memory?'已启动':'未启动'}`,
    `声屿：${music?'已启动':'未启动'}`,
    `生成注入：${lastGeneration}`,
    `后台维护：${m.running?'执行中':'空闲'} / 等待 ${m.pending}`,
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

const followLabel=D.createElement('label');const followInput=D.createElement('input');followInput.type='checkbox';followInput.checked=W.localStorage.getItem('capricorn_follow_story')!=='off';followInput.onchange=()=>W.localStorage.setItem('capricorn_follow_story',followInput.checked?'on':'off');followLabel.append(followInput,' 音乐跟随剧情');followLabel.hidden=!music;services.append(followLabel);
const result = msg => controls.querySelector('[data-result]').textContent = msg;
let changingModule = false;
async function setModule(k, value) {
  if (changingModule) return false;
  changingModule = true;
  try {
    if(k==='memory'&&!value&&memory){
      await memory.restoreAutoHidden?.();
      await memory.detach?.();
    }
    const next = {...flags, [k]: value};
    W.localStorage.setItem('capricorn_modules', JSON.stringify(next));
    Object.assign(flags,next);
    W.location.reload();
    return true;
  } catch (error) {
    W.alert('无法更新模块设置：'+error.message);
    return false;
  } finally {
    changingModule = false;
  }
}
function mountNativeControls(){
  const panel=D.createElement('div'); panel.id='capricorn-native-settings'; panel.className='inline-drawer';
  panel.innerHTML='<div class="inline-drawer-toggle inline-drawer-header"><b>摩羯座 · Capricorn</b><div class="inline-drawer-icon down">' + icon('down') + '</div></div><div class="inline-drawer-content" style="display:none"><p>独立模块开关 · 修改后刷新页面，保留数据。</p><div data-switches></div></div>';
  const body=panel.querySelector('.inline-drawer-content');
  const menu=D.createElement('div');menu.id='capricorn-native-menu';
  function switches(host){
    for(const [k,name] of [['music','声屿'],['memory','拾忆']]){
      const label=D.createElement('label');label.style.cssText='display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer';
      const input=D.createElement('input');input.type='checkbox';input.dataset.capModule=k;input.checked=flags[k];
      input.addEventListener('change',async()=>{if(!await setModule(k,input.checked))input.checked=flags[k];});
      label.append(input, name);host.append(label);
    }
  }
  switches(panel.querySelector('[data-switches]'));switches(menu);
  mountPresetControls(body,W,D);
  const cleanupRegex=mountGlobalRegexControl(body,W,D);
  const open=D.createElement('button');open.className='menu_button';open.textContent='更多设置';open.onclick=()=>openHub('settings');body.append(open);
  function attach(){
    if (!panel.isConnected) {
      const ext=D.querySelector('#extensions_settings2')||D.querySelector('#extensions_settings');
      ext?.append(panel);
    }
    if (!menu.isConnected) D.querySelector('#extensionsMenu')?.append(menu);
  }
  attach();
  mountSelectRoot(panel);
  const observer=new MutationObserver(attach);observer.observe(D.body,{childList:true,subtree:true});
  return ()=>{observer.disconnect();cleanupRegex();panel.remove();menu.remove();};
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
  if (!W.confirm(`恢复${areas.map(([name])=>name).join('、')}？现有记录优先，缺失项目将从备份补入。`)) return;
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

shared.onAccountChange=()=>{if(tab==='cloud'&&!shared.accountReady?.())select('library');else libraryNav.hidden=!['library','cloud'].includes(tab)||!shared.accountReady?.();};
if(flags.music) cleanupNetease = mountNetease(settings, shared);
if (music) cloud = mountCloud(content, shared, music);
if(flags.music) cleanupMobile = mountMobile({ root, island, nav, onResume: () => void tick() });
try {
  appearanceApi = mountAppearance(settings, root, themeSelect, memory?.root);
} catch (error) {
  console.warn('[Capricorn] 出现外观设置错误', error);
}
try { settingsUi = mountSettings(settings); }
catch (error) { console.warn('[Capricorn] 设置分类回退', error); }
mountSelectRoot(root);
mountSelectRoot(memory?.root);
}

void boot().catch(error => {
  if (!dead) root.querySelector('small').textContent = '摩羯座启动失败：' + error.message;
  console.error('[Capricorn] startup', error);
});
