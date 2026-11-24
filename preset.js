import { variants } from './tiers.js';
export const entries=[
 {identifier:'cap-output-summary-v1',name:'剧情摘要',tag:'summary',content:'每轮正文结束后输出一组 <summary> 与 </summary> 标签。内部以“时间：”及“地点：”记录已知剧情时间与地点，另起一行简洁记录本轮发生的关键事实、行动、关系变化及未完成事项。未知时间或地点可省略；保留世界观原有纪年，不虚构事实。只总结本轮，不复述全部历史。'},
 {identifier:'cap-output-table-v1',name:'随层档案',tag:'table',content:'在摘要之后输出 <table> 与 </table>，内部仅为合法 JSON 对象。只填本轮明确发生的增量事实，无变化字段省略，完全无变化输出 {}。人物使用稳定姓名；别名及关系人物使用字符串数组；别名数组累计；其他数组一旦填写即表示该字段完整当前值，空数组表示明确清空，未知或无变化则省略。关系、事件、物品、伏笔、成长、地点使用稳定名称。伏笔状态为未解决、发展中、已回收、已废弃之一。示例仅供格式参考：<table>{"时间":"十月二十六日上午","人物":[{"姓名":"甲","别名":["阿甲"],"状态":"受伤"}],"关系":[{"名称":"甲与乙","人物":["甲","乙"],"类型":"朋友","变化":"和解"}],"事件":[{"名称":"和解","内容":"解除误会"}],"物品":[{"名称":"怀表","持有者":"乙","变化":"甲赠予乙"}],"伏笔":[{"名称":"信件","状态":"未解决"}]}</table>。禁止 Markdown 围栏、注释及虚构示例事实。'},
 {identifier:'cap-output-bgm-v1',name:'剧情音乐',tag:'bgm',content:'在本轮尾部根据实际剧情氛围选择真实存在的歌曲；使用准确歌名及歌手，格式严格为 <bgm>歌名 - 歌手</bgm>，连字符两侧留空格。无合适歌曲则省略，不编造歌曲。'}
];

const promptModule = new Map(entries.map(entry => [
  entry.identifier, entry.tag === 'bgm' ? 'music' : 'memory',
]));

