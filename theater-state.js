import { hasOwn } from './compat.js';
import { applyMove, branchState, permits, restoreBranch } from './theater-flow.js';
export const freshState = data => ({ ...(data?.flow ? branchState(data) : { earned: [], done: [] }), rounds: {}, current: '' });

export const unlocked = (state, requirements) => requirements.every(key => state.earned.includes(key));

export function restoreState(data, value) {
  const state = freshState(data);
  if (!value || typeof value !== 'object') return state;
  const allowed = new Set(data.items.map(item => item.id));
  if (Array.isArray(value.earned)) state.earned = [...new Set(value.earned.filter(key => allowed.has(key)))];
  const known = new Set(data.modules.flatMap(module =>
    (module.actions ?? module.apps?.flatMap(app => app.entries) ?? module.results ?? [module.game]).map(entry => entry.id)));
  if (Array.isArray(value.done)) state.done = [...new Set(value.done.filter(key => known.has(key)))];
  for (const module of data.modules) {
    if (!module.results) continue;
    const round = hasOwn(value.rounds ?? {}, module.id) && value.rounds[module.id];
    const last = module.results.find(entry => entry.id === round?.last)?.id;
    if (last) Object.defineProperty(state.rounds, module.id, {
      value: { last, duplicate: round.duplicate === true }, enumerable: true, configurable: true, writable: true,
    });
  }
  if (data.flow) restoreBranch(data, state, value);
  if (data.modules.some(module => module.id === value.current && permits(state, module))) state.current = value.current;
  return state;
}

export const earn = applyMove;
