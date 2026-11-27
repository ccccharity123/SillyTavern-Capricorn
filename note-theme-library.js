import { compileThemeCss, NOTE_SCOPE, readThemeCss } from './theme-css.js';

const KEY = 'capricorn_note_theme_library_v1';
const MAX_THEMES = 30;
const MAX_FILE = 3_000_003;
const safeName = value => String(value ?? '').trim().slice(0, 64);
const plain = value => typeof value === 'string' ? value : '';
function normalize(theme) {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) throw Error('主题格式不正确');
  const imageUrl = plain(theme.imageUrl).trim();
  if (imageUrl) {
    const u = new URL(imageUrl);
    if (u.protocol !== 'https:' || u.username || u.password) throw Error('背景图片仅支持无凭据的 HTTPS URL');
  }
  return {
    name: safeName(theme.name) || '未命名主题',
    side: plain(theme.side), note: plain(theme.note),
    custom: plain(theme.custom), imageUrl
  };
}
export function mountNoteThemeLibrary({ D, W, host, getSnapshot, applySnapshot }) {
  if (!host) return { destroy() {} };
  let data = { themes: [], activeId: '', imageUrl: '' };
  try {
    const saved = JSON.parse(W.localStorage.getItem(KEY) || 'null');
    if (saved && Array.isArray(saved.themes)) {
      data.themes = saved.themes.slice(0, MAX_THEMES).map(t => ({
        ...normalize(t), id: String(t.id || '')
      })).filter(t => /^[a-z0-9_-]{1,60}$/i.test(t.id));
      data.activeId = String(saved.activeId || '');
      data.imageUrl = plain(saved.imageUrl);
    }
  } catch (e) { console.warn('[Capricorn] 拾忆主题库旧数据无效', e); }
  const root = D.createElement('details');
  root.className = 'cap-note-theme-library';
  root.innerHTML = '<summary>拾忆美化主题库 · 保存 / 分享</summary>';
  const content = D.createElement('div');
  content.className = 'cap-note-theme-content';
  const controls = D.createElement('div');
  controls.className = 'cap-note-theme-controls';
  const selectLabel = D.createElement('label');
  selectLabel.textContent = '已保存的主题';
  const select = D.createElement('select');
  select.setAttribute('aria-label', '拾忆主题列表');
  selectLabel.append(select);
  const nameLabel = D.createElement('label');
  nameLabel.textContent = '主题名称';
  const name = D.createElement('input');
  name.type = 'text'; name.maxLength = 64; name.placeholder = '例如：湖畔夜色';
  nameLabel.append(name);
  const imageLabel = D.createElement('label');
  imageLabel.textContent = '侧边栏背景图片 URL（HTTPS，可留空）';
  const imageInput = D.createElement('input');
  imageInput.type = 'url'; imageInput.placeholder = 'https://example.com/background.webp';
  imageLabel.append(imageInput);
  controls.append(selectLabel, nameLabel, imageLabel);
  const actions = D.createElement('div'); actions.className = 'cap-css-actions';
  const file = D.createElement('input');
  file.type = 'file'; file.accept = '.json,.css,application/json,text/css'; file.hidden = true;
  const status = D.createElement('p');
  status.className = 'cap-css-status'; status.setAttribute('role', 'status');
  content.append(controls, actions, file, status); root.append(content);
  host.append(root);
  const sheet = D.createElement('style');
  sheet.id = 'capricorn-note-theme-background';
  D.head.append(sheet);
  const buttons = new Map();
  function button(label, fn) {
    const el = D.createElement('button'); el.type = 'button';
    el.textContent = label; el.onclick = fn; actions.append(el);
    buttons.set(label, el); return el;
  }
  function notify(message) { status.textContent = message; }
  function saveStore(next) {
    W.localStorage.setItem(KEY, JSON.stringify(next));
    data = next;
  }
  function validateCss(theme) {
    const snapshot = normalize(theme);
    // Validate with the same scope and limits as the built-in CSS editor.
    compileThemeCss(snapshot.side, { W, scope: NOTE_SCOPE, declarationsFor: NOTE_SCOPE, namespace: 'note-import-side' });
    compileThemeCss(snapshot.note, { W, scope: NOTE_SCOPE, declarationsFor: NOTE_SCOPE + ' .cap-story', namespace: 'note-import-card' });
    compileThemeCss(snapshot.custom, { W, scope: NOTE_SCOPE, namespace: 'note-import-custom' });
    return snapshot;
  }
  function backgroundCss(value) {
    const url = normalize({ imageUrl: value }).imageUrl;
    const css = url ? NOTE_SCOPE + ':not(.shiyi-collapsed) { background-image: url(' + JSON.stringify(url) + ') !important; background-size: cover !important; background-position: center !important; }' : '';
    return compileThemeCss(css, { W, scope: NOTE_SCOPE, namespace: 'note-background' }).render();
  }
  function previewBackground(value) {
    const css = backgroundCss(value);
    sheet.textContent = css;
    if (css && !sheet.sheet) throw Error('背景样式无法应用，浏览器可能限制了样式注入');
  }
  function list() {
    const chosen = data.activeId;
    select.replaceChildren();
    const empty = D.createElement('option'); empty.value = ''; empty.textContent = '选择已保存的主题';
    select.append(empty);
    for (const t of data.themes) {
      const option = D.createElement('option'); option.value = t.id; option.textContent = t.name;
      select.append(option);
    }
    select.value = data.themes.some(t => t.id === chosen) ? chosen : '';
    const selected = data.themes.find(t => t.id === select.value);
    if (selected) name.value = selected.name;
  }
  function current() {
    return validateCss({ ...getSnapshot(), imageUrl: imageInput.value, name: name.value || '我的拾忆主题' });
  }
  function applySelected(theme, id = '') {
    const checked = validateCss(theme);
    const old = getSnapshot();
    const oldUrl = data.imageUrl;
    const next = { ...data, activeId: id, imageUrl: checked.imageUrl };
    const css = backgroundCss(checked.imageUrl);
    try {
      applySnapshot(checked);
      sheet.textContent = css;
      saveStore(next);
      imageInput.value = checked.imageUrl; name.value = checked.name;
      list();
      notify('主题已应用');
    } catch (e) {
      try { applySnapshot(old); previewBackground(oldUrl); } catch {}
      throw e;
    }
  }
  function download(filename, text, mime) {
    const blob = new W.Blob([text], { type: mime });
    const url = W.URL.createObjectURL(blob);
    const a = D.createElement('a'); a.href = url; a.download = filename; a.style.display = 'none';
    D.body.append(a); a.click(); a.remove();
    W.setTimeout(() => W.URL.revokeObjectURL(url), 3000);
  }
  function protect(fn) {
    return async () => { try { await fn(); } catch (e) { notify(e.message || String(e)); } };
  }
  imageInput.value = data.imageUrl;
  try { previewBackground(data.imageUrl); }
  catch(e) { imageInput.value = ''; sheet.textContent = ''; notify('已保存背景无效：' + e.message); }
  imageInput.addEventListener('input', () => {
    try { previewBackground(imageInput.value); notify('背景预览中（保存主题后生效）'); }
    catch(e) { notify(e.message); }
  });
  select.onchange = () => {
    const selected = data.themes.find(t => t.id === select.value);
    if (selected) { name.value = selected.name; imageInput.value = selected.imageUrl; }
  };
  button('应用所选', protect(() => {
    const selected = data.themes.find(t => t.id === select.value);
    if (!selected) throw Error('请先选择一套主题');
    applySelected(selected, selected.id);
  }));
  button('另存新主题', protect(() => {
    if (data.themes.length >= MAX_THEMES) throw Error('最多保存 30 套主题');
    const t = current();
    const id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    saveStore({ ...data, themes: [...data.themes, { ...t, id }], activeId: id, imageUrl: t.imageUrl });
    list(); notify('已保存：' + t.name);
  }));
  button('覆盖所选', protect(() => {
    const id = select.value;
    if (!data.themes.some(t => t.id === id)) throw Error('请先选择一套已保存的主题');
    const t = current();
    saveStore({ ...data, themes: data.themes.map(old => old.id === id ? { ...t, id } : old), activeId: id, imageUrl: t.imageUrl });
    list(); notify('已更新：' + t.name);
  }));
  button('删除所选', protect(() => {
    const id = select.value;
    if (!data.themes.some(t => t.id === id)) throw Error('请先选择要删除的主题');
    if (!W.confirm('删除选中的拾忆主题？不会删除当前 CSS 设置。')) return;
    saveStore({ ...data, themes: data.themes.filter(t => t.id !== id), activeId: data.activeId === id ? '' : data.activeId });
    list(); notify('主题已删除');
  }));
  button('导入 JSON / CSS', () => file.click());
  file.onchange = protect(async () => {
    try {
      const f = file.files?.[0]; if (!f) return;
      if (f.size > MAX_FILE) throw Error('文件过大，请使用小于 3MB 的主题文件');
      const raw = f.name.toLowerCase().endsWith('.css') ? await readThemeCss(f) : await f.text();
      let theme;
      if (f.name.toLowerCase().endsWith('.css')) theme = { name: f.name.replace(/\.css$/i, ''), side: '', note: '', custom: raw, imageUrl: '' };
      else {
        const payload = JSON.parse(raw);
        if (payload.format !== 'capricorn-note-theme' || payload.version !== 1) throw Error('不是拾忆主题 JSON（v1）');
        theme = payload.theme;
      }
      const t = validateCss(theme);
      if (data.themes.length >= MAX_THEMES) throw Error('最多保存 30 套主题');
      const id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      saveStore({ ...data, themes: [...data.themes, { ...t, id }], activeId: '' });
      list(); select.value = id; name.value = t.name; notify('导入成功，点击「应用所选」即可切换');
    } finally { file.value = ''; }
  });
  button('导出主题 JSON', protect(() => {
    const t = data.themes.find(t => t.id === select.value) ?? current();
    const { id, ...theme } = t;
    download('capricorn-note-theme.json', JSON.stringify({ format: 'capricorn-note-theme', version: 1, theme }, null, 2), 'application/json');
    notify('已导出 JSON');
  }));
  button('导出当前 CSS', protect(() => {
    const t = current();
    // CSS export is for readers and manual editing. Import the JSON to preserve the separate background URL.
    const css = [
      NOTE_SCOPE + ' {\n' + t.side + '\n}',
      NOTE_SCOPE + ' .cap-story {\n' + t.note + '\n}',
      t.custom,
      backgroundCss(t.imageUrl)
    ].filter(Boolean).join('\n\n');
    download('capricorn-note-theme.css', css, 'text/css');
    notify('已导出 CSS；完整主题分享建议使用 JSON');
  }));
  list();
  return {
    destroy() { sheet.remove(); root.remove(); },
    syncCurrent() {
      if (imageInput !== D.activeElement) imageInput.value = data.imageUrl;
    }
  };
}
