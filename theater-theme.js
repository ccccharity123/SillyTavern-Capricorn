import { hasOwn } from './compat.js';
export const themes = {
  auto: '跟随小剧场', cozy: '日常治愈', urban: '现代都市', suspense: '悬疑惊悚',
  ink: '古风', fantasy: '奇幻', sci: '科幻', romance: '浪漫',
};

export function theaterTheme(host) {
  let preference = 'auto';
  try { preference = host.localStorage.getItem('cap_theater_theme') || preference; } catch {}
  if (!hasOwn(themes, preference)) preference = 'auto';
  function apply(panel) { panel.dataset.theme = preference === 'auto' ? panel.dataset.storyTheme : preference; }
  return {
    apply,
    get: () => preference,
    set(value) {
      if (!hasOwn(themes, value)) return;
      preference = value;
      try { host.localStorage.setItem('cap_theater_theme', value); } catch {}
      host.document.querySelectorAll('.cap-theater-panel').forEach(panel => {
        apply(panel);
        const select = panel.querySelector('.ct-theme');
        if (select) select.value = value;
      });
    },
  };
}
