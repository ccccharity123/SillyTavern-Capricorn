// Apple SF Symbols 风格统一图标库（24×24 光学网格）
const paths = {
  // 播控类（实心圆角，呼应 Apple Music）
  play: '<path d="M7.6 4.9c0-1.15 1.24-1.87 2.24-1.3l10.2 5.9a1.5 1.5 0 0 1 0 2.6l-10.2 5.9c-1 .57-2.24-.15-2.24-1.3Z"/>',
  pause: '<rect x="5.5" y="4.2" width="4.4" height="15.6" rx="1.8"/><rect x="14.1" y="4.2" width="4.4" height="15.6" rx="1.8"/>',
  prev: '<rect x="4.2" y="5" width="2.6" height="14" rx="1.3"/><path d="M19.2 6.1a1.25 1.25 0 0 0-1.9-1.06L8.6 10.94a1.25 1.25 0 0 0 0 2.12l8.7 5.9a1.25 1.25 0 0 0 1.9-1.06Z"/>',
  next: '<path d="M4.8 6.1a1.25 1.25 0 0 1 1.9-1.06l8.7 5.9a1.25 1.25 0 0 1 0 2.12l-8.7 5.9a1.25 1.25 0 0 1-1.9-1.06Z"/><rect x="17.2" y="5" width="2.6" height="14" rx="1.3"/>',
  stop: '<rect x="5.2" y="5.2" width="13.6" height="13.6" rx="3.2"/>',

  // 播放模式与音量
  repeat: '<path d="M17 3.5 20.5 7 17 10.5"/><path d="M3.5 11.5v-1a3.5 3.5 0 0 1 3.5-3.5h13.5"/><path d="M7 20.5 3.5 17 7 13.5"/><path d="M20.5 12.5v1a3.5 3.5 0 0 1-3.5 3.5H3.5"/>',
  one: '<path d="M17 3.5 20.5 7 17 10.5"/><path d="M3.5 11.5v-1a3.5 3.5 0 0 1 3.5-3.5h13.5"/><path d="M7 20.5 3.5 17 7 13.5"/><path d="M20.5 12.5v1a3.5 3.5 0 0 1-3.5 3.5H3.5"/><path d="M11.2 10.4 12.6 9.5v5"/>',
  shuffle: '<path d="M3.5 7h2.8c2.6 0 4 2.2 5.7 5s3.1 5 5.7 5h2.8"/><path d="m17.5 14 3 3-3 3"/><path d="M3.5 17h2.8c2.6 0 4-2.2 5.7-5s3.1-5 5.7-5h2.8"/><path d="m17.5 4 3 3-3 3"/>',
  volumeLow: '<path d="M5.5 9.5h3.2l4.4-3.6a.9.9 0 0 1 1.4.7v10.8a.9.9 0 0 1-1.4.7l-4.4-3.6H5.5a1.5 1.5 0 0 1-1.5-1.5v-2a1.5 1.5 0 0 1 1.5-1.5Z"/>',
  volumeHigh: '<path d="M4 9.5h3l4.2-3.5a.9.9 0 0 1 1.3.7v10.6a.9.9 0 0 1-1.3.7L7 14.5H4a1.5 1.5 0 0 1-1.5-1.5v-2A1.5 1.5 0 0 1 4 9.5Z"/><path d="M16 9.2a4 4 0 0 1 0 5.6"/><path d="M18.8 6.8a7.4 7.4 0 0 1 0 10.4"/>',

  // 播放器功能区
  lyrics: '<path d="M5.5 4.5h13a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5h-6.8l-4.2 3v-3H5.5A2.5 2.5 0 0 1 3 15V7a2.5 2.5 0 0 1 2.5-2.5Z"/><path d="M7.5 9.2h9M7.5 12.8h6"/>',
  queue: '<path d="M4 6.5h16M4 11.5h16M4 16.5h8.5"/><path d="M16.2 14.8l4.2 2.4-4.2 2.4Z" fill="currentColor" stroke="none"/>',
  library: '<rect x="4" y="6.5" width="12.5" height="13.5" rx="2.5"/><path d="M8 3.5h9.5A2.5 2.5 0 0 1 20 6v10.5"/><path d="M9.5 15.2v-4.7l4.2-1v4.7"/><circle cx="8.2" cy="15.5" r="1.3"/><circle cx="12.4" cy="14.5" r="1.3"/>',
  size: '<path d="M14.5 4.5h5v5M19.5 4.5l-6 6M9.5 19.5h-5v-5m0 5 6-6"/>',

  // 导航与系统操作
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  up: '<path d="M12 19.5v-15m-5.5 5.5L12 4.5l5.5 5.5"/>',
  arrowdown: '<path d="M12 4.5v15m-5.5-5.5L12 19.5l5.5-5.5"/>',
  external: '<path d="M7 17 17 7M9.5 7H17v7.5"/>',
  settings: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/><circle cx="8.5" cy="6.5" r="2.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="12" r="2.1" fill="currentColor" stroke="none"/><circle cx="10" cy="17.5" r="2.1" fill="currentColor" stroke="none"/>',
  more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  refresh: '<path d="M19.5 8.5A8 8 0 1 0 20 13.5"/><path d="M19.5 3.8v4.7h-4.7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.6-1.5"/>',
  sparkles: '<path d="M12 3.5 13.8 8.7 19 10.5 13.8 12.3 12 17.5 10.2 12.3 5 10.5 10.2 8.7Z"/><path d="M18.5 4.5v2.5M17.25 5.75h2.5M5.5 16.5v2M4.5 17.5h2"/>',

  // 拾忆与外观
  note: '<rect x="4.5" y="3.5" width="15" height="17" rx="3"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.2"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17h1.2a2.1 2.1 0 0 0 1.8-3.2 2 2 0 0 1 1.7-3h1.5a2.3 2.3 0 0 0 2.3-2.3A8.5 8.5 0 0 0 12 3.5Z"/><circle cx="8.2" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="16.2" cy="10.2" r="1" fill="currentColor" stroke="none"/>',
  music: '<path d="M9.5 17.5V5.8l9.5-1.8v11.5"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>'
};

const filled = new Set(['play', 'pause', 'prev', 'next', 'stop']);

export function icon(name, size = 22) {
  const isFilled = filled.has(name);
  return `<svg class="cap-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${isFilled ? 'currentColor' : 'none'}" stroke="${isFilled ? 'none' : 'currentColor'}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
}
