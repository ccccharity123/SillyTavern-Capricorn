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

const W = window, D = document;
W.__capricornExtension?.destroy?.();
const flags = { memory: true, music: true };
try {
  const x = JSON.parse(W.localStorage.getItem('capricorn_modules') || '{}');
  for (const k of Object.keys(flags)) if (typeof x[k] === 'boolean') flags[k] = x[k];
} catch {}

const SHIYI_ICONS = {bookmark:icon("note",20),palette:icon("palette",18),refresh:icon("refresh",18),close:icon("right",18),note:icon("music",18)};

const context = () => getHostContext(W);
const chatIdentity = () => getChatIdentity(context());
const scope = () => chatIdentity().scope;
const shared = { flags, onIslandUpdate: null, scope, chatIdentity };
let nativeControlsCleanup;
let cleanupMemorySide, appearanceApi, cloud, cleanupMobile, cleanupNetease, memory, music, timer, dead = false, tab = '';
let memoryStartup;
let lastGeneration = '尚未生成';

const root = D.createElement('div');
root.id = 'capricorn-hub';
root.innerHTML = `
  <button class="cap-island" aria-expanded="false" data-playing="false" aria-label="声屿音乐播放器" title="声屿">
    <span class="cap-island-colors" aria-hidden="true"></span>
    <span class="cap-island-lyric-wrap">
      <span class="cap-island-lyric">声屿</span>
      <span class="cap-island-translation" hidden></span>
    </span>
  </button>
  <nav hidden>
    <header>
      <strong>声屿</strong>
      <button data-tab="settings" aria-label="声屿设置">${icon("settings")}</button><button data-close aria-label="关闭">${icon("close")}</button>
    </header>
    <div class="cap-tabs" role="tablist">
      <button data-tab="music" role="tab">播放</button>
      <button data-tab="library" role="tab">曲库</button><button data-tab="resonance" role="tab">共鸣</button>
    </div>
    <small></small>
    <section class="cap-settings" hidden>
      <label>外观模式
        <select>
          <option value="auto">跟随系统</option>
          <option value="light">日间浅色</option>
          <option value="dark">夜间深色</option>
        </select>
      </label>
    </section>
    <main class="cap-content"></main>
  </nav>
`;
D.body.append(root);

const nav = root.querySelector('nav'), island = root.querySelector('.cap-island');
const islandLyric = root.querySelector('.cap-island-lyric');
const islandTranslation = root.querySelector('.cap-island-translation');
const content = root.querySelector('.cap-content'), settings = root.querySelector('.cap-settings');

