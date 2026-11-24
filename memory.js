import {canonicalRows} from './canon.js';
import {sceneQuery} from './scene.js';
import {searchMemory} from './recall-search.js';
import {createLexicalStore} from './lexical-store.js';
import {createVector} from './vector.js';
import {hybrid,hybridBudget,buildDocs,cost} from './hybrid.js';
import {createRetrieval} from './retrieval-client.js';
import {unified} from './unified.js';
import {buildLedger,knowledgeForCharacter,retrieve,kinds} from './weave.js';
import {table,traces,fuzzy} from './traces.js';
import { createDossier } from './dossier.js';
import { memoryBackupSnapshot, restoreMemoryBackup } from './backup.js';
import { viewpointName, speakingCharacter, recallViewpoint } from './viewpoint.js';
const isManagedEntry=e=>typeof e.extra?.shiyi_key==='string'||
  (typeof e.extra?.shiyi_owner==='string'&&typeof e.extra?.shiyi_chat==='string');

async function readWorldbook(api,check,name,id){
  const entries=await api('getWorldbook',name);
  check(id);
  if(!Array.isArray(entries))throw Error(`无法读取世界书「${name}」`);
  return entries;
}
async function writeWorldbook(api,check,name,id,update){
  await api('updateWorldbookWith',name,all=>{check(id);return all.map(update);});
  check(id);
}

async function syncWorldbookMounts(api,check,id,target){
  check(id);
  const global=api('getGlobalWorldbookNames');
  if(!Array.isArray(global))throw Error('无法读取全局世界书挂载');
  const local=id?api('getChatWorldbookName','current'):null;
  const remove=new Set();
  for(const name of new Set([...global,local])){
    if(typeof name!=='string'||!name.startsWith('拾忆｜')||name===target)continue;
    const entries=await readWorldbook(api,check,name,id);
    const managed=entries.filter(isManagedEntry);
    if(!managed.length)continue;
    if(managed.some(e=>e.enabled)){
      await writeWorldbook(api,check,name,id,e=>isManagedEntry(e)?{...e,enabled:false}:e);
      if((await readWorldbook(api,check,name,id)).some(e=>isManagedEntry(e)&&e.enabled))throw Error('拾忆旧世界书条目未成功停用');
    }
    if(managed.length===entries.length)remove.add(name);
  }
  if(remove.has(local)){
    await api('rebindChatWorldbook','current',null);
    check(id);
    if(api('getChatWorldbookName','current')===local)throw Error('拾忆聊天世界书未成功停用');
  }
  const keep=global.filter(name=>!remove.has(name)&&!(name===target&&name===local));
  if(target&&!keep.includes(target)&&local!==target)keep.push(target);
  if(keep.length!==global.length||keep.some((name,i)=>name!==global[i])){
    check(id);
    if(JSON.stringify(api('getGlobalWorldbookNames'))!==JSON.stringify(global))throw Error('全局世界书挂载已变化，请重试');
    await api('rebindGlobalWorldbooks',keep);
    check(id);
    if(JSON.stringify(api('getGlobalWorldbookNames'))!==JSON.stringify(keep))throw Error('拾忆全局世界书挂载未完成');
  }
}

function helperApi(local,host){
  return (name,...args)=>{
    for(const source of [local,local.TavernHelper,host,host.TavernHelper]){
      if(typeof source?.[name]==='function')return source[name](...args);
    }
    throw Error('缺少酒馆助手 API：'+name);
  };
}

export async function detachDisabledMemory(shared){
  const scope=()=>shared.scope();
  const id=scope();
  window.SillyTavern?.getContext?.().setExtensionPrompt?.('capricorn_weave','',1,4,false,0);
  const checkScope=expected=>{if(scope()!==expected)throw Error('聊天已切换，请重试');};
  return syncWorldbookMounts(helperApi(window,window),checkScope,id,null);
}

