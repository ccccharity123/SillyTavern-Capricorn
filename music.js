/* 声屿 v0.8 | TavernHelper 全局脚本。仅本地歌单；不提供未授权网易云登录/音源。 */
import { mountNowPlaying } from './now-playing.js';
export async function startMusic(shared){
'use strict';
let W=window,D=document;try{if(window.parent!==window&&window.parent.document?.body){W=window.parent;D=W.document;}}catch{}
const INSTANCE='__sound_isle_v08__';try{W.__sound_isle_v07__?.destroy?.()}catch{};try{W.__sound_isle_v06__?.destroy?.()}catch{};try{W.__sound_isle_v05__?.destroy?.()}catch{};try{W[INSTANCE]?.destroy?.()}catch{};try{W.__sound_isle_v04__?.destroy?.()}catch{};try{W.__sound_isle_v03__?.destroy?.()}catch{};try{W.__sound_isle_v02__?.destroy?.()}catch{};try{W.__sound_isle_v01__?.destroy?.()}catch{}
const KEY='sound_isle_v01_library';
const api=(n,...a)=>{let f=window[n]||window.TavernHelper?.[n]||W[n]||W.TavernHelper?.[n];return typeof f==='function'?f(...a):null};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash=s=>{let h=2166136261;for(let c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(16)};
let db;try{db=JSON.parse(W.localStorage.getItem(KEY)||'null')}catch{};if(!db||typeof db!=='object')db={version:1,playlists:{},favorites:[],recent:[],processed:{},settings:{}};
for(let k of ['playlists','processed','settings'])if(!db[k]||typeof db[k]!=='object')db[k]={};for(let k of ['favorites','recent'])if(!Array.isArray(db[k]))db[k]=[];
const save=()=>{try{W.localStorage.setItem(KEY,JSON.stringify(db))}catch(e){status('本地保存失败：'+e.message)}};
const context=()=>W.SillyTavern?.getContext?.()||window.SillyTavern?.getContext?.()||{};
function character(){let c=context(),id=c.characterId??c.character_id;let name=c.name2||c.characters?.[id]?.name||'';if(id===undefined||id===null||id===''||!name)return null;return {id:'char:'+String(id),name:String(name)};}
function playlist(id,name,kind='character'){if(!db.playlists[id]){db.playlists[id]={id,name,kind,songs:[],created:Date.now()};save()}return db.playlists[id]}
let filterText='',current='',selected='',opened=false,playing=null,drag=false,disposed=false,lastSignature='',stability=new Map(),scanBusy=false;
const audio=D.createElement('audio');audio.preload='metadata';audio.playsInline=true;audio.setAttribute('playsinline','');audio.style.display='none';D.body.append(audio);
let queue=[],queueIndex=-1,queuePlaylistName="",playMode=db.settings.playMode||'order',audioError='';
function validUrl(u){try{let x=new URL(String(u||''));return ['https:','http:'].includes(x.protocol)?x.href:''}catch{return ''}}
function durationText(v){if(!Number.isFinite(v))return '00:00';return String(Math.floor(v/60)).padStart(2,'0')+':'+String(Math.floor(v%60)).padStart(2,'0')}
function audioTracks(){return db.playlists[selected]?.songs||[]}
function updateMedia(){try{if(!('mediaSession' in navigator)||!playing)return;navigator.mediaSession.metadata=new MediaMetadata({title:playing.title,artist:playing.artist,album:queuePlaylistName||'声屿',artwork:playing.coverUrl?[{src:playing.coverUrl}]:[]});navigator.mediaSession.playbackState=audio.paused?'paused':'playing'}catch{}}
function rememberPlay(t){db.recent=db.recent.filter(x=>x.id!==t.id);db.recent.unshift({id:t.id,title:t.title,artist:t.artist,at:Date.now()});db.recent=db.recent.slice(0,100);save()}
let fullPlayer;
let resolving=false;let playEpoch=0, matching=false, matchAttempts=new Map(), actualQuality='';
async function matchOnline(t,manual=false){
 if(!shared.online?.ready())return false;
 const d=await shared.online.get('/music/search?q='+encodeURIComponent(t.title+' '+t.artist));
 const songs=Array.isArray(d.songs)?d.songs:[];
 const norm=x=>String(x||'').normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
 const exact=songs.filter(x=>norm(x.title)===norm(t.title)&&(x.artists||[]).some(a=>norm(a)===norm(t.artist)));
 let pick=exact.length===1?exact[0]:null;
 if(manual&&songs.length){const n=W.prompt('选择网易云版本（取消不修改）：\n'+songs.map((x,i)=>`${i+1}. ${x.title} — ${x.artists.join('/')} · ${x.album}`).join('\n'),pick?String(songs.indexOf(pick)+1):'');if(n===null)return false;pick=songs[Number(n)-1]||null;}
 if(!pick||disposed||!Object.values(db.playlists).some(p=>p.songs.includes(t)))return false;
 t.neteaseId=String(pick.id);if(validUrl(pick.cover))t.coverUrl=String(pick.cover).replace(/^http:/,'https:');save();return true;
}
async function autoMatch(){if(matching||!shared.online?.ready()||shared.flags.music===false)return;const ch=character();const t=(db.playlists[ch?.id]?.songs||[]).find(t=>!t.neteaseId&&!t.audioUrl&&Date.now()-(matchAttempts.get(t.id)||0)>600000);if(!t)return;matching=true;matchAttempts.set(t.id,Date.now());try{if(await matchOnline(t)){status('已匹配网易云：'+t.title);render()}}catch(e){status('在线匹配暂不可用：'+e.message)}finally{matching=false}}
async function playIndex(index){const tracks=audioTracks();if(!tracks[index])return;queue=tracks.slice();queuePlaylistName=db.playlists[selected]?.name||'声屿';return playQueued(index)}
let playbackLog=[], coverState='未检查', started=false;
function trace(msg){playbackLog.push(String(msg));if(playbackLog.length>40)playbackLog.shift();status(msg);fullPlayer?.refresh()}
function clearAudio(){audio.pause();audio.removeAttribute('src');audio.load();started=false}
function attemptPlay(timeout=12000){let timer;return Promise.race([Promise.resolve().then(()=>audio.play()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('音频加载超时')),timeout)})]).finally(()=>clearTimeout(timer))}
async function playQueued(index,resumeAt=0){
 if(!queue.length)return;const epoch=++playEpoch;const alive=()=>epoch===playEpoch&&!disposed;
 queueIndex=(index+queue.length)%queue.length;const t=queue[queueIndex];playing=t;resolving=true;audioError='';actualQuality='';playbackLog=[];coverState='未检查';clearAudio();render();
 const deadline=Date.now()+95000;
 async function candidate(url,quality){if(!alive())return false;clearAudio();audio.src=url;actualQuality=quality;trace('正在加载：'+quality);try{await attemptPlay(Math.max(1,Math.min(12000,deadline-Date.now())));if(!alive())return false;if(resumeAt>0&&Number.isFinite(audio.duration))audio.currentTime=Math.min(resumeAt,audio.duration);started=true;return true}catch(e){if(!alive())return false;if(e.name==='NotAllowedError'){trace('音源已准备，请再次点击播放');throw e}trace(quality+'：'+(audio.error?'媒体错误 '+audio.error.code:e.name==='AbortError'?'加载中断':e.message==='音频加载超时'?e.message:'播放失败 '+e.name));clearAudio();return false}}
 try{let ok=false;const manual=validUrl(t.audioUrl);if(manual)ok=await candidate(manual,'手动音源');else if(shared.online?.ready()){
 if(!t.neteaseId)await matchOnline(t);if(!alive())return;if(!t.neteaseId)throw Error('尚未匹配网易云歌曲');
 if(!t.coverUrl||!validUrl(t.coverUrl)){try{const m=await shared.online.get('/music/detail?id='+encodeURIComponent(t.neteaseId),10000);if(!alive())return;const cover=validUrl(m.cover);if(cover){t.coverUrl=cover.replace(/^http:/,'https:');save();coverState='已取得地址';render()}else coverState='详情未返回封面'}catch(e){coverState='详情请求失败：'+e.name}}else coverState='已有地址';
 for(const level of ['jymaster','sky','jyeffect','hires','lossless','exhigh','higher','standard']){if(!alive())return;if(Date.now()>=deadline)break;trace('正在请求：'+level);let d;try{d=await shared.online.get('/music/url?id='+encodeURIComponent(t.neteaseId)+'&level='+level,Math.max(1,Math.min(16000,deadline-Date.now())))}catch(e){if(!alive())return;trace(level+'：'+(e.name==='AbortError'?'请求超时':e.message));continue}if(!alive())return;if(!d.available){trace(level+'：'+(d.reason||'无完整音源')+(d.upstreamCode?' ('+d.upstreamCode+')':''));continue}const url=validUrl(d.url);if(!url||new URL(url).protocol!=='https:'){trace(level+'：无有效 HTTPS 音源');continue}const mime={mp3:'audio/mpeg',flac:'audio/flac',aac:'audio/aac',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg'}[String(d.type||'').toLowerCase()];if(mime&&!audio.canPlayType(mime)){trace(level+'：设备不支持 '+d.type);continue}if(await candidate(url,d.level||level)){ok=true;break}}
 }else throw Error('请启用网易云并填写访问密钥');if(!alive())return;if(!ok)throw Error('未能加载完整音源，请查看播放诊断');resolving=false;rememberPlay(t);updateMedia();render();trace('播放成功：'+actualQuality);
 }catch(e){if(!alive())return;resolving=false;audioError=e.name==='NotAllowedError'?'系统要求再次点击播放':e.message;render();trace(audioError)}
}
function diagnostic(){return ['声屿 1.8.2','歌曲：'+(playing?.title||'无'),'网易云ID：'+(playing?.neteaseId||'无'),'封面：'+coverState,'音质：'+actualQuality,'readyState：'+audio.readyState,'networkState：'+audio.networkState,'媒体错误：'+(audio.error?.code||0),'状态：'+audioError,...playbackLog].join('\n')}
function nextTrack(direction=1){if(!queue.length){let tracks=audioTracks();if(!tracks.length)return;queue=tracks.slice();queueIndex=0;queuePlaylistName=db.playlists[selected]?.name||'声屿';return playQueued(0)}let i=queueIndex;if(playMode==='shuffle'&&queue.length>1){let n=Math.floor(Math.random()*(queue.length-1));i=n>=i?n+1:n}else i=(i+direction+queue.length)%queue.length;playQueued(i)}
async function toggleAudio(){if(!playing)return playIndex(0);if(resolving){++playEpoch;resolving=false;clearAudio();trace('已取消加载，再点播放重试');render();return}if(!audio.paused){audio.pause();render();return}if(!audio.getAttribute('src')||audio.error)return playQueued(queueIndex,audio.currentTime||0);const epoch=++playEpoch;resolving=true;try{await attemptPlay();if(epoch!==playEpoch||disposed)return;started=true;audioError='';trace('播放成功：'+actualQuality)}catch(e){if(epoch!==playEpoch||disposed)return;audioError=e.name==='NotAllowedError'?'系统阻止播放，请再次点击':e.message;trace(audioError);if(e.name!=='NotAllowedError')clearAudio()}finally{if(epoch===playEpoch&&!disposed){resolving=false;render()}}}
audio.addEventListener('error',()=>{const reasons={1:'播放已中止',2:'网络或音源请求失败',3:'音频格式无法解码',4:'音源不可用或格式不受支持'};audioError=reasons[audio.error?.code]||'音频播放失败';status(audioError+'；请检查音源授权、链接有效期及格式');updateMini()});
audio.addEventListener('ended',()=>{if(playMode==='one'){audio.currentTime=0;audio.play().catch(()=>{})}else nextTrack(1)});
audio.addEventListener('play',()=>{updateMedia();updateMini()});audio.addEventListener('pause',()=>{updateMedia();updateMini()});
audio.addEventListener('timeupdate',()=>{let seek=root.querySelector('#si-seek'),clock=root.querySelector('.si-clock');if(seek&&!seek.matches(':active')){seek.max=String(Number.isFinite(audio.duration)?audio.duration:0);seek.value=String(audio.currentTime||0)}if(clock)clock.textContent=durationText(audio.currentTime)+' / '+durationText(audio.duration)});
function updateMini(){fullPlayer?.refresh();let e=root.querySelector('.si-island-title');if(e)e.textContent=(audio.paused?'♫ ':'▮▮ ')+(playing?.title||'声屿 · Sound Isle');let b=root.querySelector('[data-action="playpause"]');if(b)b.textContent=audio.paused?'▶':'Ⅱ'}
try{if(navigator.mediaSession){for(let [action,fn] of [['play',()=>{if(audio.paused)toggleAudio()}],['pause',()=>{audio.pause();render()}],['previoustrack',()=>nextTrack(-1)],['nexttrack',()=>nextTrack(1)],['seekto',x=>{if(Number.isFinite(x.seekTime))audio.currentTime=x.seekTime}]])try{navigator.mediaSession.setActionHandler(action,fn)}catch{}}}catch{}

const root=D.createElement('div');root.id='sound-isle-root';
const style=D.createElement('style');style.id='sound-isle-style';style.textContent=`
#sound-isle-root{position:fixed;z-index:2147483000;top:calc(env(safe-area-inset-top, 0px) + 12px);right:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f7f7fa;font-size:13px;pointer-events:none}
#sound-isle-root *{box-sizing:border-box}#sound-isle-root .si-island{pointer-events:auto;display:flex;align-items:center;gap:9px;border:0;border-radius:999px;background:rgba(18,18,22,.92);color:white;padding:9px 14px;min-width:154px;max-width:250px;box-shadow:0 10px 30px #0005;cursor:pointer;user-select:none;touch-action:none}
#sound-isle-root .si-dot{width:9px;height:9px;background:#f48eab;border-radius:50%;flex-shrink:0}#sound-isle-root .si-island-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:left}
#sound-isle-root .si-panel{pointer-events:auto;display:none;position:absolute;top:47px;right:0;width:min(360px,calc(100vw - 20px));max-height:min(74vh,650px);overflow:auto;border-radius:23px;padding:16px;background:rgba(28,28,35,.95);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);box-shadow:0 15px 55px #0007;color:#f7f7fa}#sound-isle-root .si-panel.open{display:block}
#sound-isle-root button,#sound-isle-root input,#sound-isle-root select{font:inherit}#sound-isle-root button{cursor:pointer}#sound-isle-root .si-btn{background:#ffffff1b;color:#fff;border:1px solid #ffffff24;border-radius:11px;padding:7px 10px}#sound-isle-root .si-btn:hover{background:#ffffff30}
#sound-isle-root .si-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}#sound-isle-root .si-h1{font-weight:750;font-size:19px}#sound-isle-root .si-muted{color:#b7b6bf;font-size:11px}#sound-isle-root .si-input{background:#ffffff15;border:1px solid #ffffff35;color:#fff;border-radius:9px;padding:9px;width:100%;min-width:0}#sound-isle-root .si-row{display:flex;gap:7px;align-items:center;margin:8px 0}#sound-isle-root .si-row .si-input{flex:1}#sound-isle-root .si-section{margin:16px 0 8px;font-size:11px;color:#bbb;text-transform:uppercase;letter-spacing:1px}#sound-isle-root .si-list{display:flex;flex-direction:column;gap:5px}#sound-isle-root .si-item{border:0;background:#ffffff0d;border-radius:10px;color:#fff;padding:10px;text-align:left;display:flex;align-items:center;gap:7px;width:100%}#sound-isle-root .si-item.active{background:#f48eab33}#sound-isle-root .si-item .si-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#sound-isle-root .si-track{display:flex;gap:6px;align-items:center;padding:8px 0;border-bottom:1px solid #ffffff18}#sound-isle-root .si-track .si-grow{flex:1;min-width:0}#sound-isle-root .si-song{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#sound-isle-root .si-footer{margin-top:16px;padding-top:10px;border-top:1px solid #ffffff24}#sound-isle-root .si-pill{display:inline-block;background:#ffffff15;border-radius:20px;padding:4px 8px;margin:3px 0}#sound-isle-root .si-danger{color:#ffb1bd}
#sound-isle-root .si-cover{width:100px;height:100px;object-fit:cover;border-radius:16px;box-shadow:0 8px 30px #0006;background:linear-gradient(135deg,#ce769b,#6558a2)}
#sound-isle-root .si-now{display:flex;align-items:center;gap:13px;margin:12px 0;padding:12px;border-radius:18px;background:linear-gradient(120deg,#d36a8a30,#9876ba22)}
#sound-isle-root .si-controls{display:flex;justify-content:center;align-items:center;gap:12px;margin:10px 0}
#sound-isle-root .si-mainplay{font-size:22px;border-radius:50%;height:46px;width:46px;border:0;background:#fff;color:#17151c}
#sound-isle-root input[type=range]{accent-color:#f6a1bd;width:100%;min-width:0}
#sound-isle-root .si-panel{max-height:min(78dvh,720px);overscroll-behavior:contain}
#sound-isle-root .si-island{touch-action:none}
@media(max-width:420px){#sound-isle-root .si-panel{width:min(350px,calc(100vw - 18px));padding:13px}}

`;
D.head.append(style);D.body.append(root);
let statusText='本地曲库已就绪';function status(t){statusText=t;fullPlayer?.refresh();const e=root.querySelector('.si-status');if(e)e.textContent=t;}
// 网易云仅关联歌曲公开页面；不处理账户密码、Cookie、私有播放地址。
function neteaseId(raw){let value=String(raw||'').trim();if(/^\d{1,20}$/.test(value))return value;try{let u=new URL(value);if(!['music.163.com','y.music.163.com','163cn.tv'].includes(u.hostname))return '';if(u.hostname==='163cn.tv')return '';let id=u.searchParams.get('id')||new URLSearchParams((u.hash.split('?')[1]||'')).get('id');if(!id){let m=u.pathname.match(/\/song\/(\d+)/);id=m?.[1]}return /^\d{1,20}$/.test(id||'')?id:''}catch{return ''}}
function neteaseUrl(t){return t?.neteaseId?'https://music.163.com/#/song?id='+encodeURIComponent(t.neteaseId):'https://music.163.com/#/search/m/?s='+encodeURIComponent(t.title+' '+t.artist)}
function openExternal(url){try{W.open(url,'_blank','noopener,noreferrer')}catch(e){status('打开网易云失败：'+e.message)}}
// 可选的公开元数据候选：Apple iTunes Search API，不是网易云数据或网易云音源。
// 必须用户手动点击才发起请求；结果需用户确认，永不覆盖已关联的网易云ID。
const normalize=s=>String(s||'').toLocaleLowerCase().normalize('NFKC').replace(/[\\s\\p{P}\\p{S}]+/gu,'');
async function metadataCandidates(t){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8500);
  try{
    const url='https://itunes.apple.com/search?'+new URLSearchParams({term:t.title+' '+t.artist,entity:'song',limit:'12'});
    const r=await fetch(url,{signal:controller.signal,credentials:'omit'});
    if(!r.ok)throw Error('查询返回 HTTP '+r.status);
    const x=await r.json();
    return (Array.isArray(x.results)?x.results:[]).filter(v=>v.kind==='song'&&v.trackName&&v.artistName).map(v=>({
      title:String(v.trackName),artist:String(v.artistName),album:String(v.collectionName||''),
      cover:validUrl(String(v.artworkUrl100||'').replace(/100x100bb/g,'600x600bb')),
      preview:validUrl(v.previewUrl),url:validUrl(v.trackViewUrl),
      score:(normalize(v.trackName)===normalize(t.title)?3:normalize(v.trackName).includes(normalize(t.title))?1:0)
       +(normalize(v.artistName)===normalize(t.artist)?3:normalize(v.artistName).includes(normalize(t.artist))?1:0)
    })).sort((a,b)=>b.score-a.score).slice(0,8);
  }finally{clearTimeout(timeout)}
}
async function chooseMetadata(t){
  status('正在查询公开元数据候选（非网易云）…');
  let results;try{results=await metadataCandidates(t)}catch(e){status('元数据查询不可用：'+(e?.message||'网络限制')+'；仍可手动设置封面');return}
  if(!results.length){status('没有找到候选，请使用「音源」手动设置封面');return}
  const lines=results.map((r,i)=>`${i+1}. ${r.title} — ${r.artist}${r.album?' / '+r.album:''}${r.score<5?' [需仔细核对]':''}`);
  let answer=W.prompt('以下来自 Apple 公开曲库，并非网易云搜索结果。\\n请核对歌手和版本，输入序号确认专辑封面；取消则不修改。\\n\\n'+lines.join('\\n'),'1');
  if(answer===null)return;
  const idx=Number(answer)-1,c=results[idx];
  if(!Number.isInteger(idx)||!c){status('未选择有效候选');return}
  if(!W.confirm('确认将「'+c.title+' — '+c.artist+'」的专辑封面关联到「'+t.title+' — '+t.artist+'」？\\n不会修改网易云ID，也不会自动绑定试听音源。'))return;
  if(c.cover)t.coverUrl=c.cover;
  t.metadataSource='itunes';t.metadataTitle=c.title;t.metadataArtist=c.artist;t.metadataUrl=c.url;
  t.previewUrl=c.preview;save();status('已关联候选封面；网易云歌曲ID保持不变');render();
}
// 手动批量补封面：逐首显示候选，确认后保存；网络失败不中断本地歌单。
let metadataBatchRunning=false;
async function batchMetadata(){
 if(metadataBatchRunning)return status('已有批量匹配任务在运行');
 const pl=db.playlists[selected]||db.playlists[current];if(!pl)return status('请先选择歌单');
 const missing=pl.songs.filter(t=>!validUrl(t.coverUrl));
 if(!missing.length)return status('此歌单所有歌曲已有封面');
 if(!W.confirm('为「'+pl.name+'」中 '+missing.length+' 首没有封面的歌曲逐首查询公开曲库？\n每首都需要你手动确认；不会查询网易云或获取任何账号数据。'))return;
 metadataBatchRunning=true;let ok=0,skip=0;
 try{
  for(let i=0;i<missing.length;i++){
   if(disposed)break;
   let t=missing[i];if(!pl.songs.includes(t)||validUrl(t.coverUrl))continue;
   status('封面候选 '+(i+1)+'/'+missing.length+'：'+t.title);
   let found;try{found=await metadataCandidates(t)}catch(e){status('网络查询失败，批量操作已停止：'+(e?.message||e));break}
   if(!found.length){skip++;continue}
   const lines=found.map((c,j)=>(j+1)+'. '+c.title+' — '+c.artist+(c.album?' / '+c.album:'')+(c.score<5?' [匹配度低]':''));
   let answer=W.prompt('第 '+(i+1)+'/'+missing.length+' 首：'+t.title+' — '+t.artist+'\n候选来自 Apple 公开曲库，非网易云。\n输入序号确认，留空跳过，输入 q 结束批量匹配。\n\n'+lines.join('\n'),'');
   if(answer===null||String(answer).toLowerCase()==='q')break;
   if(!String(answer).trim()){skip++;continue}
   const n=Number(answer)-1,c=found[n];
   if(!Number.isInteger(n)||!c||!c.cover){skip++;continue}
   if(!W.confirm('确认使用「'+c.title+' — '+c.artist+'」的封面？\n不会自动设置音源或网易云ID。')){skip++;continue}
   t.coverUrl=c.cover;t.metadataSource='itunes';t.metadataTitle=c.title;t.metadataArtist=c.artist;t.metadataUrl=c.url;t.previewUrl=c.preview;
   ok++;save();render();
  }
 }finally{metadataBatchRunning=false;status('封面批量匹配完成：成功 '+ok+' 首，跳过 '+skip+' 首');render()}
}
function trackId(title,artist){return (title+'|'+artist).trim().toLocaleLowerCase().replace(/\s+/g,' ')}
function parseBgm(body){const re=/<bgm(?:\s[^>]*)?>([\s\S]*?)<\/bgm>/gi,out=[];for(const m of String(body||'').matchAll(re)){let line=m[1].replace(/<[^>]*>/g,'').trim().split('\n')[0].trim();let parts=line.split(/\s+[-—–－]\s+/);if(parts.length<2)continue;let artist=parts.pop().trim(),title=parts.join(' - ').trim();if(title&&artist&&title.length<150&&artist.length<150)out.push({id:trackId(title,artist),title,artist})}return out}
function addSong(pl,track,source){if(!pl||!track)return false;if(pl.songs.some(x=>x.id===track.id))return false;pl.songs.push({...track,source:source||null,added:Date.now()});save();return true}
function getMessages(){if(shared?.messages)return shared.messages;let last=api('getLastMessageId');if(!Number.isInteger(last)||last<0)return [];let r=api('getChatMessages',`0-${last}`,{role:'assistant',hide_state:'all'});return Array.isArray(r)?r:[]}
function msgText(m){return String(m.message??m.mes??m.content??m.text??'')}
function msgId(m,i){return String(m.message_id??m.id??i)}
function chatId(){let c=context();return String(c.chatId??c.chatMetadata?.chat_id??'unknown')}
async function scan(){if(scanBusy||disposed||shared?.flags?.music===false)return;scanBusy=true;try{let ch=character();if(!ch)return;let pl=playlist(ch.id,ch.name+' · 故事原声');let msgs=getMessages(),now=Date.now(),added=0;for(let i=0;i<msgs.length;i++){let m=msgs[i],body=msgText(m),found=parseBgm(body);if(!found.length)continue;let id=msgId(m,i),key=ch.id+'|'+chatId()+'|'+id,signature=hash(body);if(db.processed[key]===signature)continue;let prev=stability.get(key);if(!prev||prev.signature!==signature){stability.set(key,{signature,at:now});continue}if(now-prev.at<9000)continue;for(let song of found)if(addSong(pl,song,{chat:chatId(),floor:id,character:ch.name}))added++;db.processed[key]=signature;save()}if(added){status('已自动收录 '+added+' 首歌曲');render()}}catch(e){console.warn('[声屿] 扫描失败',e)}finally{scanBusy=false}}
function sync(){let ch=character();if(!ch)return;if(current!==ch.id){current=ch.id;playlist(ch.id,ch.name+' · 故事原声');if(!selected||db.playlists[selected]?.kind==='character')selected=ch.id;render()}}
function listPlaylists(){return Object.values(db.playlists).sort((a,b)=>(a.kind==='character'?0:1)-(b.kind==='character'?0:1)||a.created-b.created)}
function render(){if(disposed)return;fullPlayer?.refresh();const pl=db.playlists[selected]||db.playlists[current]||null;if(pl&&!db.playlists[selected])selected=pl.id;let tracks=pl?.songs||[];let visibleTracks=tracks.map((t,i)=>({t,i})).filter(({t})=>!filterText||normalize(t.title+" "+t.artist).includes(normalize(filterText)));
root.innerHTML=`<button type="button" class="si-island" aria-label="打开声屿播放器"><span class="si-dot"></span><span class="si-island-title">♫ ${esc(playing?playing.title:'声屿 · Sound Isle')}</span><span>⌄</span></button><div class="si-panel ${opened?'open':''}"><div class="si-head"><div><div class="si-h1">♫ 声屿</div><div class="si-muted">Sound Isle · 故事音乐库</div></div><button class="si-btn" data-action="close">收起 ⌃</button></div><div class="si-pill">当前角色：${esc(character()?.name||'未识别')}</div><div class="si-now"><img class="si-cover" src="${esc(validUrl(playing?.coverUrl)||'')}" alt="专辑封面" onerror="this.style.opacity='.25'"><div style="min-width:0;flex:1"><div style="font-size:17px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(playing?.title||'尚未播放')}</div><div class="si-muted">${esc(playing?.artist||'选择一首歌曲')}</div><div class="si-muted" style="margin-top:8px">${esc(audioError||(resolving?'正在获取授权音源':audio.getAttribute('src')?'已连接音源':'尚未获取音源'))}</div></div></div><input id="si-seek" type="range" min="0" max="${Number.isFinite(audio.duration)?audio.duration:0}" step="1" value="${audio.currentTime||0}" aria-label="播放进度"><div class="si-muted si-clock" style="text-align:right">${durationText(audio.currentTime)} / ${durationText(audio.duration)}</div><div class="si-controls"><button class="si-btn" data-action="mode" title="播放模式">${playMode==='shuffle'?'随机':playMode==='one'?'单曲':'顺序'}</button><button class="si-btn" data-action="prev">◀◀</button><button class="si-mainplay" data-action="playpause">${audio.paused?'▶':'Ⅱ'}</button><button class="si-btn" data-action="next">▶▶</button></div><div class="si-row"><span class="si-muted">音量</span><input id="si-volume" type="range" min="0" max="1" step="0.01" value="${audio.volume}" aria-label="音量"></div><div class="si-section">全局音乐库 · 角色歌单</div><div class="si-list">${listPlaylists().map(p=>`<button class="si-item ${selected===p.id?'active':''}" data-pick="${esc(p.id)}"><span>♫</span><span class="si-grow">${esc(p.name)}</span><small>${p.songs.length}</small></button>`).join('')}</div><div class="si-row"><input class="si-input" id="si-playlist-name" placeholder="新建自定义歌单名称"><button class="si-btn" data-action="new">创建</button></div><div class="si-section">${esc(pl?.name||'请选择歌单')}</div><div class="si-muted">${tracks.length} 首 · 可手动绑定有权使用的音源</div><div class="si-row"><input class="si-input" id="si-filter" placeholder="搜索当前歌单的歌曲或歌手" value="${esc(filterText)}"><button class="si-btn" data-action="clear-filter">清空</button></div><div class="si-list">${visibleTracks.map(({t,i})=>`<div class="si-track"><span class="si-grow"><div class="si-song">${esc(t.title)}</div><div class="si-muted si-song">${esc(t.artist)}${t.source?' · 第'+esc(t.source.floor)+'楼':''}</div></span><button class="si-btn" title="查看歌曲来源" data-origin="${i}">来源</button><button class="si-btn" title="复制到其他歌单" data-copy="${i}">复制</button><button class="si-btn" title="播放" data-play="${i}">▶</button><button class="si-btn" title="设置音源" data-source="${i}">音源</button><button class="si-btn" title="查找公开专辑封面候选（Apple曲库，需手动确认）" data-meta="${i}">封面</button><button class="si-btn" title="关联网易云歌曲ID" data-online="${i}">在线匹配</button><button class="si-btn" data-netease="${i}">${t.neteaseId?'已关联':'匹配'}</button><button class="si-btn" title="打开网易云歌曲或搜索" data-search="${i}">↗</button><button class="si-btn" title="上移歌曲" data-up="${i}">↑</button><button class="si-btn" title="下移歌曲" data-down="${i}">↓</button><button class="si-btn si-danger" title="删除" data-delete="${i}">×</button></div>`).join('')||'<div class="si-muted">还没有歌曲，等待正文生成 &lt;bgm&gt; 标签，或手动添加。</div>'}</div><div class="si-section">手动添加歌曲</div><div class="si-row"><input class="si-input" id="si-song-title" placeholder="歌曲名称"></div><div class="si-row"><input class="si-input" id="si-song-artist" placeholder="歌手名称"><button class="si-btn" data-action="add">添加</button></div><div class="si-row"><button class="si-btn" data-action="batch-meta">批量补封面</button><button class="si-btn" data-action="scan">扫描当前聊天</button><button class="si-btn" data-action="export-csv">导出当前歌单CSV</button><button class="si-btn" data-action="export">导出备份</button><button class="si-btn" data-action="diagnostics">播放诊断</button><button class="si-btn" data-action="import">导入备份</button></div>${pl?.kind==='custom'?'<button class="si-btn si-danger" data-action="remove-playlist">删除当前自建歌单</button>':''}<input id="si-import-file" type="file" accept="application/json,.json" hidden><div class="si-footer"><div class="si-muted si-status">${esc(statusText)}</div><div class="si-muted">v1.7 · 全屏播放器、同步歌词与独立播放队列；在线功能需配置私人网关。</div></div></div>`;
root.querySelector('.si-island').addEventListener('click',()=>{if(drag){drag=false;return}opened=!opened;render()});root.querySelector('[data-action="close"]').onclick=()=>{opened=false;render();D.querySelector('#capricorn-hub [data-close]')?.click()};
root.querySelector('#si-filter').addEventListener('input',e=>{filterText=e.target.value;let pos=e.target.selectionStart;render();let el=root.querySelector('#si-filter');el.focus();el.setSelectionRange(pos,pos)});root.querySelector('[data-action="clear-filter"]').onclick=()=>{filterText='';render()};
 root.querySelectorAll('[data-up],[data-down]').forEach(el=>el.onclick=()=>{if(!pl)return;let i=Number(el.dataset.up??el.dataset.down),j=i+(el.hasAttribute('data-up')?-1:1);if(j<0||j>=pl.songs.length)return;[pl.songs[i],pl.songs[j]]=[pl.songs[j],pl.songs[i]];save();render()});
 root.querySelectorAll('[data-pick]').forEach(el=>el.onclick=()=>{selected=el.dataset.pick;filterText='';render()});
root.querySelectorAll('[data-origin]').forEach(el=>el.onclick=()=>{let t=tracks[Number(el.dataset.origin)];if(!t)return;let x=t.source;W.alert('歌曲：'+t.title+' — '+t.artist+'\n'+(x?'角色：'+(x.character||'未知')+'\n聊天ID：'+(x.chat||'未知')+'\n楼层/消息ID：'+(x.floor??'未知'):'手动添加或旧版歌曲：无楼层来源记录')+'\n网易云歌曲ID：'+(t.neteaseId||'未关联'));});
 root.querySelectorAll('[data-copy]').forEach(el=>el.onclick=()=>{let t=tracks[Number(el.dataset.copy)];if(!t)return;let destinations=listPlaylists().filter(p=>p.id!==pl?.id);if(!destinations.length)return status('请先创建另一份歌单');let raw=W.prompt('复制「'+t.title+'」到哪份歌单？请输入序号：\n'+destinations.map((p,i)=>(i+1)+'. '+p.name).join('\n'),'1');if(raw===null)return;let i=Number(raw)-1,target=destinations[i];if(!Number.isInteger(i)||!target)return status('无效歌单序号');if(target.songs.some(x=>x.id===t.id))return status('目标歌单已包含这首歌');target.songs.push(JSON.parse(JSON.stringify(t)));save();status('已复制到「'+target.name+'」');render();});
 root.querySelectorAll('[data-play]').forEach(el=>el.onclick=()=>playIndex(Number(el.dataset.play)));
root.querySelectorAll('[data-source]').forEach(el=>el.onclick=()=>{let t=tracks[Number(el.dataset.source)];if(!t)return;let u=W.prompt('输入你有权播放的 HTTPS/HTTP 音频直链（留空清除）：',t.audioUrl||'');if(u===null)return;u=u.trim();if(u&&!validUrl(u))return status('音源地址必须是 http(s) URL');t.audioUrl=u;let c=W.prompt('可选：专辑封面 HTTPS/HTTP 图片地址（留空保持不变）：',t.coverUrl||'');if(c!==null){c=c.trim();if(!c||validUrl(c))t.coverUrl=c}save();status('音源设置已保存');render()});
root.querySelector('[data-action="playpause"]').onclick=toggleAudio;
const fullButton=D.createElement('button');fullButton.className='si-btn';fullButton.textContent='全屏播放';fullButton.onclick=()=>fullPlayer.open();root.querySelector('.si-now').append(fullButton);
root.querySelector('[data-action="prev"]').onclick=()=>nextTrack(-1);
root.querySelector('[data-action="next"]').onclick=()=>nextTrack(1);
root.querySelector('[data-action="mode"]').onclick=()=>{playMode=playMode==='order'?'shuffle':playMode==='shuffle'?'one':'order';db.settings.playMode=playMode;save();render()};
root.querySelector('#si-seek').oninput=e=>{if(Number.isFinite(audio.duration))audio.currentTime=+e.target.value};
root.querySelector('#si-volume').oninput=e=>{audio.volume=+e.target.value;db.settings.volume=audio.volume;save()};
root.querySelectorAll('[data-delete]').forEach(el=>el.onclick=()=>{if(!pl)return;let t=pl.songs[Number(el.dataset.delete)];if(t===playing){audio.pause();playing=null;audio.removeAttribute('src')}pl.songs.splice(Number(el.dataset.delete),1);save();render()});
root.querySelectorAll('[data-meta]').forEach(el=>el.onclick=()=>{let t=tracks[Number(el.dataset.meta)];if(t)chooseMetadata(t)});
 root.querySelectorAll('[data-online]').forEach(el=>el.onclick=async()=>{const t=tracks[Number(el.dataset.online)];try{if(!shared.online?.ready())throw Error('请先配置并启用网易云');status(await matchOnline(t,true)?'匹配成功':'未修改匹配');render()}catch(e){status(e.message)}});
 root.querySelectorAll('[data-netease]').forEach(el=>el.onclick=()=>{let t=tracks[Number(el.dataset.netease)];if(!t)return;let raw=W.prompt('粘贴网易云歌曲分享链接或歌曲数字 ID。留空可解除关联。\n可先点击 ↗ 在网易云查找准确版本。',t.neteaseId||'');if(raw===null)return;let id=neteaseId(raw);if(raw.trim()&&!id)return status('未识别歌曲ID：请使用网易云歌曲分享链接或数字ID');t.neteaseId=id||'';save();status(id?'已关联网易云歌曲 '+id+'（仅用于定位歌曲，不代表可直接播放）':'已解除网易云关联');render()});
root.querySelectorAll('[data-search]').forEach(el=>el.onclick=()=>{let t=tracks[Number(el.dataset.search)];if(t)openExternal(neteaseUrl(t))});
root.querySelector('[data-action="add"]').onclick=()=>{if(!pl)return status('请先选择歌单');let title=root.querySelector('#si-song-title').value.trim(),artist=root.querySelector('#si-song-artist').value.trim();if(!title||!artist)return status('请填写歌曲名称与歌手');status(addSong(pl,{id:trackId(title,artist),title,artist},null)?'已添加歌曲':'歌曲已存在');render()};
root.querySelector('[data-action="new"]').onclick=()=>{let name=root.querySelector('#si-playlist-name').value.trim();if(!name)return status('请输入歌单名称');let id='custom:'+Date.now()+':'+hash(name);playlist(id,name,'custom');selected=id;render()};
root.querySelector('[data-action="batch-meta"]').onclick=()=>batchMetadata();
 root.querySelector('[data-action="scan"]').onclick=()=>{scan();status('正在检查当前聊天，内容稳定9秒后收录')};
root.querySelector('[data-action="export-csv"]').onclick=()=>{if(!pl)return status('请先选择歌单');const q=x=>'"'+String(x??'').replace(/"/g,'""')+'"';let rows=[['歌曲名称','歌手','网易云歌曲ID','来源角色','来源聊天ID','来源楼层','音源URL','封面URL'],...pl.songs.map(t=>[t.title,t.artist,t.neteaseId||'',t.source?.character||'',t.source?.chat||'',t.source?.floor??'',t.audioUrl||'',t.coverUrl||''])];let csv='\uFEFF'+rows.map(r=>r.map(q).join(',')).join('\r\n');let blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=D.createElement('a');a.href=url;a.download='声屿_'+pl.name.replace(/[\\/:*?"<>|]/g,'_')+'_歌单.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);status('已导出当前歌单CSV（含来源记录）')};
 root.querySelector('[data-action="diagnostics"]').onclick=()=>W.prompt('复制播放诊断（不含密钥和音源链接）',diagnostic());
root.querySelector('[data-action="export"]').onclick=()=>{let blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=D.createElement('a');a.href=url;a.download='声屿_音乐库备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)};
root.querySelector('[data-action="import"]').onclick=()=>root.querySelector('#si-import-file').click();root.querySelector('#si-import-file').onchange=async e=>{let f=e.target.files?.[0];if(!f)return;try{let x=JSON.parse(await f.text());if(!x||typeof x.playlists!=='object'||Array.isArray(x.playlists))throw Error('无效的备份文件');if(!W.confirm('导入会替换声屿当前全部歌单，继续吗？将先尝试在本机保存一份恢复快照。'))return;
try{W.localStorage.setItem('sound_isle_before_import_backup',JSON.stringify({at:Date.now(),db}))}catch(e){status('无法保存导入前恢复快照：'+e.message+'；已取消导入');return}
db={version:1,playlists:x.playlists,favorites:Array.isArray(x.favorites)?x.favorites:[],recent:Array.isArray(x.recent)?x.recent:[],processed:x.processed||{},settings:x.settings||{}};selected='';save();status('导入成功');render()}catch(err){status('导入失败：'+err.message)}};
let rm=root.querySelector('[data-action="remove-playlist"]');if(rm)rm.onclick=()=>{if(W.confirm('确定删除这个自建歌单？')){delete db.playlists[selected];selected=current;save();render()}};
}
// 拖动悬浮岛：只在移动超过阈值时视为拖动；展开后面板跟随。
let start=null;root.addEventListener('pointerdown',e=>{if(!e.target.closest('.si-island'))return;start={x:e.clientX,y:e.clientY,left:root.getBoundingClientRect().left,top:root.getBoundingClientRect().top};drag=false});
D.addEventListener('pointermove',move);function move(e){if(!start)return;let dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.abs(dx)+Math.abs(dy)<8&&!drag)return;drag=true;root.style.left=Math.max(5,Math.min(W.innerWidth-155,start.left+dx))+'px';root.style.top=Math.max(5,Math.min(W.innerHeight-60,start.top+dy))+'px';root.style.right='auto'}
D.addEventListener('pointerup',up);function up(){if(start&&drag){db.settings.position={left:root.style.left,top:root.style.top};save();setTimeout(()=>{drag=false},100)}start=null}
if(db.settings.position){root.style.left=db.settings.position.left;root.style.top=db.settings.position.top;root.style.right='auto'}
audio.volume=Number.isFinite(+db.settings.volume)?Math.max(0,Math.min(1,+db.settings.volume)):0.8;
let timer=null;sync();render();scan();
fullPlayer=mountNowPlaying({D,W,audio,shared,state:()=>({playing,queue,queueIndex,actualQuality,playMode,resolving,started,statusText,diagnostic:()=>diagnostic()}),toggle:toggleAudio,next:nextTrack,play:playQueued,move(i,j){if(i<0||j<0||i>=queue.length||j>=queue.length)return;const active=queue[queueIndex];const [t]=queue.splice(i,1);queue.splice(j,0,t);queueIndex=queue.indexOf(active);fullPlayer.refresh();},remove(i){if(i===queueIndex||i<0||i>=queue.length)return;queue.splice(i,1);if(i<queueIndex)queueIndex--;fullPlayer.refresh();}});
W[INSTANCE]={root,backup(){return JSON.parse(JSON.stringify(db))},restore(x){if(!x||!x.playlists||typeof x.playlists!=='object'||Array.isArray(x.playlists)||Object.keys(x.playlists).some(k=>['__proto__','constructor','prototype'].includes(k))||Object.values(x.playlists).some(p=>!p||typeof p.id!=='string'||typeof p.name!=='string'||!Array.isArray(p.songs)||p.songs.some(t=>!t||typeof t.title!=='string'||typeof t.artist!=='string')))throw Error('无效音乐库');const next={version:1,playlists:x.playlists,favorites:Array.isArray(x.favorites)?x.favorites:[],recent:Array.isArray(x.recent)?x.recent:[],processed:x.processed||{},settings:x.settings||{}};W.localStorage.setItem('sound_isle_before_import_backup',JSON.stringify({at:Date.now(),db}));W.localStorage.setItem(KEY,JSON.stringify(next));audio.pause();audio.removeAttribute('src');playing=null;queue=[];db=next;selected='';sync();render()},tick(){if(!disposed){sync();const result=scan();void autoMatch();return result}},show(){opened=true;render()},hide(){opened=false;render()},timelineSongs(){const ch=character(),chat=chatId();if(!ch||chat==='unknown')return [];const pl=db.playlists[ch.id]?.songs||[],out=[];for(const [i,m] of getMessages().entries()){for(const t of parseBgm(msgText(m))){const saved=pl.find(x=>x.id===t.id);out.push({...t,floor:msgId(m,i),playable:!!saved&&(!!validUrl(saved.audioUrl)||!!shared.online?.ready())})}}for(const t of pl){if(t.source?.chat===chat&&t.source?.floor!=null&&!out.some(x=>x.id===t.id&&String(x.floor)===String(t.source.floor)))out.push({id:t.id,floor:t.source.floor,title:t.title,artist:t.artist,playable:!!validUrl(t.audioUrl)||!!shared.online?.ready()})}return out},playTimeline(id){const ch=character();if(!ch)return;const pl=db.playlists[ch.id];const i=pl?.songs.findIndex(t=>t.id===id)??-1;if(i<0)return status('当前角色没有此歌曲');selected=ch.id;return playIndex(i)},title(){return (audio.paused?'':'▮▮ ')+(playing?.title||'声屿')},destroy(){try{for(const a of ['play','pause','previoustrack','nexttrack','seekto'])navigator.mediaSession?.setActionHandler(a,null);if(navigator.mediaSession){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none'}}catch{}fullPlayer?.destroy();disposed=true;playEpoch++;clearInterval(timer);D.removeEventListener('pointermove',move);D.removeEventListener('pointerup',up);audio.pause();audio.removeAttribute('src');audio.remove();root.remove();style.remove();if(W[INSTANCE]===this)delete W[INSTANCE]}};
console.info('[声屿] v0.8 已启动；网易云歌曲页面关联已启用；不提供未授权网易云音源。');

return W[INSTANCE];
}
