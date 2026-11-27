// Display-only global regex rules. Stored messages and prompt content remain intact.
export const HIDE_RULES = Object.freeze([
 {id:'capricorn-table-display-only-v1',name:'摩羯座 · 隐藏随层档案（仅显示）',tag:'table'},
 {id:'capricorn-summary-display-only-v1',name:'摩羯座 · 隐藏剧情摘要（仅显示）',tag:'summary'},
 {id:'capricorn-bgm-display-only-v1',name:'摩羯座 · 隐藏剧情音乐（仅显示）',tag:'bgm'},
 {id:'capricorn-director-display-only-v1',name:'摩羯座 · 隐藏导演规划（仅显示）',tag:'director'},
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
const pending = new WeakMap();

function host(W) {
  const ctx = W.SillyTavern?.getContext?.();
  const settings = ctx?.extensionSettings ?? W.extension_settings;
  const owner = typeof ctx?.saveSettingsDebounced === 'function' ? ctx : W;
  const save = owner.saveSettingsDebounced;
  if (!Array.isArray(settings?.regex) || typeof save !== 'function') return null;
  return { settings, save: () => save.call(owner) };
}

function equivalent(rule, script) {
  // Allow the common manual form without optional tag whitespace.
  const simple = `/<${rule.tag}>[\\s\\S]*?<\\/${rule.tag}>/g`;
  const pattern = script?.findRegex;
  const samePattern = pattern === regexFor(rule.tag) || pattern === simple;
  return samePattern && script.replaceString === '' && script.markdownOnly === true &&
    script.promptOnly !== true && script.placement?.length === 1 && script.placement[0] === 2 &&
    (script.minDepth ?? null) === null && (script.maxDepth ?? null) === null &&
    (script.substituteRegex ?? 0) === 0;
}

async function install(W) {
  let list, directorState;
  const added = [];
  try {
    const h = host(W);
    if (!h) return { status: 'unavailable', message: '宿主未开放全局正则设置或保存接口，导演规划隐藏未配置。' };
    list = h.settings.regex;
    for (const rule of HIDE_RULES) {
      const matches = list.filter(script => equivalent(rule, script));
      const active = matches.some(script => !script.disabled && script.runOnEdit !== false);
      const sameId = list.some(script => script?.id === rule.id);
      if (rule.tag === 'director' && !directorState) {
        if (active) directorState = '已有启用的仅显示规则';
        else if (matches.length) directorState = '同类规则已禁用或未应用到编辑，保留当前设置';
        else if (sameId) directorState = '现有同 ID 规则的配置不同，请在宿主正则设置检查';
        else directorState = '已添加仅显示规则';
      }
      if (matches.length || sameId) continue;
      const candidate = hideScript(rule);
      list.push(candidate);
      added.push(candidate);
    }
    if (added.length) {
      const saved = await h.save();
      if (saved === false) throw Error('宿主拒绝保存');
    }
    const disabled = h.settings.disabledExtensions?.includes('regex');
    const suffix = disabled ? '正则扩展当前处于禁用状态。' : '刷新或重新显示聊天后可核对效果。';
    const saving = added.length ? '新增 ' + added.length + ' 条规则，已请求宿主保存。' : '';
    return { status: added.length ? 'installed' : 'exists', message: saving + '导演规划：' + directorState + '。' + suffix };
  } catch (error) {
    for (const script of added) {
      const index = list.indexOf(script);
      if (index >= 0) list.splice(index, 1);
    }
    return { status: 'failed', message: '全局正则安装失败，已撤回本次新增规则：' + String(error?.message ?? error) };
  }
}

export function ensureGlobalHideRegexes(W) {
  if (pending.has(W)) return pending.get(W);
  const task = Promise.resolve().then(() => install(W)).finally(() => pending.delete(W));
  pending.set(W, task);
  return task;
}

// Compatibility name for older callers.
export function ensureTableHideRegex(W) { return ensureGlobalHideRegexes(W); }

export function mountGlobalRegexControl(container, W, D) {
  const section = D.createElement('section');
  section.className = 'cap-backup';
  const title = D.createElement('h4');
  title.textContent = '全局隐藏正则';
  const status = D.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = '等待检查宿主正则接口…';
  const button = D.createElement('button');
  button.type = 'button';
  button.textContent = '检查 / 安装仅显示正则';
  section.append(title, status, button);
  container.append(section);

  let destroyed = false;
  let retry;
  let attempts = 0;
  async function check(auto = false) {
    button.disabled = true;
    const result = await ensureGlobalHideRegexes(W);
    if (destroyed) return;
    button.disabled = false;
    status.textContent = result.message;
    if (auto && result.status === 'unavailable' && attempts++ === 0) {
      retry = W.setTimeout(() => void check(true), 1200);
    }
  }
  button.onclick = () => void check();
  retry = W.setTimeout(() => void check(true), 0);
  return () => {
    destroyed = true;
    W.clearTimeout(retry);
    section.remove();
  };
}
