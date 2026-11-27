// Compatibility only: remove legacy interactive blocks from old chat text.
// This file does not create, parse, display, or run interactive theater modules.
const START = '<cap-theater>';
const END = '</cap-theater>';
const LIMIT = 24000;

function blockEnd(value, start) {
  const body = start + START.length;
  let string = false, escape = false, fallback = -1;
  for (let i = body; i < value.length && i <= body + LIMIT; i++) {
    const ch = value[i];
    if (ch === '<' && value.startsWith(END, i)) {
      if (!string) return i + END.length;
      if (fallback < 0) fallback = i;
    }
    if (string && escape) escape = false;
    else if (string && ch === '\\') escape = true;
    else if (ch === '"') string = !string;
  }
  return fallback >= 0 ? fallback + END.length : value.length;
}

export function stripTheater(value) {
  const text = String(value ?? '');
  let from = 0, result = '';
  for (let start = text.indexOf(START); start >= 0; start = text.indexOf(START, from)) {
    result += text.slice(from, start);
    from = blockEnd(text, start);
  }
  return result + text.slice(from);
}
