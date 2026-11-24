export function mountAppearance(settings, root, themeSelect, memoryRoot) {
  const D = root.ownerDocument, W = D.defaultView, key = 'capricorn_appearance_v1';
  const defaults = {
    material: 'frost',
    paper: 'warm',
    paperMode: 'auto',
    paperPattern: 'dots',
    noteDecor: 'tape',
    side: '',
    note: '',
    custom: ''
  };
  let p = { ...defaults };
  try { p = { ...p, ...JSON.parse(W.localStorage.getItem(key) || '{}') }; } catch {}

  const PRESETS = {
    glass: {
      side: '--note-bg: rgba(255, 252, 245, 0.78);\n--note-blur: 22px;\n--note-width: 380px;',
      note: '--note-card: rgba(255, 255, 255, 0.72);\n--note-radius: 14px;\n--note-shadow: 0 4px 16px rgba(0,0,0,0.06);',
      custom: ''
    },
    kraft: {
      side: '--note-bg: #dfd0b8;\n--note-line: #c4b090;\n--note-fg: #3b2f22;\n--note-muted: #75614a;\n--note-tab-bg: #c9b28e;\n--note-tab-fg: #3b2f22;',
      note: '--note-card: #efe3cf;\n--note-accent: #a67c52;\n--note-radius: 6px;',
      custom: '.cap-story-title { letter-spacing: 0.03em; }'
    },
    compact: {
      side: '--note-width: 320px;\nborder-radius: 20px 0 0 20px;',
      note: '--note-radius: 10px;\npadding: 11px 12px;\nfont-size: 13px;',
      custom: '.cap-story-title { font-size: 14px; }'
    },
    journal: {
      side: '--note-width: 420px;',
      note: '--note-radius: 16px;\nfont-size: 15px;\nline-height: 1.85;',
      custom: '.cap-story p { text-indent: 1.5em; }'
    }
  };

  function buildForm(compact = false) {
    const el = D.createElement('section');
    el.className = compact ? 'cap-appearance cap-appearance-inline' : 'cap-appearance';
    el.innerHTML = `
      ${compact ? '' : `
        <h4>外观与材质</h4>
        <label>声屿材质
          <select data-pref="material">
            <option value="glass">液态玻璃 (Liquid Glass)</option>
            <option value="frost">Apple 磨砂玻璃</option>
            <option value="solid">极简实色</option>
          </select>
        </label>
      `}
      <div class="cap-appearance-grid">
        <label>拾忆明暗
          <select data-pref="paperMode">
            <option value="auto">跟随系统</option>
            <option value="light">日间纸张</option>
            <option value="dark">夜间墨色</option>
          </select>
        </label>
        <label>便签主题
          <select data-pref="paper">
            <option value="warm">暖白手账</option>
            <option value="yellow">经典黄便签</option>
            <option value="cream">奶油信纸</option>
            <option value="sage">鼠尾草绿</option>
            <option value="sakura">樱粉便签</option>
            <option value="sky">晴空蓝笺</option>
            <option value="white">极简纯白</option>
            <option value="ink">暗夜墨笺</option>
          </select>
        </label>
        <label>纸张底纹
          <select data-pref="paperPattern">
            <option value="dots">点阵手账</option>
            <option value="grid">方格便签</option>
            <option value="lines">横线信纸</option>
            <option value="none">纯净素纸</option>
          </select>
        </label>
        <label>便签装饰
          <select data-pref="noteDecor">
            <option value="tape">和纸胶带</option>
            <option value="strip">顶部色条</option>
            <option value="fold">折角便签</option>
            <option value="minimal">极简无饰</option>
          </select>
        </label>
      </div>
      <details class="cap-css-editor" ${compact ? '' : 'open'}>
        <summary>拾忆自定义 CSS（侧边栏 & 便签主题）</summary>
        <p class="cap-css-hint">支持实时预览，不加载外部资源。可用变量：<code>--note-bg</code> <code>--note-width</code> <code>--note-blur</code> <code>--note-card</code> <code>--note-accent</code> <code>--note-fg</code> <code>--note-radius</code> <code>--note-tab-bg</code></p>
        <div class="cap-css-presets">
          <span>快捷模板：</span>
          <button type="button" data-preset="glass">磨砂浮窗</button>
          <button type="button" data-preset="kraft">复古牛皮纸</button>
          <button type="button" data-preset="compact">紧凑窄栏</button>
          <button type="button" data-preset="journal">手账大字</button>
        </div>
        <label>侧边栏样式声明（无需大括号）
          <textarea data-css="side" rows="3" placeholder="--note-bg: #f6efe2;\n--note-width: 380px;\n--note-blur: 14px;"></textarea>
        </label>
        <label>便签卡片样式声明（无需大括号）
          <textarea data-css="note" rows="3" placeholder="--note-card: #fff8dc;\n--note-accent: #f2b705;\n--note-radius: 12px;\nfont-size: 14px;"></textarea>
        </label>
        <label>高级自定义 CSS（自动限定在拾忆侧边栏内）
          <textarea data-css="custom" rows="3" placeholder=".cap-story-title { color: #8c4a27; }\n#shiyi-expand { border-left: 4px solid #f2b705; }"></textarea>
        </label>
        <div class="cap-css-actions">
          <button type="button" data-save class="cap-btn-primary">保存并应用</button>
          <button type="button" data-reset>恢复默认 CSS</button>
        </div>
        <p data-status role="status" class="cap-css-status"></p>
      </details>
    `;
    return el;
  }

  const boxes = [];
  const mainBox = buildForm(false);
  mainBox.querySelectorAll('.cap-appearance-grid, .cap-css-editor').forEach(el => el.remove());
  settings.prepend(mainBox);
  boxes.push(mainBox);

  let inlineDrawer = null;
  if (memoryRoot) {
    inlineDrawer = D.createElement('div');
    inlineDrawer.className = 'cap-note-customizer';
    inlineDrawer.hidden = true;
    const inlineBox = buildForm(true);
    inlineDrawer.append(inlineBox);
    boxes.push(inlineBox);
    const contentHost = memoryRoot.querySelector('.shiyi-dock-content');
    const timelineEl = memoryRoot.querySelector('.cap-timeline');
    if (timelineEl) timelineEl.before(inlineDrawer);
    else contentHost?.append(inlineDrawer);
  }

  const media = W.matchMedia('(prefers-color-scheme: dark)');
  const sheet = D.createElement('style');
  sheet.id = 'capricorn-custom-note-css';
  D.head.append(sheet);

  function declarations(s) {
    if (typeof s !== 'string' || s.length > 8000 || /[{}@\\<>]/.test(s) || /url\s*\(|image-set\s*\(|expression\s*\(|javascript:/i.test(s)) {
      throw Error('声明仅支持本地 CSS 属性，不支持大括号、@ 规则或外部资源');
    }
    return s;
  }

  function scopedCss(s) {
    if (typeof s !== 'string' || s.length > 12000) throw Error('高级 CSS 长度超出限制');
    if (/[<>\\]|@import|@charset|@font-face|url\s*\(|image-set\s*\(|expression\s*\(|javascript:/i.test(s)) {
      throw Error('高级 CSS 不支持外部资源、@import 或不安全字符');
    }
    const cleaned = s.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!cleaned) return '';
    // 将每条规则的选择器安全限定在 #shiyi-dock.cap-memory-side 作用域内
    return cleaned.replace(/([^{}]+)\{([^{}]*)\}/g, (_, sel, body) => {
      const scoped = sel.split(',').map(part => {
        const t = part.trim();
        if (!t) return '';
        if (t.startsWith('#shiyi-dock')) return t;
        return `#shiyi-dock.cap-memory-side ${t}`;
      }).filter(Boolean).join(', ');
      return scoped ? `${scoped} { ${body} }\n` : '';
    });
  }

  function syncForms(sourceBox = null) {
    for (const box of boxes) {
      if (box === sourceBox) continue;
      for (const el of box.querySelectorAll('[data-pref]')) {
        const k = el.dataset.pref;
        if (Array.from(el.options).some(o => o.value === p[k])) el.value = p[k];
      }
      for (const k of ['side', 'note', 'custom']) {
        const ta = box.querySelector(`[data-css="${k}"]`);
        if (ta && ta.value !== (p[k] || '')) ta.value = p[k] || '';
      }
    }
  }

  function apply(draft = p) {
    const b = D.body;
    b.dataset.capMaterial = draft.material;
    b.dataset.capLook = themeSelect.value === 'auto' ? (media.matches ? 'dark' : 'light') : themeSelect.value;
    b.dataset.capPaper = draft.paper;
    b.dataset.capPaperMode = draft.paperMode === 'auto' ? (media.matches ? 'dark' : 'light') : draft.paperMode;
    b.dataset.capPaperPattern = draft.paperPattern;
    b.dataset.capNoteDecor = draft.noteDecor;
    const sideCss = declarations(draft.side || '');
    const noteCss = declarations(draft.note || '');
    const extraCss = scopedCss(draft.custom || '');
    sheet.textContent =
      `body[data-cap-paper] #shiyi-dock.cap-memory-side { ${sideCss} }\n` +
      `body[data-cap-paper] #shiyi-dock.cap-memory-side .cap-story { ${noteCss} }\n` +
      extraCss;
  }

  function save(sourceBox = null) {
    W.localStorage.setItem(key, JSON.stringify(p));
    apply(p);
    syncForms(sourceBox);
  }

  function setStatus(msg) {
    for (const box of boxes) {
      const st = box.querySelector('[data-status]');
      if (st) st.textContent = msg;
    }
  }

  for (const box of boxes) {
    for (const el of box.querySelectorAll('[data-pref]')) {
      const k = el.dataset.pref;
      if (!Array.from(el.options).some(o => o.value === p[k])) p[k] = defaults[k];
      el.value = p[k];
      el.onchange = () => { p[k] = el.value; save(box); };
    }
    for (const k of ['side', 'note', 'custom']) {
      const ta = box.querySelector(`[data-css="${k}"]`);
      if (!ta) continue;
      try {
        if (k === 'custom') scopedCss(p[k] || '');
        else declarations(p[k] || '');
        ta.value = p[k] || '';
      } catch { p[k] = ''; ta.value = ''; }
      ta.oninput = () => {
        try {
          const draft = {
            ...p,
            side: box.querySelector('[data-css="side"]').value,
            note: box.querySelector('[data-css="note"]').value,
            custom: box.querySelector('[data-css="custom"]').value
          };
          apply(draft);
          setStatus('预览中（点击“保存并应用”持久化）');
        } catch (e) {
          setStatus(e.message);
        }
      };
    }
    for (const btn of box.querySelectorAll('[data-preset]')) {
      btn.onclick = () => {
        const preset = PRESETS[btn.dataset.preset];
        if (!preset) return;
        p = { ...p, ...preset };
        save(null);
        setStatus(`已应用“${btn.textContent}”模板`);
      };
    }
    if (box.querySelector('[data-save]')) box.querySelector('[data-save]').onclick = () => {
      try {
        const side = declarations(box.querySelector('[data-css="side"]').value);
        const note = declarations(box.querySelector('[data-css="note"]').value);
        const custom = box.querySelector('[data-css="custom"]').value;
        scopedCss(custom);
        p = { ...p, side, note, custom };
        save(box);
        setStatus('已保存并应用自定义 CSS');
      } catch (e) {
        setStatus(e.message);
      }
    };
    if (box.querySelector('[data-reset]')) box.querySelector('[data-reset]').onclick = () => {
      p = { ...p, side: '', note: '', custom: '' };
      save(null);
      setStatus('已恢复默认 CSS');
    };
  }

  themeSelect.addEventListener('change', () => apply(p));
  media.addEventListener?.('change', () => apply(p));
  apply(p);

  const api = {
    closeInlineDrawer() { if (inlineDrawer) inlineDrawer.hidden = true; apply(p); },
    toggleInlineDrawer() {
      if (inlineDrawer) inlineDrawer.hidden = !inlineDrawer.hidden;
    },
    destroy() {
      themeSelect.removeEventListener('change', apply);
      media.removeEventListener?.('change', apply);
      sheet.remove();
      inlineDrawer?.remove();
      mainBox.remove();
      for (const k of ['capMaterial', 'capLook', 'capPaper', 'capPaperMode', 'capPaperPattern', 'capNoteDecor']) {
        delete D.body.dataset[k];
      }
    }
  };
  return api;
}
