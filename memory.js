import { createDossier } from './dossier.js';
/* 拾忆 v0.7 — 酒馆助手全局脚本（测试版）
 * 将整个文件粘贴到 酒馆助手 -> 脚本库 -> 全局脚本。
 * 不删除消息；仅手动确认后隐藏正文；只在用户明确确认后写入当前存档专属世界书；自动切换全局挂载。
 */
export async function startMemory(shared) {
  'use strict';
  // 酒馆助手脚本运行于独立 iframe；界面必须挂载到父级酒馆页面。
  let hostWindow=window, hostDocument=document;
  try { if (window.parent && window.parent !== window && window.parent.document?.body) { hostWindow=window.parent; hostDocument=window.parent.document; } } catch(e) { console.warn('[拾忆] 无法访问父页面',e); }
  const KEY = '__shiyi_v03_instance__';
  if (hostWindow[KEY]?.destroy) hostWindow[KEY].destroy();
  const state = { globalSync:Promise.resolve(), timer:null, busy:false, open:false, queue:[], seen:new Set(), deferred:new Map(), stability:new Map(), current:'', root:null, style:null, disposed:false };
  hostWindow[KEY] = state;
  const $ = (s,root=hostDocument)=>root?.querySelector(s);
  const api = (name,...args)=>{ const fn=window[name] || window.TavernHelper?.[name] || hostWindow[name] || hostWindow.TavernHelper?.[name]; if(typeof fn!=='function') throw Error('缺少酒馆助手 API：'+name); return fn(...args); };
  const safe = s=>String(s??'').replace(/[<>"&]/g,c=>({'<':'&lt;','>':'&gt;','"':'&quot;','&':'&amp;'}[c]));
  const settingsDefault={start:'<摩羯纪要>',end:'</摩羯纪要>',keep:5,storyYear:''};
  const vars=()=>api('getVariables',{type:'chat'})||{};
  const saveVars=patch=>api('replaceVariables',{...vars(),shiyi_v01:patch},{type:'chat'});
  const blocked=key=>!!vars().shiyi_v01?.deletedKeys?.[key];
  const markDeleted=(keys)=>{const d=vars().shiyi_v01||{};saveVars({...d,deletedKeys:{...d.deletedKeys,...Object.fromEntries(keys.map(k=>[k,true]))}});};
  const changed=()=>state.onChange?.();
  const archive=()=>vars().shiyi_v01?.archiveUI||{};
  function archivePatch(patch){const d=vars().shiyi_v01||{};saveVars({...d,archiveUI:{...archive(),...patch}});}
  function snapshot(key,r,kind){const a=archive();const history={...a.history};history[key]=[{...r,savedAt:new Date().toISOString(),kind},...(history[key]||[])].slice(0,20);archivePatch({history});}
  function recycle(keys,rows){const a=archive(),trash={...a.trash};for(const k of keys)if(rows[k])trash[k]={...rows[k],deletedAt:new Date().toISOString()};archivePatch({trash});}
  function jump(floor){const el=hostDocument.querySelector(`#chat .mes[mesid="${Number(floor)}"]`);if(!el){notice('原楼层未加载，请先加载历史聊天');return false;}el.scrollIntoView({block:'center',behavior:'smooth'});return true;}

  const config=()=>({ ...settingsDefault,...(vars().shiyi_v01?.settings||{}) });
  const records=()=>vars().shiyi_v01?.records||{};
  const context=()=>hostWindow.SillyTavern?.getContext?.()||window.SillyTavern?.getContext?.()||{};
  const identity=()=>{
    const c=context();
    // chatId 由 ST 当前聊天文件提供；与角色 id 组合防止跨角色混淆。
    const chat=String(c.chatId??c.chatMetadata?.chat_id??'');
    const char=String(c.characterId??c.character_id??c.name2??'');
    return chat ? `${char}::${chat}` : '';
  };
  const chatLabel=()=>{
    const c=context(); const name=String(c.name2||c.characters?.[c.characterId]?.name||'角色').slice(0,24);
    const chat=String(c.chatId||'聊天').replace(/\.jsonl$/i,'').slice(0,28);
    const suffix=hash(identity()).slice(0,6);
    return `拾忆｜${name}｜${chat}｜${suffix}`;
  };
  function hash(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).toUpperCase().padStart(8,'0');}
  const notice=(msg)=>{console.info('[拾忆]',msg); const el=$('#shiyi-status',state.root);if(el)el.textContent=msg;};
  const error=(e)=>{console.error('[拾忆]',e);notice('操作失败：'+(e?.message||e));};
  function getMessages(){ const last=api('getLastMessageId');if(!Number.isInteger(last)||last < -1)throw Error('聊天尚未就绪');const list=last>=0?api('getChatMessages',`0-${last}`,{role:'assistant',hide_state:'all'}):[];if(!Array.isArray(list))throw Error('聊天读取失败');return list; }
  function extract(str){const {start,end}=config();if(!start||!end)return null;const a=str.lastIndexOf(start);if(a<0)return null;const b=str.indexOf(end,a+start.length);if(b<0)return null;return str.slice(a+start.length,b).trim();}
  // 剧情日期解析：支持年月日、月日、中文上午/中午/下午、起止范围和跨日。
  // 缺少年份时仅使用用户在设置中确认的剧情年份，不以现实年份填充。
  function storyYear(){const y=Number(config().storyYear||0);return y>=1000&&y<=9999?y:null;}
  function parseStoryTime(content){
    const raw=String(content||'').replace(/^[^：:\n]{0,24}[：:]\s*/,'').replace(/\s+/g,' ');
    const dateRe=/(?:(\d{4})\s*[年\/-])?\s*(\d{1,2})\s*[月\/-]\s*(\d{1,2})\s*日?/g;
    const matches=[...raw.matchAll(dateRe)];if(!matches.length)return null;
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
  // 全局记忆书：只替换拾忆前缀的书，保留其他全局世界书及其顺序。
  // 使用串行队列，避免扫描和确认归档同时修改全局列表。
  function syncGlobalBook(target, expectedChat){
    const run=async()=>{
      if(state.disposed||(expectedChat && identity()!==expectedChat)) return;
      const active=api('getGlobalWorldbookNames')||[];
      const keep=active.filter(x=>!String(x).startsWith('拾忆｜'));
      if(target){
        if(!(api('getWorldbookNames')||[]).includes(target)) throw Error('专属记忆世界书不存在：'+target);
        keep.push(target);
      }
      if(active.length===keep.length && active.every((x,i)=>x===keep[i])) return;
      // 写入前二次核对聊天，避免异步切档时把旧存档重新挂载。
      if(state.disposed||(expectedChat && identity()!==expectedChat)) return;
      await api('rebindGlobalWorldbooks',keep);
      notice(target?'已全局启用当前存档记忆：'+target:'已停用其他存档的拾忆记忆书');
    };
    const task=state.globalSync.then(run,run);
    state.globalSync=task.catch(e=>{error(e);});
    return task;
  }
  const characterKey=()=>{const c=context();return c.groupId!=null?'group:'+c.groupId:String(c.characters?.[c.characterId]?.avatar||c.characterId||c.name2||'');};
  const bookName=()=>`拾忆｜角色｜${hash(characterKey())}`;
  const check=id=>{if(state.disposed||identity()!==id)throw Error('聊天已切换，请重试');};
  const ordered=rows=>Object.entries(rows).sort((a,b)=>a[1].sourceMessage-b[1].sourceMessage);
  const numbered=rows=>Object.fromEntries(ordered(rows).map(([k,r],i)=>[k,{...r,title:!r.title||/^剧情摘要\s*\d+$/.test(r.title)?`剧情摘要 ${i+1}`:r.title}]));
  const formatRows=rows=>Object.values(numbered(rows)).map(r=>`【${r.storyTime||'日期未识别'}｜${r.title}】\n${r.content}`).join('\n\n');
  let writes=Promise.resolve();
  function serial(fn){const task=writes.then(fn,fn);writes=task.catch(()=>{});return task;}
  async function ensureWorldbook(id,create=false){
    check(id);const data=vars().shiyi_v01||{}, name=bookName(), owner=characterKey();
    const legacy=data.book&&data.book!==name?data.book:api('getChatWorldbookName','current');
    const old=legacy&&legacy!==name&&legacy.startsWith('拾忆｜')?legacy:null;
    let rows={...(data.records||{})};
    if(old&&data.archiveVersion!==2){
      const entries=await api('getWorldbook',old);check(id);
      rows={};for(const e of entries.filter(e=>e.extra?.shiyi_key)){const k=e.extra.shiyi_key,r=data.records?.[k]||{};rows[k]={...r,title:r.title||e.name,content:e.content,sourceMessage:r.sourceMessage??e.extra.shiyi_message_id,storyTime:parseStoryTime(e.content),sourceHash:k.split(':').slice(1).join(':')};}
    }
    if(!(api('getWorldbookNames')||[]).includes(name)){
      if(data.archiveVersion===2){recycle(Object.keys(rows),rows);markDeleted(Object.keys(rows));rows={};saveVars({...vars().shiyi_v01,records:rows});changed();}
      if(!create&&!Object.keys(rows).length)return null;
      check(id);if(!await api('createWorldbook',name,[]))throw Error('世界书创建失败');
    }
    check(id);let entries=await api('getWorldbook',name);check(id);
    if(entries.some(e=>e.extra?.shiyi_owner!==owner))throw Error('角色世界书标识冲突，请检查');
    let entry=entries.find(e=>e.extra?.shiyi_chat===id);
    if(!entry&&data.archiveVersion===2&&Object.keys(rows).length){recycle(Object.keys(rows),rows);markDeleted(Object.keys(rows));rows={};saveVars({...vars().shiyi_v01,records:rows});changed();}
    if(!entry&&(create||(data.archiveVersion!==2&&Object.keys(rows).length))){
      const result=await api('createWorldbookEntries',name,[{name:chatLabel(),content:formatRows(rows),enabled:false,strategy:{type:'constant',keys:[]},probability:100,extra:{shiyi_owner:owner,shiyi_chat:id,shiyi_rows:rows}}]);
      entry=result?.new_entries?.[0];if(!entry)throw Error('创建聊天条目失败');
    }
    check(id);
    if(entry&& !String(entry.content||'').trim()&&Object.keys(entry.extra?.shiyi_rows||{}).length){const keys=Object.keys(entry.extra.shiyi_rows);markDeleted(keys);await api('updateWorldbookWith',name,all=>all.map(e=>e.uid===entry.uid?{...e,extra:{...e.extra,shiyi_rows:{}}}:e));check(id);entry={...entry,extra:{...entry.extra,shiyi_rows:{}}};}
    if(entry){const authoritative=entry.extra?.shiyi_rows||rows;const removed=Object.keys(rows).filter(k=>!Object.prototype.hasOwnProperty.call(authoritative,k));if(removed.length){recycle(removed,rows);markDeleted(removed);}rows=authoritative;rows=Object.fromEntries(Object.entries(rows).map(([k,r])=>[k,{...r,uid:entry.uid,book:name}]));}
    if(entry||data.archiveVersion===2){const latest=vars().shiyi_v01||{};if(JSON.stringify(latest.records||{})!==JSON.stringify(rows)||latest.archiveVersion!==2){saveVars({...latest,book:name,archiveVersion:2,records:rows});changed();}}
    if(old&&api('getChatWorldbookName','current')===old){check(id);await api('rebindChatWorldbook','current',null);}
    check(id);
    if(entries.some(e=>e.enabled!== (e.extra?.shiyi_chat===id))||entry&&!entry.enabled){await api('updateWorldbookWith',name,all=>all.map(e=>({...e,enabled:e.extra?.shiyi_chat===id})));}
    check(id);return name;
  }
  async function writeRows(id,rows){
    check(id);const book=await ensureWorldbook(id,true);check(id);
    const entries=await api('getWorldbook',book);check(id);const entry=entries.find(e=>e.extra?.shiyi_chat===id);if(!entry)throw Error('聊天条目不存在');
    rows=Object.fromEntries(Object.entries(numbered(rows)).map(([k,r])=>[k,{...r,uid:entry.uid,book}]));
    await api('updateWorldbookWith',book,all=>all.map(e=>e.uid===entry.uid?{...e,content:formatRows(rows),extra:{...e.extra,shiyi_rows:rows}}:e));
    check(id);saveVars({...vars().shiyi_v01,book,archiveVersion:2,records:rows});changed();
  }
  async function addMemory(candidate,title,content,restore=false){return serial(async()=>{
    const id=candidate.chat;check(id);if(blocked(candidate.key)&&!restore)throw Error('该版本摘要已删除');const source=getMessages().find(m=>m.message_id===candidate.id);
    if(!source||hash(String(source.message??''))!==candidate.key.split(':').slice(1).join(':'))throw Error('原始正文已改变，请重新审核');
    await ensureWorldbook(id,true);check(id);const rows={...records()};
    if(rows[candidate.key])return notice('这条摘要已经归档');
    for(const [k,r] of Object.entries(rows))if(r.sourceMessage===candidate.id)delete rows[k];
    rows[candidate.key]={title,content,sourceMessage:candidate.id,sourceHash:candidate.key.split(':').slice(1).join(':'),storyTime:parseStoryTime(content),createdAt:new Date().toISOString()};
    await writeRows(id,rows);if(restore){const d=vars().shiyi_v01||{},deletedKeys={...d.deletedKeys};delete deletedKeys[candidate.key];saveVars({...d,deletedKeys});state.deferred.delete(candidate.id);}await syncGlobalBook(bookName(),id);state.seen.add(candidate.key);notice('已更新当前聊天记忆');
  });}
  async function review(candidate){
    if(state.disposed||identity()!==candidate.chat||blocked(candidate.key))return;
    const n=Object.values(records()).filter(r=>r.sourceMessage<candidate.id).length+1;
    const wrap=hostDocument.createElement('div');
    wrap.innerHTML=`<p class="shiyi-muted">来源：第 ${candidate.id} 楼 · 注入前请核对正史</p><label>记忆标题<input id="shiyi-title" maxlength="40" value="剧情摘要 ${n}"></label><label>记忆内容<textarea id="shiyi-content" rows="10"></textarea></label>`;
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
  async function verifyGlobal(){const id=identity();if(!id)return;await serial(async()=>{check(id);getMessages();const target=await ensureWorldbook(id,false);check(id);const messages=getMessages();
    if(Array.isArray(messages)){const current=new Map(messages.map(m=>[m.message_id,hash(String(m.message??''))]));const rows={...records()};const stale=Object.keys(rows).filter(k=>{const r=rows[k];return Number.isInteger(r.sourceMessage)&&(!current.has(r.sourceMessage)||current.get(r.sourceMessage)!==k.split(':').slice(1).join(':'));});if(stale.length){markDeleted(stale);for(const k of stale)delete rows[k];await writeRows(id,rows);notice('已撤销 '+stale.length+' 条失效记忆');}}
    await syncGlobalBook(target,id);});}
  async function scan(){
    if(state.busy||state.disposed)return;
    const id=identity();if(!id)return;
    if(id!==state.current){state.closeModal?.();state.current=id;state.seen.clear();state.deferred.clear();state.stability.clear();state.queue=[];}
    state.busy=true;try{await verifyGlobal();}catch(e){error(e);return;}finally{state.busy=false;}
    if(id!==identity())return;
    if(shared?.flags?.memory===false||state.open)return;
    state.busy=true;
    try{
      const existing=records();
      const messages=getMessages();
      const live=new Map(messages.map(m=>[m.message_id,`${m.message_id}:${hash(String(m.message??''))}`]));
      state.queue=state.queue.filter(q=>q.chat===id&&live.get(q.id)===q.key&&!blocked(q.key));
      for(const [floor,q] of state.deferred)if(q.chat!==id||live.get(floor)!==q.key||blocked(q.key))state.deferred.delete(floor);
      for(const floor of state.stability.keys())if(!live.has(floor))state.stability.delete(floor);
      for(const m of messages){
        const idNum=m.message_id;
        const text=String(m.message??'');
        const content=extract(text);if(!content)continue;
        // 流式输出可能提前生成闭合标签：同一楼层全文连续稳定 8 秒才审核。
        const digest=hash(text), now=Date.now();
        const prev=state.stability.get(idNum);
        if(!prev||prev.digest!==digest){state.stability.set(idNum,{digest,since:now});continue;}
        if(now-prev.since<8000)continue;
        const key=`${idNum}:${digest}`;
        // 稍后处理以楼层为单位抑制；避免流式输出造成不同哈希重复弹窗。
        if(blocked(key)||state.deferred.has(idNum)||existing[key]||state.seen.has(key)||state.queue.some(x=>x.id===idNum))continue;
        // 已归档的同一楼层不再自动审核后续文本变化。

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
      await verifyGlobal();check(chat);const saved=records();
      candidates=getMessages().map(m=>{
        const id=m.message_id, message=String(m.message??''), content=extract(message);
        return content?{id,key:`${id}:${hash(message)}`,content,chat}:null;
      }).filter(x=>x&&!saved[x.key]).sort((a,b)=>a.id-b.id);
    }catch(e){return error(e);}
    if(!candidates.length)return notice('未发现尚未归档的历史摘要');
    const box=hostDocument.createElement('div');
    box.innerHTML=`<p class="shiyi-muted">共发现 ${candidates.length} 条未归档摘要。包含已删除或拒绝的摘要（默认不选中）。可逐条勾选、修改标题和正文；确认后按楼层从小到大写入。此操作不会隐藏旧正文。</p><button type="button" id="shiyi-all">全选（含恢复）</button><button type="button" id="shiyi-none">全不选</button><div id="shiyi-history-list"></div>`;
    const list=$('#shiyi-history-list',box);
    candidates.forEach((c,i)=>{
      const row=hostDocument.createElement('section');row.className='shiyi-history-item';
      row.innerHTML=`<label class="shiyi-history-head"><input type="checkbox" class="shiyi-h-check" checked> 第 ${c.id} 楼 ${blocked(c.key)?'· 已删除/拒绝':'· 未导入'}</label><label>标题<input class="shiyi-h-title" maxlength="40"></label><label>摘要<textarea class="shiyi-h-text" rows="4"></textarea></label>`;
      $('.shiyi-h-check',row).checked=!blocked(c.key);
      $('.shiyi-h-title',row).value=`剧情摘要 ${i+1}`;
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
        if(!records()[item.candidate.key])await addMemory(item.candidate,item.title||`剧情摘要 1`,item.content,true);
        state.queue=state.queue.filter(q=>q.key!==item.candidate.key);
        ok++;
      }catch(e){failed++;console.error('[拾忆] 批量导入失败：第'+item.candidate.id+'楼',e);break;}
    }
    notice(`历史导入：成功 ${ok} 条${failed?'；失败 1 条，请检查控制台后重试':''}`);
  }
  // 归档必须由用户明确点击确认。只处理已核验来源的连续摘要覆盖段，保留近期消息。
  // 默认不开启自动隐藏；可在此手动归档并恢复。setChatMessages 的实际上下文行为需酒馆端验证。
  function archivePlan(){
    const all=(api('getChatMessages',`0-${api('getLastMessageId')}`,{hide_state:'all'})||[]).sort((a,b)=>a.message_id-b.message_id);
    const last=api('getLastMessageId'), keep=Math.max(1,Number(config().keep)||5);
    const protectedFrom=Math.max(0,last-keep*2+1);
    const rec=Object.entries(records()).map(([key,r])=>({...r,key})).filter(r=>Number.isInteger(r.sourceMessage)).sort((a,b)=>a.sourceMessage-b.sourceMessage);
    const confirmed=[];
    for(const r of rec){
      const source=all.find(m=>m.message_id===r.sourceMessage);
      if(!source||hash(String(source.message??''))!==r.key.split(':').slice(1).join(':'))break;
      if(r.sourceMessage>=protectedFrom)break;
      confirmed.push(r);
    }
    // Only prefix up to last verified summary, and only if all detected summaries in that prefix were confirmed.
    const max=confirmed.length?confirmed.at(-1).sourceMessage:-1;
    const confirmedIds=new Set(confirmed.map(r=>r.sourceMessage));
    const unreviewed=all.some(m=>m.message_id<=max&&extract(String(m.message??''))&&!confirmedIds.has(m.message_id));
    const eligible=unreviewed?[]:all.filter(m=>m.message_id<=max&&m.message_id<protectedFrom&&m.is_hidden!==true);
    return {all,eligible,max,protectedFrom,confirmed:confirmed.length,unreviewed};
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
        const latest=archivePlan();
        if(latest.unreviewed||latest.eligible.map(m=>m.message_id).join(',')!==plan.eligible.map(m=>m.message_id).join(','))throw Error('消息已变化，请重新预览');
        const ids=latest.eligible.map(m=>m.message_id);
        // 记录本插件实际隐藏的消息，恢复时不触碰原本隐藏的消息。
        const d=vars().shiyi_v01||{};const old=Array.isArray(d.hiddenByShiyi)?d.hiddenByShiyi:[];
        saveVars({...d,hiddenByShiyi:[...new Set([...old,...ids])]});
        for(const id of ids)await api('setChatMessages',[{message_id:id,is_hidden:true}],{refresh:'none'});
        notice(`已隐藏 ${ids.length} 条旧消息；原文未删除，可在归档面板恢复`);
      }catch(e){error(e);}
    }else if(choice==='restore'){
      try{
        const d=vars().shiyi_v01||{};const ids=Array.isArray(d.hiddenByShiyi)?d.hiddenByShiyi:[];
        if(!ids.length)return notice('没有由拾忆隐藏的消息');
        if(!hostWindow.confirm(`恢复拾忆隐藏的 ${ids.length} 条消息？`))return;
        for(const id of ids)await api('setChatMessages',[{message_id:id,is_hidden:false}],{refresh:'none'});
        saveVars({...d,hiddenByShiyi:[]});notice(`已恢复 ${ids.length} 条消息`);
      }catch(e){error(e);}
    }
  }
  async function timeline(){
    if(state.open)return;
    const rows=Object.values(numbered(records())).filter(r=>Number.isInteger(r.sourceMessage)).sort((a,b)=>a.sourceMessage-b.sourceMessage);
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
    if(choice==='save'){if(!content.value.trim())throw Error('摘要不能为空');await serial(async()=>{check(id);await ensureWorldbook(id,false);check(id);const rows={...records()};if(!rows[key])throw Error('摘要不存在');snapshot(key,rows[key],'编辑前');rows[key]={...rows[key],title:title.value.trim()||r.title,content:content.value,storyTime:parseStoryTime(content.value)};await writeRows(id,rows);});notice('修改成功');}
    if(identity()===id&&!state.open)await manage();
    }catch(e){error(e);}
  }
  async function manage(){
    if(state.open)return;
    const id=identity();if(!id)return;const container=hostDocument.createElement('div');container.className='shiyi-manage';
    const search=hostDocument.createElement('input');search.placeholder='搜索标题、人物、地点、正文';
    const filter=hostDocument.createElement('select');for(const [v,t] of [['all','全部记忆'],['star','星标'],['trash','回收站']]){const o=hostDocument.createElement('option');o.value=v;o.textContent=t;filter.append(o);}
    const stats=hostDocument.createElement('p'),list=hostDocument.createElement('div'),more=hostDocument.createElement('button'),batch=hostDocument.createElement('button');more.textContent='加载更多';batch.textContent='删除选中';let limit=40;const selected=new Set();
    const button=(label,fn)=>{const b=hostDocument.createElement('button');b.textContent=label;b.onclick=async()=>{try{check(id);await fn();}catch(e){error(e);hostWindow.alert(e.message);}};return b;};
    async function remove(keys){if(!keys.length||!hostWindow.confirm(`删除 ${keys.length} 条摘要？可在回收站恢复。`))return;await serial(async()=>{check(id);await ensureWorldbook(id,false);check(id);const rows={...records()};recycle(keys,rows);markDeleted(keys);for(const k of keys){delete rows[k];state.seen.add(k);}await writeRows(id,rows);});selected.clear();render();}
    async function restore(k,r){const m=getMessages().find(m=>m.message_id===r.sourceMessage);if(!m||`${m.message_id}:${hash(String(m.message??''))}`!==k)throw Error('原正文已变化，不能恢复旧正史');await addMemory({chat:id,id:r.sourceMessage,key:k},r.title,r.content,true);check(id);const trash={...archive().trash};delete trash[k];archivePatch({trash});render();}
    function render(){if(identity()!==id)return;list.replaceChildren();const a=archive(),meta=a.meta||{},trash=filter.value==='trash';const rows=ordered(trash?a.trash||{}:numbered(records()));const q=search.value.trim().toLowerCase();const matches=rows.filter(([k,r])=>(filter.value!=='star'||meta[k]?.star)&&`${r.title} ${r.content} ${meta[k]?.chapter||''}`.toLowerCase().includes(q));stats.textContent=`有效 ${Object.keys(records()).length} · 回收站 ${Object.keys(a.trash||{}).length} · 匹配 ${matches.length}`;batch.hidden=trash;more.hidden=matches.length<=limit;
      for(const [k,r] of matches.slice(0,limit)){const row=hostDocument.createElement('div');row.className='shiyi-history-item';const title=hostDocument.createElement('strong');title.textContent=`${meta[k]?.star?'★ ':''}${r.title} · 第${r.sourceMessage}楼`;const text=hostDocument.createElement('p');text.textContent=r.content;const details=hostDocument.createElement('details');const summary=hostDocument.createElement('summary');summary.textContent='查看完整摘要';details.append(summary,text);row.append(title,details);
        if(trash){row.append(button('恢复',()=>restore(k,r)));}else{const cb=hostDocument.createElement('input');cb.type='checkbox';cb.checked=selected.has(k);cb.style.width='auto';cb.onchange=()=>cb.checked?selected.add(k):selected.delete(k);row.prepend(cb);row.append(button(meta[k]?.star?'取消星标':'星标',()=>{archivePatch({meta:{...archive().meta,[k]:{...meta[k],star:!meta[k]?.star}}});changed();render();}),button('章节',()=>{const chapter=hostWindow.prompt('章节名称（留空取消归类）',meta[k]?.chapter||'');if(chapter!==null){archivePatch({meta:{...archive().meta,[k]:{...meta[k],chapter:chapter.trim()}}});changed();render();}}),button('溯源',()=>{if(jump(r.sourceMessage))state.closeModal?.();else hostWindow.alert('请先加载该历史楼层');}),button('编辑',()=>{state.closeModal?.();return editMemory(id,k);}),button('历史',async()=>{state.closeModal?.();const box=hostDocument.createElement('div');for(const v of archive().history?.[k]||[]){const p=hostDocument.createElement('p');p.textContent=v.savedAt+' · '+v.title+'\n'+v.content;box.append(p,button('回退此版本',async()=>{await serial(async()=>{check(id);await ensureWorldbook(id,false);check(id);const rows={...records()};if(!rows[k])throw Error('记忆已失效');snapshot(k,rows[k],'回退前');rows[k]={...rows[k],title:v.title,content:v.content,storyTime:parseStoryTime(v.content)};await writeRows(id,rows);});state.closeModal?.();}));}if(!box.children.length)box.textContent='暂无历史版本';await modal('修改历史',box,[{label:'返回',value:'close'}]);if(identity()===id&&!state.open)await manage();}),button('删除',()=>remove([k])));if(meta[k]?.chapter){const p=hostDocument.createElement('p');p.textContent='章节：'+meta[k].chapter;row.append(p);}}
        list.append(row);}}
    search.oninput=()=>{limit=40;selected.clear();render();};filter.onchange=()=>{limit=40;selected.clear();render();};more.onclick=()=>{limit+=40;render();};batch.onclick=()=>remove([...selected]).catch(error);container.append(search,filter,stats,batch,list,more);render();await modal('拾忆 · 剧情档案',container,[{label:'关闭',value:'close'}]);
  }
  async function settings(){
    if(state.open)return;
    const cfg=config();const el=hostDocument.createElement('div');
    el.innerHTML='<label>摘要开始标签<input id="shiyi-start"></label><label>摘要结束标签<input id="shiyi-end"></label><label>剧情年份（可选，例：2026；用于补全摘要缺失的年份及星期）<input id="shiyi-year" inputmode="numeric" maxlength="4" placeholder="不确定请留空"></label><p class="shiyi-muted">第一版只支持起止标签。默认不自动隐藏旧正文；手动归档需再次确认。</p>';
    $('#shiyi-start',el).value=cfg.start;$('#shiyi-end',el).value=cfg.end;$('#shiyi-year',el).value=cfg.storyYear||'';
    const result=await modal('拾忆 · 设置',el,[{label:'取消',value:false},{label:'保存',value:true,kind:'primary'}]);
    if(result){const start=$('#shiyi-start',el).value.trim(),end=$('#shiyi-end',el).value.trim();if(!start||!end)return notice('标签不能为空');const d=vars().shiyi_v01||{};const storyYear=$('#shiyi-year',el).value.trim();if(storyYear&&!/^[1-9]\d{3}$/.test(storyYear))return notice('剧情年份需为四位数字，或留空');saveVars({...d,settings:{...cfg,start,end,storyYear}});notice('设置已保存到当前聊天');}
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
    const dossierButton=hostDocument.createElement('button');dossierButton.textContent='留痕档案';$('#shiyi-settings',state.root).before(dossierButton);dossierButton.onclick=()=>{if(!state.open)createDossier({D:hostDocument,modal,identity,check,archive,archivePatch,records,getMessages,hash,serial,jump,notice}).open().catch(error);};
  }
  state.destroy=()=>{state.disposed=true;state.closeModal?.();clearInterval(state.timer);state.root?.remove();state.style?.remove();};
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
  // 轮询比依赖某个版本的事件常量更稳健。仅检查已完成且带闭合标签的消息。
  state.validate=()=>verifyGlobal();state.tick=()=>scan().catch(error); state.pending=()=>state.queue.length+state.deferred.size;
  scan().catch(error);
  console.info('[拾忆] v0.5 已加载；自动切换拾忆全局世界书，不修改其他全局世界书，仅在手动确认后隐藏正文，可恢复。');

state.recallPeople=()=> (archive().dossier||[]).filter(r=>r.kind==='人物').map(r=>({id:r.id,title:r.title,sources:r.sources||[]}));
state.timelineRows=async()=>{const live=new Map(getMessages().map(m=>[m.message_id,hash(String(m.message??''))]));return Object.values(numbered(records())).filter(r=>Number.isInteger(r.sourceMessage)&&live.get(r.sourceMessage)===r.sourceHash).map(r=>({floor:r.sourceMessage,title:r.title,content:r.content,when:r.storyTime||parseStoryTime(r.content)||'日期未识别',sourceHash:r.sourceHash,chapter:archive().meta?.[`${r.sourceMessage}:${r.sourceHash}`]?.chapter||'',star:!!archive().meta?.[`${r.sourceMessage}:${r.sourceHash}`]?.star}));};
state.jump=jump;
state.backup=async()=>{const id=identity();if(!id)return null;const data=JSON.parse(JSON.stringify(vars().shiyi_v01||{}));const entries=data.book?await api('getWorldbook',data.book):[];if(id!==identity())throw Error('聊天已切换');return {scope:id,data,entries};};
return state;
}
