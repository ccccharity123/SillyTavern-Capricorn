const origins = {
  archive: '摘要归档',
  message: '原楼层表格',
  manual: '手动档案',
  derived: '随层提取',
};

const pageSize = 15;

export function appendMemoryProvenance(document, parent, read, jump, label = '来源') {
  const element = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  const details = element('details', '');
  const heading = element('summary', label);
  const body = element('div', '');
  details.className = 'cap-memory-provenance';
  details.append(heading, body);
  parent.append(details);

  function renderSources() {
    if (!details.open) return;
    details.removeEventListener('toggle', renderSources);
    let record;
    try {
      record = read();
    } catch {
      body.textContent = '来源暂不可用';
      return;
    }
    if (!record) {
      body.textContent = '暂无来源';
      return;
    }
    heading.textContent = `${label} · ${origins[record.origin]}${record.active ? '' : ' · 已失效'}`;
    const { sources } = record;
    if (!sources.length) {
      body.textContent = '未关联原楼层';
      return;
    }

    const list = element('ul', '');
    const status = element('p', '');
    status.setAttribute('role', 'status');
    body.append(list, status);
    const pages = Math.ceil(sources.length / pageSize);
    let page = 0;
    const newer = element('button', '较新的来源');
    const older = element('button', '较早的来源');
    newer.type = older.type = 'button';
    if (pages > 1) body.append(newer, older);

    function renderPage() {
      list.replaceChildren();
      status.textContent = '';
      status.hidden = true;
      const end = sources.length - page * pageSize;
      const start = Math.max(0, end - pageSize);
      for (let index = end - 1; index >= start; index--) {
        const source = sources[index];
        const floor = Number.isInteger(source.floor) ? `第 ${source.floor} 楼` : '无楼层记录';
        const row = element('li', [floor, source.active ? '有效' : '已失效', source.storyTime,
          source.version && `版本 ${source.version}`].filter(Boolean).join(' · '));
        if (source.active && Number.isInteger(source.floor) && jump) {
          const button = element('button', `查看第 ${source.floor} 楼`);
          button.type = 'button';
          button.onclick = () => {
            status.hidden = jump(source);
            status.textContent = status.hidden ? '' : '无法定位原楼层，请刷新后重试';
          };
          row.append(' ', button);
        }
        list.append(row);
      }
      newer.disabled = page === 0;
      older.disabled = page >= pages - 1;
    }

    newer.onclick = () => { page--; renderPage(); };
    older.onclick = () => { page++; renderPage(); };
    renderPage();
  }

  details.addEventListener('toggle', renderSources);
  return details;
}
