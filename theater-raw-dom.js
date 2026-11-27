import { START, END } from './theater-payload.js';

export function hideRawTheater(target, payload) {
  if (!payload || payload.length > 24000) return false;

  // Some ST renderers preserve custom elements, others unwrap them.
  const wrappers = [...target.querySelectorAll('cap-theater')].filter(node =>
    !node.textContent.trim() || payload.startsWith(node.textContent.trim()));
  if (wrappers.length) {
    wrappers.forEach(node => node.remove());
    return true;
  }

  const walker = target.ownerDocument.createTreeWalker(target, 4);
  const nodes = [];
  let textNode;
  while ((textNode = walker.nextNode())) {
    if (textNode.parentElement?.closest('.cap-theater-panel,script,style')) continue;
    nodes.push(textNode);
  }
  // Build a whitespace-insensitive stream with per-character DOM positions.
  // Markdown and sanitizer can split payload across arbitrary inline elements.
  const stream = [];
  const positions = [];
  for (const node of nodes) {
    const value = node.nodeValue || '';
    for (let i = 0; i < value.length; i++) {
      if (/\s/.test(value[i])) continue;
      stream.push(value[i]);
      positions.push([node, i]);
    }
  }
  const compact = stream.join('');
  const expected = payload.replace(/\s/g, '');
  let offset = compact.lastIndexOf(expected);
  if (offset < 0) return false;
  let from = offset, to = offset + expected.length;
  // Remove literal delimiters too, if the HTML renderer kept them as text.
  const startTag = START.replace(/\s/g, '');
  const endTag = END.replace(/\s/g, '');
  if (compact.slice(Math.max(0, from - startTag.length), from) === startTag) from -= startTag.length;
  if (compact.slice(to, to + endTag.length) === endTag) to += endTag.length;
  const first = positions[from], last = positions[to - 1];
  if (!first || !last) return false;
  const range = target.ownerDocument.createRange();
  range.setStart(first[0], first[1]);
  range.setEnd(last[0], last[1] + 1);
  range.deleteContents();
  return true;
}

