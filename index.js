import {mountNetease} from './netease.js';
import {startMemory} from './memory.js';
import {startMusic} from './music.js';
import {mountMobile} from './mobile.js';
const W=window,D=document;
W.__capricornExtension?.destroy?.();
const flags={memory:true,music:true};try{const x=JSON.parse(W.localStorage.getItem('capricorn_modules')||'{}');for(const k of Object.keys(flags))if(typeof x[k]==='boolean')flags[k]=x[k]}catch{}
const shared={messages:null,flags};let cleanupMobile,cleanupNetease,memory,music,timer,busy=false,dead=false,tab='';
const root=D.createElement('div');root.id='capricorn-hub';root.innerHTML='<button class="cap-island" aria-expanded="false">♑ <span>摩羯座</span></button><nav hidden><header><strong>摩羯座</strong><button data-close aria-label="关闭">×</button></header><button data-tab="memory">拾忆</button><button data-tab="music">声屿</button><button data-tab="timeline">时序</button><button data-tab="settings">设置</button><small></small><section class="cap-settings" hidden><label>外观 <select><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><button data-memory-settings>拾忆设置</button></section><main class="cap-content"></main></nav>';D.body.append(root);
const nav=root.querySelector('nav'), island=root.querySelector('.cap-island');
const content=root.querySelector('.cap-content'), settings=root.querySelector('.cap-settings');
const timeline=D.createElement('section');timeline.className='cap-timeline';timeline.hidden=true;content.append(timeline);
let timelineEpoch=0;
const scope=()=>{const c=W.SillyTavern?.getContext?.()||{};return JSON.stringify([c.characterId??c.character_id,c.chatId??c.chatMetadata?.chat_id])};
let shownScope='';
async function refreshTimeline(){const epoch=++timelineEpoch, key=scope();shownScope=key;timeline.replaceChildren();
 const refresh=D.createElement('button');refresh.textContent='刷新当前聊天时间轴';refresh.onclick=refreshTimeline;timeline.append(refresh);
 const note=D.createElement('p');note.textContent='正在读取已归档记忆与歌曲来源…';timeline.append(note);
 try{const memories=memory?await memory.timelineRows():[];const songs=music?.timelineSongs()||[];if(epoch!==timelineEpoch||tab!=='timeline'||key!==scope())return;
 const rows=new Map();const row=f=>{const k=String(f);if(!rows.has(k))rows.set(k,{floor:k,memories:[],songs:[]});return rows.get(k)};
 memories.forEach(m=>row(m.floor).memories.push(m));songs.forEach(t=>row(t.floor).songs.push(t));
 note.textContent=rows.size?'仅显示当前聊天的已归档记忆及歌曲首次收录来源。':'当前聊天暂无已归档记忆或有来源的歌曲。';
 for(const r of [...rows.values()].sort((a,b)=>Number(a.floor)-Number(b.floor))){const card=D.createElement('article');const h=D.createElement('h4');h.textContent='第 '+r.floor+' 楼';card.append(h);
 for(const m of r.memories){const date=D.createElement('small');date.textContent=m.when;const text=D.createElement('p');text.textContent=m.content;card.append(date,text)}
 for(const t of r.songs){const line=D.createElement('div');line.className='cap-track';const label=D.createElement('span');label.textContent='♪ '+t.title+' — '+t.artist;const b=D.createElement('button');b.textContent=t.playable?'播放':'设置音源';b.onclick=()=>{if(key!==scope()){refreshTimeline();return}if(t.playable)music.playTimeline(t.id);else select('music')};line.append(label,b);card.append(line)}timeline.append(card)}
 }catch(e){if(epoch===timelineEpoch)note.textContent='读取失败：'+e.message}}
