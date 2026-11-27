import { hasOwn } from './compat.js';
import { appNames, objectNames } from './theater-parser.js';
import { node, button } from './theater-dom.js';
import { permits } from './theater-flow.js';
import { scenery } from './theater-scenography.js';
import { propArt } from './theater-prop-art.js';
import { availableRoutes, draw, interact, rarityLabels, solve } from './theater-interactions.js';

const appIcons = { chat: '◌', photos: '▧', notes: '▤', calls: '◔', calendar: '□', mail: '✉', files: '▱', music: '♫' };
const closeLabels = { drawer: '合上抽屉', letter: '折起信件', recorder: '停止播放', gift: '盖上盒盖' };

function showEntry(target, ctx, entry, outcome) {
  target.append(node(target, 'strong', '', entry.label));
  const pages = [outcome?.text || entry.text, ...entry.pages].filter(Boolean);
  const index = Math.min(ctx.ui.page || 0, pages.length - 1);
  target.append(node(target, 'p', 'ct-copy ct-object-page', pages[index]));
  if (pages.length > 1) {
    const nav = node(target, 'div', 'ct-row');
    const step = delta => {
      ctx.ui.page = index + delta;
      ctx.ui.leaf = delta > 0 ? 'next' : 'previous';
      ctx.refresh();
    };
    nav.append(
      button(target, '上一页', () => step(-1), { disabled: !index, key: 'previous-page' }),
      node(target, 'span', '', (index + 1) + ' / ' + pages.length),
      button(target, entry.kind === 'wheel' ? '转到下一格' : entry.kind === 'recorder' ? '下一段' : '下一页', () => step(1), { disabled: index === pages.length - 1, key: 'next-page' }),
    );
    target.append(nav);
  }
}

function toolCount(entry) {
  return entry.routes[0]?.tools.length ?? entry.tools.length;
}

function activate(ctx, entry, tools = []) {
  const before = { ...ctx.state.flags };
  const outcome = interact(ctx.state, entry, tools);
  if (outcome.error) {
    ctx.report(outcome.error, true);
    return;
  }
  ctx.ui.motion = { id: entry.id, changed: Object.keys(before).filter(key => before[key] !== ctx.state.flags[key]) };
  ctx.ui.reward = outcome.added.length > 0;
  ctx.ui.event = entry.kind === 'combine' ? 'join' : tools.length ? 'mechanism' : '';
  ctx.ui.tools = [];
  ctx.commit(outcome.added, outcome.route?.text || (tools.length ? '操作成功。' : objectNames[entry.kind] + ' · ' + entry.label));
}

function toolPicker(target, ctx, entry) {
  const count = toolCount(entry);
  if (entry.branch) {
    const tray = node(target, 'div', 'ct-tray');
    const tools = ctx.ui.tools ??= [];
    tray.append(node(tray, 'p', 'ct-copy', '选择 ' + count + ' 件道具放入机关。'));
    const row = node(tray, 'div', 'ct-row');
    ctx.data.items.filter(item => ctx.state.earned.includes(item.id)).forEach(item => {
      const selected = tools.includes(item.id);
      const key = 'tool-' + item.id;
      const control = button(tray, item.label, () => {
        if (selected) tools.splice(tools.indexOf(item.id), 1);
        else if (tools.length < count) tools.push(item.id);
        else return ctx.report('先取下一件已摆放的道具。', true);
        ctx.refresh();
      }, { key, className: 'ct-button ct-token' });
      control.setAttribute('aria-pressed', String(selected));
      row.append(control);
    });
    const sockets = node(tray, 'div', 'ct-sockets');
    const last = entry.routes.find(route => route.id === ctx.state.last[entry.id]);
    const settled = !tools.length && ctx.state.done.includes(entry.id);
    const displayed = settled ? (last?.tools ?? entry.tools) : tools;
    for (let slot = 0; slot < count; slot++) {
      const item = ctx.data.items.find(item => item.id === displayed[slot]);
      const socket = node(tray, 'span', 'ct-socket', item?.label ?? '空位');
      socket.dataset.full = String(Boolean(item));
      if (settled && item) socket.dataset.settled = 'true';
      sockets.append(socket);
    }
    tray.append(row, sockets, button(tray, objectNames[entry.kind], () => activate(ctx, entry, [...tools]), {
      disabled: tools.length !== count, key: 'confirm-tool',
    }));
    target.append(tray);
    return;
  }
  const selects = Array.from({ length: count }, (_, index) => {
    const wrapper = node(target, 'label', 'ct-tool', '物品 ' + (index + 1));
    const select = node(target, 'select');
    const add = (label, value) => {
      const option = node(target, 'option', '', label);
      option.value = value;
      select.append(option);
    };
    add('选择已获得的物品', '');
    ctx.data.items.filter(item => ctx.state.earned.includes(item.id)).forEach(item => add(item.label, item.id));
    wrapper.append(select);
    target.append(wrapper);
    return select;
  });
  target.append(button(target, objectNames[entry.kind], () => activate(ctx, entry, selects.map(select => select.value)), { key: 'confirm-tool' }));
}

