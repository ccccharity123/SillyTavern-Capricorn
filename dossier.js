import { hasOwn } from './compat.js';
import {fuzzy} from './traces.js';
import { appendMemoryProvenance } from './memory-provenance.js';

export function createDossier({D,modal,identity,check,archive,archivePatch,serial,jumpSource,notice,read}) {
 const kinds=['人物','关系','伏笔','事件','成长','物品','地点'];
 const statuses=['未解决','发展中','已回收','已废弃'];
 const el=(tag,parent,text)=>{const n=D.createElement(tag);if(text!=null)n.textContent=text;parent?.append(n);return n;};
 const manual=()=>archive().dossier||[];
 const live=()=>read().dossierSources();
 async function edit(id,old={},seed=''){
  check(id);const box=el('div');box.className='shiyi-editor';
  const field=(label,tag,value,options)=>{const l=el('label',box,label),n=el(tag,l);if(options)for(const v of options){const o=el('option',n,v);o.value=v;}n.value=value||'';return n;};
  const kind=field('档案类型','select',old.kind||'人物',kinds),title=field('名称 / 事件标题','input',old.title),people=field('涉及人物（可填写多人）','input',old.people),status=field('伏笔状态','select',old.status||statuses[0],statuses),body=field('身份、别名、关系变化或事件详情','textarea',old.body||seed);body.rows=9;
  const sources=el('details',box);el('summary',sources,'关联正史记忆（可多选）');const selected=new Set(old.sources||[]);const valid=live();for(const [k,r] of valid){const l=el('label',sources);l.className='shiyi-history-head';const c=el('input',l);c.type='checkbox';c.checked=selected.has(k);c.onchange=()=>c.checked?selected.add(k):selected.delete(k);el('span',l,`${r.sourceMessage}楼 · ${r.title}`);}
  const result=await modal('留痕 · 编辑档案',box,[{label:'取消',value:'cancel'},{label:'保存',value:'save',kind:'primary'}]);if(result!=='save')return;
  if(!title.value.trim()){notice('档案名称不能为空');return;}
  await serial(async()=>{check(id);const current=manual();const row={id:old.id||globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`,kind:kind.value,title:title.value.trim(),people:people.value.trim(),status:status.value,body:body.value.trim(),sources:[...selected],updatedAt:new Date().toISOString()};archivePatch({dossier:[...current.filter(r=>r.id!==row.id),row]});});
 }
 async function open(present = modal, options = {}) {
  const {bindSearch, setCount, filters, active = () => true} = options;
  const id = identity();
  if (!id) return;
  while (identity() === id && active()) {
   const box = el('div');
   const toolbar = el('div', box);
   toolbar.className = 'shiyi-view-controls';
   const search = el('input', bindSearch ? null : toolbar);
   search.placeholder = '搜索人物、关系、伏笔、事件';
   search.setAttribute('aria-label', search.placeholder);
   const filter = el('select', toolbar);
   filter.setAttribute('aria-label', '档案筛选');
   for (const kind of ['全部', ...kinds, '来源失效']) el('option', filter, kind).value = kind;
   const list = el('div', box);
   list.className = 'shiyi-dossier-rows';
   let action = null, finishView;
   const savedFilter = filters && filters.dossier;
   if (savedFilter && Array.from(filter.options).some(option => option.value === savedFilter)) filter.value = savedFilter;
   const view = read();
   check(id);
   const manualRows = view.archive.dossier || [];
   const manualIds = new Set(manualRows.map(row => row.id));
   const ledger = view.ledger();
   const summaries = view.summaries();
   const rows = [...manualRows, ...ledger.entities.filter(row => !manualIds.has(row.id))];

   function render() {
    if (identity() !== id) return;
    list.replaceChildren();
    const query = search.value.toLowerCase();
    const pins = archive().weavePins || [];
    for (const row of rows) {
     if (!fuzzy(`${row.title} ${row.people} ${row.body} ${row.status}`, query)) continue;
     const stale = (row.sources || []).some(key => !hasOwn(ledger.rows, key) && !hasOwn(summaries, key));
     if (filter.value !== '全部' && filter.value !== row.kind && !(filter.value === '来源失效' && stale)) continue;
     const card = el('div', list);
     card.className = 'shiyi-history-item';
     el('strong', card, `${row.kind} · ${row.title}${row.auto ? ' · 随层提取' : ''}`);
     el('p', card, `${row.people || ''} ${row.kind === '伏笔' ? row.status : ''}${stale ? ' · 来源失效' : ''}`);
     el('p', card, row.body).style.whiteSpace = 'pre-wrap';
     const origin = manualIds.has(row.id) ? 'manual' : 'derived';
     appendMemoryProvenance(D, card, () => identity() === id && view.provenance(
      row.kind === '伏笔' ? 'foreshadow' : 'dossier', row.id, { origin }), jumpSource);

     const pin = el('button', card, pins.includes(row.id) ? '取消核心' : '核心记忆');
     pin.onclick = async () => {
      await serial(async () => {
       check(id);
       const next = new Set(archive().weavePins || []);
       if (next.has(row.id)) next.delete(row.id);
       else next.add(row.id);
       archivePatch({ weavePins: [...next] });
      });
      pin.textContent = (archive().weavePins || []).includes(row.id) ? '取消核心' : '核心记忆';
     };
     for (const [label, type] of [['编辑', 'edit'], ['删除', 'delete']]) {
      const button = el('button', card, label);
      if (type === 'delete') button.className = 'shiyi-item-delete';
      button.onclick = () => {
       action = { type, row };
       if (finishView) finishView('close');
      };
     }
    }
    if (setCount) setCount(list.children.length);
    if (!list.children.length) el('p', list, '暂无匹配的留痕档案');
   }

   search.oninput = render;
   filter.onchange = () => {
    if (filters) filters.dossier = filter.value;
    render();
   };
   if (bindSearch) bindSearch(text => { search.value = text; render(); });
   else render();
   const result = await present('拾忆 · 留痕档案', box, [
    { label: '关闭', value: 'close' }, { label: '新建档案', value: 'new', kind: 'primary' }, { label: '从记忆整理', value: 'seed' },
   ], finish => { finishView = finish; });
   if (identity() !== id || !active()) return;
   if (action?.type === 'edit') await edit(id, action.row);
   else if (action?.type === 'delete') {
    const content = el('div', null, `删除档案「${action.row.title}」？不会删除原记忆。`);
    if (await modal('确认删除', content, [{ label: '取消', value: 'cancel' }, { label: '删除', value: 'yes' }]) === 'yes') {
     await serial(async () => {
      check(id);
      archivePatch({
       dossier: manual().filter(row => row.id !== action.row.id),
       traceHidden: { ...archive().traceHidden, [action.row.id]: true },
      });
     });
    }
   } else if (result === 'new') await edit(id);
   else if (result === 'seed') {
    const content = el('div');
    const select = el('select', content);
    select.setAttribute('aria-label', '来源记忆');
    select.setAttribute('data-cap-select', 'search');
    for (const [key, row] of live()) el('option', select, `${row.sourceMessage}楼 · ${row.title}`).value = key;
    if (!select.options.length) {
     notice('暂无有效记忆');
     continue;
    }
    if (await modal('选择来源记忆', content, [{ label: '取消', value: 'cancel' }, { label: '整理', value: 'yes' }]) === 'yes') {
     check(id);
     const row = new Map(live()).get(select.value);
     if (row) await edit(id, { sources: [select.value] }, row.content);
    }
   } else return;
  }
 }
 return {open};
}
