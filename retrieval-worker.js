import {
  RETRIEVAL_BLOCK_CHARS, RETRIEVAL_BLOCK_DOCS, RETRIEVAL_MAX_PAGES,
  addStats, blockScorer, blockStats, corpusStats, projectionSize, queryTerms, readBags, topCandidates,
} from './retrieval-blocks.js';
import { createShardStore } from './shard-store.js';

function validPage(bags) {
  return Array.isArray(bags) && bags.length <= RETRIEVAL_BLOCK_DOCS && bags.every(bag =>
    typeof bag.id === 'string' && typeof bag.search === 'string' && bag.f instanceof Map &&
    Number.isSafeInteger(bag.n) && bag.n >= 0) &&
    bags.reduce((sum, doc) => sum + projectionSize(doc), 0) <= RETRIEVAL_BLOCK_CHARS;
}

function validateBlock(block) {
  if (!Array.isArray(block) || block.length > RETRIEVAL_BLOCK_DOCS ||
      block.reduce((sum, doc) => sum + projectionSize(doc), 0) > RETRIEVAL_BLOCK_CHARS) {
    throw Error('检索块超过工作集预算');
  }
}

export function createRetrievalWorker(store = createShardStore(), progress = () => {}) {
  let staging, transientScope, transient = [];
  const same = (bags, block) => bags.length === block.length &&
    bags.every((bag, index) => bag.id === block[index].id && bag.search === block[index].search);

  // Bounded term-to-page directory; derived data only, older snapshots remain readable.
  const DIRECTORY_LIMIT = 300000;
  function indexPage(snapshot, bags, ordinal) {
    if (!snapshot.directory) return;
    const counts = new Map();
    for (const bag of bags) {
      snapshot.tokens += bag.n;
      for (const term of bag.f.keys()) counts.set(term, (counts.get(term) || 0) + 1);
    }
    for (const [term, df] of counts) {
      if (++snapshot.directorySize > DIRECTORY_LIMIT) { snapshot.directory = null; return; }
      let entry = snapshot.directory.get(term);
      if (!entry) snapshot.directory.set(term, entry = { df: 0, pages: [] });
      entry.df += df;
      entry.pages.push(ordinal);
    }
  }

  async function top({ id, scope, revision, query, limit }) {
    const snapshot = await store.active(scope);
    if (!snapshot || snapshot.revision !== revision || !Array.isArray(snapshot.pages) ||
        snapshot.pages.length > RETRIEVAL_MAX_PAGES) return null;
    const terms = queryTerms(query);
    const matches = topCandidates(limit);
    if (terms.length) {
      const stats = corpusStats(terms);
      async function visit(consume) {
        for (const [ordinal, owner] of snapshot.pages.entries()) {
          const page = await store.read(scope, owner, ordinal);
          if (!validPage(page)) return false;
          consume(page);
          if (ordinal % 16 === 0) progress(id);
        }
        return true;
      }
      if (snapshot.directory instanceof Map && Number.isSafeInteger(snapshot.tokens)) {
        stats.documents = snapshot.documents;
        stats.tokens = snapshot.tokens;
        const ordinals = new Set();
        terms.forEach((term, i) => {
          const entry = snapshot.directory.get(term);
          if (entry) { stats.frequency[i] = entry.df; for (const ordinal of entry.pages) ordinals.add(ordinal); }
        });
        const score = blockScorer(terms, stats);
        for (const ordinal of [...ordinals].sort((a,b) => a-b)) {
          const page = await store.read(scope, snapshot.pages[ordinal], ordinal);
          if (!validPage(page)) return null;
          for (const bag of page) matches.add(bag.id, score(bag));
          progress(id);
        }
      } else {
      if (!await visit(page => addStats(stats, blockStats(page, terms))) ||
          stats.documents !== snapshot.documents) return null;
      const score = blockScorer(terms, stats);
      if (!await visit(page => {
        for (const bag of page) matches.add(bag.id, score(bag));
      })) return null;
      }
      if ((await store.active(scope))?.generation !== snapshot.generation) return null;
    }
    return { matches: matches.matches, documents: snapshot.documents, revision };
  }

  return async function receive(message) {
    const { type, scope, generation, block, revision } = message;
    switch (type) {
      case 'top':
        transient = [];
        return top(message);
      case 'begin': {
        transient = [];
        const previous = await store.stage(scope, generation);
        if (previous === false) return false;
        staging = { scope, generation, previous, snapshot: { revision, generation, pages: [], documents: 0, tokens: 0, directory: new Map(), directorySize: 0 } };
        return true;
      }
      case 'page': {
        validateBlock(block);
        if (staging?.scope !== scope || staging.generation !== generation) return false;
        const { previous, snapshot } = staging;
        const ordinal = snapshot.pages.length;
        if (ordinal >= RETRIEVAL_MAX_PAGES) return false;
        const owner = previous?.pages?.[ordinal];
        const saved = owner && await store.read(scope, owner, ordinal);
        const prior = validPage(saved) ? saved : [];
        if (owner && same(prior, block)) {
          indexPage(snapshot, prior, ordinal);
          snapshot.pages.push(owner);
          snapshot.documents += block.length;
          return { reused: true };
        }
        const bags = await readBags(block, prior);
        if (!await store.write(scope, generation, ordinal, bags)) return false;
        indexPage(snapshot, bags, ordinal);
        snapshot.pages.push(generation);
        snapshot.documents += block.length;
        return { reused: false };
      }
      case 'commit': {
        if (staging?.scope !== scope || staging.generation !== generation) return false;
        const { snapshot } = staging;
        if (!await store.publish(scope, generation, snapshot)) return false;
        staging = null;
        return { documents: snapshot.documents, blocks: snapshot.pages.length, revision: snapshot.revision };
      }
      case 'abandon':
        if (staging?.scope === scope && staging.generation === generation) staging = null;
        return store.abandon(scope, generation);
      case 'stats':
      case 'scores': {
        validateBlock(block);
        if (transientScope !== scope) transient = [];
        transientScope = scope;
        transient = await readBags(block, transient, message.terms);
        if (type === 'stats') return blockStats(transient, message.terms);
        return transient.map(blockScorer(message.terms, message.stats));
      }
      case 'release':
        transient = [];
        return true;
      default:
        throw Error('未知检索操作');
    }
  };
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const receive = createRetrievalWorker(undefined, id => self.postMessage({ id, progress: true }));
  let chain = Promise.resolve();
  self.onmessage = ({ data }) => {
    chain = chain.then(async () => {
      try { self.postMessage({ id: data.id, result: await receive(data) }); }
      catch (error) { self.postMessage({ id: data.id, error: String(error) }); }
    });
  };
}
