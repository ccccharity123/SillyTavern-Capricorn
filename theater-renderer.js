import { node, button } from './theater-dom.js';
import { moduleNames } from './theater-parser.js';
import { themes } from './theater-theme.js';
import { freshState, restoreState } from './theater-state.js';
import { matchedEndings, permits } from './theater-flow.js';
import { registry } from './theater-components.js';
import { messages } from './theater-diagnostics.js';

export function renderTheater(panel, data, persistence, theme, diagnose, isCurrent) {
  let state = restoreState(data, persistence.load());
  let ui = {}, desiredFocus = '';
  const body = node(panel, 'div', 'cap-theater-body ct-body');
  const tools = node(body, 'div', 'ct-toolbar');
  const work = node(body, 'div', 'ct-work');
  const feedback = node(body, 'p', 'ct-feedback');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-atomic', 'true');
  const selectLabel = node(tools, 'label', 'ct-theme-label', '外观');
  const select = node(selectLabel, 'select', 'ct-theme');
  for (const [key, name] of Object.entries(themes)) {
    const option = node(select, 'option', '', name);
    option.value = key;
    select.append(option);
  }
  select.value = theme.get();
  select.addEventListener('change', () => theme.set(select.value));
  selectLabel.append(select);
  tools.append(selectLabel);
  const reset = node(tools, 'details', 'ct-reset');
  reset.append(node(reset, 'summary', '', '重置进度'),
    button(reset, '确认重新开始', () => {
      if (!isCurrent()) return;
      state = freshState(data);
      ui = {};
      reset.open = false;
      report(persistence.reset() ? '已重新开始。' : messages.storage);
      refresh();
    }));
  tools.append(reset);
  body.append(tools);
  if (data.description) body.append(node(body, 'p', 'ct-copy ct-intro', data.description));
  body.append(work, feedback, node(body, 'div', 'cap-theater-foot', '非正史幕间'));
  panel.append(body);
  if (persistence.failed()) report(messages.storage, true);

  function report(text, error = false) {
    feedback.dataset.error = String(error);
    feedback.textContent = text;
  }
  function save(message) {
    const ok = persistence.save(state);
    report(ok ? message : [message, messages.storage].filter(Boolean).join(' '), !ok);
  }
  function refresh() {
    if (!isCurrent()) return;
    const active = panel.ownerDocument.activeElement;
    const focusKey = desiredFocus || (work.contains(active) && active?.dataset.focusKey);
    desiredFocus = '';
    work.replaceChildren();
    try {
      const endings = matchedEndings(data, state);
      const finished = data.flow && endings.length > 0;
      const current = data.modules.find(module => module.id === state.current && permits(state, module))
        ?? data.modules.find(module => permits(state, module));
      if (data.modules.length > 1) {
        const navigation = node(work, 'nav', 'ct-stage-list');
        navigation.setAttribute('aria-label', '探索阶段');
        data.modules.forEach(module => {
          const locked = !permits(state, module);
          const control = button(navigation, module.label + (locked ? ' · 未解锁' : ''), () => {
            if (locked) return report('先在已开启的阶段寻找线索。', true);
            state.current = module.id;
            ui = {};
            save('已进入 ' + module.label);
            refresh();
          }, { key: 'stage-' + module.id });
          if (module === current) control.setAttribute('aria-current', 'step');
          // RC23: the stage list doubles as a route; mark locked and visited stops.
          const stops = module.actions ?? module.apps?.flatMap(app => app.entries) ?? module.results ?? [module.game];
          control.dataset.locked = String(locked);
          control.dataset.visited = String(stops.some(entry => state.done.includes(entry.id)));
          navigation.append(control);
        });
        work.append(navigation);
      }
      if (current) {
        const section = node(work, 'section', 'ct-stage');
        section.dataset.kind = current.type;
        section.append(node(section, 'h3', 'ct-stage-title', current.label));
        if (current.text) section.append(node(section, 'p', 'ct-copy', current.text));
        registry.get(current.type)(section, {
          data, state, ui, refresh, report, finished,
          preferFocus: key => { desiredFocus = key; },
          commit(added, message) {
            if (!isCurrent()) return;
            const names = data.items.filter(item => added.includes(item.id)).map(item => item.label);
            save(message + (names.length ? ' 获得 · ' + names.join('、') : ''));
            refresh();
          },
        }, current);
        ui.motion = null;
        ui.event = '';
        ui.leaf = '';
        work.append(section);
      }
      if (state.earned.length) {
        const bag = node(work, 'details', 'ct-inventory');
        if (ui.reward) bag.classList.add('ct-reward');
        ui.reward = false;
        bag.open = Boolean(ui.bag);
        bag.addEventListener('toggle', () => { ui.bag = bag.open; });
        bag.append(node(bag, 'summary', '', '道具与线索 · ' + state.earned.length));
        const list = node(bag, 'ul');
        data.items.filter(item => state.earned.includes(item.id)).forEach(item =>
          list.append(node(list, 'li', 'ct-copy', item.label + (item.text ? ' · ' + item.text : ''))));
        bag.append(list);
        work.append(bag);
      }
      if (data.flow && state.log.length) {
        const journal = node(work, 'details', 'ct-journal');
        journal.open = Boolean(ui.journal);
        journal.addEventListener('toggle', () => { ui.journal = journal.open; });
        journal.append(node(work, 'summary', '', '操作记录'));
        const actions = new Map(data.modules.flatMap(module =>
          module.actions ?? module.apps?.flatMap(app => app.entries) ?? module.results ?? [module.game]).map(entry => [entry.id, entry]));
        const log = node(work, 'ol');
        for (const record of state.log) {
          const [key, routeId] = record.split('/');
          const entry = actions.get(key);
          const result = entry.routes.find(route => route.id === routeId);
          log.append(node(work, 'li', 'ct-copy', entry.label + (result?.text ? ' · ' + result.text : '')));
        }
        journal.append(log);
        work.append(journal);
      }
      data.endings.forEach(ending => {
        if (!endings.includes(ending)) {
          if (!finished && !ending.hidden) work.append(node(work, 'p', 'ct-ending-locked', '结局待解锁 · ' + ending.label));
          return;
        }
        const card = node(work, 'article', 'ct-ending');
        card.append(node(card, 'strong', '', (ending.hidden ? '发现隐藏结局 · ' : '探索完成 · ') + ending.label),
          node(card, 'p', 'ct-copy', ending.text));
        work.append(card);
      });
      if (!data.endings.length) {
        const total = data.modules.reduce((sum, module) => sum +
          (module.actions?.length ?? module.apps?.reduce((count, app) => count + app.entries.length, 0) ?? module.results?.length ?? 1), 0);
        if (state.done.length >= total) work.append(node(work, 'p', 'ct-ending', '已完成本场剧场。'));
      }
    } catch {
      diagnose('render');
      work.replaceChildren(node(work, 'p', '', messages.render));
    }
    if (focusKey) {
      const next = [...work.querySelectorAll('[data-focus-key]')].find(button => button.dataset.focusKey === focusKey);
      if (next && !next.disabled) next.focus({ preventScroll: true });
      else {
        const heading = work.querySelector('.ct-stage-title');
        heading?.setAttribute('tabindex', '-1');
        heading?.focus({ preventScroll: true });
      }
    }
  }
  refresh();
}
