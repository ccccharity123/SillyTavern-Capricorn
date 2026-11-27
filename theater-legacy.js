import { node, button } from './theater-dom.js';

function short(value, n = 160) { return String(value ?? '').slice(0, n); }
export function legacyData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = ['flip', 'reveal', 'slide'].includes(raw.type) ? raw.type : null;
  if (!type) return null;
  const title = short(raw.title || '今日小剧场', 65);
  const note = short(raw.note || '', 180);
  if (type === 'slide') {
    if (!Array.isArray(raw.steps)) return null;
    const steps = raw.steps.slice(0, 8).map(x => ({
      title: short(x?.title, 80), text: short(x?.text, 320), symbol: short(x?.symbol || '✦', 4),
    })).filter(x => x.title || x.text);
    return steps.length >= 2 ? { type, title, note, steps } : null;
  }
  if (!Array.isArray(raw.items)) return null;
  const items = raw.items.slice(0, 8).map(x => ({
    front: short(x?.front || x?.label || '翻开', 90), back: short(x?.back || x?.text || '', 350),
  })).filter(x => x.back);
  return items.length ? { type, title, note, items } : null;
}

export function renderLegacy(frame, data, state, save, reset) {
  const element = (tag, cls, label) => node(frame, tag, cls, label);
  const body = element('div', 'cap-theater-body');
  const note = data.note && element('p', 'cap-theater-note', data.note);
  if (note) body.append(note);
  if (data.type === 'flip' || data.type === 'reveal') {
    const grid = element('div', `cap-theater-grid cap-theater-${data.type}`);
    data.items.forEach((item, index) => {
      const button = element('button', 'cap-theater-card');
      button.type = 'button';
      button.setAttribute('aria-pressed', state[index] ? 'true' : 'false');
      const front = element('span', 'cap-theater-front', item.front);
      const back = element('span', 'cap-theater-back', item.back);
      const show = () => {
        button.classList.toggle('cap-theater-uncovered', Boolean(state[index]));
        button.setAttribute('aria-pressed', state[index] ? 'true' : 'false');
        front.hidden = Boolean(state[index]);
        back.hidden = !state[index];
      };
      button.append(front, back);
      button.addEventListener('click', () => {
        state[index] = data.type === 'reveal' ? true : !state[index];
        save(state); show();
      });
      show(); grid.append(button);
    });
    body.append(grid);
  } else {
    const scene = element('div', 'cap-theater-slide-scene');
    const symbol = element('div', 'cap-theater-slide-symbol');
    const title = element('strong', 'cap-theater-slide-title');
    const text = element('p', 'cap-theater-slide-text');
    const stepCount = element('span', 'cap-theater-step-count');
    const range = element('input', 'cap-theater-range');
    range.type = 'range'; range.min = '0'; range.max = String(data.steps.length - 1);
    range.step = '1'; range.setAttribute('aria-label', '拖动探索小剧场');
    const prev = element('button', 'cap-theater-step-button', '‹');
    const next = element('button', 'cap-theater-step-button', '›');
    prev.type = next.type = 'button';
    const controls = element('div', 'cap-theater-slide-controls');
    const setIndex = (x, persist = true) => {
      const index = Math.max(0, Math.min(data.steps.length - 1, Number(x) || 0));
      if (state.index !== index) { state.index = index; if (persist) save(state); }
      const step = data.steps[index];
      symbol.textContent = step.symbol; title.textContent = step.title; text.textContent = step.text;
      range.value = String(index); stepCount.textContent = `${index + 1} / ${data.steps.length}`;
      prev.disabled = index === 0; next.disabled = index === data.steps.length - 1;
    };
    range.addEventListener('input', () => setIndex(range.value));
    prev.addEventListener('click', () => setIndex((state.index ?? 0) - 1));
    next.addEventListener('click', () => setIndex((state.index ?? 0) + 1));
    scene.append(symbol, title, text); controls.append(prev, range, next, stepCount);
    body.append(scene, controls); setIndex(Math.trunc(state.index) || 0, false);
  }
  const foot = element('div', 'cap-theater-foot', '独立趣味片段 · 不影响正文与人物状态');
  body.append(button(frame, '重新开始', reset), foot);
  frame.append(body);
}

