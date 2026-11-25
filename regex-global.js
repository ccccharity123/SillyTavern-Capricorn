// Display-only global regex rules. Stored messages and prompt content remain intact.
export const HIDE_RULES = Object.freeze([
 {id:'capricorn-table-display-only-v1',name:'摩羯座 · 隐藏随层档案（仅显示）',tag:'table'},
 {id:'capricorn-summary-display-only-v1',name:'摩羯座 · 隐藏剧情摘要（仅显示）',tag:'summary'},
 {id:'capricorn-bgm-display-only-v1',name:'摩羯座 · 隐藏剧情音乐（仅显示）',tag:'bgm'},
]);
export const TABLE_HIDE_ID = HIDE_RULES[0].id;
export const TABLE_HIDE_REGEX = '/<table\\s*>[\\s\\S]*?<\\/table\\s*>/g';
function regexFor(tag){return `/<${tag}\\s*>[\\s\\S]*?<\\/${tag}\\s*>/g`;}
export function hideScript(rule){return {
 id:rule.id,scriptName:rule.name,findRegex:regexFor(rule.tag),replaceString:'',
 trimStrings:[],placement:[2],disabled:false,markdownOnly:true,promptOnly:false,
 runOnEdit:true,substituteRegex:0,minDepth:null,maxDepth:null,
};}
export function tableHideScript(){return hideScript(HIDE_RULES[0]);}
function host(W){
 const ctx=W.SillyTavern?.getContext?.();
 const settings=ctx?.extensionSettings??W.extension_settings;
 const save=ctx?.saveSettingsDebounced??W.saveSettingsDebounced;
 if(!settings||typeof settings!=='object'||!Array.isArray(settings.regex)||typeof save!=='function')return null;
 return {settings,save};
}
export function ensureGlobalHideRegexes(W){
 const h=host(W);
 if(!h)return {status:'unavailable',message:'宿主未开放全局正则设置与保存接口；未修改任何设置'};
 const list=h.settings.regex,added=[],existing=[];
 for(const rule of HIDE_RULES){
  const candidate=hideScript(rule);
  if(list.some(s=>s?.id===rule.id)) {existing.push(rule.tag);continue;}
  // Do not create a duplicate if an equivalent display-only rule already exists.
  if(list.some(s=>s?.findRegex===candidate.findRegex&&s?.replaceString===''&&s?.markdownOnly===true&&s?.promptOnly===false&&Array.isArray(s?.placement)&&s.placement.includes(2))){existing.push(rule.tag);continue;}
  list.push(candidate);added.push(candidate);
 }
 if(added.length){
  try{h.save();}catch(e){for(const script of added){const i=list.indexOf(script);if(i>=0)list.splice(i,1);}return {status:'failed',message:'保存全局正则失败：'+String(e?.message??e)};}
 }
 return {status:added.length?'installed':'exists',message:`全局隐藏正则：新安装 ${added.length} 条，已有 ${existing.length} 条（摘要 / 表格 / BGM）。保留用户手动修改及禁用状态`};
}
// Compatibility with older callers.
export function ensureTableHideRegex(W){return ensureGlobalHideRegexes(W);}
export function mountGlobalRegexControl(container,W,D){
 const section=D.createElement('section');section.className='cap-backup';
 const title=D.createElement('h4');title.textContent='全局隐藏正则';section.append(title);
 const status=D.createElement('p');status.textContent='等待检查宿主正则接口…';section.append(status);
 const button=D.createElement('button');button.type='button';button.textContent='检查 / 安装摘要、表格、BGM隐藏正则';
 button.onclick=()=>{const result=ensureGlobalHideRegexes(W);status.textContent=result.message;};section.append(button);
 container.append(section);
 let stopped=false;const timers=[];
 for(const delay of [0,1200,4000,10000])timers.push(W.setTimeout(()=>{
  if(stopped)return;
  const result=ensureGlobalHideRegexes(W);status.textContent=result.message;
  if(result.status==='installed'||result.status==='exists'){stopped=true;for(const t of timers)W.clearTimeout(t);}
 },delay));
 return ()=>{stopped=true;for(const t of timers)W.clearTimeout(t);section.remove();};
}
