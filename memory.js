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
  const saveVars=patch=>api('insertOrAssignVariables',{shiyi_v01:patch},{type:'chat'});
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
  function getMessages(){ if(shared?.messages)return shared.messages; const last=api('getLastMessageId');return last>=0?api('getChatMessages',`0-${last}`,{role:'assistant',hide_state:'all'}):[]; }
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
      const finish=(v)=>{overlay.remove();state.open=false;resolve(v);};
      buttons.forEach(({label,value,kind})=>{const b=hostDocument.createElement('button');b.textContent=label;if(kind)b.className=kind;b.onclick=()=>finish(value);$('.shiyi-actions',overlay).append(b);});
      hostDocument.body.append(overlay);state.open=true;
    });
  }
  // 全局记忆书：只替换拾忆前缀的书，保留其他全局世界书及其顺序。
  // 使用串行队列，避免扫描和确认归档同时修改全局列表。
  function syncGlobalBook(target, expectedChat){
    const run=async()=>{
      if(expectedChat && identity()!==expectedChat) return;
      const active=api('getGlobalWorldbookNames')||[];
      const keep=active.filter(x=>!String(x).startsWith('拾忆｜'));
      if(target){
        if(!(api('getWorldbookNames')||[]).includes(target)) throw Error('专属记忆世界书不存在：'+target);
        keep.push(target);
      }
      if(active.length===keep.length && active.every((x,i)=>x===keep[i])) return;
      // 写入前二次核对聊天，避免异步切档时把旧存档重新挂载。
      if(expectedChat && identity()!==expectedChat) return;
      await api('rebindGlobalWorldbooks',keep);
      notice(target?'已全局启用当前存档记忆：'+target:'已停用其他存档的拾忆记忆书');
    };
    const task=state.globalSync.then(run,run);
    state.globalSync=task.catch(e=>{error(e);});
    return task;
  }
  async function ensureWorldbook(){
    const id=identity();if(!id)throw Error('无法读取聊天存档标识，请先打开实际聊天');
    const data=vars().shiyi_v01||{};
    let name=data.book;
    const bound=api('getChatWorldbookName','current');
    if(name){
      if(!(api('getWorldbookNames')||[]).includes(name))throw Error('原专属世界书不存在，请手动检查');
      // v0.4 已绑定的聊天世界书不解除，避免破坏历史存档；同时全局挂载。
      await syncGlobalBook(name,id);
      return name;
    }
    if(bound && bound.startsWith('拾忆｜')){
      saveVars({...data,book:bound});
      await syncGlobalBook(bound,id);
      return bound;
    }
    // 不占用聊天世界书绑定槽位，保护已有的非拾忆聊天世界书。
    name=chatLabel();
    if((api('getWorldbookNames')||[]).includes(name))name+='｜'+Date.now().toString(36).slice(-5);
    const made=await api('createWorldbook',name,[]);
    if(!made)throw Error('世界书创建失败');
    saveVars({...data,book:name});
    await syncGlobalBook(name,id);
    return name;
  }
  async function addMemory(candidate,title,content){
    if(identity()!==candidate.chat)throw Error('聊天已切换，请返回原聊天再审核');
    const source=(getMessages()||[]).find(m=>m.message_id===candidate.id);
    if(!source||hash(String(source.message??''))!==candidate.key.split(':').slice(1).join(':'))throw Error('原始正文已改变，请重新检测并审核摘要');
    const data=vars().shiyi_v01||{};
    if(data.records?.[candidate.key])return notice('这条摘要已经归档');
    const book=await ensureWorldbook();
    const existing=await api('getWorldbook',book);
    const n=existing.filter(x=>x.name?.startsWith('记忆')).length+1;
    const entry={name:`记忆${String(n).padStart(3,'0')}｜${title.slice(0,40)}`,content:content.trim(),enabled:true,strategy:{type:'constant',keys:[]},probability:100,extra:{shiyi_key:candidate.key,shiyi_message_id:candidate.id}};
    const result=await api('createWorldbookEntries',book,[entry]);
    const added=result?.new_entries?.[0];if(!added||!Number.isInteger(added.uid))throw Error('世界书写入返回异常；请检查是否已创建条目，避免重复确认');
    const updated=vars().shiyi_v01||{};
    const all={...(updated.records||{})};all[candidate.key]={uid:added.uid,book,title,content,sourceMessage:candidate.id,sourceHash:candidate.key.split(':').slice(1).join(':'),storyTime:parseStoryTime(content),createdAt:new Date().toISOString()};
    saveVars({...updated,records:all});
    state.seen.add(candidate.key);notice('已归档到：'+book);
  }
  async function review(candidate){
    if(state.disposed||identity()!==candidate.chat)return;
    const wrap=hostDocument.createElement('div');
    wrap.innerHTML=`<p class="shiyi-muted">来源：第 ${candidate.id} 楼 · 注入前请核对正史</p><label>记忆标题<input id="shiyi-title" maxlength="40" value="剧情摘要 ${candidate.id}"></label><label>记忆内容<textarea id="shiyi-content" rows="10"></textarea></label>`;
    $('#shiyi-content',wrap).value=candidate.content;
    const choice=await modal('拾忆 · 待审核记忆',wrap,[{label:'拒绝',value:'reject'},{label:'稍后处理',value:'later'},{label:'确认注入',value:'confirm',kind:'primary'}]);
    if(choice==='confirm'){
      const title=$('#shiyi-title',wrap).value.trim()||`剧情摘要 ${candidate.id}`;
      const content=$('#shiyi-content',wrap).value.trim();
      if(!content){notice('摘要为空，未注入');return;}
      try{await addMemory(candidate,title,content);}catch(e){error(e);state.queue.unshift(candidate);}
    } else if(choice==='reject'){state.deferred.set(candidate.id,null);state.seen.add(candidate.key);notice('已拒绝，本次运行不再提示该摘要');}
    else {state.deferred.set(candidate.id,candidate);state.seen.add(candidate.key);notice('已暂缓：本楼层不会自动重复弹窗，可点击「待审核」手动处理');}
  }
  async function verifyGlobal(){
    const id=identity();if(!id)return;
    const target=vars().shiyi_v01?.book || null;
    const active=api('getGlobalWorldbookNames')||[];
    const ours=active.filter(n=>String(n).startsWith('拾忆｜'));
    if(ours.length!==(target?1:0)||(target&&ours[0]!==target))await syncGlobalBook(target,id);
  }
  async function scan(){
    if(state.busy||state.open||state.disposed)return;
    const id=identity();if(!id){notice('界面已启动；尚未识别聊天，打开角色卡聊天后重试');return;}
    if(id!==state.current){state.current=id;state.seen.clear();state.deferred.clear();state.stability.clear();state.queue=[];try{
      const legacy=api('getChatWorldbookName','current');
      const book=vars().shiyi_v01?.book || (legacy?.startsWith('拾忆｜')?legacy:null);
      if(book){await syncGlobalBook(book,id);notice('已切换全局拾忆世界书：'+book);}
      else {await syncGlobalBook(null,id);notice('当前聊天尚无拾忆世界书，首次确认时自动创建');}
    }catch(e){error(e);}}
    try{await verifyGlobal();}catch(e){error(e);}
    if(shared?.flags?.memory===false)return;
    state.busy=true;
    try{
      const existing=records();
      const messages=getMessages();
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
        if(state.deferred.has(idNum)||existing[key]||state.seen.has(key)||state.queue.some(x=>x.id===idNum))continue;
        // 已归档的同一楼层不再自动审核后续文本变化。
        if(Object.values(existing).some(r=>r.sourceMessage===idNum))continue;
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
      const saved=records();
      candidates=getMessages().map(m=>{
        const id=m.message_id, message=String(m.message??''), content=extract(message);
        return content?{id,key:`${id}:${hash(message)}`,content,chat}:null;
      }).filter(x=>x&&!saved[x.key]).sort((a,b)=>a.id-b.id);
    }catch(e){return error(e);}
    if(!candidates.length)return notice('未发现尚未归档的历史摘要');
    const box=hostDocument.createElement('div');
    box.innerHTML=`<p class="shiyi-muted">共发现 ${candidates.length} 条未归档摘要。可逐条取消勾选、修改标题和正文；确认后按楼层从小到大写入。此操作不会隐藏旧正文。</p><div id="shiyi-history-list"></div>`;
    const list=$('#shiyi-history-list',box);
    candidates.forEach((c,i)=>{
      const row=hostDocument.createElement('section');row.className='shiyi-history-item';
      row.innerHTML=`<label class="shiyi-history-head"><input type="checkbox" class="shiyi-h-check" checked> 第 ${c.id} 楼</label><label>标题<input class="shiyi-h-title" maxlength="40"></label><label>摘要<textarea class="shiyi-h-text" rows="4"></textarea></label>`;
      $('.shiyi-h-title',row).value=`剧情摘要 ${c.id}`;
      $('.shiyi-h-text',row).value=c.content;
      list.append(row);
    });
    const choice=await modal('拾忆 · 历史摘要导入',box,[{label:'取消',value:'cancel'},{label:'确认导入所选',value:'confirm',kind:'primary'}]);
    if(choice!=='confirm')return;
    const selected=[...list.children].map((row,i)=>({candidate:candidates[i],enabled:$('.shiyi-h-check',row).checked,title:$('.shiyi-h-title',row).value.trim(),content:$('.shiyi-h-text',row).value.trim()})).filter(x=>x.enabled&&x.content);
    if(!selected.length)return notice('没有选中有效摘要');
    let ok=0,failed=0;
    for(const item of selected){
      if(identity()!==chat){notice(`聊天已切换，已成功导入 ${ok} 条，停止后续写入`);return;}
      try{
        if(!records()[item.candidate.key])await addMemory(item.candidate,item.title||`剧情摘要 ${item.candidate.id}`,item.content);
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
    const rows=Object.values(records()).filter(r=>Number.isInteger(r.sourceMessage)).sort((a,b)=>a.sourceMessage-b.sourceMessage);
    const box=hostDocument.createElement('div');
    if(!rows.length)box.textContent='暂无记忆';
    for(const r of rows){const item=hostDocument.createElement('div');item.className='shiyi-history-item';
      const when=parseStoryTime(r.content)||r.storyTime||'日期未识别（请检查摘要格式）';
      item.textContent=`第${r.sourceMessage}楼 · ${when}\n${r.title||'剧情摘要'}：${String(r.content||'').slice(0,160)}`;
      item.style.whiteSpace='pre-wrap';box.append(item);
    }
    await modal('拾忆 · 剧情时间轴（按楼层）',box,[{label:'关闭',value:'close'}]);
  }
  async function manage(){
    if(state.open)return;
    const book=vars().shiyi_v01?.book;
    if(!book){notice('当前聊天还没有归档记忆');return;}
    let entries;try{entries=(await api('getWorldbook',book)).filter(e=>e.extra?.shiyi_key);}catch(e){error(e);return;}
    const container=hostDocument.createElement('div');
    container.className='shiyi-manage';
    if(!entries.length)container.textContent='暂无已归档记忆';
    for(const entry of entries){
      const row=hostDocument.createElement('div');row.className='shiyi-row';
      const label=hostDocument.createElement('span');label.textContent=entry.name;
      const edit=hostDocument.createElement('button');edit.textContent='编辑';
      edit.onclick=async()=>{const content=hostWindow.prompt('修改记忆内容（取消则不保存）',entry.content);if(content===null)return;try{await api('updateWorldbookWith',book,all=>all.map(x=>x.uid===entry.uid?{...x,content}:x));notice('修改成功');}catch(e){error(e);}};
      const del=hostDocument.createElement('button');del.textContent='删除';
      del.onclick=async()=>{if(!hostWindow.confirm(`确定删除「${entry.name}」吗？此操作不删除原始聊天。`))return;try{await api('deleteWorldbookEntries',book,x=>x.uid===entry.uid);const d=vars().shiyi_v01||{};const rec={...(d.records||{})};for(const [k,v] of Object.entries(rec))if(v.uid===entry.uid&&v.book===book)delete rec[k];saveVars({...d,records:rec});row.remove();notice('记忆已删除');}catch(e){error(e);}};
      const source=hostDocument.createElement('button');source.textContent='溯源';
      source.onclick=async()=>{
        const r=Object.entries(records()).find(([k,v])=>v.uid===entry.uid&&v.book===book);
        const sourceId=r?.[1]?.sourceMessage??entry.extra?.shiyi_message_id;
        let m;try{m=getMessages().find(x=>x.message_id===sourceId);}catch(e){return error(e);}
        const box=hostDocument.createElement('div');const text=String(m?.message??'原始楼层已不存在');
        const originalHash=r?.[0]?.split(':').slice(1).join(':');
        const changed=originalHash&&m&&hash(text)!==originalHash;
        box.innerHTML=`<p>来源：第 ${safe(sourceId)} 楼 ${changed?'⚠ 原文已修改，请重新审核':'· 原文对照'}</p>`;
        const pre=hostDocument.createElement('textarea');pre.readOnly=true;pre.rows=13;pre.value=text;box.append(pre);
        await modal('拾忆 · 记忆溯源',box,[{label:'关闭',value:'close'}]);
      };
      row.append(label,source,edit,del);container.append(row);
    }
    await modal('拾忆 · 记忆管理',container,[{label:'关闭',value:'close'}]);
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
    state.root=hostDocument.createElement('div');state.root.id='shiyi-dock';state.root.classList.add('shiyi-collapsed');state.root.innerHTML='<button type="button" class="shiyi-orb" id="shiyi-expand" aria-label="展开拾忆面板" title="展开拾忆">✦</button><div class="shiyi-dock-content"><button type="button" class="shiyi-collapse" id="shiyi-collapse" aria-label="收起拾忆面板" title="收起">−</button><div class="shiyi-brand">拾忆 · v0.7.1</div><div><button id="shiyi-scan">检测摘要</button><button id="shiyi-import">导入历史</button><button id="shiyi-archive">正文归档</button><button id="shiyi-timeline">时间轴</button><button id="shiyi-review">待审核</button><button id="shiyi-manage">管理</button><button id="shiyi-settings">设置</button></div><div id="shiyi-status">等待聊天加载</div></div>';
    hostDocument.body.append(state.root);
    const setCollapsed=(collapsed)=>{state.root.classList.toggle('shiyi-collapsed',collapsed);$('#shiyi-expand',state.root).setAttribute('aria-expanded',String(!collapsed));};
    $('#shiyi-expand',state.root).onclick=()=>setCollapsed(false);
    $('#shiyi-collapse',state.root).onclick=()=>setCollapsed(true);
    $('#shiyi-scan',state.root).onclick=()=>scan();
    $('#shiyi-import',state.root).onclick=()=>importHistory();
    $('#shiyi-archive',state.root).onclick=()=>archivePreview();
    $('#shiyi-timeline',state.root).onclick=()=>timeline();
    $('#shiyi-review',state.root).onclick=async()=>{if(state.open)return;const pending=state.queue.shift()||[...state.deferred.values()].find(Boolean);if(pending){state.deferred.delete(pending.id);await review(pending);}else notice('暂无待审核记忆');};
    $('#shiyi-manage',state.root).onclick=()=>manage();
    $('#shiyi-settings',state.root).onclick=()=>settings();
  }
  state.destroy=()=>{state.disposed=true;clearInterval(state.timer);state.root?.remove();state.style?.remove();};
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
  state.tick=()=>scan().catch(error); state.pending=()=>state.queue.length+state.deferred.size;
  scan().catch(error);
  console.info('[拾忆] v0.5 已加载；自动切换拾忆全局世界书，不修改其他全局世界书，仅在手动确认后隐藏正文，可恢复。');

state.timelineRows=async()=>{
 const scope=identity(); if(!scope)return [];
 const rows=Object.values(records()).filter(r=>Number.isInteger(r.sourceMessage));
 const book=vars().shiyi_v01?.book;
 if(!book)return [];
 const entries=await api('getWorldbook',book);
 if(scope!==identity())throw Error('聊天已切换，请刷新');
 return rows.filter(r=>r.book===book).flatMap(r=>{const e=entries.find(e=>e.uid===r.uid);return e?[{floor:r.sourceMessage,title:e.name,content:e.content,when:parseStoryTime(e.content)||'日期未识别',sourceHash:r.sourceHash}]:[]});
};
state.backup=async()=>{const id=identity();if(!id)return null;const data=JSON.parse(JSON.stringify(vars().shiyi_v01||{}));const entries=data.book?await api('getWorldbook',data.book):[];if(id!==identity())throw Error('聊天已切换');return {scope:id,data,entries};};
return state;
}
