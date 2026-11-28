import { stripTheater } from './legacy-content.js';
import { hasOwn } from './compat.js';
import { icon } from './icons.js';
import { uiAlert, uiConfirm, uiPrompt, uiToast } from './ui-dialog.js';
import { mountSelects } from './ui-select.js';
import {boundedRecall,RecallTimeout} from './recall-deadline.js';
import {createVectorHealth} from './vector-health.js';
import {createVectorLane} from './vector-lane.js';
import {createMigration,embedBatch,vectorScope} from './migration.js';
import {createVectorStore} from './vector-store.js';
import {routeMemoryFromStats} from './memory-route.js';
import {createMemoryData} from './memory-data.js';
import {createMessageCatalog} from './message-catalog.js';
import {appendMemoryProvenance} from './memory-provenance.js';
import {sceneQuery} from './scene.js';
import {searchMemory, searchMemoryTop} from './recall-search.js';
import {createDocumentCorpus, shardThreshold} from './memory-documents.js';
import {maintenancePriority} from './scheduler.js';
import {createLexicalStore} from './lexical-store.js';
import {createVector} from './vector.js';
import {hybrid,hybridBudget,buildDocs,cost,createSummaryDocCache,createEntityDocCache} from './hybrid.js';
import {createRetrieval} from './retrieval-client.js';
import {unified} from './unified.js';
import {knowledgeForCharacter,retrieve,kinds} from './weave.js';
import {table,traces,fuzzy} from './traces.js';
import { createDossier } from './dossier.js';
import { memoryBackupSnapshot, restoreMemoryBackup } from './backup.js';
import { viewpointName, speakingCharacter, recallViewpoint } from './viewpoint.js';
// A previously linked 拾忆 book can be removed outside the extension while its mount remains.
// Only an explicit not-found result is safe to treat as a stale reference.
const missingWorldbook = error => /未能找到世界书|找不到世界书|世界书不存在|worldbook[^\\n]{0,80}(?:not found|does not exist)|(?:not found|does not exist)[^\\n]{0,80}worldbook/i.test(String(error?.message ?? error));
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
    let entries;
    try { entries=await readWorldbook(api,check,name,id); }
    catch (error) {
      if (!missingWorldbook(error)) throw error;
      // Only prune dangling 拾忆 mounts; never remove or modify unrelated worldbooks.
      remove.add(name);
      continue;
    }
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
  const vectorLane=createVectorLane();const vectorStore=createVectorStore();const vectorHealth=createVectorHealth(embedBatch);const vector=createVector(vectorStore,vectorLane,()=>Date.now(),vectorHealth.request);const migration=createMigration(vectorStore,vectorHealth.request,()=>Date.now(),vectorLane);let migrationRevision=-1,migrationTexts=[],migrationTextSet=new Set(),migrationScope="";const lexicalStore=createLexicalStore();const retrieval=createRetrieval();
  const settingsDefault={start:'<summary>',end:'</summary>',keep:5,storyYear:'',weaveMode:'smart',weaveBudget:3000,weaveKinds:kinds,summaryMode:'unified',engine:'hybrid',adaptive:false,autoHide:false,layers:true,vectorEnabled:false,vectorMigration:false,vectorUrl:'',vectorModel:'',modeAdvice:true};
  const vars=()=>api('getVariables',{type:'chat'})||{};
  const saveVars=patch=>api('replaceVariables',{...vars(),shiyi_v01:patch},{type:'chat'});
  const blocked=key=>!!vars().shiyi_v01?.deletedKeys?.[key];
  const markDeleted=(keys)=>{
    const d=vars().shiyi_v01||{};
    saveVars({...d,deletedKeys:{...d.deletedKeys,...Object.fromEntries(keys.map(k=>[k,true]))}});
    archiveRevision++;
  };
  let archiveRevision=0, projectedRevision='', archiveCheckedScope='', persistedTableScope='', persistedTableRevision;
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
    if (!state.disposed) context().setExtensionPrompt?.(promptKey,'',1,4,false,0);
  };
  const memoryData = createMemoryData(hash);
  const readMemory = (messages = getMessageSource()) => memoryData.read({
    ...chatIdentity(), ...(Array.isArray(messages)?{messages}:messages), data: vars().shiyi_v01,
  });
  function ledger(view = readMemory()) {
    const id = view.scope;
    check(id);
    const result = view.ledger();
    if(result.revision!==undefined&&persistedTableScope===id&&persistedTableRevision===result.revision)return result;
    const next = { rows: result.rows, entities: result.entities };
    if (JSON.stringify(vars().shiyi_v01?.weave || {}) !== JSON.stringify(next)) {
      check(id);
      saveVars({ ...vars().shiyi_v01, weave: next });
    }
    if(result.revision!==undefined){persistedTableScope=id;persistedTableRevision=result.revision;}
    return result;
  }
  const autoDossier=()=>ledger().entities;
  const summaryCache=createSummaryDocCache(),entityCache=createEntityDocCache();let summaryScope='';
  const indexSession=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`;
  function indexRevision(view,cfg){
    if(view.messageRevision==null)return null;
    const metadata=hash(JSON.stringify([view.archive.meta,view.archive.dossier,view.archive.weavePins]));
    return JSON.stringify([indexSession,view.scope,view.messageRevision,view.tableRevision(),view.summaryStats().revision,
      archiveRevision,metadata,cfg.weaveMode,cfg.weaveKinds,cfg.layers]);
  }
  function recallInputs(chat,view,rows,cfg,budget){
    const l=view.ledger(), a=view.archive;
    const entities=view.activeDossiers(rows);
    const visible=sceneQuery(chat,[]).query;
    const options={mode:cfg.weaveMode,budget,pins:a.weavePins||[],categories:cfg.weaveKinds||kinds,meta:a.meta||{},adaptive:cfg.adaptive,layers:cfg.layers,visible};
    if(cfg.summaryMode==='legacy'||cfg.engine!=='hybrid')return {l,entities,visible,options};
    const known=cfg.weaveMode==='archive'?[]:knowledgeForCharacter(l);
    if(known.length){
      entities.push(...known);
      options.categories=[...options.categories,'认知'];
    }
    if(Object.keys(rows).length+entities.length>=shardThreshold||view.summaryStats().estimate>=1024*1024){
      return {l,entities,visible,options,corpus:createDocumentCorpus(rows,entities,options)};
    }
    const scope=identity();if(summaryScope!==scope){summaryScope=scope;summaryCache.clear();entityCache.clear();}
    const docs=buildDocs(rows,entities,{...options,summaryCache,entityCache});
    return {l,entities,visible,options,docs};
  }
  async function recallForGeneration(chat,view,rows,cfg,scope,guard,budget,verifySources,type){
    if(budget===0)return {content:'',selected:[],summaries:[],estimate:0};
    const {l,entities,visible,options,docs,corpus}=recallInputs(chat,view,rows,cfg,budget);
    if(cfg.summaryMode==='legacy')return retrieve(entities,visible,options);
    if(cfg.engine!=='hybrid')return unified(rows,entities,visible,options);
    const scene=sceneQuery(chat,corpus?corpus.sceneEntities():docs);
    const revision=corpus?indexRevision(view,cfg):null;
    const recall=corpus?await searchMemoryTop(scene,async query=>{
      verifySources();
      const ranked=(revision&&await retrieval.top(query,scope,revision,192,guard))||
        await retrieval.topBlocks(corpus.documents,query,192,guard);
      return ranked.matches.flatMap(({id,score})=>{
        const doc=corpus.resolve(id);
        return doc?[{doc,score}]:[];
      });
    }):await searchMemory(docs,scene,query=>{
      if(query!==scene.primary)verifySources();
      return retrieval.scores(docs,query,scope,lexicalStore,guard);
    });
    guard();
    const sameScope=state.echoScope===scope;
    const echo=sameScope?state.echo:{};
    const candidates=corpus?corpus.candidates(recall.scores,scene,echo):docs;
    const scores=corpus?candidates.map(doc=>recall.scores.get(doc.id)||0):recall.scores;
    const query=['expanded','deep'].includes(recall.stage)?scene.expanded:scene.primary;
    const limit=hybridBudget(budget,query,options.adaptive,recall);
    const actor=cfg.weaveMode==='archive'?'':activeViewpoint(scope,type);
    const perspective=recallViewpoint(l,actor,query,Math.min(360,Math.floor(limit*.25)));
    const roleCost=perspective.content?cost('\n\n'+perspective.content):0;
    const result=hybrid(rows,entities,query,{
      ...options, budget:limit-roleCost, adaptive:false,
      docs:candidates, scores, sceneHints:scene.hints, recallAnchor:recall.anchor, primaryQuery:scene.primary, lexicalStore,
      echo, advance:!sameScope||state.echoTurn!==visible,
      vectorRank:cfg.vectorEnabled&&vectorHealth.ready({...cfg,vectorKey:sessionStorage.getItem('capricorn-vector-key')||''})?(ranked,query)=>vector.rank(ranked,query,{...cfg,vectorKey:sessionStorage.getItem('capricorn-vector-key')||''},scope):null,
    });
    const publicIds = new Set(result.selected.filter(id => id.startsWith('knowledge:')));
    const viewpointIds = new Set(perspective.selected);
    const knowledgeSources = [];
    if (publicIds.size || viewpointIds.size) {
      const candidates = { knowledge: l.knowledge.filter(row => publicIds.has(row.id) || viewpointIds.has(row.id)) };
      for (const row of knowledgeForCharacter(candidates)) {
        if (publicIds.has(row.id) && row.sourceKey) knowledgeSources.push([row.id, row.sourceKey]);
      }
      if (viewpointIds.size) {
        for (const row of knowledgeForCharacter(candidates, actor)) {
          if (viewpointIds.has(row.id) && row.sourceKey) knowledgeSources.push([row.id, row.sourceKey]);
        }
      }
    }
    const content=[result.content,perspective.content].filter(Boolean).join('\n\n');
    return {
      ...result, estimate:cost(content), budget:limit, recallStage:recall.stage, recallConfidence:recall.confidence, knowledgeSources,
      content,
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

  const config=(d=vars().shiyi_v01||{})=>{const saved=d.settings||{};return {...settingsDefault,...saved,summaryMode:saved.summaryMode||'auto'};};
  const records=()=>vars().shiyi_v01?.records||{};
  const activeRecords=(messages=getMessageSource())=>readMemory(messages).summaries();
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
  const notice=(msg,toastKind='auto')=>{
    console.info('[拾忆]',msg);
    const el=$('#shiyi-status',state.root);
    if(el)el.textContent=msg;
    if(toastKind===false||hostDocument.hidden||!msg)return;
    const text=String(msg);
    const kind=toastKind!=='auto'?toastKind:/失败|异常/.test(text)?'error':/未加载|为空|未发现|不存在|禁止|冲突|取消|没有选中|没有可核对|已切换|请先/.test(text)?'warn':/已更新|已保存|成功|已隐藏|已恢复|已归档|修改成功/.test(text)?'success':'info';
    uiToast(text,{doc:hostDocument,kind});
  };
  const error=(e)=>{console.error('[拾忆]',e);notice('操作失败：'+(e?.message||e));};
  const messageCatalog=createMessageCatalog({context,scope:identity,last:()=>api('getLastMessageId'),
    read:(start,end,full)=>api('getChatMessages',full||start!==end?`${start}-${end}`:String(start),{role:'assistant',hide_state:'all'}),
  });
  function getMessageSource({reconcile=false,swipe=false}={}){
    const source=messageCatalog.snapshot({reconcile});
    const excludeFloor=swipe?source.last:undefined;
    if(source.trusted)return {source,excludeFloor};
    const messages=source.messages();
    return swipe?messages.filter(message=>message.message_id!==excludeFloor):messages;
  }
  function getMessages(){return messageCatalog.snapshot().messages();}
  function extract(str,{start,end}=config()){str=stripTheater(str);let best=null,pos=-1;for(const [a,b] of [[start,end],['<summary>','</summary>'],['<摩羯纪要>','</摩羯纪要>']]){if(!a||!b)continue;const i=str.lastIndexOf(a),j=str.indexOf(b,i+a.length);if(i>=0&&j>=0&&i>pos){pos=i;best=str.slice(i+a.length,j).trim();}}return best;}
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
  function modal(title, body, buttons, registerFinish) {
    return new Promise(resolve => {
      const overlay = hostDocument.createElement('div');
      overlay.className = 'shiyi-overlay';
      const dialog = hostDocument.createElement('div');
      dialog.className = 'shiyi-dialog';
      if (body.classList.contains('shiyi-editor')) dialog.classList.add('shiyi-dialog-wide');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', title);
      const heading = hostDocument.createElement('h3');
      heading.textContent = title;
      const content = hostDocument.createElement('div');
      content.className = 'shiyi-body';
      content.append(body);
      const actions = hostDocument.createElement('div');
      actions.className = 'shiyi-actions';
      dialog.append(heading, content, actions);
      overlay.append(dialog);
      const dismissButton = buttons.find(b => b.value === 'cancel' || b.value === 'close' || b.value === false);
      const onKey = event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        if (hostDocument.querySelector('.cap-ui-portal')) return;
        if (dismissButton) {
          event.preventDefault();
          finish(dismissButton.value);
        }
      };
      let adapter, finished = false;
      const finish = value => {
        if (finished) return;
        finished = true;
        hostDocument.removeEventListener('keydown', onKey);
        if (adapter) adapter.destroy();
        overlay.remove();
        state.open = false;
        state.closeModal = null;
        resolve(value);
      };
      state.closeModal = () => finish(dismissButton ? dismissButton.value : 'cancel');
      if (registerFinish) registerFinish(finish);
      if (dismissButton) {
        overlay.addEventListener('pointerdown', event => {
          if (event.target === overlay) finish(dismissButton.value);
        });
      }
      buttons.forEach(({label, value, kind}) => {
        const button = hostDocument.createElement('button');
        button.type = 'button';
        button.textContent = label;
        if (kind) button.className = kind;
        button.onclick = () => finish(value);
        actions.append(button);
      });
      hostDocument.addEventListener('keydown', onKey);
      hostDocument.body.append(overlay);
      state.open = true;
      try { adapter = mountSelects(overlay); }
      catch (cause) { console.warn('[拾忆] 保留原生选择器', cause); }
    });
  }
  const characterKey=()=>chatIdentity().owner.replace(/^character:/,'');
  // Keep the stable card identity for ownership; use its visible card name only for the worldbook title.
  const oldBookName=()=>`拾忆｜角色｜${hash(characterKey())}`;
  const bookName=()=>{
    const c=context(), characterId=c.characterId??c.character_id;
    if(c.groupId!=null&&c.groupId!=='')return oldBookName();
    const name=String(c.characters?.[characterId]?.name||c.name2||'').trim();
    return name ? name+'记忆' : oldBookName();
  };
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
    const listedNames=api('getWorldbookNames');
    if(!Array.isArray(listedNames))throw Error('无法读取世界书列表');
    const names=[...listedNames];
    let entries=[];
    if(names.includes(name)){
      try { entries=await readWorldbook(api,check,name,id); }
      catch(error){
        if(!missingWorldbook(error))throw error;
        // The host may still list a deleted book; allow controlled recreation below.
        names.splice(names.indexOf(name),1);
      }
    }
    const rows={...data.records};
    let imported=false;
    function importRow(key,row){
      if(typeof key!=='string'||!key||['__proto__','constructor','prototype'].includes(key)||!row||typeof row.content!=='string'||hasOwn(rows,key)||data.deletedKeys?.[key])return;
      rows[key]=row;
      imported=true;
    }
    for(const entry of entries.filter(matches)){
      for(const [key,row] of Object.entries(entry.extra.shiyi_rows||{}))importRow(key,row);
    }
    // Migrate all recognized historic projection names, even after archiveVersion=2.
    // Preserve old books for rollback, and only copy records owned by this card and chat.
    const previous=data.book||api('getChatWorldbookName','current');
    const legacyNames=new Set([oldBookName(),previous].filter(
      book=>typeof book==='string'&&book!==name&&book.startsWith('拾忆｜')&&names.includes(book)));
    for(const oldName of legacyNames){
      let old=[];
      try { old=await readWorldbook(api,check,oldName,id); }
      catch(error){ if(!missingWorldbook(error))throw error; }
      for(const entry of old){
        if(matches(entry)){
          for(const [key,row] of Object.entries(entry.extra?.shiyi_rows||{}))importRow(key,row);
        }
        if(data.archiveVersion!==2){
          const key=entry.extra?.shiyi_key;
          if(typeof key!=='string'||(entry.extra?.shiyi_owner&&entry.extra.shiyi_owner!==owner))continue;
          importRow(key,{title:entry.name,content:entry.content,sourceMessage:entry.extra.shiyi_message_id,
            sourceHash:key.split(':').slice(1).join(':'),storyTime:parseStoryTime(entry.content)});
        }
      }
    }
    return {name,owner,names,entries,owns,matches,rows,imported};
  }
  async function recoverArchive(id){
    const book=await readArchive(id);
    check(id);
    if(book.imported){
      const latest=vars().shiyi_v01||{};
      saveVars({...latest,records:{...book.rows,...latest.records},archiveVersion:2});
      changed();
    }
    archiveCheckedScope=id;
    return book;
  }
  async function projectLegacyWorldbook(id,active,{name,owner,names,entries,owns,matches}){
    const content=formatRows(active);
    const intact=e=>String(e.content??'')===formatRows(e.extra.shiyi_rows||{});
    // Keep manually edited worldbook text and keep it out of automatic injection until reviewed.
    const conflict=entries.some(e=>matches(e)&&!intact(e));
    if(conflict)notice('拾忆世界书存在手动修改，已保留原内容；请在世界书中核对。');
    if(entries.length&&!entries.some(owns))throw Error('同名世界书已存在且不属于拾忆，请先处理名称冲突：'+name);
    const existing=entries.find(e=>owns(e)&&e.extra.shiyi_chat===id&&intact(e));
    const enable=!!content;
    let projection=existing;
    if(content&&!projection){
      if(!names.includes(name)){
        // getWorldbookNames may be stale, so probe existence before creating.
        let exists=false;
        try { await readWorldbook(api,check,name,id); exists=true; }
        catch(error){ if(!missingWorldbook(error))throw error; }
        if(!exists){
          if(!await api('createWorldbook',name,[]))throw Error('世界书创建未成功，请检查酒馆世界书列表');
          check(id);
          // A few hosts update their worldbook index asynchronously after creation.
          let ready=false;
          for(let attempt=0;attempt<3;attempt++){
            try { await readWorldbook(api,check,name,id); ready=true; break; }
            catch(error){ if(!missingWorldbook(error))throw error; }
            if(attempt<2)await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
            check(id);
          }
          if(!ready)throw Error('世界书已请求创建，但宿主尚未能读取，请稍后重试；不会重复创建条目');
        }
      }
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
  }
  function memoryRoute(id,view,cfg,limit){
    const settings=cfg.summaryMode;
    return routeMemoryFromStats(settings,settings==='auto'?view.summaryStats():undefined,
      limit??cfg.weaveBudget,state.routeScope===id?state.routeMode:undefined,
      cfg.engine==='hybrid'&&cfg.vectorEnabled&&!!cfg.vectorUrl&&!!cfg.vectorModel);
  }
  async function prepareMemoryRoute(id,messages,limit,force=false,settings){
    let book=archiveCheckedScope!==id||force?await recoverArchive(id):undefined;
    check(id);
    let view=readMemory(messages);
    const cfg=settings||config();
    let route=memoryRoute(id,view,cfg,limit);
    if(route.mode==='legacy'&&!book){
      book=await recoverArchive(id);
      if(book.imported){
        view=view.withData(vars().shiyi_v01);
        route=memoryRoute(id,view,cfg,limit);
      }
    }
    if(route.mode==='legacy')await projectLegacyWorldbook(id,view.summaries(),book);
    else await syncWorldbookMounts(api,check,id,null);
    check(id);
    state.routeScope=id;state.routeMode=route.mode;state.routeProfile=route.profile;state.routeReason=route.reason;
    return {memoryView:view,cfg:{...cfg,summaryMode:route.mode,vectorEnabled:route.profile==='enhanced'}};
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
      const messages=getMessageSource({reconcile:true});
      const revision=JSON.stringify([id,archiveRevision,state.messageVersion?.()]);
      let memoryView;
      if(force||projectedRevision!==revision){
        ({memoryView}=await prepareMemoryRoute(id,messages,undefined,force));
      }
      if(generation)return;
      check(id);
      if(memoryView){
        const current=getMessageSource();
        if(!sameSources(messages,current))return;
        projectedRevision=JSON.stringify([id,archiveRevision,state.messageVersion?.()]);
      }
      ledger(memoryView?.withData(vars().shiyi_v01) || readMemory(messages));
      await reconcileAutoHide(id,state.routeMode==='unified');
      return messages;
    });
  }
  const generationMessages=type=>getMessageSource({swipe:type==='swipe'});
  function sameSources(previous,current){
    if(!Array.isArray(previous)||!Array.isArray(current)){
      return previous.source?.scope===current.source?.scope&&previous.source?.revision===current.source?.revision&&
        previous.source?.last===current.source?.last&&previous.excludeFloor===current.excludeFloor;
    }
    return previous.length===current.length&&previous.every((m,i)=>
      m.message_id===current[i].message_id&&m.message===current[i].message&&m.is_hidden===current[i].is_hidden);
  }
  async function prepareGeneration(chat,type,contextSize){
    const id=identity();
    invalidateGeneration();
    if(!id||state.disposed)return;
    const ticket={};
    generation=ticket;
    clearTimeout(inputWarmTimer);
    state.recallTiming='准备中';
    migration.pause();
    const checkTicket=()=>{check(id);if(generation!==ticket)throw Error('生成期间剧情已更新，请重新发送');};
    try{
      return await serial(async()=>{
        checkTicket();
        const messages=generationMessages(type);
        const rawCfg=config();
        const routeLimit=Number.isFinite(contextSize)?Math.min(rawCfg.weaveBudget,Math.max(0,contextSize)):rawCfg.weaveBudget;
        const {memoryView,cfg}=await prepareMemoryRoute(id,messages,routeLimit);
        if(cfg.summaryMode==='legacy')await reconcileAutoHide(id,false);
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
          const view=memoryView.withData(vars().shiyi_v01);
          const began=Date.now();
          try {
            result=await boundedRecall(guard=>recallForGeneration(input,view,view.summaries(),cfg,id,guard,budget,()=>{guard();guardSources();},type),{
              guard:checkTicket,cancel:()=>{if(generation===ticket)retrieval.stop();},
            });
            state.recallTiming=`${Date.now()-began} ms`;
          } catch(cause) {
            if(!(cause instanceof RecallTimeout))throw cause;
            guardSources();
            state.recallTiming=`${Date.now()-began} ms · 超时，本轮跳过动态记忆`;
            state.weaveResult=null;
            return;
          }
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
  let inputWarmTimer, inputWarmSnapshot;
  function onDraftInput(event){
    if(shared.flags.memory===false||event.target?.id!=='send_textarea'||event.isComposing)return;
    clearTimeout(inputWarmTimer);
    const snapshot=inputWarmSnapshot;
    if(!snapshot||generation||state.disposed)return;
    inputWarmTimer=setTimeout(()=>{
      if(shared.flags.memory===false||snapshot!==inputWarmSnapshot||generation||state.disposed||identity()!==snapshot.id||state.messageVersion?.()!==snapshot.version||archiveRevision!==snapshot.revision)return;
      warmLocal(snapshot.id,snapshot.messages,config());
    },350);
  }
  hostDocument.addEventListener?.('input',onDraftInput);
  let warmKey='', warmStatus='等待空闲', warming=false, warmRetryAt=0;
  function warmLocal(id,messages,cfg){
    if(shared.flags.memory===false||warming||Date.now()<warmRetryAt||generation||hostDocument.hidden||state.open||state.queue.length||cfg.engine!=='hybrid'||state.routeMode!=='unified'||typeof Worker==='undefined')return;
    const revision=archiveRevision, sourceVersion=state.messageVersion?.();
    const key=JSON.stringify([id,revision,sourceVersion,persistedTableRevision,cfg.weaveMode,cfg.weaveKinds,cfg.layers]);
    if(key===warmKey)return;
    warming=true;
    const run=async task=>{try{
      const guard=()=>{
        task?.check();
        if(state.disposed||generation||identity()!==id||archiveRevision!==revision||hostDocument.hidden||sourceVersion!==state.messageVersion?.())throw Error('预热已过期');
      };
      guard();
      const view=readMemory(messages), rows=view.summaries();
      const {docs,corpus}=recallInputs([],view,rows,{...cfg,summaryMode:'unified'},cfg.weaveBudget);
      const token=corpus?indexRevision(view,cfg):null;
      if(corpus&&!token){warmKey=key;warmStatus='宿主消息版本不可用：按需分片检索';return;}
      const result=corpus?await retrieval.warmBlocks(corpus.documents(),id,guard,token,task):
        await retrieval.warm(docs,id,lexicalStore,guard);
      guard();if(result)warmKey=key;else warmRetryAt=Date.now()+30000;warmStatus=result?'本地索引已预热':'后台线程不可用：按需检索';
    }catch{warmRetryAt=Date.now()+3000;warmStatus='预热让位或已过期';}finally{warming=false;}};
    if(shared.maintenance){
      warming=false;
      shared.maintenance.enqueue('拾忆索引',async task=>{if(warming)return;warming=true;await run(task);},maintenancePriority.index,{lane:'index',scoped:true});
    }else if(typeof hostWindow.requestIdleCallback==='function')hostWindow.requestIdleCallback(()=>void run());
    else setTimeout(()=>void run(),50);
  }
  async function scan(task){
    if(shared.flags.memory===false||state.busy||state.disposed||generation)return;
    const id=identity();if(!id)return;
    if(id!==state.current){retrieval.stop();vector.reset();migration.reset();migrationScope="";state.closeModal?.();state.current=id;state.seen.clear();state.deferred.clear();state.stability.clear();state.queue=[];state.reviewRevision=undefined;archiveRevision++;}
    let messages;
    state.busy=true;try{messages=await verifyGlobal(false);}catch(e){error(e);return;}finally{state.busy=false;}
    if(!messages||id!==identity()||generation)return;
    task?.check();
    if(shared?.flags?.memory===false||state.open)return;
    state.busy=true;
    try{
      const data=vars().shiyi_v01||{}, cfg=config(data), existing=data.records||{}, deleted=data.deletedKeys||{};
      suggestMode(id);
      const source=messages.source;
      const fallback=source?null:new Map(messages.map(message=>[message.message_id,message]));
      const at=floor=>source?source.get(floor):fallback.get(floor);
      const liveKey=floor=>{const message=at(floor);return message&&sourceKey(message);};
      state.queue=state.queue.filter(q=>q.chat===id&&liveKey(q.id)===q.key&&!deleted[q.key]);
      const queuedFloors=new Set(state.queue.map(q=>q.id));
      for(const [floor,q] of state.deferred)if(q.chat!==id||liveKey(floor)!==q.key||deleted[q.key])state.deferred.delete(floor);
      const now=Date.now();
      const tags=JSON.stringify([cfg.start,cfg.end]);
      const changedFloors=source&&tags===state.reviewTags?source.changesSince(state.reviewRevision):null;
      const inspect=changedFloors?[...changedFloors].map(at).filter(Boolean):source?source.values():messages;
      for(const m of inspect){
        const idNum=m.message_id;
        const key=sourceKey(m);
        if(deleted[key]||state.deferred.has(idNum)||existing[key]||state.seen.has(key)||queuedFloors.has(idNum))continue;
        const content=extract(String(m.message??''),cfg);if(!content)continue;
        const prev=state.stability.get(idNum);
        if(!prev||prev.key!==key||tags!==state.reviewTags)state.stability.set(idNum,{key,since:now,content});
      }
      // 流式输出可能提前闭合标签，正文连续稳定八秒后再审核。
      for(const [floor,pending] of state.stability){
        const {key,since,content}=pending;
        if(liveKey(floor)!==key||deleted[key]||existing[key]||state.seen.has(key))state.stability.delete(floor);
        else if(now-since>=8000&&!queuedFloors.has(floor)&&!state.deferred.has(floor)){
          state.stability.delete(floor);
          state.seen.add(key);
          state.queue.push({key,id:floor,content,chat:id});
        }
      }
      state.reviewRevision=source?.revision;
      state.reviewTags=tags;
    }catch(e){error(e);}finally{state.busy=false;}
    const mc=config();
    inputWarmSnapshot={id,messages,version:state.messageVersion?.(),revision:archiveRevision};
    warmLocal(id,messages,mc);
    if(vectorHealth.ready({...mc,vectorKey:sessionStorage.getItem('capricorn-vector-key')||''})&&mc.vectorEnabled&&mc.vectorMigration&&mc.vectorUrl&&mc.vectorModel&&state.routeProfile==='enhanced'&&mc.engine==='hybrid'&&!hostDocument.hidden&&!generation){
      const key=vectorScope(id,mc), stamp=JSON.stringify([archiveRevision,state.messageVersion?.()]);
      if(migrationScope!==key||migrationRevision!==stamp){
        migrationRevision=stamp;
        const rows=activeRecords(messages), meta=archive().meta||{};
        const nextTexts=[...new Set(Object.entries(rows).sort((a,b)=>Number(!!meta[b[0]]?.star)-Number(!!meta[a[0]]?.star)||b[1].sourceMessage-a[1].sourceMessage).map(([,r])=>r.title+' '+r.content))];
        if(migrationScope!==key||nextTexts.length!==migrationTexts.length||nextTexts.some(t=>!migrationTextSet.has(t))){migrationScope=key;migrationTexts=migration.revise(key,nextTexts);migrationTextSet=new Set(nextTexts);}
      }
      const texts=migrationTexts;
      const migrate=async vectorTask=>{
        const release=vectorTask?.reserve(768*1024);
        if(vectorTask&&!release)return;
        const cancel=()=>migration.pause();
        vectorTask?.signal.addEventListener('abort',cancel,{once:true});
        try {
          await migration.step(key,texts,{...mc,vectorKey:sessionStorage.getItem('capricorn-vector-key')||''},()=>{
            if(vectorTask?.signal.aborted||generation||state.disposed||identity()!==id||hostDocument.hidden||state.routeProfile!=='enhanced'||
              migrationRevision!==stamp||stamp!==JSON.stringify([archiveRevision,state.messageVersion?.()]))return false;
            const current=config();
            return current.vectorEnabled&&current.vectorMigration&&vectorScope(id,current)===key;
          });
        } finally {
          vectorTask?.signal.removeEventListener('abort',cancel);
          release?.();
        }
      };
      if(shared.maintenance)shared.maintenance.enqueue('拾忆向量',migrate,maintenancePriority.vector,{lane:'vector',scoped:true});
      else void migrate().catch(error);
    }
    if(shared?.flags?.memory!==false&&state.queue.length&&!state.open){const item=state.queue.shift();void review(item).catch(error);}
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
    messageCatalog.touch(floor);
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
    const auto=allowNew&&cfg.autoHide&&state.routeScope===chat&&state.routeMode==='unified';
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
    box.innerHTML=`<div class="shiyi-stat-grid"><div class="shiyi-stat-card"><strong>${plan.confirmed}</strong><span>已核对摘要</span></div><div class="shiyi-stat-card"><strong>#${plan.protectedFrom}</strong><span>正文保护起点</span></div><div class="shiyi-stat-card"><strong>${plan.eligible.length}</strong><span>可隐藏消息</span></div></div><p class="shiyi-muted">${plan.unreviewed?'检测到未审核摘要，本次禁止归档。':'仅在点击确认后隐藏；原始聊天不删除。请先备份聊天。'}隐藏消息是否从最终模型上下文排除，需要在你的酒馆版本中实际验证。</p>`;
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
        if(!await uiConfirm(`恢复拾忆隐藏且来源一致的 ${entries.length} 条消息？`,{doc:hostDocument,title:'恢复正文归档',confirmText:'恢复'}))return;
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
    const button=(label,fn)=>{const b=hostDocument.createElement('button');b.textContent=label;b.onclick=async()=>{try{check(id);await fn();}catch(e){error(e);void uiAlert(e.message,{doc:hostDocument,title:'操作失败'});}};return b;};
    async function remove(keys){if(!keys.length||!await uiConfirm(`删除选中的 ${keys.length} 条摘要？可在回收站中恢复。`,{doc:hostDocument,title:'删除摘要',danger:true,confirmText:'移入回收站'}))return;await serial(async()=>{check(id);const rows={...records()};recycle(keys,rows);markDeleted(keys);for(const k of keys)state.seen.add(k);changed();});selected.clear();render();}
    async function restore(k,r){const m=getMessages().find(m=>m.message_id===r.sourceMessage);if(!m||`${m.message_id}:${hash(String(m.message??''))}`!==k)throw Error('原正文已变化，不能恢复旧正史');await addMemory({chat:id,id:r.sourceMessage,key:k},r.title,r.content,true);check(id);const trash={...archive().trash};delete trash[k];archivePatch({trash});render();}
    function render(){if(identity()!==id)return;list.replaceChildren();const a=archive(),meta=a.meta||{},trash=filter.value==='trash';const active=activeRecords();const inactive=()=>Object.fromEntries(Object.entries(records()).filter(([k])=>!hasOwn(active,k)&&!blocked(k)));const rows=ordered(trash?a.trash||{}:numbered(filter.value==='inactive'?inactive():active));const q=search.value.trim().toLowerCase();const matches=rows.filter(([k,r])=>(filter.value!=='star'||meta[k]?.star)&&fuzzy(`${r.title} ${r.content} ${meta[k]?.chapter||''}`,q));stats.textContent=`有效 ${Object.keys(active).length} · 回收站 ${Object.keys(a.trash||{}).length} · 匹配 ${matches.length}`;batch.hidden=trash;page=Math.min(page,Math.max(0,Math.ceil(matches.length/limit)-1));previous.disabled=page===0;more.disabled=(page+1)*limit>=matches.length;stats.textContent+=` · 第 ${page+1}/${Math.max(1,Math.ceil(matches.length/limit))} 页 · 已选 ${selected.size}`;
      for(const [k,r] of matches.slice(page*limit,(page+1)*limit)){const row=hostDocument.createElement('div');row.className='shiyi-history-item';const title=hostDocument.createElement('strong');title.textContent=`${meta[k]?.star?'★ ':''}${r.title} · 第${r.sourceMessage}楼`;const text=hostDocument.createElement('p');text.textContent=r.content;const details=hostDocument.createElement('details');const summary=hostDocument.createElement('summary');summary.textContent='查看完整摘要';details.append(summary,text);row.append(title,details);
        if(trash){row.append(button('恢复',()=>restore(k,r)));}else{const cb=hostDocument.createElement('input');cb.type='checkbox';cb.checked=selected.has(k);cb.style.width='auto';cb.onchange=()=>cb.checked?selected.add(k):selected.delete(k);row.prepend(cb);row.append(button(meta[k]?.star?'取消星标':'星标',()=>{archivePatch({meta:{...archive().meta,[k]:{...meta[k],star:!meta[k]?.star}}});changed();render();}),button('章节',async()=>{const chapter=await uiPrompt('输入章节名称（留空取消归类）：',meta[k]?.chapter||'',{doc:hostDocument,title:'设置章节',placeholder:'章节名称'});if(chapter!==null){archivePatch({meta:{...archive().meta,[k]:{...meta[k],chapter:chapter.trim()}}});changed();render();uiToast('章节已更新',{doc:hostDocument,kind:'success'});}}),button('溯源',()=>{if(jump(r.sourceMessage))state.closeModal?.();else uiToast('请先加载该历史楼层',{doc:hostDocument,kind:'warn'});}),button('编辑',()=>{state.closeModal?.();return editMemory(id,k);}),button('历史',async()=>{state.closeModal?.();const box=hostDocument.createElement('div');for(const v of archive().history?.[k]||[]){const p=hostDocument.createElement('p');p.textContent=v.savedAt+' · '+v.title+'\n'+v.content;box.append(p,button('回退此版本',async()=>{await serial(async()=>{check(id);const rows={...records()};if(!rows[k]||blocked(k))throw Error('记忆已失效');snapshot(k,rows[k],'回退前');rows[k]={...rows[k],title:v.title,content:v.content,storyTime:parseStoryTime(v.content)};writeRows(id,rows);});state.closeModal?.();}));}if(!box.children.length)box.textContent='暂无历史版本';await modal('修改历史',box,[{label:'返回',value:'close'}]);if(identity()===id&&!state.open)await manage();}),button('删除',()=>remove([k])));if(meta[k]?.chapter){const p=hostDocument.createElement('p');p.textContent='章节：'+meta[k].chapter;row.append(p);}}
        list.append(row);}}
    search.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=0;selected.clear();render();},180);};filter.onchange=()=>{clearTimeout(searchTimer);page=0;selected.clear();render();};previous.onclick=()=>{page=Math.max(0,page-1);render();};more.onclick=()=>{page++;render();};batch.onclick=()=>remove([...selected]).catch(error);container.append(search,filter,stats,batch,list,previous,more);render();try{await modal('拾忆 · 剧情档案',container,[{label:'关闭',value:'close'}]);}finally{clearTimeout(searchTimer);}
  }
  async function settings(){
    if(state.open)return;
    const settingsChat=identity();const cfg=config();const el=hostDocument.createElement('div');
    const resultForChat=state.weaveResultScope===settingsChat?state.weaveResult:null;
    el.innerHTML='<label>摘要开始标签<input id="shiyi-start"></label><label>摘要结束标签<input id="shiyi-end"></label><label>剧情年份（可选，例：2026；用于补全摘要缺失的年份及星期）<input id="shiyi-year" inputmode="numeric" maxlength="4" placeholder="不确定请留空"></label><p class="shiyi-muted">第一版只支持起止标签。默认不自动隐藏旧正文；手动归档需再次确认。</p>';
    $('#shiyi-start',el).value=cfg.start;$('#shiyi-end',el).value=cfg.end;$('#shiyi-year',el).value=cfg.storyYear||'';
    const w=hostDocument.createElement('div');w.innerHTML='<label>档案记忆模式<select id="weave-mode"><option value="archive">仅归档</option><option value="compact">精简记忆</option><option value="smart">智能记忆</option><option value="deep">深度记忆</option></select></label><label>记忆运行模式<select id="summary-mode"><option value="auto">智能自动（推荐）</option><option value="local">本地超长记忆</option><option value="enhanced">增强超长记忆</option><option value="legacy">简约模式 · 古法总结</option></select></label><label>检索引擎<select id="weave-engine"><option value="hybrid">凝忆 · BM25 + 实体 + 余温</option><option value="classic">原版检索</option></select></label><label>记忆注入预算（估算 Token）<input id="weave-budget" type="number" min="200" max="12000"></label><label><input id="weave-adaptive" type="checkbox"> 自适应预算（凝忆模式，上限为上述预算）</label><p>当前召回：'+(resultForChat?.selected?.length||0)+' 条；估算 '+(resultForChat?.estimate||0)+' Tokens。动态模式包含摘要与档案；旧版模式仅限制档案。摘要召回：'+(resultForChat?.summaries?.length||0)+' 条。</p>';el.append(w);const auto=hostDocument.createElement('label');auto.innerHTML='<input type="checkbox" id="auto-hide"> 自动隐藏已确认的旧 AI 正文（实验；默认关闭）';w.append(auto);const ve=hostDocument.createElement('div');ve.innerHTML='<label><input id="vector-enabled" type="checkbox"> 可选向量检索（剧情将发送到指定服务）</label><label><input id="vector-migration" type="checkbox"> 后台补全历史摘要向量（可能产生 API 费用，默认关闭）</label><label>完整 Embedding URL<input id="vector-url" type="url"></label><label>模型<input id="vector-model"></label><label>API Key（仅本次浏览器会话）<input id="vector-key" type="password"></label>';w.append(ve);const guide=hostDocument.createElement('details');guide.innerHTML='<summary>免费向量 API 获取指南</summary><p>硅基流动提供免费模型的情况以官方价格页为准。启用后剧情文本将发送至服务商。</p><p><a href="https://cloud.siliconflow.cn/account/ak" target="_blank" rel="noopener noreferrer">获取 API Key</a> · <a href="https://siliconflow.cn/pricing" target="_blank" rel="noopener noreferrer">模型价格</a> · <a href="https://siliconflow.readme.io/reference/createembedding" target="_blank" rel="noopener noreferrer">接口文档</a></p><p>注册、创建密钥、复制到上方，保存设置。</p>';const fill=hostDocument.createElement('button');fill.type='button';fill.textContent='填入硅基流动 BGE-M3 配置';fill.onclick=()=>{$('#vector-url',el).value='https://api.siliconflow.cn/v1/embeddings';$('#vector-model',el).value='BAAI/bge-m3';};guide.append(fill);w.append(guide);const layer=hostDocument.createElement('label');layer.innerHTML='<input type="checkbox" id="memory-layers"> 章节索引（实验，保留原始摘要）';w.append(layer);$('#memory-layers',el).checked=cfg.layers;$('#vector-enabled',el).checked=cfg.vectorEnabled;$('#vector-migration',el).checked=cfg.vectorMigration;$('#vector-url',el).value=cfg.vectorUrl;$('#vector-model',el).value=cfg.vectorModel;$('#vector-key',el).value=sessionStorage.getItem('capricorn-vector-key')||'';const vs=hostDocument.createElement('p');vs.textContent=vectorHealth.info({...config(),vectorKey:sessionStorage.getItem('capricorn-vector-key')||''})+"；"+migration.info()+"；向量通道："+(vectorLane.busy()?"忙碌":"空闲")+"；"+vector.info()+"；"+retrieval.info();w.append(vs);$('#auto-hide',el).checked=cfg.autoHide;$('#weave-engine',el).value=cfg.engine;$('#weave-adaptive',el).checked=cfg.adaptive;const inspect=hostDocument.createElement('details');const caption=hostDocument.createElement('summary');caption.textContent='查看最近一次准备注入的记忆与召回原因';const pre=hostDocument.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent='召回阶段：'+(resultForChat?.recallStage||'—')+'；证据等级：'+({strong:'较强',limited:'有限',weak:'较弱',none:'无'}[resultForChat?.recallConfidence]||'—')+'\n'+(resultForChat?.details||[]).map(x=>x.id+'：'+x.reason+(x.group?' ['+x.group+']':'')).join('\n')+'\n\n'+(resultForChat?.content||'暂无');inspect.append(caption,pre);w.append(inspect);$('#summary-mode',el).value=cfg.summaryMode==='unified'?(cfg.vectorEnabled?'enhanced':'local'):cfg.summaryMode;$('#weave-mode',el).value=cfg.weaveMode;$('#weave-budget',el).value=cfg.weaveBudget;const kindsWrap=hostDocument.createElement('div');kindsWrap.className='shiyi-kind-section';const kindsTitle=hostDocument.createElement('div');kindsTitle.className='shiyi-kind-title';kindsTitle.textContent='档案召回类别';const kindsGrid=hostDocument.createElement('div');kindsGrid.className='shiyi-kind-grid';for(const k of kinds){const label=hostDocument.createElement('label');label.className='shiyi-kind-chip';const c=hostDocument.createElement('input');c.type='checkbox';c.value=k;c.checked=cfg.weaveKinds.includes(k);c.dataset.weaveKind='1';const span=hostDocument.createElement('span');span.textContent=k;label.append(c,span);kindsGrid.append(label);}kindsWrap.append(kindsTitle,kindsGrid);w.append(kindsWrap);
    const modeSelect=$('#summary-mode',el);const modeLabel=modeSelect.closest('label');w.prepend(modeLabel);const modeHint=hostDocument.createElement('p');modeLabel.after(modeHint);const adviceLabel=hostDocument.createElement("label"),advice=hostDocument.createElement("input");advice.type="checkbox";advice.checked=cfg.modeAdvice;adviceLabel.append(advice," 智能模式切换建议");modeHint.after(adviceLabel);const advancedIds=['weave-engine','weave-adaptive','auto-hide','memory-layers'];const updateMode=()=>{const simple=modeSelect.value==='legacy',local=modeSelect.value==='local';for(const id of advancedIds)$('#'+id,el).closest('label').hidden=simple;ve.hidden=simple||local;guide.hidden=simple||local;vs.hidden=simple||local;modeHint.textContent=modeSelect.value==='auto'?'自动：小规模古法，超预算后本地超长；向量可选。':simple?'古法总结：完整世界书 + 档案检索，不调用向量服务。':local?'本地超长：使用已有摘要和本地索引。':'增强超长：配置并启用向量服务后增强召回。';};modeSelect.addEventListener('change',updateMode);updateMode();
    if (resultForChat?.knowledgeSources?.length) {
      appendMemoryProvenance(hostDocument, inspect, () => {
        if (identity() !== settingsChat || state.weaveResult !== resultForChat) return;
        const view = readMemory();
        const ledger = view.ledger();
        const visible = knowledgeForCharacter(ledger);
        if (resultForChat.viewpoint && activeViewpoint(settingsChat) === resultForChat.viewpoint) {
          visible.push(...knowledgeForCharacter(ledger, resultForChat.viewpoint));
        }
        const allowed = new Set(visible.map(row => JSON.stringify([row.id, row.sourceKey])));
        const sources = new Map();
        for (const [id, key] of resultForChat.knowledgeSources) {
          if (!key || !allowed.has(JSON.stringify([id, key]))) continue;
          const source = view.provenance('knowledge', id, { sourceKey: key })?.sources[0];
          if (source?.active) sources.set(source.key, source);
        }
        if (sources.size) return {
          origin: 'derived', active: true,
          sources: [...sources.values()].sort((a, b) => a.floor - b.floor),
        };
      }, undefined, '认知来源');
    }
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
    const estimate=hostDocument.createElement('button');estimate.type='button';estimate.textContent='估算历史向量补全用量';
    const usage=hostDocument.createElement('p');
    const pause=hostDocument.createElement('button');pause.type='button';pause.textContent='暂停补全';
    const resume=hostDocument.createElement('button');resume.type='button';resume.textContent='恢复补全';
    estimate.onclick=async()=>{
      check(settingsChat);
      const records=Object.values(activeRecords());
      const result=migration.estimate(records.map(row=>row.title+' '+row.content));
      const storage=await vectorStore.estimate();
      if(identity()!==settingsChat||!usage.isConnected)return;
      usage.textContent=`最多 ${result.requests} 批 · 约 ${result.estimatedTokens} 估算 Token · ${result.skipped} 条超长或空文本跳过`+
        (storage?` · 此站点剩余约 ${Math.floor(storage.available/1048576)} MiB`:'')+'。实际费用以所选服务计费为准。';
    };
    pause.onclick=()=>{check(settingsChat);migration.pause(true);};
    resume.onclick=()=>{check(settingsChat);migration.resume();};
    ve.append(estimate,pause,resume,usage);
    const progressTimer=setInterval(()=>{if(vs.isConnected&&!hostDocument.hidden)vs.textContent=vectorHealth.info({...config(),vectorKey:sessionStorage.getItem('capricorn-vector-key')||''})+"；"+migration.info()+"；向量通道："+(vectorLane.busy()?"忙碌":"空闲")+"；"+vector.info()+"；"+retrieval.info();},1000);
    let result;try{result=await modal('拾忆 · 设置',el,[{label:'取消',value:false},{label:'保存',value:true,kind:'primary'}]);}finally{clearInterval(progressTimer);}
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
        vectorMigration:$('#vector-migration',el).checked,vectorUrl:$('#vector-url',el).value.trim(),vectorModel:$('#vector-model',el).value.trim(),
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
          await prepareMemoryRoute(id,getMessages(),next.weaveBudget,false,next);
          if(state.routeMode==='legacy')await reconcileAutoHide(id,false);
        }
        check(id);
        touched=true;
        saveVars({...vars().shiyi_v01,settings:next});
        if(key!==undefined)sessionStorage.setItem('capricorn-vector-key',key);
      }catch(e){
        if(identity()===id&&!state.disposed){
          if(touched){
            const restored={...vars().shiyi_v01};
            if(hasOwn(before,'settings'))restored.settings=before.settings;
            else delete restored.settings;
            saveVars(restored);
            if(previousKey===null)sessionStorage.removeItem('capricorn-vector-key');
            else sessionStorage.setItem('capricorn-vector-key',previousKey);
          }
          if(project)try{await prepareMemoryRoute(id,getMessages(),undefined,false,config(before));}catch(rollbackError){error(rollbackError);}
        }
        throw e;
      }
      if(next.summaryMode!==previousMode||next.engine!==config(before).engine)retrieval.stop();
      if(next.summaryMode!==previousMode||!next.vectorEnabled||next.engine!=='hybrid'||
        next.vectorUrl!==before.settings?.vectorUrl||next.vectorModel!==before.settings?.vectorModel||
        key!==undefined&&key!==previousKey)vector.reset();
      migration.reset();migrationScope="";
      archiveRevision++;
    });

  }
  function tableView(options = {}){
    const {bindSearch, setCount, filters} = options;
    const id=identity();if(!id)return;
    const view=readMemory();
    check(id);
    const rows=Object.entries(view.ledger().rows).sort((a,b)=>b[1].floor-a[1].floor);
    const D=hostDocument,box=D.createElement('div'),q=D.createElement('input'),cat=D.createElement('select'),list=D.createElement('div'),nav=D.createElement('div');
    q.placeholder='搜索人物、事件或字段';
    q.setAttribute('aria-label','搜索人物、事件或字段');
    cat.setAttribute('aria-label','表格分类');
    cat.setAttribute('data-cap-select','search');
    const toolbar = D.createElement('div');
    toolbar.className = 'shiyi-view-controls';
    if (!bindSearch) toolbar.append(q);
    toolbar.append(cat);
    list.className = 'shiyi-table-rows';
    nav.className = 'shiyi-view-pagination';
    const categories=[...new Set(rows.flatMap(([,r])=>Object.keys(r.value)))];
    for(const k of ['',...categories]){const o=D.createElement('option');o.value=k;o.textContent=k||'全部分类';cat.append(o);}
    if (filters && categories.includes(filters.table)) cat.value = filters.table;
    const prev=D.createElement('button'),next=D.createElement('button'),status=D.createElement('span');prev.textContent='上一页';next.textContent='下一页';nav.append(prev,status,next);box.append(toolbar,list,nav);let page=0;
    const field=(parent,k,v)=>{
      const isObj=Boolean(v&&typeof v==='object');
      const line=D.createElement('div');
      line.className=isObj?'cap-table-group':'cap-table-row';
      const label=D.createElement('strong');
      label.className='cap-table-key';
      label.textContent=k;
      line.append(label);
      if(isObj){
        const nested=D.createElement('div');
        nested.className='cap-table-nested';
        for(const [key,val] of Object.entries(v))field(nested,Array.isArray(v)?'#'+String(Number(key)+1):key,val);
        line.append(nested);
      }else{
        const val=D.createElement('span');
        val.className='cap-table-val';
        val.textContent=String(v??'—');
        line.append(val);
      }
      parent.append(line);
    };
    function render(){if(state.disposed||identity()!==id)return;list.replaceChildren();const term=q.value.trim().toLowerCase(),filtered=rows.filter(([,r])=>(!cat.value||hasOwn(r.value,cat.value))&&(!term||JSON.stringify(cat.value?r.value[cat.value]:r.value).toLowerCase().includes(term)));const pages=Math.max(1,Math.ceil(filtered.length/20));page=Math.min(page,pages-1);nav.hidden=pages<=1;status.textContent=`${page+1} / ${pages} · ${filtered.length} 楼`;prev.disabled=page===0;next.disabled=page+1>=pages;
      for(const [key,row] of filtered.slice(page*20,page*20+20)){
        const item=D.createElement('details'),title=D.createElement('summary'),body=D.createElement('div');
        item.className='cap-table-card';
        body.className='cap-table-body';
        const floorBadge=D.createElement('span');floorBadge.className='cap-table-floor';floorBadge.textContent='#'+row.floor;
        const chips=D.createElement('span');chips.className='cap-table-chips';
        for(const col of Object.keys(row.value)){const chip=D.createElement('span');chip.className='cap-table-chip';chip.textContent=col;chips.append(chip);}
        title.append(floorBadge,chips);
        item.append(title,body);
        item.addEventListener('toggle',()=>{
          if(!item.open||body.childNodes.length||identity()!==id)return;
          for(const [fieldName,value] of Object.entries(row.value))if(!cat.value||fieldName===cat.value)field(body,fieldName,value);
          appendMemoryProvenance(D,body,()=>identity()===id&&view.provenance('table',key),source=>{
            if(!jumpToSource(source))return false;
            if (!bindSearch) state.closeModal?.();
            return true;
          });
        });
        list.append(item);
      }
      if(setCount)setCount(filtered.length);
      if(!filtered.length)list.textContent='暂无匹配的已归档表格';
    }
    let timer;
    const search = text => { q.value = text; page = 0; if (identity() === id) render(); };
    q.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (box.isConnected) search(q.value); }, 180);
    };
    cat.onchange = () => {
      if (filters) filters.table = cat.value;
      search(q.value);
    };
    prev.onclick = () => {page--;render();};
    next.onclick = () => {page++;render();};
    if (bindSearch) bindSearch(search);
    else render();
    return { element: box, destroy: () => clearTimeout(timer) };
  }

  async function showTables() {
    if (state.open) return;
    const view = tableView();
    if (!view) return;
    try { await modal('表格档案 · 只读', view.element, [{label:'关闭', value:'close'}]); }
    finally { view.destroy(); }
  }
  function openDossier(present, options) {
    if (state.open) return;
    return createDossier({
      D:hostDocument, modal, identity, check, archive, archivePatch, serial,
      jumpSource:jumpToSource, notice, read:readMemory,
    }).open(present, options);
  }
  function ui(){
    state.root?.remove();
    state.style?.remove();
    // Main extension stylesheet is loaded by the host in the extension document.
    if (hostDocument !== document) {
      state.style = hostDocument.createElement('link');
      state.style.rel = 'stylesheet';
      state.style.href = new URL('./style.css', import.meta.url).href;
      hostDocument.head.append(state.style);
    }
    state.root=hostDocument.createElement('div');state.root.id='shiyi-dock';state.root.classList.add('shiyi-collapsed');state.root.innerHTML='<button type="button" class="shiyi-orb" id="shiyi-expand" aria-label="展开拾忆面板" title="展开拾忆" aria-expanded="false"></button><div class="shiyi-dock-content"><button type="button" class="shiyi-collapse" id="shiyi-collapse" aria-label="收起拾忆面板" title="收起">−</button><div class="shiyi-brand">拾忆 · v0.7.1</div><div><button id="shiyi-scan">全量检测</button><button id="shiyi-import">补录 / 恢复</button><button id="shiyi-archive">正文归档</button><button id="shiyi-timeline">时间轴</button><button id="shiyi-review">待审核</button><button id="shiyi-manage">管理</button><button id="shiyi-settings">设置</button></div><div id="shiyi-status">等待聊天加载</div></div>';
    hostDocument.body.append(state.root);
    $('#shiyi-collapse', state.root).innerHTML = icon('right', 18);
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
    const tableButton=hostDocument.createElement('button');tableButton.id='shiyi-table';tableButton.textContent='表格档案';$('#shiyi-settings',state.root).before(tableButton);tableButton.onclick=()=>showTables().catch(error);
    const dossierButton=hostDocument.createElement('button');dossierButton.id='shiyi-dossier';dossierButton.textContent='留痕档案';$('#shiyi-settings',state.root).before(dossierButton);dossierButton.onclick=()=>openDossier()?.catch(error);
    state.setCollapsed = setCollapsed;
    state.tableView = tableView;
    state.openDossier = openDossier;
  }
  state.destroy=()=>{
    if(state.disposed)return;
    invalidateGeneration();
    state.disposed=true;
    clearTimeout(inputWarmTimer);
    hostDocument.removeEventListener?.('input',onDraftInput);
    inputWarmSnapshot=null;
    messageCatalog.destroy();
    retrieval.stop();
    lexicalStore.close();
    migration.reset();
    vector.reset();
    vectorStore.close();
    state.closeModal?.();
    state.root?.remove();
    state.style?.remove();
    if (state.stopOpenCommand) {
      try { state.stopOpenCommand(); } catch (cause) { console.warn('[拾忆] 移除脚本按钮监听失败', cause); }
    }
  };
  try { ui(); } catch(e) { console.error('[拾忆] UI 初始化失败',e); try { hostWindow.alert('拾忆 v0.7 启动失败：'+e.message); } catch(_) {} }
  // 备用入口：酒馆助手脚本按钮，即使悬浮层被主题遮挡也能打开诊断。
  try {
    if (typeof eventOn==='function' && typeof getButtonEvent==='function') {
      const event = getButtonEvent('拾忆·打开面板');
      const openCommand = () => {
        if (state.disposed || shared.flags.memory===false) return;
        try { if(!state.root?.isConnected) ui(); state.setCollapsed(false); notice('通过脚本按钮打开面板'); }
        catch(e) { hostWindow.alert('拾忆面板异常：'+e.message); }
      };
      const subscription = eventOn(event, openCommand);
      if (subscription && typeof subscription.stop === 'function') state.stopOpenCommand = () => subscription.stop();
      else if (typeof eventRemoveListener === 'function') state.stopOpenCommand = () => eventRemoveListener(event, openCommand);
    }
  } catch(e) { console.warn('[拾忆] 脚本按钮绑定失败',e); }
  state.validate=verifyGlobal;
  state.messageVersion=messageCatalog.version;
  state.tick=task=>scan(task).catch(e=>{if(!task?.signal.aborted)error(e);});
  state.pending=()=>state.queue.length+state.deferred.size;
  state.diagnostics=()=>{
    const id=identity();
    const prepared=state.weaveResultScope===id?state.weaveResult:null;
    let mode='等待聊天';
    if(id)try{
      const effective=state.routeScope===id?state.routeProfile||state.routeMode:config().summaryMode;
      mode=({legacy:'古法记忆',local:'本地超长记忆',enhanced:'增强超长记忆',unified:'超长记忆'})[effective]||'自动待判定';
    }catch{mode='等待酒馆助手';}
    return {
      '记忆模式':mode,
      '最近动态注入':prepared?`${prepared.summaries?.length||0} 条摘要 / ${prepared.estimate||0} 估算 Token（上限 ${prepared.budget}）`:'暂无',
      '场景召回':({direct:'当前输入命中',expanded:'已用近期场景扩查',weak:'线索有限',none:'无有效查询'})[prepared?.recallStage]||'暂无',
      '未结伏笔':prepared?.threadCount??0,
      '角色视角':prepared?.viewpoint?`${prepared.viewpoint} · ${prepared.viewpointCount} 条认知`:'公开认知',
      '检索':retrieval.info(),
      '宿主历史读取':`${messageCatalog.metrics().fullReads} 次全量 / ${messageCatalog.metrics().rangeReads} 次分段`,
      '表格来源读取':memoryData.tableMetrics()?.sourceReads??'—',
      '本地预热':warmStatus,
      '生成前检索耗时':state.recallTiming||'暂无',
      '向量':vector.info(),
    };
  };
  state.prepareGeneration=prepareGeneration;
  state.invalidateGeneration=invalidateGeneration;
  state.setSettings=settings=>saveSettings(identity(),settings);
  state.setViewpoint=name=>setViewpoint(identity(),name);
  state.suspend=async()=>{
    invalidateGeneration();
    clearTimeout(inputWarmTimer);
    inputWarmSnapshot=null;
    retrieval.stop(); vector.reset(); migration.reset();
    state.closeModal?.();
    await state.restoreAutoHidden();
    await state.detach();
    projectedRevision=undefined;
    state.root?.style.setProperty('display','none','important');
  };
  state.resume=()=>{
    projectedRevision=undefined;
    warmKey='';
    state.root?.style.removeProperty('display');
  };
  state.detach=()=>{
    invalidateGeneration();
    return serial(()=>syncWorldbookMounts(api,check,identity(),null));
  };
  state.recallThreads=()=>readMemory().activeDossiers().filter(r=>['事件','伏笔'].includes(r.kind)).map(r=>({id:r.id,kind:r.kind,title:r.title,status:r.status,sources:r.sources||[]}));
  state.recallPeople=()=> [...(archive().dossier||[]),...autoDossier()]
    .filter(r=>r.kind==='人物').map(r=>({id:r.id,title:r.title,sources:r.sources||[]}));
  state.timelineRows=async()=>{
    const messages=getMessages();
    const byFloor=new Map(messages.map(m=>[m.message_id,m]));
    const view=readMemory(messages), meta=view.archive.meta||{};
    return Object.entries(numbered(view.summaries())).filter(([,r])=>Number.isInteger(r.sourceMessage)).map(([key,r])=>{
      const trace=view.rawTable(byFloor.get(r.sourceMessage));
      return {
        floor:r.sourceMessage,title:r.title,content:r.content,
        when:trace?.时间||r.storyTime||parseStoryTime(r.content)||'日期未识别',
        traceText:JSON.stringify(trace||{}),sourceHash:r.sourceHash||key.split(':')[1],sourceKey:key,
        chapter:meta[key]?.chapter||'',star:!!meta[key]?.star,
      };
    });
  };
  state.provenance = (kind, id) => {
    const scope = identity();
    if (!scope || state.disposed || kind === 'knowledge') return;
    const view = readMemory();
    check(scope);
    return view.provenance(kind, id);
  };
  function jumpToSource(source) {
    if (!source.active || !Number.isSafeInteger(source.floor) || state.disposed || identity() !== source.scope) return false;
    try {
      const message = readFloor(source.floor);
      if (!message || hash(String(message.message ?? '')) !== source.version || blocked(source.key) || identity() !== source.scope) return false;
      return jump(source.floor);
    } catch (cause) {
      error(cause);
      return false;
    }
  }
  state.jumpToSource = jumpToSource;
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