export function createPresetGate() {
  const overridden = new Set();
  function restore() {
    for (const prompt of overridden) {
      if (prompt.enabled === false) prompt.enabled = true;
    }
    overridden.clear();
  }
  function apply(settings, flags) {
    restore();
    if (!Array.isArray(settings?.prompt_order)) return;
    for (const group of settings.prompt_order) {
      if (!Array.isArray(group?.order)) continue;
      for (const prompt of group.order) {
        const module = promptModule.get(prompt?.identifier);
        if (module && flags[module] === false && prompt.enabled === true) {
          overridden.add(prompt);
          prompt.enabled = false;
        }
      }
    }
  }
  return { apply, restore };
}
const knowledgeGuidance = {
  summary: '未公开的客观事实及角色的私密看法仅写入随层档案的“认知”，摘要只记录可公开的行动和结果。',
  table: '认知有变化时填“认知”数组。每项用稳定“名称”，区分“客观事实”与“人物认知”（每项包含“人物”“看法”和可选、该人物已知的“主题”）。“公开”用布尔值，只有已明确向相关人物公开才填 true。“知情者”列出明确知道该事实的稳定姓名。知情者和人物认知数组填写当前完整值，空数组清空，未知省略。私密内容只写入“认知”。',
};
const narrativeGuidance = {
  summary: '出现明确的倒叙、回忆、未来或假设时，在摘要中标注其时间范围。',
  table: '明示倒叙、回忆、未来或假设时，在档案对象填写“叙事时态”。分段不同可在对应行单独填写，时间保留剧情原文。',
};
const originalTiers=entries.map(entry=>[entry.content,...variants[entry.tag]]);
const withKnowledge=(original,tag)=>knowledgeGuidance[tag]?`${original}\n\n${knowledgeGuidance[tag]}`:original;
export const tiers=entries.map((entry,index)=>originalTiers[index].map((original,level)=>{
  const guidance=narrativeGuidance[entry.tag];
  const baseline=withKnowledge(original,entry.tag);
  const content=guidance?baseline+guidance:baseline;
  const tokens=Math.ceil([...content].reduce((total,char)=>total+(/[\u3400-\u9fff]/u.test(char)?1:0.35),0));
  return {...entry,content,level,tokens};
}));
const isBuiltInContent=(entry,content)=>{
  const index=entries.findIndex(candidate=>candidate.identifier===entry.identifier);
  return index>=0&&(originalTiers[index].some(original=>original===content||withKnowledge(original,entry.tag)===content)||
    tiers[index].some(tier=>tier.content===content));
};
// Preserve unknown fields and support both grouped and flat native order lists.
export function presetShape(p){
 if(!Array.isArray(p?.prompts))throw Error('缺少 prompts 数组；宿主未返回可编辑预设');
 if(!Array.isArray(p.prompt_order))throw Error('缺少 prompt_order 数组；无法安全写入排序');
 const flat=p.prompt_order.length>0&&p.prompt_order.every(x=>typeof x?.identifier==='string');
 const groups=flat?[{order:p.prompt_order}]:p.prompt_order;
 if(!groups.length||groups.some(g=>!Array.isArray(g?.order)))throw Error('无法识别排序分组，请导出预设 JSON');
 return {groups,flat};
}
export function presetTargets(p){const {groups}=presetShape(p);const names=new Map(p.prompts.map(x=>[x.identifier,x.name]));return groups.map((g,i)=>({index:i, label:String(g.character_id??i+1),targets:g.order.filter(x=>!promptModule.has(x.identifier)).map(x=>({id:x.identifier,name:names.get(x.identifier)||x.identifier}))}));}
export function mergePreset(preset,selected,enabled=true,remove=false,placement=null){
 const p=JSON.parse(JSON.stringify(preset));const {groups,flat}=presetShape(p);const ids=new Set(selected.map(e=>e.identifier));
 if([...ids].some(id=>!promptModule.has(id)))throw Error('仅允许修改摩羯座条目');
 if(remove){p.prompts=p.prompts.filter(x=>!ids.has(x.identifier));for(const g of groups)g.order=g.order.filter(x=>!ids.has(x.identifier));}
 else {
 if(placement&&enabled){if(!groups[placement.group])throw Error('排序分组已变化');if(!['before','after','start','end'].includes(placement.side))throw Error('无效插入位置');if(['before','after'].includes(placement.side)&&!groups[placement.group].order.some(x=>x.identifier===placement.anchor&&!ids.has(x.identifier)))throw Error('目标条目已变化');}
 for(const e of selected){const existing=p.prompts.find(x=>x.identifier===e.identifier);if(enabled){if(existing)existing.content=e.content;else p.prompts.push({identifier:e.identifier,name:e.name,role:'system',content:e.content,system_prompt:false,marker:false,injection_position:0,injection_depth:4,injection_order:100,forbid_overrides:false});}}
 for(const [i,g] of groups.entries()){
 if(placement&&enabled){if(i!==placement.group)continue;const old=new Map(g.order.map(x=>[x.identifier,x]));g.order=g.order.filter(x=>!ids.has(x.identifier));let at=placement.side==='start'?0:placement.side==='end'?g.order.length:g.order.findIndex(x=>x.identifier===placement.anchor)+(placement.side==='after'?1:0);g.order.splice(at,0,...selected.map(e=>({...old.get(e.identifier),identifier:e.identifier,enabled:true})));continue;}
 for(const e of selected){const o=g.order.find(x=>x.identifier===e.identifier);if(o)o.enabled=enabled;else if(enabled){let at=g.order.findIndex(x=>x.identifier==='jailbreak');if(at<0)at=g.order.length;g.order.splice(at,0,{identifier:e.identifier,enabled:true});}}
 }}if(flat)p.prompt_order=groups[0].order;return p;
}
export function resolvePresetManager(W){const ctx=W.SillyTavern?.getContext?.();const pm=ctx?.getPresetManager?.('openai')||ctx?.getPresetManager?.();if(!pm||(pm.apiId&&pm.apiId!=='openai')||typeof pm.getPresetSettings!=='function'||typeof pm.savePreset!=='function')throw Error('宿主未提供兼容的聊天补全预设接口');return pm;}
// Only accept complete snapshots; never manufacture missing native ordering.
export function unwrapPreset(raw){
 for(const value of [raw,raw?.preset,raw?.settings,raw?.data,raw?.data?.preset,raw?.data?.settings]){
  try{presetShape(value);return value;}catch{}
 }
 throw Error('未找到完整预设结构；请运行接口诊断或使用 JSON 备用方案');
}
export async function readPreset(pm,name){
 const raw=await pm.getPresetSettings(name);
 return unwrapPreset(raw);
}
export async function presetDiagnostics(W){
 const ctx=W.SillyTavern?.getContext?.();const report={context:!!ctx,manager: false};
 try{const pm=resolvePresetManager(W);report.manager=true;const name=pm.getSelectedPresetName?.();report.selected=!!name;const raw=await pm.getPresetSettings(name);report.shape=[raw,raw?.preset,raw?.settings,raw?.data].map(x=>({type:Array.isArray(x)?'array':typeof x,prompts:Array.isArray(x?.prompts),order:Array.isArray(x?.prompt_order)}));try{unwrapPreset(raw);report.readable=true;}catch{report.readable=false;}}catch{report.readable=false;}
 return report;
}
export function mountPresetControls(settings,W,D){const box=D.createElement('section');box.className='cap-backup';const add=(tag,txt,parent=box)=>{const x=D.createElement(tag);x.textContent=txt;parent.append(x);return x;};add('h4','预设适配');add('p','剧情摘要与随层档案需搭配拾忆；剧情音乐需搭配声屿。安装自动启用条目，不自动开启模块。Token 为字符启发式估算，非 Gemini 实测。请先备份。');const current=add('p','');const get=()=>{const pm=resolvePresetManager(W);const name=pm.getSelectedPresetName();if(!name)throw Error('请先选择预设');return {pm,name};};const refresh=()=>{try{current.textContent='当前预设：'+get().name;}catch(e){current.textContent=e.message;}};refresh();const status=add('p','');let busy=false;async function install(selected,enabled=true,remove=false){if(busy)return;busy=true;status.textContent="正在读取当前预设…";try{const {pm,name}=get();const old=await readPreset(pm,name);const placement=enabled&&!remove?{group:Number(group.value),anchor:target.value,side:side.value}:null;if(placement&&loadedName!==name)throw Error('请刷新当前预设条目');if(placement&&JSON.stringify(presetTargets(old))!==loadedTargets)throw Error('预设排序已变化，请刷新');const modified=enabled&&selected.some(e=>{const x=old.prompts?.find(p=>p.identifier===e.identifier);return x&&!isBuiltInContent(e,x.content);});if(!W.confirm(`${remove?'彻底删除':enabled?'安装/更新并启用':'停用'} ${selected.map(e=>e.name).join('、')}？\n当前预设：${name}\n摘要与档案需搭配拾忆，音乐需搭配声屿。${modified?'\n检测到自定义内容，继续将覆盖该条目。':''}`)){status.textContent='已取消';return;}if(pm.getSelectedPresetName()!==name)throw Error('预设已切换');const next=mergePreset(old,selected,enabled,remove,placement);status.textContent='正在保存…';await pm.savePreset(name,next);if(typeof pm.selectPreset==='function')await pm.selectPreset(name);const actual=await readPreset(pm,name);const actualGroups=presetShape(actual).groups;if(!selected.every(e=>remove?!actual.prompts?.some(p=>p.identifier===e.identifier)&&actualGroups.every(g=>!g.order.some(p=>p.identifier===e.identifier)):(!enabled||actual.prompts?.some(p=>p.identifier===e.identifier&&p.content===e.content))&&actualGroups.filter((g,i)=>!placement||i===placement.group).every(g=>enabled?g.order.some(p=>p.identifier===e.identifier&&p.enabled):!g.order.some(p=>p.identifier===e.identifier&&p.enabled))))throw Error('保存后未能验证活动预设，请重新选择预设或查看宿主日志');if(placement&&JSON.stringify(actualGroups[placement.group]?.order.map(x=>x.identifier))!==JSON.stringify(presetShape(next).groups[placement.group].order.map(x=>x.identifier)))throw Error('保存后排序未通过验证');status.textContent='已保存并验证：'+name;await loadTargets();}catch(e){status.textContent='操作失败：'+e.message;W.toastr?.error?.(status.textContent);}finally{busy=false;}}let loadedName='',loadedTargets='',targetGroups=[];const group=add('select','');const target=add('select','');const side=add('select','');for(const [v,t] of [['after','目标之后'],['before','目标之前'],['start','分组开头'],['end','分组末尾']]){const o=add('option',t,side);o.value=v;}const fillTargets=()=>{const previous=target.value;target.replaceChildren();for(const t of targetGroups[Number(group.value)]?.targets||[]){const o=add('option',t.name,target);o.value=t.id;}if([...target.options].some(o=>o.value===previous))target.value=previous;};group.onchange=fillTargets;async function loadTargets(){try{const {pm,name}=get();const data=await readPreset(pm,name);targetGroups=presetTargets(data);loadedName=name;loadedTargets=JSON.stringify(targetGroups);const previous=group.value;group.replaceChildren();for(const g of targetGroups){const o=add('option','排序分组 '+g.label,group);o.value=g.index;}if(targetGroups.some(g=>String(g.index)===previous))group.value=previous;fillTargets();current.textContent='当前预设：'+name+' · 已读取条目';}catch(e){loadedName='';group.replaceChildren();target.replaceChildren();current.textContent='读取失败：'+e.message;}}const reload=add('button','刷新预设条目');reload.type='button';reload.onclick=loadTargets;void loadTargets();const picks=[];const total=add('p','');const update=()=>{total.textContent='当前所选合计：≈'+picks.filter(p=>p.check.checked).reduce((n,p)=>n+p.get().tokens,0)+' Tokens';};for(const list of tiers){const row=add('div','');const check=add('input','',row);check.type='checkbox';check.checked=true;add('strong',list[0].name+' · '+(list[0].tag==='bgm'?'声屿':'拾忆'),row);const select=add('select','',row);list.forEach((e,i)=>{const o=add('option',['短版','中等版','详实版'][i]+' · ≈'+e.tokens+' Tokens',select);o.value=i;});select.value='1';const get=()=>list[Number(select.value)];const preview=add('details','',row);add('summary','预览提示词',preview);const pre=add('pre',get().content,preview);pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:45vh;overflow:auto;';select.onchange=()=>{pre.textContent=get().content;update();};check.onchange=update;const b=add('button','插入/移动并启用',row);b.type='button';b.onclick=()=>install([get()]);const copy=add('button','复制提示词',row);copy.type='button';copy.onclick=async()=>{try{await W.navigator.clipboard.writeText(get().content);status.textContent='已复制提示词';}catch{preview.open=true;status.textContent='无法访问剪贴板，请手动复制预览内容';}};const del=add('button','删除条目',row);del.type='button';del.onclick=()=>install([get()],false,true);picks.push({check,get});}update();const all=add('button','插入所选并启用保存');all.type='button';all.onclick=()=>{const chosen=picks.filter(p=>p.check.checked).map(p=>p.get());if(chosen.length)install(chosen);else status.textContent='请至少选择一个条目';};const off=add('button','停用已安装条目');off.type='button';off.onclick=()=>install(entries,false);const del=add('button','删除全部摩羯座条目');del.type='button';del.onclick=()=>install(entries,false,true);const diag=add('button','接口诊断');diag.type='button';diag.onclick=async()=>{diagnostic.textContent=JSON.stringify(await presetDiagnostics(W),null,2);};const diagnostic=add('pre','');diagnostic.style.whiteSpace='pre-wrap';
 const offline=add('details','');add('summary','JSON 备用方案（需手动导入酒馆）',offline);const file=add('input','',offline);file.type='file';file.accept='.json,application/json';const og=add('select','',offline),ot=add('select','',offline),os=add('select','',offline);for(const [v,t] of [['after','目标之后'],['before','目标之前'],['start','分组开头'],['end','分组末尾']]){const o=add('option',t,os);o.value=v;}let source=null,groups=[];const fill=()=>{ot.replaceChildren();for(const t of groups[Number(og.value)]?.targets||[]){const o=add('option',t.name,ot);o.value=t.id;}};og.onchange=fill;file.onchange=async()=>{source=null;og.replaceChildren();ot.replaceChildren();try{source=JSON.parse(await file.files[0].text());groups=presetTargets(source);for(const g of groups){const o=add('option','排序分组 '+g.label,og);o.value=g.index;}fill();status.textContent='已读取 JSON；不会修改原文件';}catch(e){source=null;status.textContent='JSON 读取失败：'+e.message;}};const exportBtn=add('button','导出已启用条目的预设副本',offline);exportBtn.type='button';exportBtn.onclick=()=>{try{if(!source)throw Error('请先选择预设 JSON');const chosen=picks.filter(p=>p.check.checked).map(p=>p.get());if(!chosen.length)throw Error('请勾选条目');const next=mergePreset(source,chosen,true,false,{group:Number(og.value),anchor:ot.value,side:os.value});const url=W.URL.createObjectURL(new W.Blob([JSON.stringify(next,null,2)],{type:'application/json'}));const a=D.createElement('a');a.href=url;a.download='Capricorn-preset.json';box.append(a);a.click();a.remove();W.setTimeout(()=>W.URL.revokeObjectURL(url),30000);status.textContent='已请求导出副本，请在酒馆手动导入';}catch(e){status.textContent=e.message;}};settings.append(box);}
