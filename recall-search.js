import { tokenize } from './hybrid.js';

const keywords = terms => [...new Set(terms)]
  .filter(word => /\p{Script=Han}/u.test(word) ? word.length >= 2 : word.length >= 3);

function leadingMatches(scores, limit) {
  const matches = [];
  for (let index = 0; index < scores.length; index++) {
    const score = scores[index];
    if (score <= 0 || (matches.length === limit && score <= matches.at(-1).score)) continue;
    matches.push({ index, score });
    matches.sort((a, b) => b.score - a.score || a.index - b.index);
    if (matches.length > limit) matches.pop();
  }
  return matches;
}

function supports(document, words, phrase, directNames) {
  const text = document.search.normalize('NFKC').toLowerCase();
  if ((phrase && text.includes(phrase)) || directNames.some(name => text.includes(name))) return true;
  const matching = words.filter(word => text.includes(word)).length;
  return matching >= 2 && matching / words.length >= 0.6;
}

async function rankScene(scene, rank) {
  const { primary, expanded, hints } = scene;
  if (!primary) return { stage: 'none', confidence: 'none' };

  const terms = scene.cue ? [] : tokenize(primary);
  const words = keywords(terms);
  const trimmed = primary.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+$/gu, '').replace(/[呢吗吧呀啊么]$/u, '');
  const phrase = scene.short && !scene.cue && trimmed.length >= 2 && trimmed.length <= 24 ? trimmed : '';
  const primaryRank = terms.length ? await rank(primary) : [];
  const primaryMatches = primaryRank.slice(0, 32);
  const supported = primaryMatches
    .slice(0, 8)
    .map(({ doc }) => doc)
    .filter(document => supports(document, words, phrase, scene.directNames || []));
  const history = document => document.kind === 'summary' && !document.recent;
  // A recent or entity hit alone must not suppress a historical lookup for short input.
  const directHistory = supported.find(history);
  // A bare name is identity evidence, not event evidence.
  const directConfidence = directHistory && !scene.nameOnly ? 'strong' : supported.length ? 'limited' : 'weak';
  if ((supported.length && (!scene.short || (directHistory && !scene.nameOnly))) || !expanded || expanded === primary) {
    return {
      stage: supported.length ? 'direct' : 'weak',
      anchor: scene.nameOnly ? undefined : directHistory?.id,
      confidence: directConfidence,
    };
  }

  const expandedMatches = (await rank(expanded)).slice(0, 48);
  const fused = new Map();
  const merge = (matches, weight) => {
    for (const [rank, { key }] of matches.entries()) fused.set(key, (fused.get(key) || 0) + weight / (20 + rank + 1));
  };
  merge(primaryMatches, scene.short ? 0.5 : 1.25);
  merge(expandedMatches, 1);
  const focus = expandedMatches[0]?.doc;
  // For a bare name, prefer a historical hit with additional scene evidence.
  const nameTerms = new Set(tokenize([primary, ...hints].join(' ')));
  const contextWords = keywords(tokenize(expanded)).filter(word => !nameTerms.has(word));
  const contextual = scene.nameOnly && expandedMatches.map(({ doc }) => doc).find(doc => {
    if (!history(doc)) return false;
    const text = doc.search.normalize('NFKC').toLowerCase();
    return hints.some(name => text.includes(name)) && contextWords.filter(word => text.includes(word)).length >= 2;
  });
  const anchor = contextual?.id ?? (!scene.nameOnly ? directHistory?.id : undefined) ?? (!scene.nameOnly && scene.short && focus && history(focus)
    && hints.some(name => focus.search.normalize('NFKC').toLowerCase().includes(name))
    ? focus.id : undefined);
  const confidence = contextual || (directHistory && !scene.nameOnly) ? 'strong' : anchor ? 'limited' : 'weak';
  // A separate context-only pass can recover evidence diluted by the current input.
  // Keep it bounded and do not promote a context-only match to a factual anchor.
  const context = String(scene.context || '').trim();
  const contextTerms = keywords(tokenize(context));
  if (confidence !== 'strong' && context.length >= 24 && contextTerms.length >= 8
      && context !== primary && context !== expanded) {
    const deepMatches = (await rank(context)).slice(0, 48);
    const supportedDeep = deepMatches.filter(({doc}) => {
      if (!history(doc)) return false;
      const text = doc.search.normalize('NFKC').toLowerCase();
      return contextTerms.filter(word => text.includes(word)).length >= 3
        && (!hints.length || hints.some(name => text.includes(name)));
    });
    merge(supportedDeep, .85);
    return { fused, stage: 'deep', anchor, confidence,
      deepCandidates: supportedDeep.length };
  }
  return { fused, stage: 'expanded', anchor, confidence };
}

export async function searchMemory(docs, scene, score) {
  let primaryScores;
  const { fused, ...result } = await rankScene(scene, async query => {
    const scores = await score(query);
    if (query === scene.primary) primaryScores = scores;
    return leadingMatches(scores, 48).map(({ index }) => ({ key: index, doc: docs[index] }));
  });
  const scores = fused || !primaryScores ? new Float64Array(docs.length) : primaryScores;
  if (fused) for (const [index, score] of fused) scores[index] = score;
  return { ...result, scores };
}

// The sharded scorer supplies exact top ranks by ID. Only ranked documents need projecting.
export async function searchMemoryTop(scene, rank) {
  let primaryScores;
  const { fused, ...result } = await rankScene(scene, async query => {
    const matches = await rank(query);
    if (query === scene.primary) primaryScores = new Map(matches.map(({ doc, score }) => [doc.id, score]));
    return matches.map(({ doc }) => ({ key: doc.id, doc }));
  });
  return { ...result, scores: fused || primaryScores || new Map() };
}
