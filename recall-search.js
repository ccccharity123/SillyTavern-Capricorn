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

export async function searchMemory(docs, scene, score) {
  const { primary, expanded, hints } = scene;
  if (!primary) return { scores: new Float64Array(docs.length), stage: 'none', confidence: 'none' };

  const terms = scene.cue ? [] : tokenize(primary);
  const words = keywords(terms);
  const trimmed = primary.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+$/gu, '').replace(/[呢吗吧呀啊么]$/u, '');
  const phrase = scene.short && !scene.cue && trimmed.length >= 2 && trimmed.length <= 24 ? trimmed : '';
  const primaryScores = terms.length ? await score(primary) : new Float64Array(docs.length);
  const primaryMatches = leadingMatches(primaryScores, 32);
  const supported = primaryMatches
    .slice(0, 8)
    .map(({ index }) => docs[index])
    .filter(document => supports(document, words, phrase, scene.directNames || []));
  const history = document => document.kind === 'summary' && !document.recent;
  // A recent or entity hit alone must not suppress a historical lookup for short input.
  const directHistory = supported.find(history);
  // A bare name is identity evidence, not event evidence.
  const directConfidence = directHistory && !scene.nameOnly ? 'strong' : supported.length ? 'limited' : 'weak';
  if ((supported.length && (!scene.short || (directHistory && !scene.nameOnly))) || !expanded || expanded === primary) {
    return {
      scores: primaryScores,
      stage: supported.length ? 'direct' : 'weak',
      anchor: scene.nameOnly ? undefined : directHistory?.id,
      confidence: directConfidence,
    };
  }

  const expandedScores = await score(expanded);
  const expandedMatches = leadingMatches(expandedScores, 48);
  const fused = new Float64Array(docs.length);
  const merge = (matches, weight) => {
    for (const [rank, { index }] of matches.entries()) fused[index] += weight / (20 + rank + 1);
  };
  merge(primaryMatches, scene.short ? 0.5 : 1.25);
  merge(expandedMatches, 1);
  const focus = docs[expandedMatches[0]?.index];
  // For a bare name, prefer a historical hit with additional scene evidence.
  const nameTerms = new Set(tokenize([primary, ...hints].join(' ')));
  const contextWords = keywords(tokenize(expanded)).filter(word => !nameTerms.has(word));
  const contextual = scene.nameOnly && expandedMatches.map(({ index }) => docs[index]).find(doc => {
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
    const deepScores = await score(context);
    const deepMatches = leadingMatches(deepScores, 48);
    const supportedDeep = deepMatches.filter(({index}) => {
      const doc = docs[index];
      if (!history(doc)) return false;
      const text = doc.search.normalize('NFKC').toLowerCase();
      return contextTerms.filter(word => text.includes(word)).length >= 3
        && (!hints.length || hints.some(name => text.includes(name)));
    });
    merge(supportedDeep, .85);
    return { scores: fused, stage: 'deep', anchor, confidence,
      deepCandidates: supportedDeep.length };
  }
  return { scores: fused, stage: 'expanded', anchor, confidence };
}
