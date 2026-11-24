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
let appearanceApi, cloud, cleanupMobile, cleanupNetease, memory, music, timer, busy = false, dead = false, tab = '';

const root = D.createElement('div');
root.id = 'capricorn-hub';
root.innerHTML = `
  <button class="cap-island" aria-expanded="false" data-playing="false" aria-label="声屿音乐播放器" title="声屿">
    <span class="cap-island-orb" aria-hidden="true">
      ${SHIYI_ICONS.note}
      <span class="cap-island-bars"><i></i><i></i><i></i></span>
    </span>
    <span class="cap-island-lyric-wrap">
      <span class="cap-island-lyric">声屿</span>
    </span>
  </button>
  <nav hidden>
    <header>
      <strong>声屿</strong>
      <button data-tab="settings" aria-label="声屿设置">${icon("settings")}</button><button data-close aria-label="关闭">${icon("close")}</button>
    </header>
    <div class="cap-tabs" role="tablist">
      <button data-tab="music" role="tab">播放</button>
      <button data-tab="library" role="tab">曲库</button>
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
const content = root.querySelector('.cap-content'), settings = root.querySelector('.cap-settings');

shared.onIslandUpdate = ({ playing, text, title }) => {
  island.dataset.playing = playing ? 'true' : 'false';
  island.title = playing ? `${title || '正在播放'} · 点击展开声屿` : '声屿（点击打开播放器）';
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
const scope = () => {
  const c = W.SillyTavern?.getContext?.() || {};
  return JSON.stringify([c.characterId ?? c.character_id, c.chatId ?? c.chatMetadata?.chat_id]);
};
const memoryOpen = () => memory?.root && !memory.root.classList.contains('shiyi-collapsed');

async function refreshTimeline() {
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
    for (const m of memories.sort((a, b) => a.floor - b.floor)) {
      const card = D.createElement('details');
      card.className = 'cap-story';
      const head = D.createElement('summary');
      const field = n => m.content.match(new RegExp('<' + n + '>([\\s\\S]*?)</' + n + '>'))?.[1]?.trim();
      const tracks = songs.filter(t => String(t.floor) === String(m.floor));
      for (const [cls, value] of [
        ['cap-story-time', field('时间') || m.when],
        ['cap-story-title', field('标题') || m.title.replace(/^记忆\d+｜/, '')],
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
      timeline.append(card);
    }
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
  tab = t;
  root.dataset.tab = t;
  D.body.dataset.capricornTab = t;
  settings.hidden = t !== 'settings';
  if (t === 'cloud') cloud?.show(); else cloud?.hide();
  libraryNav.hidden = !['library','cloud'].includes(t);
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
  if (busy || dead) return;
  busy = true;
  try {
    const last = api('getLastMessageId');
    shared.messages = last >= 0 ? api('getChatMessages', `0-${last}`, { role: 'assistant', hide_state: 'all' }) : [];
    if (!Array.isArray(shared.messages)) shared.messages = null;
    if (flags.music) await music?.tick();
    Promise.resolve(memory?.tick()).catch(e => console.warn('[Capricorn] memory scan', e));
    if (memoryOpen() && shownScope !== scope()) refreshTimeline();
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
    dead = true;
    appearanceApi?.destroy();
    cleanupMobile?.destroy();
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

if (memory?.root) {
  memory.root.classList.add('cap-memory-side');

  // 收起态：纯图标精致耳扣，彻底移除文字
  const expandBtn = memory.root.querySelector('#shiyi-expand');
  if (expandBtn) {
    expandBtn.innerHTML = `${SHIYI_ICONS.bookmark}<span class="cap-shiyi-dot" hidden></span>`;
    expandBtn.setAttribute('aria-label', '展开拾忆');
    expandBtn.title = '展开拾忆';
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
if (!dead) { timer = setInterval(() => { if (!D.hidden) void tick(); }, 4000); tick(); }

const controls = D.createElement('div');
controls.className = 'cap-backup';
controls.innerHTML = '<h4>模块与数据</h4><p>暂停音乐自动收录，不删除数据。</p><label><input type="checkbox" data-module="music"> 声屿自动收录</label><button data-backup>导出统一备份</button><button data-restore>恢复音乐库与外观设置</button><input type="file" accept=".json,application/json" hidden><p data-result></p>';
settings.append(controls);
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