let islandCover='', islandColorEpoch=0, islandImage, islandFrame;
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
shared.onIslandUpdate = ({ playing, text, title, coverUrl, translation }) => {
  if (dead) return;
  colorIsland(coverUrl||'');
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
libraryNav.className = 'cap-tabs';
for (const [key,label] of [['library','本地 / 角色'],['cloud','网易云']]) {
  const b = D.createElement('button'); b.textContent = label; b.dataset.tab = key; libraryNav.append(b);
}
content.before(libraryNav);
const timeline = D.createElement('section');
timeline.className = 'cap-timeline';

let timelineEpoch = 0, shownScope = '', memoryViewFrame;
const resonance=D.createElement('section');resonance.className='cap-resonance';resonance.hidden=true;content.append(resonance);
let resonanceEpoch=0;
let recall;
function unlockRecall(){shared.recallLocked=false;}
function refreshMemoryViews() {
  if (dead || memoryViewFrame != null) return;
  memoryViewFrame = requestAnimationFrame(() => {
    memoryViewFrame = null;
    void recall?.refresh();
    if (memoryOpen()) void refreshTimeline();
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
 const q=el('input','');q.placeholder='搜索歌曲、歌手、剧情';const chapter=el('select','');for(const c of ['',...new Set(rows.map(r=>r.chapter).filter(Boolean))]){const o=el('option',c||'全部章节',chapter);o.value=c;}
 const play=el('button','播放筛选原声带');const list=el('div','');
 const valid=()=>key===scope()&&tab==='resonance';
 function render(){list.replaceChildren();const grouped=new Map();for(const r of rows){if(chapter.value&&r.chapter!==chapter.value)continue;for(const t of songs.get(String(r.floor))??[]){if(q.value&&!fuzzy(`${t.title} ${t.artist} ${r.title} ${r.content} ${r.chapter} ${r.traceText||''}`,q.value))continue;const g=grouped.get(t.id)||{t,rows:[]};if(g.rows.at(-1)!==r)g.rows.push(r);grouped.set(t.id,g);}}
 play.disabled=![...grouped.values()].some(g=>g.t.playable);play.onclick=()=>{if(valid()){shared.recallLocked=true;lock.textContent='解除音乐锁定';music.playStoryQueue([...grouped.values()].filter(g=>g.t.playable).map(g=>g.t.id),chapter.value||'剧情原声带');}};
 if(!grouped.size)el('p','暂无匹配的已归档剧情音乐',list);
 for(const {t,rows:matches} of grouped.values()){const d=el('details','',list);el('summary',`${t.title} · ${t.artist} (${matches.length})`,d);const b=el('button','播放此曲',d);b.disabled=!t.playable;b.onclick=()=>{if(valid()){shared.recallLocked=true;lock.textContent='解除音乐锁定';music.playStoryQueue([t.id],t.title);}};for(const r of matches){el('p',`${r.chapter||''} ${r.title} · ${r.when}`,d);const j=el('button','查看剧情便签',d);j.onclick=()=>{if(!valid())return;close();memory.root.classList.remove('shiyi-collapsed');void refreshTimeline(r.floor);};}}
 }q.oninput=render;chapter.onchange=render;render();
 }catch(e){if(epoch===resonanceEpoch)resonance.textContent='读取失败：'+e.message;}
}

const memoryOpen = () => memory?.root && !memory.root.classList.contains('shiyi-collapsed');

async function refreshTimeline(targetFloor) {
  const epoch = ++timelineEpoch, key = scope();
  shownScope = key;
  timeline.replaceChildren();
  const note = D.createElement('p');
  note.className = 'cap-timeline-empty';
  note.textContent = '正在读取剧情便签…';
  timeline.append(note);
  try {
    const [rows, soundtrack] = await Promise.all([memory.timelineRows(), music?.timelineSongs()]);
    const memories = rows.sort((a,b)=>a.floor-b.floor);
    const songs = tracksByFloor(soundtrack || []);
    if (epoch !== timelineEpoch || key !== scope() || !memoryOpen()) return;
    note.textContent = memories.length ? `已归档 ${memories.length} 条剧情便签` : '暂无已归档摘要，请检测或导入历史。';
    const query=D.createElement('input');query.placeholder='搜索剧情便签';timeline.append(query);const cards=D.createElement('div');timeline.append(cards);
    const pageSize=40, targetIndex=memories.findIndex(m=>m.floor===targetFloor);
    let offset=targetIndex<0?0:Math.floor(targetIndex/pageSize)*pageSize, jumpToTarget=targetIndex>=0;
    let filtered=memories;
    const previous=D.createElement('button');previous.textContent='上一页';timeline.append(previous);
    const more=D.createElement('button');more.textContent='下一页';timeline.append(more);
    function render(){cards.replaceChildren();
    previous.hidden=offset===0;more.hidden=filtered.length<=offset+pageSize;
    for (const m of filtered.slice(offset,offset+pageSize)) {
      const card = D.createElement('details');
      card.className = 'cap-story';if(jumpToTarget&&m.floor===targetFloor){card.open=true;requestAnimationFrame(()=>{if(card.isConnected)card.scrollIntoView({block:'center'});});}
      const head = D.createElement('summary');
      const field = n => m.content.match(new RegExp('<' + n + '>([\\s\\S]*?)</' + n + '>'))?.[1]?.trim();
      const tracks = songs.get(String(m.floor)) ?? [];
      for (const [cls, value] of [
        ['cap-story-time', field('时间') || m.when],
        ['cap-story-title', (m.star?'★ ':'')+(m.chapter?m.chapter+' · ':'')+(field('标题') || m.title.replace(/^记忆\d+｜/, ''))],
        ['cap-story-song', tracks.length ? '♫ ' + tracks.map(t => t.title + ' — ' + t.artist).join(' / ') : '暂无音乐记录']
      ]) {
        const el = D.createElement('span');
        el.className = cls;
        el.textContent = value;
        head.append(el);
      }
      const body = D.createElement('p');
      body.textContent = field('摘要') || m.content;
      card.append(head, body);
      for (const t of tracks) {
        const button = D.createElement('button');
        button.className = 'cap-story-play';
        button.textContent = '▶ 播放 · ' + t.title;
        button.disabled = !t.playable;
        button.onclick = () => { if (key === scope()) music.playTimeline(t.id); };
        card.append(button);
      }
      const jump=D.createElement('button');jump.textContent='查看原楼层';jump.onclick=()=>{if(key===scope()&&!memory.jump(m.floor))W.alert('请先加载该历史楼层');};card.append(jump);cards.append(card);
    }
    jumpToTarget=false;
    }
    query.oninput=()=>{
      const text=query.value.trim();
      filtered=text?memories.filter(m=>fuzzy(`${m.title} ${m.content} ${m.chapter} ${m.traceText||''} ${(songs.get(String(m.floor))??[]).map(t=>t.title+' '+t.artist).join(' ')}`,text)):memories;
      offset=0;
      render();
    };
    previous.onclick=()=>{offset-=pageSize;render();};
    more.onclick=()=>{offset+=pageSize;render();};
    render();
  } catch (e) {
    if (epoch === timelineEpoch) note.textContent = '读取失败：' + e.message;
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
  if(t==='resonance'&&(!memory||!music))t='settings';
  if(t==='cloud'&&!shared.accountReady?.())t='library';
  tab = t;
  root.dataset.tab = t;
  D.body.dataset.capricornTab = t;
  settings.hidden = t !== 'settings';resonance.hidden=t!=='resonance';if(t==='resonance')void showResonance();
  if (t === 'cloud') cloud?.show(); else cloud?.hide();
  libraryNav.hidden = !['library','cloud'].includes(t)||!shared.accountReady?.();
  nav.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  if (['music','library'].includes(t) && flags.music) music?.show(); else music?.hide();
  if (t === 'memory' && flags.memory) memory?.root?.classList.remove('shiyi-collapsed');
}

function close() {
  nav.hidden = true;
  island.setAttribute('aria-expanded', 'false');
  select('');
}

shared.onPlayerClose=()=>island.setAttribute('aria-expanded','false');
shared.openPlayerAux=t=>{nav.hidden=false;island.setAttribute('aria-expanded','true');select(t);};
island.onclick = () => {
  if (cleanupMobile?.consumeDrag()) return;
  if(music?.isPlayerOpen()){music.closePlayer();return;}
  close();music?.openPlayer();island.setAttribute('aria-expanded','true');
};
nav.querySelector('[data-close]').onclick = ()=>{close();music?.openPlayer();island.setAttribute('aria-expanded','true');};
nav.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {if(b.dataset.tab==='music'){close();music?.openPlayer();}else select(b.dataset.tab);});

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
    if (shownScope !== key && memoryOpen()) void refreshTimeline();
    if (tab === 'resonance' && resonance.dataset.scope !== key) {
      unlockRecall();
      void showResonance();
    }
    if (memory?.root) {
      const b = memory.root.querySelector('#shiyi-expand');
      if (b) {
        const cnt = Number(memory.pending?.() || 0);
        b.dataset.pending = cnt > 0 ? String(cnt) : '';
        b.title = cnt > 0 ? `拾忆（${cnt} 条待审核）` : '展开拾忆';
        const dot = b.querySelector('.cap-shiyi-dot');
        if (dot) {
          dot.hidden = cnt <= 0;
          dot.textContent = cnt > 9 ? '9+' : String(cnt);
        }
      }
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
    ++timelineEpoch;
    ++resonanceEpoch;
    recall?.close();
    maintenance.close();
    D.removeEventListener('visibilitychange', resume);
    appearanceApi?.destroy();
    cleanupMobile?.destroy();
    cleanupMemorySide?.();
    cleanupNetease?.();
    cloud?.destroy();
    clearInterval(timer);
    memory?.destroy();
    music?.destroy();
    nativeControlsCleanup?.();
    root.remove();
    delete D.body.dataset.capricornTab;
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

// Independent viewport geometry for the memory tab and panel.
function mountMemorySide(dock, button) {
  const win = dock.ownerDocument.defaultView;
  const key = 'capricorn_memory_tab_y';
  let ratio = 0.42, drag = null, suppress = false;
  try { const saved = win.localStorage.getItem(key); if (saved !== null && Number.isFinite(Number(saved))) ratio = Math.max(0, Math.min(1, Number(saved))); } catch {}
  const viewport = () => ({ top: win.visualViewport?.offsetTop || 0, height: win.visualViewport?.height || win.innerHeight });
  function bounds() { const v = viewport(); return { min: v.top + 12, max: Math.max(v.top + 12, v.top + v.height - 58) }; }
  function fit() {
    const v = viewport(), b = bounds();
    dock.style.setProperty('--cap-memory-tab-top', `${b.min + ratio * (b.max - b.min)}px`);
    dock.style.setProperty('--cap-memory-panel-top', `${v.top + 12}px`);
    dock.style.setProperty('--cap-memory-panel-height', `${Math.max(1, v.height - 24)}px`);
  }
  function down(e) {
    if (!e.isPrimary || e.button !== 0 || !dock.classList.contains('shiyi-collapsed')) return;
    suppress = false;
    drag = { id: e.pointerId, y: e.clientY, top: dock.getBoundingClientRect().top, moved: false };
    try { button.setPointerCapture(e.pointerId); } catch {}
  }
  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 7) return;
    drag.moved = true;
    const b = bounds(); ratio = Math.max(0, Math.min(1, (drag.top + dy - b.min) / Math.max(1, b.max - b.min)));
    fit();
  }
  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    suppress = drag.moved; drag = null;
    if (suppress) try { win.localStorage.setItem(key, String(ratio)); } catch {}
  }
  function click(e) { if (suppress && e.detail !== 0) { suppress = false; e.preventDefault(); e.stopImmediatePropagation(); } }
  const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', end], ['pointercancel', end], ['lostpointercapture', end]];
  for (const [name, fn] of listeners) button.addEventListener(name, fn);
  button.addEventListener('click', click, true);
  win.addEventListener('resize', fit);
  win.visualViewport?.addEventListener('resize', fit);
  win.visualViewport?.addEventListener('scroll', fit);
  fit();
  return () => {
    for (const [name, fn] of listeners) button.removeEventListener(name, fn);
    button.removeEventListener('click', click, true);
    win.removeEventListener('resize', fit);
    win.visualViewport?.removeEventListener('resize', fit);
    win.visualViewport?.removeEventListener('scroll', fit);
  };
}

