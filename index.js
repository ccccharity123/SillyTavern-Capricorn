import { createRecall } from './recall.js';
import { icon } from './icons.js';
import { mountAppearance } from './appearance.js';
import { mountCloud } from './cloud.js';
import { mountNetease } from './netease.js';
import { startMemory } from './memory.js';
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

const shared = { messages: null, flags, onIslandUpdate: null };
let musicBusy = false, eventCleanup = [], cleanupMemorySide, appearanceApi, cloud, cleanupMobile, cleanupNetease, memory, music, timer, busy = false, dead = false, tab = '';

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

let islandCover='', islandColorEpoch=0;
function colorIsland(url){
  if(url===islandCover)return; islandCover=url; const epoch=++islandColorEpoch;
  const host=island.querySelector('.cap-island-colors');
  function show(background){if(epoch!==islandColorEpoch)return;const old=Array.from(host.children);const layer=D.createElement('span');layer.style.background=background;host.append(layer);void layer.offsetWidth;requestAnimationFrame(()=>{if(epoch!==islandColorEpoch){layer.remove();return;}layer.style.opacity='1';for(const el of old){el.style.opacity='0';setTimeout(()=>el.remove(),1250);}});}
  host.replaceChildren(); if(!url)return;
  let u;try{u=new URL(url);if(!['https:','http:'].includes(u.protocol))throw Error();}catch{show('transparent');return;}
  const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{try{const c=D.createElement('canvas');c.width=c.height=24;const x=c.getContext('2d');x.drawImage(img,0,0,24,24);const d=x.getImageData(0,0,24,24).data;const bins=new Map();for(let i=0;i<d.length;i+=4){if(d[i+3]<128)continue;const rgb=[d[i],d[i+1],d[i+2]];const k=rgb.map(v=>v>>5).join(',');const v=bins.get(k)||[0,0,0,0];v[0]+=rgb[0];v[1]+=rgb[1];v[2]+=rgb[2];v[3]++;bins.set(k,v);}const colors=[...bins.values()].sort((a,b)=>b[3]-a[3]).slice(0,3).map(v=>'rgb('+v.slice(0,3).map(n=>Math.round(n/v[3])).join(',')+')');if(!colors.length)throw Error();show('linear-gradient(135deg,'+[colors[0],colors[1]||colors[0],colors[2]||colors[0]].join(',')+')');}catch{show('transparent');}};img.onerror=()=>show('transparent');img.src=u.href;
}
shared.onIslandUpdate = ({ playing, text, title, coverUrl, translation }) => {
  colorIsland(coverUrl||'');
  island.dataset.playing = playing ? 'true' : 'false';
  island.title = playing ? `${title || '正在播放'} · 点击展开声屿` : '声屿（点击打开播放器）';
  const translated = playing ? (translation || '') : '';
  islandTranslation.textContent = translated;
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

let timelineEpoch = 0, shownScope = '';
const resonance=D.createElement('section');resonance.className='cap-resonance';resonance.hidden=true;content.append(resonance);
let resonanceEpoch=0;
let recall;
function unlockRecall(){shared.recallLocked=false;}
async function showResonance(){
 const epoch=++resonanceEpoch,key=scope();resonance.dataset.scope=key;resonance.replaceChildren();
 const el=(tag,text,parent=resonance)=>{const n=D.createElement(tag);n.textContent=text;parent.append(n);return n;};
 el('p','正在读取当前聊天的剧情原声…');
 try{
 const rows=(await memory?.timelineRows()||[]).sort((a,b)=>a.floor-b.floor),songs=music?.timelineSongs()||[];
 if(epoch!==resonanceEpoch||key!==scope()||tab!=='resonance')return;
 resonance.replaceChildren();el('h3','共鸣 · 剧情原声');el('button','回响 · 沉浸式回忆').onclick=()=>recall?.open();
 const lock=el('button',shared.recallLocked?'解除音乐锁定':'锁定音乐（暂停剧情切歌）');lock.onclick=()=>{shared.recallLocked=!shared.recallLocked;lock.textContent=shared.recallLocked?'解除音乐锁定':'锁定音乐（暂停剧情切歌）';};
 const q=el('input','');q.placeholder='搜索歌曲、歌手、剧情';const chapter=el('select','');for(const c of ['',...new Set(rows.map(r=>r.chapter).filter(Boolean))]){const o=el('option',c||'全部章节',chapter);o.value=c;}
 const play=el('button','播放筛选原声带');const list=el('div','');
 const valid=()=>key===scope()&&tab==='resonance';
 function render(){list.replaceChildren();const grouped=new Map();for(const r of rows){if(chapter.value&&r.chapter!==chapter.value)continue;for(const t of songs.filter(t=>String(t.floor)===String(r.floor))){if(!`${t.title} ${t.artist} ${r.title} ${r.content} ${r.chapter}`.toLowerCase().includes(q.value.trim().toLowerCase()))continue;const g=grouped.get(t.id)||{t,rows:[]};if(!g.rows.includes(r))g.rows.push(r);grouped.set(t.id,g);}}
 play.disabled=![...grouped.values()].some(g=>g.t.playable);play.onclick=()=>{if(valid()){shared.recallLocked=true;lock.textContent='解除音乐锁定';music.playStoryQueue([...grouped.values()].filter(g=>g.t.playable).map(g=>g.t.id),chapter.value||'剧情原声带');}};
 if(!grouped.size)el('p','暂无匹配的已归档剧情音乐',list);
 for(const {t,rows:matches} of grouped.values()){const d=el('details','',list);el('summary',`${t.title} · ${t.artist} (${matches.length})`,d);const b=el('button','播放此曲',d);b.disabled=!t.playable;b.onclick=()=>{if(valid()){shared.recallLocked=true;lock.textContent='解除音乐锁定';music.playStoryQueue([t.id],t.title);}};for(const r of matches){el('p',`${r.chapter||''} ${r.title} · ${r.when}`,d);const j=el('button','查看剧情便签',d);j.onclick=()=>{if(!valid())return;close();memory.root.classList.remove('shiyi-collapsed');void refreshTimeline(r.floor);};}}
 }q.oninput=render;chapter.onchange=render;render();
 }catch(e){if(epoch===resonanceEpoch)resonance.textContent='读取失败：'+e.message;}
}

const scope = () => {
  const c = W.SillyTavern?.getContext?.() || {};
  return JSON.stringify([c.characterId ?? c.character_id, c.chatId ?? c.chatMetadata?.chat_id]);
};
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
    const memories = await memory.timelineRows(), songs = music?.timelineSongs() || [];
    if (epoch !== timelineEpoch || key !== scope() || !memoryOpen()) return;
    note.textContent = memories.length ? `已归档 ${memories.length} 条剧情便签` : '暂无已归档摘要，请检测或导入历史。';
    const query=D.createElement('input');query.placeholder='搜索剧情便签';timeline.append(query);const cards=D.createElement('div');timeline.append(cards);let limit=targetFloor!=null?Math.max(40,memories.length):40;const more=D.createElement('button');more.textContent='加载更多';timeline.append(more);function render(){cards.replaceChildren();const filtered=memories.filter(m=>`${m.title} ${m.content} ${m.chapter} ${songs.filter(t=>String(t.floor)===String(m.floor)).map(t=>t.title+' '+t.artist).join(' ')}`.toLowerCase().includes(query.value.trim().toLowerCase()));more.hidden=filtered.length<=limit;
    for (const m of filtered.sort((a, b) => a.floor - b.floor).slice(0,limit)) {
      const card = D.createElement('details');
      card.className = 'cap-story';if(String(m.floor)===String(targetFloor)){card.open=true;requestAnimationFrame(()=>card.scrollIntoView({block:'center'}));}
      const head = D.createElement('summary');
      const field = n => m.content.match(new RegExp('<' + n + '>([\\s\\S]*?)</' + n + '>'))?.[1]?.trim();
      const tracks = songs.filter(t => String(t.floor) === String(m.floor));
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
    }}query.oninput=()=>{limit=40;render();};more.onclick=()=>{limit+=40;render();};render();
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

const api = (n, ...a) => {
  const f = W[n] || W.TavernHelper?.[n];
  if (typeof f !== 'function') throw Error('缺少酒馆助手 API: ' + n);
  return f(...a);
};

async function tick() {
  recall?.check();
  if (busy || dead) return;
  busy = true;
  try {
    Promise.resolve(memory?.tick()).catch(e => console.warn('[Capricorn] memory scan', e));
    if (flags.music && music && !musicBusy) {
      musicBusy = true;
      Promise.resolve().then(()=>music.tick()).catch(e=>console.warn('[Capricorn] music scan',e)).finally(()=>{musicBusy=false;});
    }
    if (shownScope !== scope() && memoryOpen()) refreshTimeline();if(tab==='resonance'&&resonance.dataset.scope!==scope()){unlockRecall();resonance.dataset.scope=scope();void showResonance();}
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
    root.querySelector('small').textContent = !flags.music ? '自动收录已暂停' : !music ? '播放器未启动' : '';
  } catch (e) {
    root.querySelector('small').textContent = e.message;
  } finally {
    shared.messages = null;
    busy = false;
  }
}

W.__capricornExtension = {
  destroy() {
    recall?.close();
    dead = true;
    for(const off of eventCleanup)off();
    appearanceApi?.destroy();
    cleanupMobile?.destroy();
    cleanupMemorySide?.();
    cleanupNetease?.();
    cloud?.destroy();
    clearInterval(timer);
    memory?.destroy();
    music?.destroy();
    root.remove();
    delete D.body.dataset.capricornTab;
  }
};

D.body.dataset.capricornTab = '';
try { memory = await startMemory(shared); } catch (e) { console.error('[Capricorn] memory', e); }
try { music = await startMusic(shared); } catch (e) { console.error('[Capricorn] music', e); }

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
  memory.onChange = () => { void recall?.refresh(); if (memoryOpen()) void refreshTimeline(); if(tab==='resonance')void showResonance(); };
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
  refreshIconBtn.onclick = refreshTimeline;

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
  more.addEventListener('toggle', () => { if (!more.open) appearanceApi?.closeInlineDrawer(); });
  expandBtn?.addEventListener('click', refreshTimeline);
  const refresh = memory.root.querySelector('#shiyi-timeline');
  if (refresh) {
    refresh.textContent = '刷新时间轴';
    refresh.onclick = refreshTimeline;
  }
}