export async function startMemory(shared) {
  'use strict';
  // 酒馆助手脚本运行于独立 iframe；界面必须挂载到父级酒馆页面。
  let hostWindow=window, hostDocument=document;
  try { if (window.parent && window.parent !== window && window.parent.document?.body) { hostWindow=window.parent; hostDocument=window.parent.document; } } catch(e) { console.warn('[拾忆] 无法访问父页面',e); }
  const KEY = '__shiyi_v03_instance__';
  if (hostWindow[KEY]?.destroy) hostWindow[KEY].destroy();
  const state = { busy:false, open:false, queue:[], seen:new Set(), deferred:new Map(), stability:new Map(), current:'', root:null, style:null, disposed:false };
  hostWindow[KEY] = state;
  const $ = (s,root=hostDocument)=>root?.querySelector(s);
  const api = helperApi(window,hostWindow);
  const safe = s=>String(s??'').replace(/[<>"&]/g,c=>({'<':'&lt;','>':'&gt;','"':'&quot;','&':'&amp;'}[c]));
  const vector=createVector();const lexicalStore=createLexicalStore();const retrieval=createRetrieval();
  const settingsDefault={start:'<summary>',end:'</summary>',keep:5,storyYear:'',weaveMode:'smart',weaveBudget:3000,weaveKinds:kinds,summaryMode:'unified',engine:'hybrid',adaptive:false,autoHide:false,layers:true,vectorEnabled:false,vectorUrl:'',vectorModel:'',modeAdvice:true};
  const vars=()=>api('getVariables',{type:'chat'})||{};
  const saveVars=patch=>api('replaceVariables',{...vars(),shiyi_v01:patch},{type:'chat'});
  const blocked=key=>!!vars().shiyi_v01?.deletedKeys?.[key];
  const markDeleted=(keys)=>{
    const d=vars().shiyi_v01||{};
    saveVars({...d,deletedKeys:{...d.deletedKeys,...Object.fromEntries(keys.map(k=>[k,true]))}});
    archiveRevision++;
  };
  let archiveRevision=0, projectedRevision=-1;
  const changed=()=>{archiveRevision++;state.onChange?.();};
  const archive=()=>vars().shiyi_v01?.archiveUI||{};
  const promptKey='capricorn_weave';
  const viewpoints=new Map();
  function activeViewpoint(id,type){
    const speaker=speakingCharacter(context(),type);
    return speaker&&viewpoints.get(id)===speaker?speaker:'';
  }
  function setViewpoint(id,name){
    check(id);
    if(typeof name!=='string')throw Error('请提供准确角色名');
    const expected=viewpointName(name);
    if(name.trim()&&(!expected||expected!==speakingCharacter(context())))throw Error('角色视角仅支持角色名匹配的当前单聊');
    if((viewpoints.get(id)||'')===expected)return;
    if(expected)viewpoints.set(id,expected);else viewpoints.delete(id);
    if(state.weaveResultScope===id&&state.weaveResult?.viewpoint)state.weaveResult=null;
    if(generation)invalidateGeneration();
  }
  let generation=null;
  const invalidateGeneration=()=>{
    generation=null;
    archiveRevision++;
    if (!state.disposed) context().setExtensionPrompt?.(promptKey,'',1,4,false,0);
  };
  const tableStable=new Map();let tableScope='';
  function ledger(messages=getMessages(),persist=true){
    const id=identity();if(tableScope!==id){tableScope=id;tableStable.clear();}
    const d=vars().shiyi_v01||{}, old=d.weave?.rows||{}, now=Date.now();
    const confirmed=d.records||{};const result=buildLedger(messages,hash,d.deletedKeys||{},archive().traceHidden||{},old,(m,k)=>{if(confirmed[k])return true;const t=tableStable.get(k);if(t===undefined){tableStable.set(k,now);return false;}return now-t>=8000;});
    const live=new Set(messages.map(m=>`${m.message_id}:${hash(String(m.message??''))}`));for(const k of tableStable.keys())if(!live.has(k))tableStable.delete(k);
    const next={rows:result.rows,entities:result.entities};if(persist&&JSON.stringify(d.weave||{})!==JSON.stringify(next)){check(id);saveVars({...vars().shiyi_v01,weave:next});}return result;
  }
  const autoDossier=()=>ledger().entities;
  async function recallForGeneration(chat,messages,rows,cfg,scope,guard,budget,verifySources,type){
    if(budget===0)return {content:'',selected:[],summaries:[],estimate:0};
    const l=ledger(messages,false), a=archive();
    const live=new Set([...Object.keys(l.rows),...Object.keys(rows)]);
    const manual=(a.dossier||[]).filter(r=>!(r.sources||[]).some(k=>!live.has(k)));
    const manualIds=new Set(manual.map(r=>r.id));
    const entities=[...manual,...l.entities.filter(r=>!manualIds.has(r.id))];
    const visible=sceneQuery(chat,[]).query;
    const options={mode:cfg.weaveMode,budget,pins:a.weavePins||[],categories:cfg.weaveKinds||kinds,meta:a.meta||{},adaptive:cfg.adaptive,layers:cfg.layers,visible};
    if(cfg.summaryMode==='legacy')return retrieve(entities,visible,options);
    if(cfg.engine!=='hybrid')return unified(rows,entities,visible,options);
    const known=cfg.weaveMode==='archive'?[]:knowledgeForCharacter(l);
    if(known.length){
      entities.push(...known);
      options.categories=[...options.categories,'认知'];
    }
    const docs=buildDocs(rows,entities,options), scene=sceneQuery(chat,docs);
    const recall=await searchMemory(docs,scene,query=>{
      if(query!==scene.primary)verifySources();
      return retrieval.scores(docs,query,scope,lexicalStore,guard);
    });
    guard();
    const sameScope=state.echoScope===scope;
    const query=['expanded','deep'].includes(recall.stage)?scene.expanded:scene.primary;
    const limit=hybridBudget(budget,query,options.adaptive,recall);
    const actor=cfg.weaveMode==='archive'?'':activeViewpoint(scope,type);
    const perspective=recallViewpoint(l,actor,query,Math.min(360,Math.floor(limit*.25)));
    const roleCost=perspective.content?cost('\n\n'+perspective.content):0;
    const result=hybrid(rows,entities,query,{
      ...options, budget:limit-roleCost, adaptive:false,
      docs, scores:recall.scores, sceneHints:scene.hints, recallAnchor:recall.anchor, primaryQuery:scene.primary, lexicalStore,
      echo:sameScope?state.echo:{}, advance:!sameScope||state.echoTurn!==visible,
      vectorRank:cfg.vectorEnabled?(ranked,query)=>vector.rank(ranked,query,{...cfg,vectorKey:sessionStorage.getItem('capricorn-vector-key')||''},scope):null,
    });
    return {
      ...result, budget:limit, recallStage:recall.stage, recallConfidence:recall.confidence,
      content:[result.content,perspective.content].filter(Boolean).join('\n\n'),
      selected:[...new Set([...result.selected,...perspective.selected])],
      viewpoint:perspective.content?actor:'',
      viewpointCount:perspective.selected.length,
    };
  }
  function archivePatch(patch){
    const d=vars().shiyi_v01||{};
    saveVars({...d,archiveUI:{...d.archiveUI,...patch}});
    archiveRevision++;
  }
  function snapshot(key,r,kind){const a=archive();const history={...a.history};history[key]=[{...r,savedAt:new Date().toISOString(),kind},...(history[key]||[])].slice(0,20);archivePatch({history});}
  function recycle(keys,rows){const a=archive(),trash={...a.trash};for(const k of keys)if(rows[k])trash[k]={...rows[k],deletedAt:new Date().toISOString()};archivePatch({trash});}
  function jump(floor){const el=hostDocument.querySelector(`#chat .mes[mesid="${Number(floor)}"]`);if(!el){notice('原楼层未加载，请先加载历史聊天');return false;}el.scrollIntoView({block:'center',behavior:'smooth'});return true;}

  const config=(d=vars().shiyi_v01||{})=>{const saved=d.settings||{};return {...settingsDefault,...saved,summaryMode:saved.summaryMode||(Object.keys(d.records||{}).length?'unified':'legacy')};};
  const records=()=>vars().shiyi_v01?.records||{};
  const activeRecords=(messages=getMessages())=>canonicalRows(records(),messages,hash,vars().shiyi_v01?.deletedKeys);
  const context=()=>hostWindow.SillyTavern?.getContext?.()||window.SillyTavern?.getContext?.()||{};
  const chatIdentity=()=>{
    if(shared.chatIdentity)return shared.chatIdentity();
    const c=context();
    const chatId=String(c.chatId??c.chatMetadata?.chat_id??'');
    const char=String(c.characterId??c.character_id??c.name2??'');
    const legacyScope=chatId?`${char}::${chatId}`:'';
    const owner=c.groupId!=null?`group:${c.groupId}`:`character:${c.characters?.[c.characterId]?.avatar||char}`;
    return {scope:shared.scope?.()??(chatId?JSON.stringify([owner,chatId]):''),owner,chatId,legacyScope};
  };
  const identity=()=>chatIdentity().scope;
  const chatLabel=()=>{
    const c=context(); const name=String(c.name2||c.characters?.[c.characterId]?.name||'角色').slice(0,24);
    const chat=String(c.chatId||'聊天').replace(/\.jsonl$/i,'').slice(0,28);
    const suffix=hash(identity()).slice(0,6);
    return `拾忆｜${name}｜${chat}｜${suffix}`;
  };
  function hash(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).toUpperCase().padStart(8,'0');}
  const sourceKey=m=>`${m.message_id}:${hash(String(m.message??''))}`;
  const notice=(msg)=>{console.info('[拾忆]',msg); const el=$('#shiyi-status',state.root);if(el)el.textContent=msg;};
  const error=(e)=>{console.error('[拾忆]',e);notice('操作失败：'+(e?.message||e));};
  function getMessages(){ const last=api('getLastMessageId');if(!Number.isInteger(last)||last < -1)throw Error('聊天尚未就绪');const list=last>=0?api('getChatMessages',`0-${last}`,{role:'assistant',hide_state:'all'}):[];if(!Array.isArray(list))throw Error('聊天读取失败');return list; }
  function extract(str,{start,end}=config()){let best=null,pos=-1;for(const [a,b] of [[start,end],['<summary>','</summary>'],['<摩羯纪要>','</摩羯纪要>']]){if(!a||!b)continue;const i=str.lastIndexOf(a),j=str.indexOf(b,i+a.length);if(i>=0&&j>=0&&i>pos){pos=i;best=str.slice(i+a.length,j).trim();}}return best;}
  // 剧情日期解析：支持年月日、月日、中文上午/中午/下午、起止范围和跨日。
  // 缺少年份时仅使用用户在设置中确认的剧情年份，不以现实年份填充。
  function storyYear(){const y=Number(config().storyYear||0);return y>=1000&&y<=9999?y:null;}
  function parseStoryTime(content){
    const original=String(content||'');
    const cn=s=>{const d='零一二三四五六七八九';if(s.includes('十')){const [a,b]=s.split('十');return (a?d.indexOf(a):1)*10+(b?d.indexOf(b):0);}return Number([...s].map(c=>d.indexOf(c)).join(''));};
    content=original.normalize('NFKC').replace(/([一二三四五六七八九十零]+)([月日])/g,(_,n,u)=>cn(n)+u);
    const raw=String(content||'').replace(/^[^：:\n]{0,24}[：:]\s*/,'').replace(/\s+/g,' ');
    const dateRe=/(?:(\d{4})\s*[年\/-])?\s*(\d{1,2})\s*[月\/-]\s*(\d{1,2})\s*日?/g;
    const matches=[...raw.matchAll(dateRe)];if(!matches.length)return original.match(/(?:剧情时间|时间)[：:]\s*([^\n|｜]+)/)?.[1]?.trim()||null;
    const baseYear=storyYear();
    function stamp(y,mo,da,time){
      mo=Number(mo);da=Number(da);y=y?Number(y):baseYear;
      if(mo<1||mo>12||da<1||da>31)return null;
      let wd='年份待确认';
      if(y){const d=new Date(Date.UTC(y,mo-1,da));if(d.getUTCMonth()!==mo-1||d.getUTCDate()!==da)return null;wd='星期'+'日一二三四五六'[d.getUTCDay()];}
      const prefix=(y?`${y}年`:'年份待确认｜')+`${String(mo).padStart(2,'0')}月${String(da).padStart(2,'0')}日`;
      return `${prefix} ${wd==='年份待确认'?'':wd+' '}${time||'时间待确认'}`.trim();
    }
    function clock(segment){
      const m=segment.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上|夜间)?\s*(\d{1,2})\s*[:：点时]\s*(\d{1,2})?\s*分?/);
      if(!m)return /(?:凌晨|早上|上午|中午|下午|傍晚|晚上|夜间)/.exec(segment)?.[0]||null;
      let h=Number(m[2]),min=Number(m[3]||0);if(h>23||min>59)return null;
      const period=m[1]||'';
      if(['下午','傍晚','晚上','夜间'].includes(period)&&h<12)h+=12;
      if(period==='中午'&&h<11)h+=12;
      if(period==='凌晨'&&h===12)h=0;
      if(['上午','早上'].includes(period)&&h===12)h=0;
      return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
    }
    const first=matches[0],second=matches[1];
    const firstEnd=second?second.index:Math.min(raw.length,first.index+65);
    const segment=raw.slice(first.index+first[0].length,firstEnd).split(/[，。；;]/)[0];
    const startClock=clock(segment.split(/至|到|—|–|~|～/)[0]);
    const start=stamp(first[1],first[2],first[3],startClock);if(!start)return null;
    if(second&&second.index-first.index<75){
      const secondSegment=raw.slice(second.index+second[0].length,second.index+second[0].length+30).split(/[，。；;]/)[0];
      const end=stamp(second[1]||first[1],second[2],second[3],clock(secondSegment));
      return end?`${start} — ${end}`:start;
    }
    const range=segment.match(/(?:至|到|—|–|~|～)\s*((?:(?:凌晨|早上|上午|中午|下午|傍晚|晚上|夜间)\s*)?\d{1,2}\s*[:：点时]\s*\d{0,2})/);
    if(range){const endClock=clock(range[1]);if(endClock)return `${start} — ${endClock}`;}
    return start;
  }
  function modal(title,body,buttons){
    return new Promise(resolve=>{
      const overlay=hostDocument.createElement('div');overlay.className='shiyi-overlay';
      overlay.innerHTML=`<div class="shiyi-dialog" role="dialog" aria-modal="true"><h3>${safe(title)}</h3><div class="shiyi-body"></div><div class="shiyi-actions"></div></div>`;
      $('.shiyi-body',overlay).append(body);
      const finish=(v)=>{overlay.remove();state.open=false;state.closeModal=null;resolve(v);};state.closeModal=()=>finish('cancel');
      buttons.forEach(({label,value,kind})=>{const b=hostDocument.createElement('button');b.textContent=label;if(kind)b.className=kind;b.onclick=()=>finish(value);$('.shiyi-actions',overlay).append(b);});
      hostDocument.body.append(overlay);state.open=true;
    });
  }
  const characterKey=()=>chatIdentity().owner.replace(/^character:/,'');
  const bookName=()=>`拾忆｜角色｜${hash(characterKey())}`;
  const check=id=>{if(state.disposed||identity()!==id)throw Error('聊天已切换，请重试');};
  const ordered=rows=>Object.entries(rows).sort((a,b)=>a[1].sourceMessage-b[1].sourceMessage);
  const numbered=rows=>Object.fromEntries(ordered(rows).map(([k,r],i)=>[k,{...r,title:!r.title||/^剧情摘要\s*\d+$/.test(r.title)?`剧情摘要 ${i+1}`:r.title}]));
  const formatRows=rows=>Object.values(numbered(rows)).map(r=>`【${r.storyTime||'日期未识别'}｜${r.title}】\n${r.content}`).join('\n\n');
  let writes=Promise.resolve();
  function serial(fn){const task=writes.then(fn,fn);writes=task.catch(()=>{});return task;}
  async function readArchive(id){
    check(id);
    const data=vars().shiyi_v01||{}, name=bookName(), owner=characterKey();
    const {chatId,legacyScope}=chatIdentity();
    const owns=e=>e.extra?.shiyi_owner===owner&&typeof e.extra?.shiyi_chat==='string';
    const matches=e=>owns(e)&&(e.extra.shiyi_chat===id||e.extra.shiyi_chat===legacyScope||
      (!e.extra.shiyi_chat.startsWith('[')&&e.extra.shiyi_chat.split('::').slice(1).join('::')===chatId));
    const names=api('getWorldbookNames');
    if(!Array.isArray(names))throw Error('无法读取世界书列表');
    const entries=names.includes(name)?await readWorldbook(api,check,name,id):[];
    const rows={...data.records};
    let imported=false;
    function importRow(key,row){
      if(typeof key!=='string'||!key||['__proto__','constructor','prototype'].includes(key)||!row||typeof row.content!=='string'||Object.hasOwn(rows,key)||data.deletedKeys?.[key])return;
      rows[key]=row;
      imported=true;
    }
    for(const entry of entries.filter(matches)){
      for(const [key,row] of Object.entries(entry.extra.shiyi_rows||{}))importRow(key,row);
    }
    const previous=data.book||api('getChatWorldbookName','current');
    if(data.archiveVersion!==2&&previous!==name&&typeof previous==='string'&&previous.startsWith('拾忆｜')&&names.includes(previous)){
      const old=await readWorldbook(api,check,previous,id);
      for(const entry of old){
        const key=entry.extra?.shiyi_key;
        if(typeof key!=='string')continue;
        importRow(key,{title:entry.name,content:entry.content,sourceMessage:entry.extra.shiyi_message_id,
          sourceHash:key.split(':').slice(1).join(':'),storyTime:parseStoryTime(entry.content)});
      }
    }
    return {name,owner,names,entries,owns,matches,rows,imported};
  }
  async function projectWorldbook(id,messages,mode){
    const {name,owner,names,entries,owns,matches,rows,imported}=await readArchive(id);
    if(imported){
      check(id);
      const latest=vars().shiyi_v01||{};
      saveVars({...latest,records:{...rows,...latest.records},archiveVersion:2});
      changed();
    }
    const active=activeRecords(messages);
    const content=formatRows(active);
    const intact=e=>String(e.content??'')===formatRows(e.extra.shiyi_rows||{});
    // Keep manually edited worldbook text and keep it out of automatic injection until reviewed.
    const conflict=entries.some(e=>matches(e)&&!intact(e));
    if(conflict)notice('拾忆世界书存在手动修改，已保留原内容；请在世界书中核对。');
    const existing=entries.find(e=>owns(e)&&e.extra.shiyi_chat===id&&intact(e));
    const cfg=config();
    const enable=(mode||cfg.summaryMode)==='legacy'&&!!content;
    let projection=existing;
    if(content&&!projection){
      if(!names.includes(name)&&!await api('createWorldbook',name,[]))throw Error('世界书创建失败');
      check(id);
      if(entries.length&&!entries.some(owns))throw Error('拾忆世界书名称冲突，请检查');
      const result=await api('createWorldbookEntries',name,[{name:chatLabel(),content,enabled:false,strategy:{type:'constant',keys:[]},probability:100,extra:{shiyi_owner:owner,shiyi_chat:id,shiyi_rows:active}}]);
      check(id);
      projection=result?.new_entries?.[0];
      if(!projection)throw Error('创建聊天条目失败');
    }
    if(projection&&enable&&entries.some(e=>!isManagedEntry(e))&&
      !api('getGlobalWorldbookNames').includes(name)&&api('getChatWorldbookName','current')!==name){
      throw Error('拾忆世界书含其他条目，请手动核对其挂载');
    }
    const modify=e=>{
      if(!isManagedEntry(e))return e;
      if(e.uid!==projection?.uid)return e.enabled?{...e,enabled:false}:e;
      if(!intact(e))throw Error('拾忆世界书内容已变化，请重新准备');
      if(e.enabled===enable&&e.content===content&&JSON.stringify(e.extra.shiyi_rows)===JSON.stringify(active))return e;
      return {...e,enabled:enable,content,extra:{...e.extra,shiyi_rows:active}};
    };
    const candidates=existing||!projection?entries:[...entries,projection];
    if(candidates.some(e=>modify(e)!==e)){
      await writeWorldbook(api,check,name,id,modify);
      const updated=await readWorldbook(api,check,name,id);
      if((projection&&!updated.some(e=>e.uid===projection.uid))||updated.some(e=>modify(e)!==e))throw Error('拾忆世界书更新未完成');
    }
    await syncWorldbookMounts(api,check,id,enable?name:null);
    check(id);
    return {active,cfg};
  }
  function writeRows(id,rows,patch={}){
    check(id);
    const data=vars().shiyi_v01||{};
    saveVars({...data,...patch,records:rows});
    changed();
  }
  async function addMemory(candidate,title,content,restore=false){return serial(async()=>{
    const id=candidate.chat;check(id);if(blocked(candidate.key)&&!restore)throw Error('该版本摘要已删除');const source=getMessages().find(m=>m.message_id===candidate.id);
    if(!source||hash(String(source.message??''))!==candidate.key.split(':').slice(1).join(':'))throw Error('原始正文已改变，请重新审核');
    const rows={...records()};
    if(rows[candidate.key]&&!blocked(candidate.key))return notice('这条摘要已经归档');
    rows[candidate.key]={...rows[candidate.key],title,content,sourceMessage:candidate.id,
      sourceHash:candidate.key.split(':').slice(1).join(':'),storyTime:parseStoryTime(content),
      createdAt:rows[candidate.key]?.createdAt||new Date().toISOString()};
    if(restore){
      const deletedKeys={...vars().shiyi_v01?.deletedKeys};
      delete deletedKeys[candidate.key];
      writeRows(id,rows,{deletedKeys});
      state.deferred.delete(candidate.id);
    }else writeRows(id,rows);
    state.seen.add(candidate.key);
    notice('已更新当前聊天记忆');
  });}
  async function review(candidate){
    if(state.disposed||identity()!==candidate.chat||blocked(candidate.key))return;
    const n=Object.values(records()).filter(r=>r.sourceMessage<candidate.id).length+1;
    const wrap=hostDocument.createElement('div');
    wrap.innerHTML=`<p class="shiyi-muted">来源：第 ${candidate.id} 楼 · 注入前请核对正史</p><label>记忆标题<input id="shiyi-title" maxlength="40" value="剧情摘要 ${n}"></label><label>记忆内容<textarea id="shiyi-content" rows="10"></textarea></label>`;
    $('#shiyi-title',wrap).value=candidate.content.match(/^\s*标题[：:]\s*([^\n]+)/m)?.[1]?.trim().slice(0,40)||`剧情摘要 ${n}`;
    $('#shiyi-content',wrap).value=candidate.content;
    const choice=await modal('拾忆 · 待审核记忆',wrap,[{label:'拒绝',value:'reject'},{label:'稍后处理',value:'later'},{label:'确认注入',value:'confirm',kind:'primary'}]);
    if(choice==='confirm'){
      const title=$('#shiyi-title',wrap).value.trim()||`剧情摘要 ${n}`;
      const content=$('#shiyi-content',wrap).value.trim();
      if(!content){notice('摘要为空，未注入');return;}
      try{await addMemory(candidate,title,content);}catch(e){error(e);if(!state.disposed&&identity()===candidate.chat&&!blocked(candidate.key)&&getMessages().some(m=>m.message_id===candidate.id&&`${m.message_id}:${hash(String(m.message??''))}`===candidate.key))state.queue.unshift(candidate);}
    } else if(choice==='reject'){if(identity()===candidate.chat)markDeleted([candidate.key]);state.seen.add(candidate.key);notice('已拒绝，本次运行不再提示该摘要');}
    else if(choice==='later'&&identity()===candidate.chat&&!state.disposed){state.deferred.set(candidate.id,candidate);state.seen.add(candidate.key);notice('已暂缓：本楼层不会自动重复弹窗，可点击「待审核」手动处理');}
  }
  async function verifyGlobal(force=true){
    const id=identity();
    if(!id||generation)return;
    return serial(async()=>{
      if(generation)return;
      check(id);
      const messages=getMessages();
      const revision=archiveRevision;
      if(force||projectedRevision!==revision){
        await projectWorldbook(id,messages);
        projectedRevision=revision;
      }
      if(generation)return;
      ledger(messages);
      await reconcileAutoHide(id,config().summaryMode==='unified');
      return messages;
    });
  }
  const generationMessages=type=>{
    const messages=getMessages();
    if(type!=='swipe')return messages;
    const last=api('getLastMessageId');
    return messages.filter(m=>m.message_id!==last);
  };
  function sameSources(previous,current){
    return previous.length===current.length&&previous.every((m,i)=>
      m.message_id===current[i].message_id&&m.message===current[i].message&&m.is_hidden===current[i].is_hidden);
  }
  async function prepareGeneration(chat,type,contextSize){
    const id=identity();
    invalidateGeneration();
    if(!id||state.disposed)return;
    const ticket={};
    generation=ticket;
    const checkTicket=()=>{check(id);if(generation!==ticket)throw Error('生成期间剧情已更新，请重新发送');};
    try{
      return await serial(async()=>{
        checkTicket();
        const messages=generationMessages(type);
        const {active,cfg}=await projectWorldbook(id,messages);
        const revision=archiveRevision;
        const guardSources=()=>{
          checkTicket();
          if(archiveRevision!==revision||!sameSources(messages,generationMessages(type)))throw Error('生成期间剧情已更新，请重新发送');
        };
        checkTicket();
        const input=Array.isArray(chat)?chat:(context().chat||[]);
        const configured=Number(cfg.weaveBudget);
        const configuredLimit=Number.isFinite(configured)?Math.max(0,Math.floor(configured)):0;
        const budget=Number.isFinite(contextSize)
          ? Math.min(configuredLimit,Math.max(0,Math.floor(contextSize))) : configuredLimit;
        let result;
        try{
          result=await recallForGeneration(input,messages,active,cfg,id,checkTicket,budget,guardSources,type);
          guardSources();
          if(result.viewpoint&&activeViewpoint(id,type)!==result.viewpoint)throw Error('发言角色已变化，请重新发送');
          const estimate=cost(result.content);
          if(estimate>budget)throw Error('动态记忆超过本轮估算预算');
          result={...result,estimate,budget:result.budget??budget};
          if(result.content){
            if(typeof context().setExtensionPrompt!=='function')throw Error('当前酒馆不支持档案记忆注入');
            context().setExtensionPrompt(promptKey,result.content,1,4,false,0);
          }
        }catch(e){
          guardSources();
          state.weaveResult=null;
          error(e);
          return;
        }
        state.echoScope=id;
        state.echo=result.echo||{};
        state.echoTurn=sceneQuery(input,[]).query;
        state.weaveResultScope=id;
        state.weaveResult=result;
        return result;
      });
    }catch(e){
      if(generation===ticket)invalidateGeneration();
      throw e;
    }
  }
  const advised=new Set();
  function suggestMode(id){
    const cfg=config();if(!cfg.modeAdvice||cfg.summaryMode!=='legacy'||advised.has(id))return;
    const rows=Object.values(records());let bytes=0;for(const r of rows)bytes+=String(r.content||'').length;
    if(rows.length<200&&bytes<24000)return;
    advised.add(id);notice('历史摘要已积累 '+rows.length+' 条，建议在拾忆设置中开启超长模式（不会自动切换）。');
  }
  async function scan(){
    if(state.busy||state.disposed||generation)return;
    const id=identity();if(!id)return;
    if(id!==state.current){retrieval.stop();vector.reset();state.closeModal?.();state.current=id;state.seen.clear();state.deferred.clear();state.stability.clear();state.queue=[];archiveRevision++;}
    let messages;
    state.busy=true;try{messages=await verifyGlobal(false);}catch(e){error(e);return;}finally{state.busy=false;}
    if(!messages||id!==identity()||generation)return;
    if(shared?.flags?.memory===false||state.open)return;
    state.busy=true;
    try{
      const data=vars().shiyi_v01||{}, cfg=config(data), existing=data.records||{}, deleted=data.deletedKeys||{};
      suggestMode(id);
      const live=new Map(messages.map(m=>[m.message_id,sourceKey(m)]));
      state.queue=state.queue.filter(q=>q.chat===id&&live.get(q.id)===q.key&&!deleted[q.key]);
      const queuedFloors=new Set(state.queue.map(q=>q.id));
      for(const [floor,q] of state.deferred)if(q.chat!==id||live.get(floor)!==q.key||deleted[q.key])state.deferred.delete(floor);
      for(const floor of state.stability.keys())if(!live.has(floor))state.stability.delete(floor);
      const now=Date.now();
      for(const m of messages){
        const idNum=m.message_id;
        const key=live.get(idNum);
        if(deleted[key]||state.deferred.has(idNum)||existing[key]||state.seen.has(key)||queuedFloors.has(idNum))continue;
        const content=extract(String(m.message??''),cfg);if(!content)continue;
        // 流式输出可能提前闭合标签，正文连续稳定八秒后再审核。
        const prev=state.stability.get(idNum);
        if(!prev||prev.key!==key){state.stability.set(idNum,{key,since:now});continue;}
        if(now-prev.since<8000)continue;
        queuedFloors.add(idNum);
        state.seen.add(key);
        state.queue.push({key,id:idNum,content,chat:id});
      }
    }catch(e){error(e);}finally{state.busy=false;}
    if(shared?.flags?.memory!==false&&state.queue.length&&!state.open){const item=state.queue.shift();await review(item);}
  }
  // 手动批量导入：只扫描当前存档的已闭合摘要；按消息楼层顺序写入。
  async function importHistory(){
    if(state.open)return;
    const chat=identity();if(!chat)return notice('请先打开聊天存档');
    let candidates=[];
    try{
      await verifyGlobal();check(chat);const saved=records(),cfg=config();
      candidates=getMessages().map(m=>{
        const id=m.message_id, content=extract(String(m.message??''),cfg);
        return content?{id,key:sourceKey(m),content,chat}:null;
      }).filter(x=>x&&(!saved[x.key]||blocked(x.key))).sort((a,b)=>a.id-b.id);
    }catch(e){return error(e);}
    if(!candidates.length)return notice('未发现尚未归档的历史摘要');
    const box=hostDocument.createElement('div');
    box.innerHTML=`<p class="shiyi-muted">共发现 ${candidates.length} 条未归档摘要。包含已删除或拒绝的摘要（默认不选中）。可逐条勾选、修改标题和正文；确认后按楼层从小到大写入。此操作不会隐藏旧正文。</p><button type="button" id="shiyi-all">全选（含恢复）</button><button type="button" id="shiyi-none">全不选</button><div id="shiyi-history-list"></div>`;
    const list=$('#shiyi-history-list',box);
    candidates.forEach((c,i)=>{
      const row=hostDocument.createElement('section');row.className='shiyi-history-item';
      row.innerHTML=`<label class="shiyi-history-head"><input type="checkbox" class="shiyi-h-check" checked> 第 ${c.id} 楼 ${blocked(c.key)?'· 已删除/拒绝':'· 未导入'}</label><label>标题<input class="shiyi-h-title" maxlength="40"></label><label>摘要<textarea class="shiyi-h-text" rows="4"></textarea></label>`;
      $('.shiyi-h-check',row).checked=!blocked(c.key);
      $('.shiyi-h-title',row).value=c.content.match(/^\s*标题[：:]\s*([^\n]+)/m)?.[1]?.trim().slice(0,40)||`剧情摘要 ${i+1}`;
      $('.shiyi-h-text',row).value=c.content;
      list.append(row);
    });
    $('#shiyi-all',box).onclick=()=>list.querySelectorAll('.shiyi-h-check').forEach(x=>x.checked=true);
    $('#shiyi-none',box).onclick=()=>list.querySelectorAll('.shiyi-h-check').forEach(x=>x.checked=false);
    const choice=await modal('拾忆 · 全量检测与恢复',box,[{label:'取消',value:'cancel'},{label:'确认导入所选',value:'confirm',kind:'primary'}]);
    if(choice!=='confirm')return;
    const selected=[...list.children].map((row,i)=>({candidate:candidates[i],enabled:$('.shiyi-h-check',row).checked,title:$('.shiyi-h-title',row).value.trim(),content:$('.shiyi-h-text',row).value.trim()})).filter(x=>x.enabled&&x.content);
    if(!selected.length)return notice('没有选中有效摘要');
    let ok=0,failed=0;
    for(const item of selected){
      if(identity()!==chat){notice(`聊天已切换，已成功导入 ${ok} 条，停止后续写入`);return;}
      try{
        if(!records()[item.candidate.key]||blocked(item.candidate.key))await addMemory(item.candidate,item.title||`剧情摘要 1`,item.content,true);
        state.queue=state.queue.filter(q=>q.key!==item.candidate.key);
        ok++;
      }catch(e){failed++;console.error('[拾忆] 批量导入失败：第'+item.candidate.id+'楼',e);break;}
    }
    notice(`历史导入：成功 ${ok} 条${failed?'；失败 1 条，请检查控制台后重试':''}`);
  }
  // 归档必须由用户明确点击确认。只处理已核验来源的连续摘要覆盖段，保留近期消息。
  // 默认不开启自动隐藏；可在此手动归档并恢复。setChatMessages 的实际上下文行为需酒馆端验证。
  // Conservative automatic hiding: assistant messages only, exact archived revision,
  // valid table (including empty object), no protected/starred or pending sources.
  function readFloor(floor){
    const list=api('getChatMessages',String(floor),{hide_state:'all'});
    return Array.isArray(list)?list.find(m=>m.message_id===floor):undefined;
  }
  async function setHidden(chat,floor,key,hidden){
    check(chat);
    const current=readFloor(floor);
    if(!current||sourceKey(current)!==key)return false;
    if(!!current.is_hidden===hidden)return true;
    await api('setChatMessages',[{message_id:floor,is_hidden:hidden}],{refresh:'none'});
    check(chat);
    const updated=readFloor(floor);
    if(!updated||sourceKey(updated)!==key)return false;
    if(!!updated.is_hidden!==hidden)throw Error(`第 ${floor} 楼的隐藏状态未更新`);
    return true;
  }
  function saveHidden(chat,field,owned){
    check(chat);
    saveVars({...vars().shiyi_v01,[field]:{...owned}});
  }
  async function reconcileAutoHide(chat, allowNew=true){
    check(chat);
    const d=vars().shiyi_v01||{}, cfg=config(d), owned={...d.autoHidden};
    const auto=allowNew&&cfg.autoHide&&cfg.summaryMode==='unified';
    if(!Object.keys(owned).length&&!auto)return;
    const all=getMessages(), byFloor=new Map(all.map(m=>[m.message_id,m]));
    const cutoff=api('getLastMessageId')-Math.max(12,Number(cfg.keep)*2||12);
    const pending=new Set(state.queue.map(q=>q.id));
    const eligible=(m,key)=>{
      const floor=m.message_id;
      if(floor<=0||floor>cutoff||!d.records?.[key]||d.deletedKeys?.[key]||d.archiveUI?.meta?.[key]?.star||
        pending.has(floor)||state.deferred.has(floor))return false;
      const trace=table(m.message);
      return trace!==null&&(Object.keys(trace).length===0||!!d.weave?.rows?.[key]);
    };
    for(const [id,key] of Object.entries(owned)){
      const floor=Number(id), m=byFloor.get(floor);
      if(!m||sourceKey(m)!==key||auto&&eligible(m,key)&&m.is_hidden)continue;
      if(await setHidden(chat,floor,key,false)){
        delete owned[id];
        saveHidden(chat,'autoHidden',owned);
      }
    }
    if(!auto)return;
    for(const m of all){
      const floor=m.message_id;
      if(generation||m.is_hidden||owned[floor])continue;
      const key=sourceKey(m);
      if(!eligible(m,key))continue;
      owned[floor]=key;
      saveHidden(chat,'autoHidden',owned);
      await setHidden(chat,floor,key,true);
    }
  }
  state.restoreAutoHidden=()=>serial(async()=>{const chat=identity();if(chat)await reconcileAutoHide(chat,false);});
  function archivePlan(){
    const all=(api('getChatMessages',`0-${api('getLastMessageId')}`,{hide_state:'all'})||[]).sort((a,b)=>a.message_id-b.message_id);
    const cfg=config(), last=api('getLastMessageId'), keep=Math.max(1,Number(cfg.keep)||5);
    const protectedFrom=Math.max(0,last-keep*2+1);
    const assistant=all.filter(m=>m.role!=='user'&&!m.is_user&&!m.is_system);
    const confirmed=Object.values(activeRecords(assistant)).filter(r=>
      Number.isInteger(r.sourceMessage)&&r.sourceMessage<protectedFrom);
    // Only prefix up to last verified summary, and only if all detected summaries in that prefix were confirmed.
    const max=confirmed.reduce((floor,row)=>Math.max(floor,row.sourceMessage),-1);
    const confirmedIds=new Set(confirmed.map(r=>r.sourceMessage));
    const unreviewed=assistant.some(m=>m.message_id<=max&&extract(String(m.message??''),cfg)&&!confirmedIds.has(m.message_id));
    const eligible=unreviewed?[]:all.filter(m=>m.message_id<=max&&m.message_id<protectedFrom&&m.is_hidden!==true);
    return {eligible,protectedFrom,confirmed:confirmed.length,unreviewed};
  }
  async function archivePreview(){
    if(state.open)return;
    const chat=identity();if(!chat)return notice('请先打开聊天');
    let plan;try{plan=archivePlan();}catch(e){return error(e);}
    const box=hostDocument.createElement('div');
    box.innerHTML=`<p>已核对摘要：${plan.confirmed} 条</p><p>最近正文保护起点：第 ${plan.protectedFrom} 楼</p><p>可手动隐藏：${plan.eligible.length} 条消息</p><p class="shiyi-muted">${plan.unreviewed?'检测到未审核摘要，本次禁止归档。':'仅在点击确认后隐藏；原始聊天不删除。请先备份聊天。'}隐藏消息是否从最终模型上下文排除，需要在你的酒馆版本中实际验证。</p>`;
    const options=[{label:'关闭',value:'close'},{label:'恢复本聊天归档',value:'restore'}];
    if(plan.eligible.length)options.push({label:'确认隐藏',value:'archive',kind:'primary'});
    const choice=await modal('拾忆 · 正文归档',box,options);
    if(identity()!==chat)return notice('已切换聊天，取消归档操作');
    if(choice==='archive'){
      try{
        const count=await serial(async()=>{
          check(chat);
          const latest=archivePlan();
          if(latest.unreviewed||latest.eligible.map(sourceKey).join(',')!==plan.eligible.map(sourceKey).join(','))throw Error('消息已变化，请重新预览');
          const owned={...vars().shiyi_v01?.manualHidden};
          let total=0;
          for(const m of latest.eligible){
            const floor=m.message_id,key=sourceKey(m);
            const current=readFloor(floor);
            if(!current||current.is_hidden||sourceKey(current)!==key||owned[floor]&&owned[floor]!==key)continue;
            owned[floor]=key;
            saveHidden(chat,'manualHidden',owned);
            if(await setHidden(chat,floor,key,true))total++;
          }
          return total;
        });
        notice(`已隐藏 ${count} 条旧消息，原文可在归档面板恢复`);
      }catch(e){error(e);}
    }else if(choice==='restore'){
      try{
        const d=vars().shiyi_v01||{};
        const legacy=Array.isArray(d.hiddenByShiyi)&&d.hiddenByShiyi.length>0;
        const legacyNotice=legacy?'。旧版楼层记录缺少来源指纹，可在酒馆核对后手动恢复':'';
        const entries=Object.entries(d.manualHidden||{});
        if(!entries.length)return notice('没有可核对的拾忆归档'+legacyNotice);
        if(!hostWindow.confirm(`恢复拾忆隐藏且来源一致的 ${entries.length} 条消息？`))return;
        const count=await serial(async()=>{
          check(chat);
          const owned={...vars().shiyi_v01?.manualHidden};
          let total=0;
          for(const [id,key] of entries){
            if(owned[id]!==key||!await setHidden(chat,Number(id),key,false))continue;
            delete owned[id];
            saveHidden(chat,'manualHidden',owned);
            total++;
          }
          return total;
        });
        notice(`已恢复 ${count} 条消息${legacyNotice}`);
      }catch(e){error(e);}
    }
  }
  async function timeline(){
    if(state.open)return;
    const rows=Object.values(numbered(activeRecords())).filter(r=>Number.isInteger(r.sourceMessage)).sort((a,b)=>a.sourceMessage-b.sourceMessage);
    const box=hostDocument.createElement('div');
    if(!rows.length)box.textContent='暂无记忆';
    for(const r of rows){const item=hostDocument.createElement('div');item.className='shiyi-history-item';
      const when=parseStoryTime(r.content)||r.storyTime||'日期未识别（请检查摘要格式）';
      item.textContent=`第${r.sourceMessage}楼 · ${when}\n${r.title||'剧情摘要'}：${String(r.content||'').slice(0,160)}`;
      item.style.whiteSpace='pre-wrap';box.append(item);
    }
    await modal('拾忆 · 剧情时间轴（按楼层）',box,[{label:'关闭',value:'close'}]);
  }
  async function editMemory(id,key){
    try{check(id);const r=numbered(records())[key];if(!r)return notice('摘要不存在');
    const box=hostDocument.createElement('div');box.className='shiyi-editor';
    box.innerHTML='<label>标题<input maxlength="40"></label><label>完整摘要<textarea rows="16"></textarea></label>';
    const title=$('input',box),content=$('textarea',box);title.value=r.title;content.value=r.content;
    const choice=await modal('拾忆 · 编辑记忆',box,[{label:'取消',value:'cancel'},{label:'保存修改',value:'save',kind:'primary'}]);
    if(choice==='save'){if(!content.value.trim())throw Error('摘要不能为空');await serial(async()=>{check(id);const rows={...records()};if(!rows[key]||blocked(key))throw Error('摘要不存在');snapshot(key,rows[key],'编辑前');rows[key]={...rows[key],title:title.value.trim()||r.title,content:content.value,storyTime:parseStoryTime(content.value)};writeRows(id,rows);});notice('修改成功');}
    if(identity()===id&&!state.open)await manage();
    }catch(e){error(e);}
  }
  async function manage(){
    if(state.open)return;
    const id=identity();if(!id)return;const container=hostDocument.createElement('div');container.className='shiyi-manage';
    const search=hostDocument.createElement('input');search.placeholder='搜索标题、人物、地点、正文';
    const filter=hostDocument.createElement('select');for(const [v,t] of [['all','有效记忆'],['star','星标'],['inactive','非当前剧情版本'],['trash','回收站']]){const o=hostDocument.createElement('option');o.value=v;o.textContent=t;filter.append(o);}
    const stats=hostDocument.createElement('p'),list=hostDocument.createElement('div'),more=hostDocument.createElement('button'),batch=hostDocument.createElement('button');more.textContent='下一页';const previous=hostDocument.createElement('button');previous.textContent='上一页';batch.textContent='删除选中';const limit=40;let page=0,searchTimer=null;const selected=new Set();
    const button=(label,fn)=>{const b=hostDocument.createElement('button');b.textContent=label;b.onclick=async()=>{try{check(id);await fn();}catch(e){error(e);hostWindow.alert(e.message);}};return b;};
    async function remove(keys){if(!keys.length||!hostWindow.confirm(`删除 ${keys.length} 条摘要？可在回收站恢复。`))return;await serial(async()=>{check(id);const rows={...records()};recycle(keys,rows);markDeleted(keys);for(const k of keys)state.seen.add(k);changed();});selected.clear();render();}
    async function restore(k,r){const m=getMessages().find(m=>m.message_id===r.sourceMessage);if(!m||`${m.message_id}:${hash(String(m.message??''))}`!==k)throw Error('原正文已变化，不能恢复旧正史');await addMemory({chat:id,id:r.sourceMessage,key:k},r.title,r.content,true);check(id);const trash={...archive().trash};delete trash[k];archivePatch({trash});render();}
    function render(){if(identity()!==id)return;list.replaceChildren();const a=archive(),meta=a.meta||{},trash=filter.value==='trash';const active=activeRecords();const inactive=()=>Object.fromEntries(Object.entries(records()).filter(([k])=>!Object.hasOwn(active,k)&&!blocked(k)));const rows=ordered(trash?a.trash||{}:numbered(filter.value==='inactive'?inactive():active));const q=search.value.trim().toLowerCase();const matches=rows.filter(([k,r])=>(filter.value!=='star'||meta[k]?.star)&&fuzzy(`${r.title} ${r.content} ${meta[k]?.chapter||''}`,q));stats.textContent=`有效 ${Object.keys(active).length} · 回收站 ${Object.keys(a.trash||{}).length} · 匹配 ${matches.length}`;batch.hidden=trash;page=Math.min(page,Math.max(0,Math.ceil(matches.length/limit)-1));previous.disabled=page===0;more.disabled=(page+1)*limit>=matches.length;stats.textContent+=` · 第 ${page+1}/${Math.max(1,Math.ceil(matches.length/limit))} 页 · 已选 ${selected.size}`;
      for(const [k,r] of matches.slice(page*limit,(page+1)*limit)){const row=hostDocument.createElement('div');row.className='shiyi-history-item';const title=hostDocument.createElement('strong');title.textContent=`${meta[k]?.star?'★ ':''}${r.title} · 第${r.sourceMessage}楼`;const text=hostDocument.createElement('p');text.textContent=r.content;const details=hostDocument.createElement('details');const summary=hostDocument.createElement('summary');summary.textContent='查看完整摘要';details.append(summary,text);row.append(title,details);
        if(trash){row.append(button('恢复',()=>restore(k,r)));}else{const cb=hostDocument.createElement('input');cb.type='checkbox';cb.checked=selected.has(k);cb.style.width='auto';cb.onchange=()=>cb.checked?selected.add(k):selected.delete(k);row.prepend(cb);row.append(button(meta[k]?.star?'取消星标':'星标',()=>{archivePatch({meta:{...archive().meta,[k]:{...meta[k],star:!meta[k]?.star}}});changed();render();}),button('章节',()=>{const chapter=hostWindow.prompt('章节名称（留空取消归类）',meta[k]?.chapter||'');if(chapter!==null){archivePatch({meta:{...archive().meta,[k]:{...meta[k],chapter:chapter.trim()}}});changed();render();}}),button('溯源',()=>{if(jump(r.sourceMessage))state.closeModal?.();else hostWindow.alert('请先加载该历史楼层');}),button('编辑',()=>{state.closeModal?.();return editMemory(id,k);}),button('历史',async()=>{state.closeModal?.();const box=hostDocument.createElement('div');for(const v of archive().history?.[k]||[]){const p=hostDocument.createElement('p');p.textContent=v.savedAt+' · '+v.title+'\n'+v.content;box.append(p,button('回退此版本',async()=>{await serial(async()=>{check(id);const rows={...records()};if(!rows[k]||blocked(k))throw Error('记忆已失效');snapshot(k,rows[k],'回退前');rows[k]={...rows[k],title:v.title,content:v.content,storyTime:parseStoryTime(v.content)};writeRows(id,rows);});state.closeModal?.();}));}if(!box.children.length)box.textContent='暂无历史版本';await modal('修改历史',box,[{label:'返回',value:'close'}]);if(identity()===id&&!state.open)await manage();}),button('删除',()=>remove([k])));if(meta[k]?.chapter){const p=hostDocument.createElement('p');p.textContent='章节：'+meta[k].chapter;row.append(p);}}
        list.append(row);}}
    search.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=0;selected.clear();render();},180);};filter.onchange=()=>{clearTimeout(searchTimer);page=0;selected.clear();render();};previous.onclick=()=>{page=Math.max(0,page-1);render();};more.onclick=()=>{page++;render();};batch.onclick=()=>remove([...selected]).catch(error);container.append(search,filter,stats,batch,list,previous,more);render();try{await modal('拾忆 · 剧情档案',container,[{label:'关闭',value:'close'}]);}finally{clearTimeout(searchTimer);}
  }
  async function settings(){
    if(state.open)return;
    const settingsChat=identity();const cfg=config();const el=hostDocument.createElement('div');
    const resultForChat=state.weaveResultScope===settingsChat?state.weaveResult:null;
    el.innerHTML='<label>摘要开始标签<input id="shiyi-start"></label><label>摘要结束标签<input id="shiyi-end"></label><label>剧情年份（可选，例：2026；用于补全摘要缺失的年份及星期）<input id="shiyi-year" inputmode="numeric" maxlength="4" placeholder="不确定请留空"></label><p class="shiyi-muted">第一版只支持起止标签。默认不自动隐藏旧正文；手动归档需再次确认。</p>';
    $('#shiyi-start',el).value=cfg.start;$('#shiyi-end',el).value=cfg.end;$('#shiyi-year',el).value=cfg.storyYear||'';
    const w=hostDocument.createElement('div');w.innerHTML='<label>档案记忆模式<select id="weave-mode"><option value="archive">仅归档</option><option value="compact">精简记忆</option><option value="smart">智能记忆</option><option value="deep">深度记忆</option></select></label><label>记忆运行模式<select id="summary-mode"><option value="unified">超长模式 · 智能记忆</option><option value="legacy">简约模式 · 古法总结</option></select></label><label>检索引擎<select id="weave-engine"><option value="hybrid">凝忆 · BM25 + 实体 + 余温</option><option value="classic">原版检索</option></select></label><label>记忆注入预算（估算 Token）<input id="weave-budget" type="number" min="200" max="12000"></label><label><input id="weave-adaptive" type="checkbox"> 自适应预算（凝忆模式，上限为上述预算）</label><p>当前召回：'+(resultForChat?.selected?.length||0)+' 条；估算 '+(resultForChat?.estimate||0)+' Tokens。动态模式包含摘要与档案；旧版模式仅限制档案。摘要召回：'+(resultForChat?.summaries?.length||0)+' 条。</p>';el.append(w);const auto=hostDocument.createElement('label');auto.innerHTML='<input type="checkbox" id="auto-hide"> 自动隐藏已确认的旧 AI 正文（实验；默认关闭）';w.append(auto);const ve=hostDocument.createElement('div');ve.innerHTML='<label><input id="vector-enabled" type="checkbox"> 可选向量检索（剧情将发送到指定服务）</label><label>完整 Embedding URL<input id="vector-url" type="url"></label><label>模型<input id="vector-model"></label><label>API Key（仅本次浏览器会话）<input id="vector-key" type="password"></label>';w.append(ve);const guide=hostDocument.createElement('details');guide.innerHTML='<summary>免费向量 API 获取指南</summary><p>硅基流动提供免费模型的情况以官方价格页为准。启用后剧情文本将发送至服务商。</p><p><a href="https://cloud.siliconflow.cn/account/ak" target="_blank" rel="noopener noreferrer">获取 API Key</a> · <a href="https://siliconflow.cn/pricing" target="_blank" rel="noopener noreferrer">模型价格</a> · <a href="https://siliconflow.readme.io/reference/createembedding" target="_blank" rel="noopener noreferrer">接口文档</a></p><p>注册、创建密钥、复制到上方，保存设置。</p>';const fill=hostDocument.createElement('button');fill.type='button';fill.textContent='填入硅基流动 BGE-M3 配置';fill.onclick=()=>{$('#vector-url',el).value='https://api.siliconflow.cn/v1/embeddings';$('#vector-model',el).value='BAAI/bge-m3';};guide.append(fill);w.append(guide);const layer=hostDocument.createElement('label');layer.innerHTML='<input type="checkbox" id="memory-layers"> 章节索引（实验，保留原始摘要）';w.append(layer);$('#memory-layers',el).checked=cfg.layers;$('#vector-enabled',el).checked=cfg.vectorEnabled;$('#vector-url',el).value=cfg.vectorUrl;$('#vector-model',el).value=cfg.vectorModel;$('#vector-key',el).value=sessionStorage.getItem('capricorn-vector-key')||'';const vs=hostDocument.createElement('p');vs.textContent=vector.info()+"；"+retrieval.info();w.append(vs);$('#auto-hide',el).checked=cfg.autoHide;$('#weave-engine',el).value=cfg.engine;$('#weave-adaptive',el).checked=cfg.adaptive;const inspect=hostDocument.createElement('details');const caption=hostDocument.createElement('summary');caption.textContent='查看最近一次准备注入的记忆与召回原因';const pre=hostDocument.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent='召回阶段：'+(resultForChat?.recallStage||'—')+'；证据等级：'+({strong:'较强',limited:'有限',weak:'较弱',none:'无'}[resultForChat?.recallConfidence]||'—')+'\n'+(resultForChat?.details||[]).map(x=>x.id+'：'+x.reason+(x.group?' ['+x.group+']':'')).join('\n')+'\n\n'+(resultForChat?.content||'暂无');inspect.append(caption,pre);w.append(inspect);$('#summary-mode',el).value=cfg.summaryMode;$('#weave-mode',el).value=cfg.weaveMode;$('#weave-budget',el).value=cfg.weaveBudget;for(const k of kinds){const label=hostDocument.createElement('label'),c=hostDocument.createElement('input');c.type='checkbox';c.value=k;c.checked=cfg.weaveKinds.includes(k);c.dataset.weaveKind='1';label.append(c,k);w.append(label);}
    const modeSelect=$('#summary-mode',el);const modeLabel=modeSelect.closest('label');w.prepend(modeLabel);const modeHint=hostDocument.createElement('p');modeLabel.after(modeHint);const adviceLabel=hostDocument.createElement("label"),advice=hostDocument.createElement("input");advice.type="checkbox";advice.checked=cfg.modeAdvice;adviceLabel.append(advice," 智能模式切换建议");modeHint.after(adviceLabel);const advancedIds=['weave-engine','weave-adaptive','auto-hide','memory-layers'];const updateMode=()=>{const simple=modeSelect.value==='legacy';for(const id of advancedIds)$('#'+id,el).closest('label').hidden=simple;ve.hidden=simple;guide.hidden=simple;vs.hidden=simple;modeHint.textContent=simple?'古法总结：完整世界书 + 档案检索，不调用向量服务。':'超长模式：共享已有摘要，动态召回，无需重新总结。';};modeSelect.addEventListener('change',updateMode);updateMode();
    const viewpointLabel=hostDocument.createElement('label');
    const viewpointInput=hostDocument.createElement('input');
    viewpointInput.maxLength=80;
    viewpointInput.value=viewpoints.get(settingsChat)||'';
    viewpointInput.placeholder='留空时仅使用公开认知';
    viewpointLabel.append('角色认知视角（仅本页面单聊，填写当前角色的准确姓名）',viewpointInput);
    const updateViewpoint=()=>{viewpointLabel.hidden=modeSelect.value==='legacy'||$('#weave-engine',el).value!=='hybrid';};
    modeSelect.addEventListener('change',updateViewpoint);
    $('#weave-engine',el).addEventListener('change',updateViewpoint);
    w.append(viewpointLabel);
    updateViewpoint();
    const result=await modal('拾忆 · 设置',el,[{label:'取消',value:false},{label:'保存',value:true,kind:'primary'}]);
    if(!result)return;
    try{
      check(settingsChat);
      const start=$('#shiyi-start',el).value.trim(),end=$('#shiyi-end',el).value.trim();
      if(!start||!end)throw Error('标签不能为空');
      const storyYear=$('#shiyi-year',el).value.trim();
      if(storyYear&&!/^[1-9]\d{3}$/.test(storyYear))throw Error('剧情年份需为四位数字，或留空');
      const viewpoint=viewpointLabel.hidden?'':viewpointInput.value.trim();
      if(viewpoint&&(!viewpointName(viewpoint)||viewpointName(viewpoint)!==speakingCharacter(context())))throw Error('角色视角仅支持角色名匹配的当前单聊');
      await saveSettings(settingsChat,{
        ...cfg,start,end,storyYear,modeAdvice:advice.checked,
        layers:$('#memory-layers',el).checked,vectorEnabled:$('#vector-enabled',el).checked,
        vectorUrl:$('#vector-url',el).value.trim(),vectorModel:$('#vector-model',el).value.trim(),
        engine:$('#weave-engine',el).value,adaptive:$('#weave-adaptive',el).checked,
        autoHide:$('#auto-hide',el).checked,summaryMode:$('#summary-mode',el).value,
        weaveMode:$('#weave-mode',el).value,
        weaveBudget:Math.max(200,Math.min(12000,Number($('#weave-budget',el).value)||1800)),
        weaveKinds:[...el.querySelectorAll('[data-weave-kind]:checked')].map(c=>c.value),
      },$('#vector-key',el).value);
      setViewpoint(settingsChat,viewpoint);
      notice('设置已保存到当前聊天');
    }catch(e){error(e);}
  }
  async function saveSettings(id,settings,key){
    return serial(async()=>{
      check(id);
      const before=vars().shiyi_v01||{},previousMode=config(before).summaryMode;
      const previousKey=sessionStorage.getItem('capricorn-vector-key');
      const next={...config(before),...settings};
      const project=!generation;
      let touched=false;
      try{
        if(project){
          if(next.summaryMode==='legacy')await reconcileAutoHide(id,false);
          await projectWorldbook(id,getMessages(),next.summaryMode);
        }
        check(id);
        touched=true;
        saveVars({...vars().shiyi_v01,settings:next});
        if(key!==undefined)sessionStorage.setItem('capricorn-vector-key',key);
      }catch(e){
        if(identity()===id&&!state.disposed){
          if(touched){
            const restored={...vars().shiyi_v01};
            if(Object.hasOwn(before,'settings'))restored.settings=before.settings;
            else delete restored.settings;
            saveVars(restored);
            if(previousKey===null)sessionStorage.removeItem('capricorn-vector-key');
            else sessionStorage.setItem('capricorn-vector-key',previousKey);
          }
          if(project)try{await projectWorldbook(id,getMessages(),previousMode);}catch(rollbackError){error(rollbackError);}
        }
        throw e;
      }
      if(next.summaryMode!==previousMode||next.engine!==config(before).engine)retrieval.stop();
      if(next.summaryMode==='legacy'||!next.vectorEnabled||next.engine!=='hybrid'||
        next.vectorUrl!==before.settings?.vectorUrl||next.vectorModel!==before.settings?.vectorModel)vector.reset();
      archiveRevision++;
    });

  }
  function ui(){
    state.root?.remove(); state.style?.remove();
    state.style=hostDocument.createElement('style');state.style.textContent=`
      /* 拾忆 Liquid Glass: 仅作用于拾忆组件，不修改酒馆主题 */
      #shiyi-dock,.shiyi-overlay{--sy-text:#18212d;--sy-muted:#526071;--sy-stroke:rgba(255,255,255,.65);--sy-glass:rgba(244,248,255,.56);--sy-blue:#1677f2;--sy-shadow:0 16px 48px rgba(17,36,65,.19),inset 0 1px 0 rgba(255,255,255,.76);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','PingFang SC',system-ui,sans-serif}
      #shiyi-dock{position:fixed;bottom:max(78px,env(safe-area-inset-bottom));right:12px;z-index:2147480000;box-sizing:border-box;width:min(340px,calc(100vw - 24px));padding:12px;border-radius:22px;color:var(--sy-text);background:var(--sy-glass);border:1px solid var(--sy-stroke);box-shadow:var(--sy-shadow);-webkit-backdrop-filter:blur(26px) saturate(185%);backdrop-filter:blur(26px) saturate(185%);font-size:13px;isolation:isolate}
      #shiyi-dock.shiyi-collapsed{width:54px;height:54px;padding:0;border-radius:50%;overflow:visible;display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation}
      #shiyi-dock.shiyi-collapsed .shiyi-dock-content{display:none}
      #shiyi-dock .shiyi-orb{display:none}
      #shiyi-dock.shiyi-collapsed .shiyi-orb{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:0;border-radius:50%;padding:0;margin:0;background:transparent;font-size:23px;line-height:1;box-shadow:none;cursor:pointer}
      #shiyi-dock .shiyi-collapse{float:right;padding:2px 9px;margin:-2px 0 3px 8px;border-radius:10px;font-size:17px;line-height:20px}
      #shiyi-dock.shiyi-collapsed::after{content:'';position:absolute;inset:3px;border-radius:50%;border:1px solid rgba(255,255,255,.55);pointer-events:none}
      #shiyi-dock.shiyi-collapsed:focus-within{outline:2px solid rgba(22,119,242,.5);outline-offset:2px}
      #shiyi-dock::before,.shiyi-dialog::before{content:'';position:absolute;inset:1px;border-radius:inherit;pointer-events:none;background:linear-gradient(155deg,rgba(255,255,255,.34),transparent 42%,rgba(255,255,255,.08));z-index:-1}
      #shiyi-dock .shiyi-brand{font-weight:680;font-size:14px;letter-spacing:.02em;margin:1px 4px 9px}#shiyi-status{font-size:11px;color:var(--sy-muted);margin:8px 5px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #shiyi-dock button,.shiyi-dialog button{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.42);color:inherit;border:1px solid rgba(255,255,255,.66);border-radius:12px;padding:9px 11px;margin:3px 2px;cursor:pointer;font:inherit;font-weight:550;box-shadow:inset 0 1px rgba(255,255,255,.56),0 2px 8px rgba(36,55,86,.07);transition:background .18s ease,transform .18s ease,box-shadow .18s ease}
      #shiyi-dock button:hover,.shiyi-dialog button:hover{background:rgba(255,255,255,.72);box-shadow:inset 0 1px rgba(255,255,255,.75),0 3px 12px rgba(36,55,86,.1)}
      #shiyi-dock button:active,.shiyi-dialog button:active{transform:scale(.98)}
      #shiyi-dock button:focus-visible,.shiyi-dialog button:focus-visible,.shiyi-dialog input:focus-visible,.shiyi-dialog textarea:focus-visible{outline:2px solid var(--sy-blue);outline-offset:2px}
      .shiyi-overlay{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom));box-sizing:border-box;background:rgba(15,25,42,.34);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
      .shiyi-dialog{position:relative;isolation:isolate;width:min(540px,100%);max-height:min(86dvh,760px);overflow:auto;overscroll-behavior:contain;box-sizing:border-box;padding:22px;border-radius:28px;color:var(--sy-text);background:rgba(247,250,255,.77);border:1px solid rgba(255,255,255,.8);box-shadow:0 25px 85px rgba(12,28,54,.28),inset 0 1px rgba(255,255,255,.94);-webkit-backdrop-filter:blur(38px) saturate(190%);backdrop-filter:blur(38px) saturate(190%);font-size:14px}
      .shiyi-dialog h3{font-size:18px;letter-spacing:-.025em;font-weight:700;margin:0 0 16px}.shiyi-dialog label{display:block;margin:13px 0;font-size:13px;font-weight:560}
      .shiyi-dialog textarea,.shiyi-dialog input{display:block;box-sizing:border-box;width:100%;margin-top:7px;padding:12px 13px;border:1px solid rgba(124,148,177,.25);border-radius:14px;background:rgba(255,255,255,.54);color:var(--sy-text);box-shadow:inset 0 1px 3px rgba(19,43,75,.05);font:inherit;line-height:1.55;outline:none}
      .shiyi-dialog textarea:focus,.shiyi-dialog input:focus{border-color:rgba(22,119,242,.48);background:rgba(255,255,255,.8)}
      .shiyi-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:5px;margin-top:18px}.shiyi-dialog button.primary{color:white;background:linear-gradient(180deg,#3895ff,#1677f2);border-color:rgba(16,95,213,.55);box-shadow:inset 0 1px rgba(255,255,255,.28),0 4px 12px rgba(22,119,242,.22)}.shiyi-dialog button.primary:hover{background:linear-gradient(180deg,#55a4ff,#2585f7)}
      .shiyi-history-item{padding:12px 0;border-bottom:1px solid rgba(96,118,147,.22)}.shiyi-history-head{display:flex!important;align-items:center;gap:8px;font-weight:700!important}.shiyi-history-head input{width:auto!important;margin:0!important}.shiyi-muted{color:var(--sy-muted);font-size:12px;line-height:1.6}.shiyi-row{display:flex;align-items:center;gap:6px;border-bottom:1px solid rgba(96,118,147,.16);padding:9px 0}.shiyi-row span{flex:1;overflow-wrap:anywhere}
      @media(max-width:480px){#shiyi-dock{right:10px;bottom:max(72px,env(safe-area-inset-bottom));width:min(320px,calc(100vw - 20px));border-radius:20px}.shiyi-dialog{padding:18px;border-radius:24px;max-height:83dvh}.shiyi-actions button{flex:1 1 auto}}
      @media(prefers-reduced-motion:reduce){#shiyi-dock button,.shiyi-dialog button{transition:none}}
      @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){#shiyi-dock{background:rgba(245,248,253,.96)}.shiyi-dialog{background:rgba(248,250,254,.98)}}
    `;hostDocument.head.append(state.style);
    state.root=hostDocument.createElement('div');state.root.id='shiyi-dock';state.root.classList.add('shiyi-collapsed');state.root.innerHTML='<button type="button" class="shiyi-orb" id="shiyi-expand" aria-label="展开拾忆面板" title="展开拾忆">✦</button><div class="shiyi-dock-content"><button type="button" class="shiyi-collapse" id="shiyi-collapse" aria-label="收起拾忆面板" title="收起">−</button><div class="shiyi-brand">拾忆 · v0.7.1</div><div><button id="shiyi-scan">全量检测</button><button id="shiyi-import">补录 / 恢复</button><button id="shiyi-archive">正文归档</button><button id="shiyi-timeline">时间轴</button><button id="shiyi-review">待审核</button><button id="shiyi-manage">管理</button><button id="shiyi-settings">设置</button></div><div id="shiyi-status">等待聊天加载</div></div>';
    hostDocument.body.append(state.root);
    const setCollapsed=(collapsed)=>{state.root.classList.toggle('shiyi-collapsed',collapsed);$('#shiyi-expand',state.root).setAttribute('aria-expanded',String(!collapsed));};
    $('#shiyi-expand',state.root).onclick=()=>setCollapsed(false);
    $('#shiyi-collapse',state.root).onclick=()=>setCollapsed(true);
    $('#shiyi-scan',state.root).onclick=()=>importHistory();
    $('#shiyi-import',state.root).onclick=()=>importHistory();
    $('#shiyi-archive',state.root).onclick=()=>archivePreview();
    $('#shiyi-timeline',state.root).onclick=()=>timeline();
    $('#shiyi-review',state.root).onclick=async()=>{if(state.open)return;const pending=state.queue.shift()||[...state.deferred.values()].find(Boolean);if(pending){state.deferred.delete(pending.id);await review(pending);}else notice('暂无待审核记忆');};
    $('#shiyi-manage',state.root).onclick=()=>manage();
    $('#shiyi-settings',state.root).onclick=()=>settings();
    const dossierButton=hostDocument.createElement('button');dossierButton.textContent='留痕档案';$('#shiyi-settings',state.root).before(dossierButton);dossierButton.onclick=()=>{if(!state.open)createDossier({D:hostDocument,modal,identity,check,archive,archivePatch,records:activeRecords,getMessages,hash,serial,jump,notice,autoDossier}).open().catch(error);};
  }
  state.destroy=()=>{
    if(state.disposed)return;
    invalidateGeneration();
    state.disposed=true;
    retrieval.stop();
    lexicalStore.close();
    vector.reset();
    state.closeModal?.();
    state.root?.remove();
    state.style?.remove();
  };
  try { ui(); } catch(e) { console.error('[拾忆] UI 初始化失败',e); try { hostWindow.alert('拾忆 v0.7 启动失败：'+e.message); } catch(_) {} }
  // 备用入口：酒馆助手脚本按钮，即使悬浮层被主题遮挡也能打开诊断。
  try {
    if (typeof eventOn==='function' && typeof getButtonEvent==='function') {
      eventOn(getButtonEvent('拾忆·打开面板'), () => {
        try { if(!state.root?.isConnected) ui(); else {state.root.style.display='block';state.root.classList.remove('shiyi-collapsed');} notice('通过脚本按钮打开面板'); }
        catch(e) { hostWindow.alert('拾忆面板异常：'+e.message); }
      });
    }
  } catch(e) { console.warn('[拾忆] 脚本按钮绑定失败',e); }
  state.validate=verifyGlobal;
  state.tick=()=>scan().catch(error);
  state.pending=()=>state.queue.length+state.deferred.size;
  state.diagnostics=()=>{
    const id=identity();
    const prepared=state.weaveResultScope===id?state.weaveResult:null;
    let mode='等待聊天';
    if(id)try{mode=config().summaryMode==='legacy'?'简约':'超长';}catch{mode='等待酒馆助手';}
    return {
      '记忆模式':mode,
      '最近动态注入':prepared?`${prepared.summaries?.length||0} 条摘要 / ${prepared.estimate||0} 估算 Token（上限 ${prepared.budget}）`:'暂无',
      '场景召回':({direct:'当前输入命中',expanded:'已用近期场景扩查',weak:'线索有限',none:'无有效查询'})[prepared?.recallStage]||'暂无',
      '未结伏笔':prepared?.threadCount??0,
      '角色视角':prepared?.viewpoint?`${prepared.viewpoint} · ${prepared.viewpointCount} 条认知`:'公开认知',
      '检索':retrieval.info(),
      '向量':vector.info(),
    };
  };
  state.prepareGeneration=prepareGeneration;
  state.invalidateGeneration=invalidateGeneration;
  state.setSettings=settings=>saveSettings(identity(),settings);
  state.setViewpoint=name=>setViewpoint(identity(),name);
  state.detach=()=>{
    invalidateGeneration();
    return serial(()=>syncWorldbookMounts(api,check,identity(),null));
  };
  state.recallPeople=()=> [...(archive().dossier||[]),...autoDossier()]
    .filter(r=>r.kind==='人物').map(r=>({id:r.id,title:r.title,sources:r.sources||[]}));
  state.timelineRows=async()=>{
    const messages=getMessages();
    const byFloor=new Map(messages.map(m=>[m.message_id,table(m.message)]));
    return Object.entries(numbered(activeRecords(messages))).filter(([,r])=>Number.isInteger(r.sourceMessage)).map(([key,r])=>({
      floor:r.sourceMessage,title:r.title,content:r.content,
      when:byFloor.get(r.sourceMessage)?.时间||r.storyTime||parseStoryTime(r.content)||'日期未识别',
      traceText:JSON.stringify(byFloor.get(r.sourceMessage)||{}),sourceHash:r.sourceHash||key.split(':')[1],
      chapter:archive().meta?.[key]?.chapter||'',star:!!archive().meta?.[key]?.star,
    }));
  };
  state.jump=jump;
  state.backup=async()=>serial(async()=>{
    const id=identity();
    if(!id)return null;
    const {rows}=await readArchive(id);
    check(id);
    const latest=vars().shiyi_v01||{};
    return memoryBackupSnapshot(id,{...latest,records:{...rows,...latest.records}});
  });
  state.restoreBackup=payload=>serial(async()=>{
    const result=await restoreMemoryBackup(payload,{
      getIdentity:chatIdentity,read:()=>vars().shiyi_v01||{},write:saveVars,
      persist:()=>context().saveMetadata?.(),
    });
    if(result.changed)changed();
    return result;
  });
  state.clearDerivedCaches=()=>serial(async()=>{
    const id=identity();
    if(!id)throw Error('请先打开聊天');
    const [workerOK,lexicalOK]=await Promise.all([retrieval.clear(id),lexicalStore.clear(id)]);
    check(id);
    vector.reset();
    return workerOK&&lexicalOK;
  });
  return state;
}
