import { earn } from './theater-state.js';
import { permits } from './theater-flow.js';

export const rarityLabels = { common: '常见', rare: '稀有', epic: '珍藏' };
const weights = { common: 7, rare: 3, epic: 1 };

export function availableRoutes(state, entry) {
  return entry.routes?.filter(route => permits(state, route)) ?? [];
}

export function interact(state, entry, tools = []) {
  if (!permits(state, entry)) return { error: '当前条件还不满足。' };
  const hasTools = expected => expected.length === tools.length &&
    expected.every(key => tools.includes(key) && state.earned.includes(key));
  const route = availableRoutes(state, entry).find(candidate => hasTools(candidate.tools));
  if (entry.routes?.length ? !route : !hasTools(entry.tools)) {
    return { error: entry.branch ? '这些物品或当前状态无法启动机关。' : '这些物品在这里没有起作用。' };
  }
  return { added: earn(state, entry, route), route };
}

export function solve(state, game, input) {
  if (!permits(state, game)) return { error: '先取得所需线索。' };
  const expected = game.answer;
  const match = game.mode === 'code' ? typeof input === 'string' && input.trim() === expected
    : Array.isArray(input) && input.length === expected.length &&
      expected.every((choice, index) => game.mode === 'choose' ? input.includes(choice) : input[index] === choice);
  return match ? interact(state, game) : { error: '还差一点，检查线索后再试。' };
}

export function draw(state, module, rng = Math.random, unseenOnly = false) {
  const unseen = module.results.filter(entry => !state.done.includes(entry.id));
  const pool = module.repeat && !unseenOnly ? module.results : unseen;
  if (!pool.length) return null;
  const weight = entry => module.mode === 'dice' ? 1 : weights[entry.rarity];
  let threshold = rng() * pool.reduce((total, entry) => total + weight(entry), 0);
  const result = pool.find(entry => (threshold -= weight(entry)) < 0) ?? pool[pool.length - 1];
  const duplicate = state.done.includes(result.id);
  Object.defineProperty(state.rounds, module.id, {
    value: { last: result.id, duplicate }, enumerable: true, configurable: true, writable: true,
  });
  return { result, added: earn(state, result), duplicate };
}