if (music?.root) { content.append(music.root); }
if (!dead) {
  const c=W.SillyTavern?.getContext?.()||{}, src=c.eventSource, types=c.eventTypes||c.event_types||{};
  const bind=(key,fn)=>{const name=types[key];if(name&&src?.on){src.on(name,fn);eventCleanup.push(()=>{if(src.removeListener)src.removeListener(name,fn);else src.off?.(name,fn);});}};
  const validate=async()=>{if(dead)return;try{await memory?.validate?.();}catch(e){console.warn('[Capricorn] memory validation',e);root.querySelector('small').textContent='拾忆校验失败：'+e.message;}};
  bind('GENERATION_STARTED',validate);
  bind('GENERATION_AFTER_COMMANDS',validate);
  for(const key of ['CHAT_CHANGED','MESSAGE_SWIPED','MESSAGE_DELETED','MESSAGE_EDITED','GENERATION_ENDED'])bind(key,async()=>{try{await validate();if(!dead)void tick();}catch(e){console.warn('[Capricorn] event validation',e);}});
  const resume=()=>{if(!D.hidden&&!dead)void tick();};D.addEventListener('visibilitychange',resume);eventCleanup.push(()=>D.removeEventListener('visibilitychange',resume));
}
if (!dead) { timer = setInterval(() => { if (!D.hidden) void tick(); }, 4000); tick(); }

