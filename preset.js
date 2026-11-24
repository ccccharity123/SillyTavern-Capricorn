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
export function mergePreset(preset,selected,enabled=true){const p=JSON.parse(JSON.stringify(preset));if(!Array.isArray(p.prompts)||!Array.isArray(p.prompt_order)||!p.prompt_order.length||p.prompt_order.some(x=>!Array.isArray(x.order)))throw Error('当前预设不支持原生独立提示词结构');for(const e of selected){const existing=p.prompts.find(x=>x.identifier===e.identifier);if(enabled){if(existing)existing.content=e.content;else p.prompts.push({identifier:e.identifier,name:e.name,role:'system',content:e.content,system_prompt:false,marker:false,injection_position:0,injection_depth:4,injection_order:100,forbid_overrides:false});}for(const g of p.prompt_order){const o=g.order.find(x=>x.identifier===e.identifier);if(o)o.enabled=enabled;else if(enabled)g.order.push({identifier:e.identifier,enabled:true});}}return p;}
export function mountPresetControls(settings,W,D){const box=D.createElement('section');box.className='cap-backup';const add=(tag,txt,parent=box)=>{const x=D.createElement(tag);x.textContent=txt;parent.append(x);return x;};add('h4','预设适配');add('p','剧情摘要与随层档案需搭配拾忆；剧情音乐需搭配声屿。安装自动启用条目，不自动开启模块。Token 为字符启发式估算，非 Gemini 实测。请先备份。');const current=add('p','');const get=()=>{const pm=W.SillyTavern?.getContext?.()?.getPresetManager?.();if(!pm||pm.apiId!=='openai'||!pm.getPresetSettings||!pm.savePreset)throw Error('宿主未提供兼容的 Chat Completion 预设 API');const name=pm.getSelectedPresetName();if(!name)throw Error('请先选择预设');return {pm,name};};const refresh=()=>{try{current.textContent='当前预设：'+get().name;}catch(e){current.textContent=e.message;}};refresh();box.addEventListener('pointerenter',refresh);box.addEventListener('focusin',refresh);const status=add('p','');let busy=false;async function install(selected,enabled=true){if(busy)return;busy=true;try{const {pm,name}=get();const old=pm.getPresetSettings(name);const modified=enabled&&selected.some(e=>{const x=old.prompts?.find(p=>p.identifier===e.identifier);return x&&!isBuiltInContent(e,x.content);});if(!W.confirm(`${enabled?'安装/更新并启用':'停用'} ${selected.map(e=>e.name).join('、')}？\n当前预设：${name}\n摘要与档案需搭配拾忆，音乐需搭配声屿。${modified?'\n检测到自定义内容，继续将覆盖该条目。':''}`))return;if(pm.getSelectedPresetName()!==name)throw Error('预设已切换');await pm.savePreset(name,mergePreset(old,selected,enabled));status.textContent='已保存：'+name+'；请检查提示词列表。';}catch(e){status.textContent='操作失败：'+e.message;}finally{busy=false;}}const picks=[];const total=add('p','');const update=()=>{total.textContent='当前所选合计：≈'+picks.filter(p=>p.check.checked).reduce((n,p)=>n+p.get().tokens,0)+' Tokens';};for(const list of tiers){const row=add('div','');const check=add('input','',row);check.type='checkbox';check.checked=true;add('strong',list[0].name+' · '+(list[0].tag==='bgm'?'声屿':'拾忆'),row);const select=add('select','',row);list.forEach((e,i)=>{const o=add('option',['短版','中等版','详实版'][i]+' · ≈'+e.tokens+' Tokens',select);o.value=i;});select.value='1';const get=()=>list[Number(select.value)];const preview=add('details','',row);add('summary','预览提示词',preview);const pre=add('pre',get().content,preview);pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:45vh;overflow:auto;';select.onchange=()=>{pre.textContent=get().content;update();};check.onchange=update;const b=add('button','安装/更新',row);b.type='button';b.onclick=()=>install([get()]);picks.push({check,get});}update();const all=add('button','一键安装所选条目');all.type='button';all.onclick=()=>{const chosen=picks.filter(p=>p.check.checked).map(p=>p.get());if(chosen.length)install(chosen);};const off=add('button','停用已安装条目');off.type='button';off.onclick=()=>install(entries,false);settings.append(box);}
