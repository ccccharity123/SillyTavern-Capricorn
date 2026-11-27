export const START = '<cap-theater>';
export const END = '</cap-theater>';
export const payloadLimit = 24000;

export function theaterBlock(value, start) {
  const body = start + START.length;
  let string = false, escape = false, fallback = -1;
  for (let i = body; i < value.length && i <= body + payloadLimit; i++) {
    const ch = value[i];
    if (ch === '<' && value.startsWith(END, i)) {
      if (!string) return { end: i + END.length, payload: value.slice(body, i).trim() };
      if (fallback < 0) fallback = i;
    }
    if (string && escape) escape = false;
    else if (string && ch === '\\') escape = true;
    else if (ch === '"') string = !string;
  }
  return fallback < 0
    ? { end: value.length, incomplete: true, payload: value.slice(body, body + payloadLimit).trim() }
    : { end: fallback + END.length, payload: value.slice(body, fallback).trim() };
}

export function stripTheater(value) {
  const text = String(value ?? '');
  let from = 0, result = '';
  for (let start = text.indexOf(START); start >= 0; start = text.indexOf(START, from)) {
    result += text.slice(from, start);
    from = theaterBlock(text, start).end;
  }
  return result + text.slice(from);
}
