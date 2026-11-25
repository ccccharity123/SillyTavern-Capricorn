import { canonicalRowsFromSources, parseMemorySource } from './canon.js';
import { createSummaryStatistics } from './memory-route.js';
import { createTableIndex } from './memory-table-index.js';
import { buildLedger, createTableCache } from './weave.js';

function own(object, key) {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

// One message snapshot can serve multiple reads of the chat variables.
export function createMemoryData(hash) {
  let currentScope;
  let tables;
  let firstSeen;
  let accounting;
  let tableIndex;
  let sourceHashes;

  function read({ scope, chatId, messages, data, source, excludeFloor, now = Date.now() }) {
    if (currentScope !== scope || !tables) {
      currentScope = scope;
      tables = createTableCache(hash);
      firstSeen = new Map();
      accounting = createSummaryStatistics();
      tableIndex = createTableIndex(hash, createTableCache(hash));
      sourceHashes = new WeakMap();
    }
    const cache = tables;
    const stability = firstSeen;
    const statistics = accounting;
    const eventTables = tableIndex;
    const digests = sourceHashes;
    const items = new Map();
    let versions;

    function itemFor(message) {
      if (!items.has(message)) items.set(message, cache.source(message));
      return items.get(message);
    }

    function sourceVersions() {
      if (!versions) {
        if (source) {
          versions = { get(floor) {
            if (floor === excludeFloor) return;
            const message = source.get(floor);
            if (!message) return;
            if (!digests.has(message)) digests.set(message, hash(String(message.message ?? '')));
            return digests.get(message);
          } };
        } else {
          versions = new Map();
          for (const message of messages) versions.set(message.message_id, itemFor(message).version);
        }
      }
      return versions;
    }

    function withData(value, readAt = Date.now()) {
      const data = value ?? {};
      const records = data.records || {};
      const deleted = data.deletedKeys || {};
      const archive = data.archiveUI || {};
      const storedTables = data.weave?.rows || {};
      let summaries;
      let ledger;
      let summaryAccounting;

      function activeSummaries() {
        return summaries ??= canonicalRowsFromSources(records, sourceVersions(), deleted);
      }

      function summaryStats() {
        if (!summaryAccounting) {
          statistics.reconcile(activeSummaries());
          summaryAccounting = statistics.read();
        }
        return summaryAccounting;
      }

      function activeLedger() {
        if (ledger) return ledger;
        if (source) return ledger = eventTables.read(source, {
          records, deleted, storedTables, hidden: archive.traceHidden, now: readAt,
        }, { excludeFloor });
        ledger = buildLedger(messages, hash, deleted, archive.traceHidden || {}, storedTables, (_message, key) => {
          if (records[key]) return true;
          const seenAt = stability.get(key);
          if (seenAt !== undefined) return readAt - seenAt >= 8000;
          stability.set(key, readAt);
          return false;
        }, cache, itemFor);
        for (const key of stability.keys()) if (!ledger.live.has(key)) stability.delete(key);
        return ledger;
      }

      function activeDossiers(selectedSummaries = activeSummaries()) {
        const { rows, entities } = activeLedger();
        const manual = (archive.dossier || []).filter(row => (row.sources || []).every(key =>
          Object.hasOwn(rows, key) || Object.hasOwn(selectedSummaries, key)));
        const manualIds = new Set(manual.map(row => row.id));
        return [...manual, ...entities.filter(row => !manualIds.has(row.id))];
      }

      function dossierSources() {
        const sources = { ...activeSummaries() };
        for (const row of activeLedger().entities) {
          for (const key of row.sources) {
            const source = parseMemorySource(key);
            if (source && !Object.hasOwn(sources, key)) {
              sources[key] = { sourceMessage: source.floor, sourceHash: source.version, title: '随层档案', content: row.body };
            }
          }
        }
        return Object.entries(sources).filter(([key, { sourceMessage, sourceHash }]) =>
          sourceVersions().get(sourceMessage) === sourceHash && key === `${sourceMessage}:${sourceHash}`)
          .sort((a, b) => a[1].sourceMessage - b[1].sourceMessage);
      }

      function provenance(kind, id, options = {}) {
        let origin, keys, active;
        if (kind === 'summary' || kind === 'table') {
          const live = kind === 'summary' ? activeSummaries() : activeLedger().rows;
          const stored = kind === 'summary' ? records : storedTables;
          if (!own(live, id) && !own(stored, id)) return;
          origin = kind === 'summary' ? 'archive' : 'message';
          keys = [id];
          active = Object.hasOwn(live, id);
        } else if (kind === 'dossier' || kind === 'foreshadow' || kind === 'knowledge') {
          const projection = activeLedger();
          const matches = row => row.id === id;
          const manual = kind === 'knowledge' ? undefined : (archive.dossier || []).find(matches);
          const live = kind === 'knowledge' ? projection.knowledge.find(matches) : projection.entities.find(matches);
          const previous = kind === 'knowledge' ? undefined : (data.weave?.entities || []).find(matches);
          const manualActive = manual && (manual.sources || []).every(key =>
            Object.hasOwn(projection.rows, key) || Object.hasOwn(activeSummaries(), key));
          const row = options.origin === 'manual' ? manual : manualActive ? manual : live || manual || previous;
          if (!row || kind === 'foreshadow' && row.kind !== '伏笔') return;
          origin = row === manual ? 'manual' : 'derived';
          keys = row.sources || [];
          active = Boolean(row === manual ? manualActive : live);
        } else {
          return;
        }
        if (options.sourceKey !== undefined) keys = keys.filter(key => key === options.sourceKey);
        const sources = keys.map(key => {
          const parsed = parseMemorySource(key);
          const summary = own(records, key);
          const table = kind === 'summary' ? undefined : own(activeLedger().rows, key) || own(storedTables, key);
          const tableTime = table?.value?.时间;
          const storyTime = typeof tableTime === 'string' && tableTime ? tableTime : summary?.storyTime;
          return {
            scope, chatId, key, floor: parsed?.floor ?? null, version: parsed?.version ?? null,
            storyTime: typeof storyTime === 'string' && storyTime ? storyTime : null,
            active: kind === 'summary' || kind === 'table' ? active : Boolean(
              Object.hasOwn(activeSummaries(), key) || Object.hasOwn(activeLedger().rows, key)),
          };
        });
        return { scope, chatId, kind, id, origin, active, sources };
      }

      return {
        scope, archive, summaries: activeSummaries, summaryStats, ledger: activeLedger, activeDossiers, dossierSources, provenance, withData,
        messageRevision: excludeFloor === undefined ? source?.revision : undefined,
        tableRevision: () => activeLedger().revision,
        rawTable: message => message ? cache.parse(itemFor(message)) : null,
      };
    }

    return withData(data, now);
  }

  return { read, tableMetrics: () => tableIndex?.info() };
}
