import { lastItem } from './compat.js';
import { lexicalTokens } from './hybrid.js';

export const RETRIEVAL_BLOCK_DOCS = 128;
export const RETRIEVAL_BLOCK_CHARS = 65536;
export const RETRIEVAL_MAX_PAGES = 16384;
export const RETRIEVAL_MAX_CANDIDATES = 1024;
export const yieldRetrieval = () => new Promise(resolve => setTimeout(resolve, 0));

export function projectionSize({ id, search }) {
  return id.length + search.length;
}

export async function* documentBlocks(source, check) {
  let block = [], chars = 0;
  for await (const value of source) {
    for (const { id, search } of Array.isArray(value) ? value : [value]) {
      if (typeof id !== 'string' || typeof search !== 'string') throw Error('无效检索文档');
      const doc = { id, search }, length = projectionSize(doc);
      if (block.length && (block.length >= RETRIEVAL_BLOCK_DOCS || chars + length > RETRIEVAL_BLOCK_CHARS)) {
        check();
        yield block;
        block = [];
        chars = 0;
      }
      block.push(doc);
      chars += length;
    }
  }
  check();
  if (block.length) yield block;
}

export const queryTerms = query => [...new Set(lexicalTokens(query))];

export async function readBags(block, previous = [], terms = [], check = () => {}) {
  const cached = new Map(previous.map(doc => [doc.id, doc]));
  const bags = [];
  for (const doc of block) {
    const prior = cached.get(doc.id);
    if (prior?.search === doc.search && prior.f instanceof Map && Number.isSafeInteger(prior.n)) {
      bags.push(prior);
      continue;
    }
    const oversized = projectionSize(doc) > RETRIEVAL_BLOCK_CHARS;
    const needed = oversized ? new Set(terms) : null;
    const f = new Map();
    let n = 0;
    for (const term of lexicalTokens(doc.search)) {
      if (!needed || needed.has(term)) f.set(term, (f.get(term) || 0) + 1);
      n++;
      if (oversized && n % 4096 === 0) {
        await yieldRetrieval();
        check();
      }
    }
    bags.push({ ...doc, f, n });
  }
  return bags;
}

export function corpusStats(terms) {
  return { documents: 0, tokens: 0, frequency: terms.map(() => 0) };
}

export function addStats(stats, next) {
  stats.documents += next.documents;
  stats.tokens += next.tokens;
  for (let i = 0; i < stats.frequency.length; i++) stats.frequency[i] += next.frequency[i];
}

export function blockStats(bags, terms) {
  const stats = corpusStats(terms);
  stats.documents = bags.length;
  for (const { f, n } of bags) {
    stats.tokens += n;
    for (let i = 0; i < terms.length; i++) if (f.has(terms[i])) stats.frequency[i]++;
  }
  return stats;
}

export function blockScorer(terms, stats) {
  const avg = stats.tokens / Math.max(1, stats.documents) || 1;
  const inverse = stats.frequency.map(df => Math.log(1 + (stats.documents - df + .5) / (df + .5)));
  return ({ f, n }) => {
    let score = 0;
    for (let i = 0; i < terms.length; i++) {
      const count = f.get(terms[i]);
      if (count) score += inverse[i] * count * 2.2 / (count + 1.2 * (.25 + .75 * n / avg));
    }
    return score;
  };
}

export function topCandidates(limit) {
  const matches = [];
  const capacity = Math.max(1, Math.min(RETRIEVAL_MAX_CANDIDATES, Math.floor(limit) || 1));
  return {
    matches,
    add(id, score) {
      if (!(score > 0) || (matches.length === capacity && score <= lastItem(matches).score)) return;
      let left = 0, right = matches.length;
      while (left < right) {
        const middle = (left + right) >>> 1;
        if (matches[middle].score < score) right = middle;
        else left = middle + 1;
      }
      matches.splice(left, 0, { id, score });
      if (matches.length > capacity) matches.pop();
    },
  };
}

export async function streamScores(source, query, check, consume, onBlock) {
  const terms = queryTerms(query);
  const stats = corpusStats(terms);
  async function visit(source, callback) {
    for await (const block of documentBlocks(source, check)) {
      const bags = await readBags(block, [], terms, check);
      callback(bags);
      if (onBlock) await onBlock();
      else await yieldRetrieval();
      check();
    }
  }
  await visit(source(), bags => addStats(stats, blockStats(bags, terms)));
  if (terms.length) {
    const score = blockScorer(terms, stats);
    await visit(source(), bags => {
      for (const bag of bags) consume(bag.id, score(bag));
    });
  }
  return stats.documents;
}
