/* Bounded, declarative state transitions for branching v2 interludes. */
export const operationKey = (entry, route) => entry.id + '/' + (route?.id ?? 'default');

export function permits(state, rule) {
  return rule.need.every(key => state.earned.includes(key)) &&
    (rule.when ?? []).every(token => {
      if (token.startsWith('@')) {
        const key = token.slice(1);
        return key.includes('/') ? state.log.includes(key) : state.done.includes(key);
      }
      const [key, value] = token.split('=');
      return state.flags[key] === value;
    });
}

export function applyMove(state, entry, route) {
  if (!state.done.includes(entry.id)) state.done.push(entry.id);
  if (entry.branch) {
    const key = operationKey(entry, route);
    if (!state.log.includes(key)) state.log.push(key);
    state.last[entry.id] = route?.id ?? 'default';
    Object.assign(state.flags, entry.set, route?.set);
  }
  const added = [...new Set([...entry.give, ...(route?.give ?? [])])].filter(key => !state.earned.includes(key));
  state.earned.push(...added);
  return added;
}

export function matchedEndings(data, state) {
  return data.endings.filter(ending => permits(state, ending));
}

export function branchState(data) {
  return {
    earned: [], done: [], flags: Object.assign(Object.create(null), data.initial),
    log: [], last: Object.create(null),
  };
}

function cloneState(state) {
  return {
    earned: [...state.earned], done: [...state.done], flags: { ...state.flags }, log: [...state.log],
    last: Object.create(null),
  };
}

function signature(state) {
  return JSON.stringify([[...state.earned].sort(), [...state.done].sort(), [...state.log].sort(),
    Object.entries(state.flags).sort(([a], [b]) => a.localeCompare(b))]);
}

export function validateBranch(data, steps, inventory) {
  const initial = Object.create(null);
  for (const module of data.modules) {
    for (const [flag, value] of Object.entries(module.vars ?? {})) initial[module.id + '.' + flag] = value;
  }
  data.initial = initial;
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, new Set([value])]));
  const operations = new Map(steps.map(step => [step.entry.id, new Set()]));
  for (const { entry } of steps) {
    for (const route of entry.routes.length ? entry.routes : [null]) {
      operations.get(entry.id).add(operationKey(entry, route));
      for (const [key, value] of [...Object.entries(entry.set), ...Object.entries(route?.set ?? {})]) {
        if (!values.has(key)) throw Error('unknown-state');
        values.get(key).add(value);
      }
    }
  }
  const available = token => {
    if (token.startsWith('@')) {
      const key = token.slice(1);
      const [action, route] = key.split('/');
      return route ? operations.get(action)?.has(key) : operations.has(action);
    }
    const [key, value] = token.split('=');
    return values.get(key)?.has(value);
  };
  for (const { entry } of steps) {
    if ([entry.signal, entry.alert].some(token => token && !available(token))) throw Error('unknown-signal');
  }
  if (data.modules.some(module => Object.values(module.cues ?? {}).some(token => !available(token)))) throw Error('unknown-cue');
  const moves = steps.flatMap(({ parents, entry }) => (entry.routes.length ? entry.routes : [null]).map(route => {
    const rules = [...parents, entry, ...(route ? [route] : [])];
    const tools = route?.tools ?? entry.tools;
    const module = parents[0];
    const once = module.type === 'game' || (module.type === 'random' && !module.repeat);
    return { entry, route, tools, once, needs: [...rules.flatMap(rule => rule.need), ...tools],
      when: rules.flatMap(rule => rule.when), give: [...entry.give, ...(route?.give ?? [])] };
  }));
  for (const rule of [...data.modules, ...data.modules.flatMap(module => module.apps ?? []), ...data.endings]) {
    if (rule.need.some(key => !inventory.has(key)) || rule.when.some(token => !available(token))) throw Error('bad-condition');
  }
  for (const move of moves) {
    if ([...move.needs, ...move.give].some(key => !inventory.has(key)) ||
        move.when.some(token => !available(token))) throw Error('bad-operation');
  }
  const first = branchState(data);
  if (!data.endings.length || matchedEndings(data, first).length) throw Error('missing-goal');
  const nodes = [{ state: first, parents: new Set() }];
  const indexByState = new Map([[signature(first), 0]]);
  const terminals = [], endings = new Set(), played = new Set(), earned = new Set();
  for (let index = 0; index < nodes.length; index++) {
    const { state, parents } = nodes[index];
    state.earned.forEach(key => earned.add(key));
    const outcomes = matchedEndings(data, state);
    if (outcomes.length > 1) throw Error('ambiguous-ending');
    if (outcomes.length) {
      endings.add(outcomes[0].id);
      terminals.push(index);
      continue;
    }
    const usable = new Set();
    for (const move of moves) {
      if (move.once && state.done.includes(move.entry.id)) continue;
      if (!permits(state, { need: move.needs, when: move.when })) continue;
      const selection = move.entry.id + ':' + [...move.tools].sort().join(',');
      if (usable.has(selection)) throw Error('ambiguous-route');
      usable.add(selection);
      played.add(operationKey(move.entry, move.route));
      const next = cloneState(state);
      applyMove(next, move.entry, move.route);
      const key = signature(next);
      let nextIndex = indexByState.get(key);
      if (nextIndex === undefined) {
        if (nodes.length >= 4096) throw Error('too-many-states');
        nextIndex = nodes.length;
        indexByState.set(key, nextIndex);
        nodes.push({ state: next, parents: new Set() });
      }
      if (nextIndex !== index) nodes[nextIndex].parents.add(index);
    }
  }
  const safe = new Set(terminals);
  for (let i = 0; i < terminals.length; i++) {
    for (const parent of nodes[terminals[i]].parents) {
      if (!safe.has(parent)) { safe.add(parent); terminals.push(parent); }
    }
  }
  if (safe.size !== nodes.length || endings.size !== data.endings.length ||
      played.size !== moves.length || earned.size !== inventory.size) throw Error('unreachable');
  data.branchIndex = { values, operations, signatures: new Set(indexByState.keys()) };
  return data;
}

export function restoreBranch(data, state, value) {
  const { values, operations, signatures } = data.branchIndex;
  for (const [key, valid] of values) {
    const candidate = value.flags?.[key];
    if (valid.has(candidate)) state.flags[key] = candidate;
  }
  if (Array.isArray(value.log)) {
    state.log = [...new Set(value.log.filter(key =>
      typeof key === 'string' && operations.get(key.split('/')[0])?.has(key)))];
  }
  for (const [key, valid] of operations) {
    const last = value.last?.[key];
    if (valid.has(key + '/' + last) && state.log.includes(key + '/' + last)) state.last[key] = last;
  }
  if (!signatures.has(signature(state))) Object.assign(state, branchState(data));
}