function renderObjects(target, ctx, module) {
  const grid = node(target, 'div', 'ct-props');
  grid.setAttribute('aria-label', module.label);
  const positions = module.actions.map(entry => entry.at?.join(','));
  const spatial = positions.every(Boolean) && new Set(positions).size === positions.length;
  if (spatial) grid.classList.add('ct-spatial');
  const scene = scenery(grid, module, ctx.state, ctx.finished);
  const motion = ctx.ui.motion;
  if (motion) scene.dataset.transition = ctx.finished ? 'ending' : motion.changed.length ? 'state' : '';
  const isPowered = (entry, done) => entry.signal
    ? permits(ctx.state, { need: [], when: [entry.signal] })
    : done && ['lever', 'lamp', 'slot', 'lock', 'use', 'combine'].includes(entry.kind);
  module.actions.forEach(entry => {
    const selected = ctx.ui.entry === entry.id;
    const unavailable = !permits(ctx.state, entry) || entry.routes.length > 0 && !availableRoutes(ctx.state, entry).length;
    const done = ctx.state.done.includes(entry.id);
    const [signal] = entry.signal.split('=');
    const powered = isPowered(entry, done);
    const locked = unavailable && !(ctx.finished && done);
    const control = button(grid, entry.label + (locked ? ' · 未解锁' : done ? ' · 已操作' : ''), () => {
      if (ctx.finished) {
        ctx.ui.entry = selected ? '' : entry.id;
        ctx.ui.page = 0;
        return ctx.refresh();
      }
      if (locked) return ctx.report('当前条件还不满足，先检查其他物件。', true);
      ctx.ui.page = 0;
      ctx.ui.tools = [];
      const mechanical = entry.kind === 'lever';
      ctx.ui.entry = selected && !mechanical ? '' : entry.id;
      if ((!selected || mechanical) && !toolCount(entry)) activate(ctx, entry);
      else {
        ctx.ui.motion = { id: entry.id, changed: [] };
        ctx.refresh();
      }
    }, { key: 'entry-' + entry.id, className: 'ct-button ct-prop', disabled: ctx.finished && !done });
    const caption = node(control, 'span', 'ct-prop-label', entry.label);
    if (locked) control.setAttribute('aria-label', entry.label + ' · 未解锁');
    control.replaceChildren(propArt(grid, entry.kind), caption);
    control.dataset.scale = entry.scale;
    control.dataset.found = String(done && entry.give.some(key => ctx.state.earned.includes(key)));
    control.dataset.done = String(done);
    control.dataset.anomaly = String(Boolean(entry.alert && permits(ctx.state, { need: [], when: [entry.alert] })));
    if (selected && ctx.ui.page) control.dataset.page = 'turned';
    if (motion?.id === entry.id && ctx.ui.event) control.dataset.event = ctx.ui.event;
    control.dataset.prop = entry.kind;
    control.dataset.power = String(powered);
    control.dataset.open = String(selected);
    control.dataset.locked = String(locked);
    if (motion?.id === entry.id || signal && motion?.changed.includes(signal)) control.dataset.changed = 'true';
    if (spatial) {
      control.style.setProperty('--ct-x', entry.at[0]);
      control.style.setProperty('--ct-y', entry.at[1]);
    }
    control.setAttribute('aria-expanded', String(selected));
    grid.append(control);
  });
  target.append(scene);
  const active = module.actions.find(entry => entry.id === ctx.ui.entry);
  if (!active) return;
  const detail = node(target, 'article', 'ct-object');
  detail.dataset.object = active.kind;
  detail.dataset.open = 'true';
  detail.dataset.page = ctx.ui.page ? 'turned' : 'first';
  if (ctx.ui.leaf) detail.dataset.leaf = ctx.ui.leaf;
  detail.dataset.found = String(active.give.some(key => ctx.state.earned.includes(key)));
  detail.dataset.power = String(isPowered(active, ctx.state.done.includes(active.id)));
  detail.dataset.anomaly = String(Boolean(active.alert && permits(ctx.state, { need: [], when: [active.alert] })));
  const zoom = node(detail, 'div', 'ct-object-zoom');
  zoom.append(propArt(detail, active.kind));
  detail.append(zoom);
  const operated = ctx.state.done.includes(active.id);
  const outcome = active.branch && active.routes.find(route => route.id === ctx.state.last[active.id]);
  if (!toolCount(active) || operated) showEntry(detail, ctx, active, outcome);
  else detail.append(node(detail, 'strong', '', active.label));
  if (!ctx.finished && toolCount(active) && (!operated || active.branch)) toolPicker(detail, ctx, active);
  detail.append(button(detail, closeLabels[active.kind] || '收起特写', () => {
    ctx.ui.entry = '';
    ctx.ui.motion = { id: active.id, changed: [] };
    ctx.preferFocus('entry-' + active.id);
    ctx.refresh();
  }, { key: 'close-object' }));
  target.append(detail);
}