let theme='auto';try{theme=W.localStorage.getItem('capricorn_theme')||'auto'}catch{};
const themeSelect=settings.querySelector('select');themeSelect.value=theme;root.dataset.theme=theme;
themeSelect.onchange=()=>{root.dataset.theme=themeSelect.value;try{W.localStorage.setItem('capricorn_theme',themeSelect.value)}catch{}};
function select(t){tab=t;root.dataset.tab=t;D.body.dataset.capricornTab=t;settings.hidden=t!=='settings';nav.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===t)));if(t==='music'&&flags.music)music?.show();else music?.hide();if(t==='memory'&&flags.memory)memory?.root?.classList.remove('shiyi-collapsed');timeline.hidden=t!=='timeline';if(t==='timeline')refreshTimeline();else timelineEpoch++;}
function close(){nav.hidden=true;island.setAttribute('aria-expanded','false');select('');}
island.onclick=()=>{if(cleanupMobile?.consumeDrag())return;if(!nav.hidden){close();return;}nav.hidden=false;island.setAttribute('aria-expanded','true');select('memory');};
nav.querySelector('[data-close]').onclick=close;settings.querySelector('[data-memory-settings]').onclick=()=>memory?.root?.querySelector('#shiyi-settings')?.click();nav.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>select(b.dataset.tab));
const api=(n,...a)=>{const f=W[n]||W.TavernHelper?.[n];if(typeof f!=='function')throw Error('缺少酒馆助手 API: '+n);return f(...a)};
async function tick(){if(busy||dead)return;busy=true;try{const last=api('getLastMessageId');shared.messages=last>=0?api('getChatMessages',`0-${last}`,{role:'assistant',hide_state:'all'}):[];if(!Array.isArray(shared.messages))shared.messages=null;if(flags.music)await music?.tick(); // memory review may remain pending while user reads; do not block music polling
Promise.resolve(memory?.tick()).catch(e=>console.warn('[Capricorn] memory scan',e));if(tab==='timeline'&&shownScope!==scope())refreshTimeline();root.querySelector('.cap-island span').textContent=(music?.title()||'摩羯座')+(memory?.pending()?` · ${memory.pending()}待审`:'');root.querySelector('small').textContent=`拾忆 ${!flags.memory?'暂停':memory?'已启动':'未启动'} · 声屿 ${!flags.music?'暂停':music?'已启动':'未启动'}`;}catch(e){root.querySelector('small').textContent=e.message;}finally{shared.messages=null;busy=false;}}
W.__capricornExtension={destroy(){dead=true;cleanupMobile?.destroy();cleanupNetease?.();clearInterval(timer);memory?.destroy();music?.destroy();root.remove();delete D.body.dataset.capricornTab;}};
D.body.dataset.capricornTab='';
try{memory=await startMemory(shared)}catch(e){console.error('[Capricorn] memory',e)}
try{music=await startMusic(shared)}catch(e){console.error('[Capricorn] music',e)}
if(memory?.root){content.append(memory.root);memory.root.querySelector('#shiyi-collapse').onclick=close;}if(music?.root){content.append(music.root);}if(!dead){timer=setInterval(()=>{if(!D.hidden)void tick()},4000);tick();}

const controls=D.createElement('div');controls.className='cap-backup';controls.innerHTML='<h4>模块与数据</h4><p>暂停自动收录，不删除数据；拾忆暂停审核时仍维护当前聊天的世界书挂载。</p><label><input type="checkbox" data-module="memory"> 拾忆自动审核</label><label><input type="checkbox" data-module="music"> 声屿自动收录</label><button data-backup>导出统一备份</button><button data-restore>恢复音乐库与外观设置</button><input type="file" accept=".json,application/json" hidden><p data-result></p>';settings.append(controls);
const result=msg=>controls.querySelector('[data-result]').textContent=msg;
for(const b of controls.querySelectorAll('[data-module]')){const k=b.dataset.module;b.checked=flags[k];b.onchange=()=>{flags[k]=b.checked;W.localStorage.setItem('capricorn_modules',JSON.stringify(flags));result('已保存自动收录开关');};}
controls.querySelector('[data-backup]').onclick=async()=>{try{const key=scope();const mem=await memory?.backup();if(key!==scope())throw Error('聊天已切换，请重试');const data={format:'capricorn-backup',version:1,created:new Date().toISOString(),music:music?.backup()??null,memory:mem??null,theme:themeSelect.value,flags:{...flags}};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=D.createElement('a');a.href=url;a.download='Capricorn-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);result('已导出音乐库、设置及当前聊天记忆副本；请妥善保管。')}catch(e){result('导出失败：'+e.message)}};
const file=controls.querySelector('input[type=file]');controls.querySelector('[data-restore]').onclick=()=>file.click();file.onchange=async()=>{try{const f=file.files[0];if(!f)return;const x=JSON.parse(await f.text());if(x.format!=='capricorn-backup'||x.version!==1||!x.music||!music)throw Error('不支持的备份或音乐模块不可用');if(!W.confirm('替换全部音乐库及外观设置？记忆世界书不会被覆盖。'))return;music.restore(x.music);if(['auto','light','dark'].includes(x.theme)){themeSelect.value=x.theme;themeSelect.onchange()}result('音乐库已恢复；记忆副本请通过世界书管理手动核对。')}catch(e){result('恢复失败：'+e.message)}finally{file.value=''}};

cleanupNetease=mountNetease(settings,shared);
cleanupMobile=mountMobile({root,island,nav,onResume:()=>void tick()});