if (memory?.root) {
  recall=createRecall({D,W,scope,memory,music,shared});
  const recallButton=D.createElement("button");recallButton.textContent="回响";memory.root.querySelector("#shiyi-settings").before(recallButton);recallButton.onclick=()=>recall.open();
  memory.onChange = refreshMemoryViews;
  memory.root.classList.add('cap-memory-side');

  // 收起态：纯图标精致耳扣，彻底移除文字
  const expandBtn = memory.root.querySelector('#shiyi-expand');
  if (expandBtn) {
    expandBtn.innerHTML = `${SHIYI_ICONS.bookmark}<span class="cap-shiyi-dot" hidden></span>`;
    expandBtn.setAttribute('aria-label', '展开拾忆');
    expandBtn.title = '点击展开拾忆，拖动调整位置';
    cleanupMemorySide = mountMemorySide(memory.root, expandBtn);
  }

  // 展开态顶栏：纯图标操作栏
  const collapseBtn = memory.root.querySelector('#shiyi-collapse');
  if (collapseBtn) {
    collapseBtn.innerHTML = SHIYI_ICONS.close;
    collapseBtn.title = '收起侧边栏';
  }

  const brand = memory.root.querySelector('.shiyi-brand');
  const headerBar = D.createElement('div');
  headerBar.className = 'cap-shiyi-topbar';

  const brandIcon = D.createElement('span');
  brandIcon.className = 'cap-shiyi-mark';
  brandIcon.innerHTML = SHIYI_ICONS.bookmark;
  brandIcon.title = '拾忆便签';

  const iconGroup = D.createElement('div');
  iconGroup.className = 'cap-shiyi-icon-actions';

  const refreshIconBtn = D.createElement('button');
  refreshIconBtn.type = 'button';
  refreshIconBtn.className = 'cap-shiyi-icon-btn';
  refreshIconBtn.innerHTML = SHIYI_ICONS.refresh;
  refreshIconBtn.title = '刷新时间轴';
  refreshIconBtn.setAttribute('aria-label', '刷新时间轴');
  refreshIconBtn.onclick = () => void refreshTimeline();

  const styleBtn = D.createElement('button');
  styleBtn.type = 'button';
  styleBtn.className = 'cap-shiyi-icon-btn cap-note-style-btn';
  styleBtn.innerHTML = SHIYI_ICONS.palette;
  styleBtn.title = '外观、字体与自定义 CSS';
  styleBtn.setAttribute('aria-label', '外观、字体与自定义 CSS');
  styleBtn.onclick = () => appearanceApi?.toggleInlineDrawer();

  iconGroup.append(refreshIconBtn, styleBtn);
  if (collapseBtn) {
    collapseBtn.classList.add('cap-shiyi-icon-btn');
    iconGroup.append(collapseBtn);
  }
  headerBar.append(brandIcon, iconGroup);

  if (brand) {
    brand.hidden = true;
    brand.before(headerBar);
  }

  const tools = memory.root.querySelector('#shiyi-scan').parentElement;
  const more = D.createElement('details');
  more.className = 'cap-memory-tools';
  const label = D.createElement('summary');
  label.innerHTML = icon('more');
  label.setAttribute('aria-label', '拾忆管理与设置');
  more.append(label);
  tools.before(timeline, more);
  more.append(tools);
  // Main memory destinations stay visible. Management actions remain in "more".
  // Move the original buttons rather than cloning them, preserving their handlers.
  const primaryNav = D.createElement('nav');
  primaryNav.className = 'cap-memory-primary-nav';
  primaryNav.setAttribute('aria-label', '拾忆主要功能');
  for (const [id, label] of [
    ['shiyi-timeline', '时间轴'],
    ['shiyi-table', '表格'],
    ['shiyi-dossier', '档案'],
  ]) {
    const button = id === 'shiyi-table'
      ? [...tools.querySelectorAll('button')].find(el => el.textContent.trim() === '表格档案')
      : id === 'shiyi-dossier'
        ? [...tools.querySelectorAll('button')].find(el => el.textContent.trim() === '留痕档案')
        : tools.querySelector('#shiyi-timeline');
    if (!button) continue;
    button.id = id;
    button.textContent = label;
    button.type = 'button';
    button.classList.add('cap-memory-primary-btn');
    primaryNav.append(button);
  }
  more.before(primaryNav);
  more.addEventListener('toggle', () => { if (!more.open) appearanceApi?.closeInlineDrawer(); });
  expandBtn?.addEventListener('click', () => void refreshTimeline());
  const refresh = memory.root.querySelector('#shiyi-timeline');
  if (refresh) {
    refresh.textContent = '时间轴';
    refresh.onclick = () => void refreshTimeline();
  }
}