function renderPhone(target, ctx, module) {
  const phone = node(target, 'div', 'ct-phone');
  target.append(phone);
  const app = module.apps.find(app => app.id === ctx.ui.app);
  if (!app) {
    phone.append(node(phone, 'strong', 'ct-phone-bar', '应用桌面'));
    const launcher = node(phone, 'div', 'ct-apps');
    module.apps.forEach(app => {
      const locked = !permits(ctx.state, app);
      const unread = app.entries.filter(entry => permits(ctx.state, entry) && !ctx.state.done.includes(entry.id)).length;
      const key = 'app-' + app.id;
      const control = button(phone, app.label, () => {
        if (locked) return ctx.report('这个应用还未解锁。', true);
        ctx.ui.app = app.id;
        ctx.ui.entry = '';
        ctx.preferFocus('phone-home');
        ctx.refresh();
      }, { key, className: 'ct-button ct-app' });
      control.prepend(node(phone, 'span', 'ct-app-icon', appIcons[app.kind]));
      if (locked || unread) control.append(node(phone, 'small', 'ct-app-badge', locked ? '未解锁' : unread + ' 未读'));
      launcher.append(control);
    });
    phone.append(launcher);
    return;
  }
  phone.dataset.app = app.kind;
  const bar = node(phone, 'div', 'ct-row ct-phone-bar');
  bar.append(button(phone, '‹ 桌面', () => {
    ctx.ui.app = '';
    ctx.ui.entry = '';
    ctx.preferFocus('app-' + app.id);
    ctx.refresh();
  }, { key: 'phone-home' }), node(phone, 'strong', '', app.label || appNames[app.kind]));
  phone.append(bar);
  if (app.text) phone.append(node(phone, 'p', 'ct-copy', app.text));
  const list = node(phone, 'div', 'ct-app-list');
  for (const entry of app.entries) {
    const done = ctx.state.done.includes(entry.id);
    const locked = !permits(ctx.state, entry);
    const active = ctx.ui.entry === entry.id;
    const control = button(list, entry.label + (locked ? ' · 未解锁' : done ? '' : ' · 未读'), () => {
      if (ctx.finished) return;
      if (locked) return ctx.report('先查看相关应用中的线索。', true);
      ctx.ui.entry = active ? '' : entry.id;
      ctx.ui.page = 0;
      if (active) ctx.refresh();
      else ctx.commit(interact(ctx.state, entry).added, '已查看 · ' + entry.label);
    }, { key: 'phone-entry-' + entry.id, disabled: ctx.finished });
    control.setAttribute('aria-expanded', String(active));
    list.append(control);
    if (active) {
      const detail = node(list, 'article', 'ct-app-entry');
      showEntry(detail, ctx, entry);
      list.append(detail);
    }
  }
  phone.append(list);
}