const controls = D.createElement('div');
controls.className = 'cap-backup';
controls.innerHTML = '<h4>模块与数据</h4><p>暂停音乐自动收录，不删除数据。</p><label><input type="checkbox" data-module="music"> 声屿自动收录</label><button data-backup>导出统一备份</button><button data-restore>恢复音乐库与外观设置</button><input type="file" accept=".json,application/json" hidden><p data-result></p>';
settings.append(controls);
const followLabel=D.createElement('label');const followInput=D.createElement('input');followInput.type='checkbox';followInput.checked=W.localStorage.getItem('capricorn_follow_story')!=='off';followInput.onchange=()=>W.localStorage.setItem('capricorn_follow_story',followInput.checked?'on':'off');followLabel.append(followInput,' 音乐跟随剧情');controls.append(followLabel);
const result = msg => controls.querySelector('[data-result]').textContent = msg;
for (const b of controls.querySelectorAll('[data-module]')) {
  const k = b.dataset.module;
  b.checked = flags[k];
  b.onchange = () => {
    flags[k] = b.checked;
    W.localStorage.setItem('capricorn_modules', JSON.stringify(flags));
    result('已保存自动收录开关');
  };
}
controls.querySelector('[data-backup]').onclick = async () => {
  try {
    const key = scope();
    const mem = await memory?.backup();
    if (key !== scope()) throw Error('聊天已切换，请重试');
    const data = {
      format: 'capricorn-backup', version: 1, created: new Date().toISOString(),
      music: music?.backup() ?? null, memory: mem ?? null,
      theme: themeSelect.value, flags: { ...flags },
      appearance: JSON.parse(W.localStorage.getItem('capricorn_appearance_v1') || 'null')
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = D.createElement('a'); a.href = url; a.download = 'Capricorn-backup.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    result('已导出音乐库、外观设置及当前聊天记忆副本。');
  } catch (e) { result('导出失败：' + e.message); }
};
const file = controls.querySelector('input[type=file]');
controls.querySelector('[data-restore]').onclick = () => file.click();
file.onchange = async () => {
  try {
    const f = file.files[0]; if (!f) return;
    const x = JSON.parse(await f.text());
    if (x.format !== 'capricorn-backup' || x.version !== 1 || !x.music || !music) throw Error('不支持的备份或音乐模块不可用');
    if (!W.confirm('替换全部音乐库及外观设置？记忆世界书不会被覆盖。')) return;
    music.restore(x.music);
    if (x.appearance) W.localStorage.setItem('capricorn_appearance_v1', JSON.stringify(x.appearance));
    if (['auto', 'light', 'dark'].includes(x.theme)) { themeSelect.value = x.theme; themeSelect.onchange(); }
    result('音乐库与外观已恢复（若外观未刷新请重载页面）。');
  } catch (e) { result('恢复失败：' + e.message); } finally { file.value = ''; }
};

shared.onAccountChange=()=>{if(tab==='cloud'&&!shared.accountReady?.())select('library');else libraryNav.hidden=!['library','cloud'].includes(tab)||!shared.accountReady?.();};
cleanupNetease = mountNetease(settings, shared);
if (music) cloud = mountCloud(content, shared, music);
cleanupMobile = mountMobile({ root, island, nav, onResume: () => void tick() });
appearanceApi = mountAppearance(settings, root, themeSelect, memory?.root);
for (const [node,label] of [[controls,'数据与自动收录'],[settings.querySelector('.cap-backup:not(.cap-backup:first-child)'),'账号与连接']]) {
  if (!node || node.parentElement !== settings || node.closest('details')) continue;
  const d = D.createElement('details'); const h = D.createElement('summary'); h.textContent = label; d.append(h); node.before(d); d.append(node);
}
for (const node of [...settings.children]) {
  if (!node.matches('section.cap-backup')) continue;
  const d = D.createElement('details'); const h = D.createElement('summary'); h.textContent = '账号与连接'; d.append(h); node.before(d); d.append(node);
}
