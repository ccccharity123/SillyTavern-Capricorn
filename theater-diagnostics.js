export const messages = {
  absent: '未检测到小剧场数据。',
  format: '小剧场数据不完整或格式有误。可尝试重新生成本楼层。',
  legacy: '此处的小剧场使用了无法读取的旧版格式。',
  render: '小剧场组件加载失败。可收起后重新打开。',
  binding: '小剧场无法订阅聊天事件，楼层将通过页面更新同步。',
  storage: '小剧场存档不可用。当前进度仅在本次页面会话保留。',
};

export function diagnostics(host) {
  const seen = new Map();
  return {
    mark(code) {
      if (!seen.has(code) && host.CAPRICORN_THEATER_DEBUG === true) {
        host.console.debug('[Capricorn Theater]', code);
      }
      seen.set(code, (seen.get(code) || 0) + 1);
    },
    read: () => Object.fromEntries(seen),
  };
}