function renderRandom(target, ctx, module) {
  const board = node(target, 'section', 'ct-random');
  board.dataset.mode = module.mode;
  const round = hasOwn(ctx.state.rounds, module.id) ? ctx.state.rounds[module.id] : undefined;
  const result = module.results.find(entry => entry.id === round?.last);
  const count = module.results.filter(entry => ctx.state.done.includes(entry.id)).length;
  board.append(node(board, 'strong', '', '收集 ' + count + ' / ' + module.results.length));
  const drawLabel = { dice: '掷骰', event: '触发事件', draw: '抽签' }[module.mode];
  function roll(unseenOnly = false) {
    if (ctx.finished) return;
    const outcome = draw(ctx.state, module, Math.random, unseenOnly);
    if (outcome) ctx.commit(outcome.added, outcome.duplicate ? '重复结果，已收集的记录仍保留。' : '已记录新结果。');
  }
  board.append(button(board, drawLabel, () => roll(), {
    disabled: ctx.finished || !module.repeat && count === module.results.length, key: 'draw',
  }));
  if (!ctx.finished && module.repeat && round?.duplicate && count < module.results.length) {
    board.append(button(board, '开启未收集记录', () => roll(true), { key: 'unseen' }));
  }
  if (result) {
    const card = node(board, 'article', 'ct-result');
    card.dataset.rarity = result.rarity;
    if (module.mode === 'dice') card.append(node(board, 'span', 'ct-die', String(module.results.indexOf(result) + 1)));
    const face = module.mode === 'dice' ? ' · ' + (module.results.indexOf(result) + 1) + ' 点' : '';
    card.append(node(board, 'span', '', rarityLabels[result.rarity] + face),
      node(board, 'strong', '', result.label), node(board, 'p', 'ct-copy', result.text));
    board.append(card);
  }
  if (count) {
    const book = node(board, 'details', 'ct-result-book');
    book.open = Boolean(ctx.ui.book);
    book.addEventListener('toggle', () => { ctx.ui.book = book.open; });
    book.append(node(book, 'summary', '', '已收集结果'));
    module.results.filter(entry => ctx.state.done.includes(entry.id)).forEach(entry => {
      const record = node(book, 'article', 'ct-record');
      record.append(node(record, 'strong', '', entry.label + ' · ' + rarityLabels[entry.rarity]),
        node(record, 'p', 'ct-copy', entry.text));
      book.append(record);
    });
    board.append(book);
  }
  target.append(board);
}

function renderGame(target, ctx, module) {
  const game = module.game;
  const board = node(target, 'section', 'ct-game');
  board.dataset.mode = game.mode;
  target.append(board);
  board.append(node(board, 'strong', '', game.label));
  const verify = value => {
    const result = solve(ctx.state, game, value);
    if (result.error) ctx.report(result.error, true);
    else ctx.commit(result.added, '已完成。');
  };
  if (!permits(ctx.state, game)) {
    board.append(node(board, 'p', '', '取得线索后可开始。'));
    return;
  }
  if (ctx.state.done.includes(game.id)) {
    showEntry(board, ctx, game);
    return;
  }
  if (ctx.finished) return;
  // RC23: a reasoning question pins the clues already in hand beside the answer.
  const evidence = ctx.data.items.filter(item => item.text && ctx.state.earned.includes(item.id));
  if (game.mode === 'choose' && evidence.length) {
    const pin = node(board, 'div', 'ct-evidence');
    pin.append(node(pin, 'span', 'ct-evidence-title', '手上的线索 · ' + evidence.length));
    for (const item of evidence) {
      const card = node(pin, 'div', 'ct-evidence-card');
      card.append(node(card, 'strong', '', item.label), node(card, 'p', 'ct-copy', item.text));
      pin.append(card);
    }
    board.append(pin);
  }
  if (game.mode === 'code') {
    const label = node(board, 'label', 'ct-tool', '输入密码');
    const input = node(board, 'input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.maxLength = 8;
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      verify(input.value);
    });
    label.append(input);
    board.append(label, button(board, '开锁', () => verify(input.value), { key: 'verify-game' }));
    return;
  }
  const selection = ctx.ui.selection ??= [];
  const controls = node(board, 'div', 'ct-row');
  game.choices.forEach((choice, index) => {
    const position = selection.indexOf(index);
    const control = button(controls, position < 0 ? choice : (position + 1) + '. ' + choice, () => {
      if (position < 0) selection.push(index);
      else selection.splice(position, 1);
      ctx.refresh();
    }, { key: 'choice-' + index });
    control.setAttribute('aria-pressed', String(position >= 0));
    controls.append(control);
  });
  board.append(node(board, 'p', '', game.mode === 'order' ? '按正确顺序选择，点选已选项可撤销。' : '选出符合线索的项目。'),
    controls, button(board, '提交答案', () => verify(selection), { key: 'verify-game' }));
}

// RC23: dialogue replay. The player tries lines; each reply unfolds like a chat.
function bubble(parent, who, words, side) {
  const element = node(parent, 'div', 'ct-bubble');
  element.dataset.side = side;
  if (who) element.append(node(element, 'span', 'ct-bubble-who', who));
  element.append(node(element, 'p', 'ct-copy', words));
  return element;
}

