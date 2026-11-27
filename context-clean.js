/* Prompt-only history cleanup. The interceptor owns the array, not its message objects. */

const director = '<director>';
const directorEnd = '</director>';
const supportedTypes = new Set([undefined, 'normal', 'continue', 'regenerate', 'swipe']);
const tagOrCode = /<cap-theater>|<director>|<(?:table|summary|bgm|status(?:[_-]?(?:bar|block))?|forum|摩羯纪要|摩羯留痕)(?=[\s>])[^>]*>|`+|~{3,}/g;
const nestedDirectorTag = /<\/?(?:director|table|summary|bgm|status(?:[_-]?bar)?|forum)\s*>/;

function isAssistant(message) {
  return message && !message.is_user && !message.is_system &&
    (message.role === undefined || message.role === 'assistant');
}

function jsonTableEnd(text, from, closing) {
  let quoted = false, escaped = false;
  for (let i = from; i < text.length; i++) {
    if (!quoted && text.startsWith(closing, i)) return i;
    const ch = text[i];
    if (quoted && escaped) escaped = false;
    else if (quoted && ch === '\\') escaped = true;
    else if (ch === '"') quoted = !quoted;
  }
  return -1;
}

function completeObject(payload) {
  try {
    const data = JSON.parse(payload);
    return data !== null && typeof data === 'object' && !Array.isArray(data);
  } catch { return false; }
}

function codeEnd(text, start, marker) {
  const same = marker[0];
  const begin = start + marker.length;
  const startsLine = /^[ \t]{0,3}$/.test(text.slice(text.lastIndexOf('\n', start - 1) + 1, start));
  if (marker.length >= 3 && startsLine) {
    const endFence = new RegExp('^ {0,3}' + same + '{' + marker.length + ',}[ \\t]*\\r?$', 'gm');
    const lineEnd = text.indexOf('\n', begin);
    if (lineEnd < 0) return text.length;
    endFence.lastIndex = lineEnd + 1;
    const close = endFence.exec(text);
    return close ? endFence.lastIndex : text.length; // Markdown keeps an open fence through the end.
  }
  if (same === '~') return begin;
  const runs = /`+/g;
  runs.lastIndex = begin;
  let close;
  while ((close = runs.exec(text))) {
    if (close[0].length === marker.length) return runs.lastIndex;
  }
  return begin; // RC23: an unpaired backtick is plain text
}

function structures(text) {
  const blocks = [];
  const scan = new RegExp(tagOrCode);
  let match;
  while ((match = scan.exec(text))) {
    const token = match[0], start = match.index, from = scan.lastIndex;
    let escaping = 0;
    for (let i = start - 1; i >= 0 && text[i] === '\\'; i--) escaping++;
    if (escaping % 2) continue;
    if (token[0] !== '<') {
      scan.lastIndex = codeEnd(text, start, token);
      continue;
    }
    const kind = token.slice(1, -1).trim().split(/\s/, 1)[0];
    const closing = kind === 'director' ? directorEnd : '</' + kind + '>';
    const isTable = kind === 'table' || kind === '摩羯留痕';
    const close = isTable ? jsonTableEnd(text, from, closing) : text.indexOf(closing, from);
    if (close < 0) break;
    const end = close + closing.length;
    const payload = text.slice(from, close).trim();
    if (token === director) {
      if (nestedDirectorTag.test(payload)) break;
      if (payload) blocks.push({ kind, start, end });
    } else if (kind === 'table' && completeObject(payload)) {
      blocks.push({ kind, start, end });
    }
    scan.lastIndex = end;
  }
  return blocks;
}

function limit(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function without(text, blocks) {
  let from = 0, result = '';
  for (const block of blocks) {
    result += text.slice(from, block.start);
    from = block.end;
  }
  return result + text.slice(from);
}

/**
 * Updates only slots of an already verified prompt array, keeping its identity.
 * Call cleanGenerationHistory at the host boundary.
 */
export function cleanPromptHistory(chat, options) {
  if (!Array.isArray(chat)) return 0;
  const keepDirectors = limit(options?.keepDirectors, 1);
  const stripTablesBeyond = limit(options?.stripTablesBeyond, 0);
  const protectLast = options?.protectLast === true;
  let directors = 0, assistants = 0, changed = 0;
  for (let i = chat.length - 1; i >= 0; i--) {
    const message = chat[i];
    if (!isAssistant(message) || typeof message.mes !== 'string') continue;
    assistants++;
    const blocks = structures(message.mes);
    const remove = [];
    const protectedPrefix = protectLast && i === chat.length - 1;
    for (let j = blocks.length - 1; j >= 0; j--) {
      const block = blocks[j];
      const discard = block.kind === 'director' ? directors++ >= keepDirectors
        : stripTablesBeyond > 0 && assistants > stripTablesBeyond;
      if (!protectedPrefix && discard) remove.push(block);
    }
    if (remove.length) {
      chat[i] = { ...message, mes: without(message.mes, remove.reverse()) };
      changed++;
    }
  }
  return changed;
}

export function cleanGenerationHistory(prompt, live, type) {
  // SillyTavern release maps coreChat to independent, consecutively indexed messages.
  // Unknown host shapes fall back to passing the original prompt through.
  if (!supportedTypes.has(type) || !Array.isArray(prompt) || !Array.isArray(live) || prompt === live) return 0;
  const originals = new Set(live);
  for (let i = 0; i < prompt.length; i++) {
    const row = prompt[i];
    const slot = Object.getOwnPropertyDescriptor(prompt, i);
    if (!slot?.writable || !row || typeof row.mes !== 'string' || row.index !== i || originals.has(row)) return 0;
  }
  return cleanPromptHistory(prompt, { protectLast: type === 'continue' });
}

// Director notes may remain as guidance in the prompt, but are not scene-recall evidence.
export function withoutDirectorNotes(text) {
  return text.includes(director) ? without(text, structures(text).filter(block => block.kind === 'director')) : text;
}