if (music?.root) { content.append(music.root); }
D.addEventListener('visibilitychange',resume);
timer = setInterval(() => { if (!D.hidden) tick(); }, 4000);
tick();

const controls = D.createElement('div');
controls.className = 'cap-backup';
controls.innerHTML = '<h4>模块与数据</h4><button data-backup>导出统一备份</button><button data-restore>从备份恢复</button><button data-cache>重建聊天检索索引</button><input type="file" accept=".json,application/json" hidden><p data-result role="status"></p>';
settings.append(controls);
const health=D.createElement('details');health.innerHTML='<summary>运行诊断</summary><pre style="white-space:pre-wrap"></pre><button type="button">刷新诊断</button>';controls.append(health);
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

island.hidden=!flags.music;
nav.querySelector('[data-tab="resonance"]').hidden=!(flags.music&&flags.memory);
if(!flags.music){for(const b of nav.querySelectorAll('[data-tab="music"],[data-tab="library"]'))b.hidden=true;nav.querySelector('[data-close]').onclick=close;}

const followLabel=D.createElement('label');const followInput=D.createElement('input');followInput.type='checkbox';followInput.checked=W.localStorage.getItem('capricorn_follow_story')!=='off';followInput.onchange=()=>W.localStorage.setItem('capricorn_follow_story',followInput.checked?'on':'off');followLabel.append(followInput,' 音乐跟随剧情');controls.append(followLabel);
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
  panel.innerHTML='<div class="inline-drawer-toggle inline-drawer-header"><b>摩羯座 · Capricorn</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content" style="display:none"><p>独立模块开关 · 修改后刷新页面，保留数据。</p><div data-switches></div></div>';
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
  const open=D.createElement('button');open.className='menu_button';open.textContent='更多设置';open.onclick=()=>{nav.hidden=false;select('settings');};body.append(open);
  function attach(){
    if (!panel.isConnected) {
      const ext=D.querySelector('#extensions_settings2')||D.querySelector('#extensions_settings');
      ext?.append(panel);
    }
    if (!menu.isConnected) D.querySelector('#extensionsMenu')?.append(menu);
  }
  attach();const observer=new MutationObserver(attach);observer.observe(D.body,{childList:true,subtree:true});
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
        root.dataset.theme = report.theme;
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
appearanceApi = mountAppearance(settings, root, themeSelect, memory?.root);
for (const [node,label] of [[controls,'数据与自动收录'],[settings.querySelector('.cap-backup:not(.cap-backup:first-child)'),'账号与连接']]) {
  if (!node || node.parentElement !== settings || node.closest('details')) continue;
  const d = D.createElement('details'); const h = D.createElement('summary'); h.textContent = label; d.append(h); node.before(d); d.append(node);
}
for (const node of [...settings.children]) {
  if (!node.matches('section.cap-backup')) continue;
  const d = D.createElement('details'); const h = D.createElement('summary'); h.textContent = '账号与连接'; d.append(h); node.before(d); d.append(node);
}
}

void boot().catch(error => {
  if (!dead) root.querySelector('small').textContent = '摩羯座启动失败：' + error.message;
  console.error('[Capricorn] startup', error);
});
