import { withoutDirectorNotes } from './context-clean.js';
import { stripTheater } from './theater-payload.js';
import { lastItem } from './compat.js';
// Use a bounded slice of visible story text. Scene hints never become archive facts.
const clean = (value, isUser) => stripTheater(isUser ? value : withoutDirectorNotes(String(value ?? '')))
  .replace(/<(summary|table|bgm|摩羯纪要|摩羯留痕)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi, '')
  .trim();
const normalize = text => text.normalize('NFKC').toLowerCase();
const tail = (text, length) => Array.from(text).slice(-length).join('');
const cue = /^(?:嗯+|哦+|好(?:了|的|吧)?|是吗|继续|那后来呢|后来呢?|然后呢?|那?[他她它](?:们)?呢)$/u;

export function sceneQuery(chat, docs) {
  const recent = [];
  for (let i = chat.length - 1; i >= 0 && recent.length < 4; i--) {
    const message = chat[i];
    if (message.is_system || message.is_hidden) continue;
    const text = clean(message.mes ?? message.message, message.is_user);
    if (text) recent.unshift({ text, user: !!message.is_user });
  }
  const latest = lastItem(recent);
  const user = latest?.user ? latest.text : '';
  const short = !!user && user.length <= 64 && Array.from(user).length <= 32;
  const context = tail((latest?.user ? recent.slice(0, -1) : recent).map(item => tail(item.text, 480)).join('\n'), short ? 480 : 240);
  const normalizedUser = normalize(user);
  const normalizedContext = normalize(context);
  const mentioned = value => normalizedUser.includes(value) || normalizedContext.includes(value);

  const names = new Set();
  const aliases = new Map();
  const canonical = new Set();
  for (const doc of docs) {
    for (const name of doc.names || []) {
      const key = normalize(name);
      if (name.length >= 2 && name.length <= 40 && mentioned(key)) names.add(key);
    }
    if (!doc.actor) continue;
    const name = normalize(String(doc.actor.name ?? '').trim());
    if (!name) continue;
    canonical.add(name);
    for (const alias of (doc.actor.aliases || [])) {
      const key = normalize(String(alias).trim());
      if (key.length < 2 || key.length > 40 || key === name || !mentioned(key)) continue;
      if (!aliases.has(key)) aliases.set(key, new Set());
      aliases.get(key).add(name);
    }
  }
  const explicit = [...names].filter(name => normalizedUser.includes(name));
  const active = short && explicit.length === 0
    ? [...names]
      .map(name => [name, normalizedContext.lastIndexOf(name)])
      .filter(([, index]) => index >= 0)
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      .slice(0, 3).map(([name]) => name)
    : [];
  const hints = explicit.length ? explicit : active;
  const officialNames = candidates => [...new Set(candidates.flatMap(alias => {
    const mapped = aliases.get(alias);
    return !canonical.has(alias) && mapped?.size === 1 ? [...mapped] : [];
  }))].slice(0, 3);
  const named = officialNames(explicit).filter(name => name && !normalizedUser.includes(name));
  const primary = [tail(latest?.text || '', 1200), ...named].filter(Boolean).join('\n');
  const normalizedPrimary = normalize(primary);
  const expansionNames = [...new Set([...hints, ...officialNames(hints)])]
    .filter(name => !normalizedPrimary.includes(name));
  const expanded = [primary, ...expansionNames, context].filter(Boolean).join('\n');
  const aliasOnly = normalizedUser.replace(/[\s\p{P}\p{S}]+$/gu, '').replace(/[呢吗吧呀啊么]$/u, '');
  return {
    query: expanded, primary, expanded, context, hints, short,
    directNames: short ? officialNames([aliasOnly]) : [],
    nameOnly: short && names.has(aliasOnly),
    cue: short && cue.test(normalizedUser.replace(/[\s\p{P}\p{S}]/gu, '')),
  };
}
