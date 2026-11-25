import { parseMemorySource } from './canon.js';
import { createLedgerProjection, createTableCache, projectLedger } from './weave.js';

const EMPTY = Object.freeze({});
const STABILITY_MS = 8000;

// The caller provides checked floor changes. A missing change journal falls back to a full scan.
export function createTableIndex(hash, sharedCache) {
  const cache = sharedCache || createTableCache(hash);
  const projection = sharedCache ? createLedgerProjection() : cache;
  const candidates = new Map();
  const pending = new Set();
  const confirmed = new Set();
  let rows = EMPTY;
  let sourceRevision, revision = 0;
  let lastRecords, lastStored;
  let lastNow = -Infinity;
  let tombstones = new Set(), hiddenIds = new Set();
  let excludedKey, visibleBase = EMPTY, visibleRows = EMPTY;
  let initialized = false;
  let sourceReads = 0, fullScans = 0;

  function read(source, {
    records = EMPTY, deleted = EMPTY, storedTables = EMPTY, hidden = EMPTY, now = Date.now(),
  } = {}, { excludeFloor } = {}) {
    if (initialized && source.revision < sourceRevision) throw Error('表格来源已变化，请重试');
    const changes = new Map();
    const nextTombstones = new Set(Object.keys(deleted).filter(key => deleted[key]));
    const affected = new Set();
    const journal = initialized && (sourceRevision === source.revision ? [] : source.changesSince(sourceRevision));

    function retract(floor) {
      const lookup = candidates.get(floor);
      if (lookup && Object.hasOwn(rows, lookup.key)) changes.set(lookup.key, null);
      candidates.delete(floor);
      pending.delete(floor);
      confirmed.delete(floor);
    }

    function inspect(floor, message) {
      sourceReads++;
      if (!message) {
        retract(floor);
        return;
      }
      const item = cache.source(message);
      const value = cache.parse(item);
      if (!value || !Object.keys(value).length) {
        retract(floor);
        return;
      }
      const existing = candidates.get(floor);
      if (existing?.key !== item.key) retract(floor);
      if (existing?.key === item.key && existing.row.value === value) return;
      candidates.set(floor, {
        key: item.key, row: { floor, value }, since: existing?.key === item.key ? existing.since : undefined,
      });
      affected.add(floor);
    }

    if (!journal) {
      fullScans++;
      const live = new Set();
      for (const message of source.values()) {
        live.add(message.message_id);
        inspect(message.message_id, message);
      }
      for (const floor of candidates.keys()) if (!live.has(floor)) retract(floor);
    } else {
      for (const floor of new Set(journal)) inspect(floor, source.get(floor));
    }

    function changedTombstone(key) {
      const floor = parseMemorySource(key)?.floor;
      if (candidates.get(floor)?.key === key) affected.add(floor);
    }
    for (const key of tombstones) if (!nextTombstones.has(key)) changedTombstone(key);
    for (const key of nextTombstones) if (!tombstones.has(key)) changedTombstone(key);
    for (const floor of pending) affected.add(floor);
    if (lastRecords !== records || lastStored !== storedTables) {
      for (const floor of confirmed) affected.add(floor);
    }
    if (now < lastNow) for (const floor of candidates.keys()) affected.add(floor);

    for (const floor of affected) {
      const candidate = candidates.get(floor);
      if (!candidate) continue;
      const { key, row } = candidate;
      const blocked = nextTombstones.has(key);
      const ready = !blocked && Boolean(records[key] || storedTables[key]);
      if (!blocked && !ready) candidate.since ??= now;
      const stable = candidate.since !== undefined && now - candidate.since >= STABILITY_MS;
      pending.delete(floor);
      confirmed.delete(floor);
      if (!blocked && !stable) (ready ? confirmed : pending).add(floor);
      if (!blocked && (ready || stable)) {
        if (rows[key] !== row) changes.set(key, row);
      } else if (Object.hasOwn(rows, key)) {
        changes.set(key, null);
      }
    }
    if (changes.size) {
      rows = { ...rows };
      for (const [key, row] of changes) {
        if (row) rows[key] = row;
        else delete rows[key];
      }
    }

    const candidate = candidates.get(excludeFloor);
    const nextExclusion = candidate && Object.hasOwn(rows, candidate.key) ? candidate.key : undefined;
    if (excludedKey && excludedKey !== nextExclusion && Object.hasOwn(rows, excludedKey)) {
      changes.set(excludedKey, rows[excludedKey]);
    }
    const previousRows = visibleRows;
    if (nextExclusion) {
      if (excludedKey !== nextExclusion || changes.has(nextExclusion)) changes.set(nextExclusion, null);
      if (visibleBase !== rows || excludedKey !== nextExclusion) {
        visibleRows = { ...rows };
        delete visibleRows[nextExclusion];
      }
    } else {
      visibleRows = rows;
    }

    const projected = projectLedger(null, hidden, projection, changes);
    const nextHidden = new Set(Object.keys(hidden).filter(key => hidden[key]));
    if (!initialized || previousRows !== visibleRows || nextHidden.size !== hiddenIds.size ||
        [...nextHidden].some(id => !hiddenIds.has(id))) revision++;
    visibleBase = rows;
    excludedKey = nextExclusion;
    hiddenIds = nextHidden;
    tombstones = nextTombstones;
    lastRecords = records;
    lastStored = storedTables;
    lastNow = now;
    sourceRevision = source.revision;
    initialized = true;
    return { rows: visibleRows, ...projected, revision, sourceRevision };
  }

  return {
    read,
    info: () => ({
      sourceReads, fullScans, candidates: candidates.size, pending: pending.size,
      dossiers: projection.accumulator.info(), knowledge: projection.knowledgeAccumulator.info(),
    }),
  };
}
