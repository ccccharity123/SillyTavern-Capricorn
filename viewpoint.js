import { cost, tokenize } from './hybrid.js';
import { knowledgeForCharacter } from './weave.js';

export function viewpointName(value) {
  const name = typeof value === 'string' ? value.trim().normalize('NFKC') : '';
  return name.length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(name) ? name : '';
}

export function speakingCharacter(context, type = 'normal') {
  const group = context.groupId ?? context.group_id;
  const character = context.characterId ?? context.character_id;
  if ((group != null && group !== '') || character == null || character === '') return '';
  if (!['normal', 'continue', 'swipe', 'regenerate'].includes(type)) return '';
  return viewpointName(context.name2 || context.characters?.[character]?.name);
}

export function recallViewpoint(ledger, actor, query, budget) {
  const selected = [];
  if (!viewpointName(actor) || typeof query !== 'string' || !query || budget <= 0) return { content: '', selected };
  const normalized = query.normalize('NFKC').toLowerCase();
  const words = [...new Set(tokenize(query))].filter(word => word.length > 1);
  const actorKey = actor.normalize('NFKC').toLowerCase();
  const candidates = [];
  for (const item of knowledgeForCharacter(ledger, actor)) {
    if (Object.hasOwn(item.fields, '已公开事实')) continue;
    const facts = Object.entries(item.fields).filter(([key]) => key !== '角色')
      .map(([key, value]) => `${key}：${value}`).join('。');
    const topic = item.title.normalize('NFKC').toLowerCase();
    const explicit = topic.length >= 2 && topic !== `${actorKey}的认知` && normalized.includes(topic);
    const evidence = facts.replace(/^角色：[^。]*。?/u, '').normalize('NFKC').toLowerCase();
    const hits = words.filter(word => !actorKey.includes(word) && (evidence.includes(word) || (topic !== `${actorKey}的认知` && topic.includes(word)))).length;
    if (explicit || hits >= 2) candidates.push({ item, facts, rank: (explicit ? 10 : 0) + hits });
  }
  candidates.sort((a, b) => b.rank - a.rank);
  let content = '';
  const header = `【${actor}的角色视角】仅供该角色使用，其他角色保留各自的认知。人物看法可能有误。`;
  for (const { item, facts } of candidates) {
    const next = `${content || header}\n${item.title}｜${facts}`;
    if (cost(next) > budget) continue;
    content = next;
    selected.push(item.id);
  }
  return { content, selected };
}