function pickEntry(ctx, entry, locked, done, lockedMessage, message) {
  if (locked) return ctx.report(lockedMessage, true);
  ctx.ui.entry = entry.id;
  ctx.ui.page = 0;
  if (done || ctx.finished) return ctx.refresh();
  const outcome = interact(ctx.state, entry);
  if (outcome.error) return ctx.report(outcome.error, true);
  ctx.commit(outcome.added, message);
}

function renderTalk(target, ctx, module) {
  const box = node(target, 'section', 'ct-talk');
  const log = node(box, 'div', 'ct-talk-log');
  log.setAttribute('aria-live', 'polite');
  if (module.prompt) log.append(bubble(log, module.speaker, module.prompt, 'them'));
  const active = module.actions.find(entry => entry.id === ctx.ui.entry);
  if (active) {
    log.append(bubble(log, '你', active.label, 'you'));
    const pages = [active.text, ...active.pages].filter(Boolean);
    const shown = Math.min(ctx.ui.page || 0, pages.length - 1);
    pages.slice(0, shown + 1).forEach(words => log.append(bubble(log, module.speaker, words, 'them')));
    if (shown < pages.length - 1) {
      log.append(button(log, '……然后呢', () => {
        ctx.ui.page = shown + 1;
        ctx.preferFocus('talk-more');
        ctx.refresh();
      }, { key: 'talk-more', className: 'ct-button ct-talk-more' }));
    }
  }
  box.append(log);
  const options = node(box, 'div', 'ct-talk-options');
  options.setAttribute('role', 'group');
  options.append(node(options, 'p', 'ct-talk-hint', active ? '如果那时换一种说法——' : '你要怎么回答？'));
  for (const entry of module.actions) {
    const done = ctx.state.done.includes(entry.id);
    const locked = !permits(ctx.state, entry);
    const control = button(options, entry.label, () => {
      ctx.preferFocus('line-' + entry.id);
      pickEntry(ctx, entry, locked, done, '这句话现在还说不出口。', '你说出了这一句。');
    }, { key: 'line-' + entry.id, className: 'ct-button ct-line', disabled: ctx.finished && !done });
    control.dataset.done = String(done);
    control.dataset.locked = String(locked);
    control.setAttribute('aria-pressed', String(entry === active));
    if (locked) control.setAttribute('aria-label', entry.label + ' · 未解锁');
    options.append(control);
  }
  const said = module.actions.filter(entry => ctx.state.done.includes(entry.id)).length;
  if (module.actions.length > 1) options.append(node(options, 'small', 'ct-talk-count', '已试过 ' + said + ' / ' + module.actions.length + ' 种说法'));
  box.append(options);
  target.append(box);
}

// RC23: one event, several people's versions of it.
function renderViews(target, ctx, module) {
  const box = node(target, 'section', 'ct-views');
  const tabs = node(box, 'div', 'ct-view-tabs');
  tabs.setAttribute('role', 'tablist');
  const active = module.actions.find(entry => entry.id === ctx.ui.entry);
  for (const entry of module.actions) {
    const done = ctx.state.done.includes(entry.id);
    const locked = !permits(ctx.state, entry);
    const control = button(tabs, entry.label, () => {
      ctx.preferFocus('view-' + entry.id);
      pickEntry(ctx, entry, locked, done, '还不知道这个人怎么看。', '换到 ' + entry.label + ' 的视角。');
    }, { key: 'view-' + entry.id, className: 'ct-button ct-view-tab', disabled: ctx.finished && !done });
    control.setAttribute('role', 'tab');
    control.setAttribute('aria-selected', String(entry === active));
    control.dataset.done = String(done);
    control.dataset.locked = String(locked);
    if (locked) control.setAttribute('aria-label', entry.label + ' · 未解锁');
    tabs.append(control);
  }
  box.append(tabs);
  if (active) {
    const card = node(box, 'article', 'ct-view');
    card.setAttribute('role', 'tabpanel');
    showEntry(card, ctx, active);
    box.append(card);
  } else {
    box.append(node(box, 'p', 'ct-copy ct-view-hint', '选一个人，看看他记得的版本。'));
  }
  const seen = module.actions.filter(entry => ctx.state.done.includes(entry.id)).length;
  box.append(node(box, 'small', 'ct-talk-count', '已看 ' + seen + ' / ' + module.actions.length + ' 个视角'));
  target.append(box);
}

export const registry = new Map([
  ['scene', renderObjects], ['objects', renderObjects], ['phone', renderPhone],
  ['random', renderRandom], ['game', renderGame],
  ['talk', renderTalk], ['views', renderViews],
]);
