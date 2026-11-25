const floorBlock = 256;
const journalLimit = 256;
const reconciliationInterval = 120000;
const requiredEvents = ['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED'];

function eventFloor(value) {
  const floor = value && typeof value === 'object' ? value.message_id ?? value.messageId : value;
  if (!((typeof floor === 'string' && /^\d+$/.test(floor)) || typeof floor === 'number')) return;
  const index = Number(floor);
  return Number.isSafeInteger(index) && index >= 0 ? index : undefined;
}

function nativeStamp(message) {
  return message && [message.mes ?? message.message, message.is_user, message.is_system, message.is_hidden, message.swipe_id];
}

function sameStamp(a, b) {
  return a === b || !!a && !!b && a.every((value, index) => value === b[index]);
}

export function createMessageCatalog({ context, scope, last, read, clock = Date.now }) {
  let subscribed, eventTypes, cleanup = [];
  let pages = new Map();
  let journal = [];
  let dirty = new Set();
  let needsFull = true, removed = false;
  let currentScope, confirmedScope, native, firstMessage, tailMessage, finalFloor = -1, lastCheck = -Infinity;
  let tail, penultimate, penultimateMessage, revision = 0, epoch = 0;
  let current;
  const metrics = { fullReads: 0, rangeReads: 0, floorsRequested: 0 };

  function invalidate() {
    needsFull = true;
    epoch++;
  }

  function touch(floor) {
    dirty.add(floor);
    epoch++;
  }

  function unbind() {
    for (const detach of cleanup) detach();
    cleanup = [];
    subscribed = undefined;
    eventTypes = undefined;
  }

  function bind(host) {
    const events = host.eventSource;
    const types = host.eventTypes || host.event_types;
    if (events === subscribed && types === eventTypes) return;
    unbind();
    invalidate();
    if (!events?.on || !(events.off || events.removeListener) || !types || !requiredEvents.every(key => types[key])) return;
    subscribed = events;
    eventTypes = types;
    function on(key, callback) {
      if (!types[key]) return;
      events.on(types[key], callback);
      cleanup.push(() => (events.off || events.removeListener).call(events, types[key], callback));
    }
    on('CHAT_CHANGED', () => { confirmedScope = scope(); invalidate(); });
    on('MESSAGE_DELETED', () => { removed = true; epoch++; });
    for (const key of ['MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED', 'MESSAGE_UPDATED', 'MESSAGE_SENT']) {
      on(key, value => {
        const floor = eventFloor(value);
        if (floor === undefined) invalidate();
        else touch(floor);
      });
    }
  }

  function lookup(blocks, floor) {
    return blocks.get(Math.floor(floor / floorBlock))?.[floor % floorBlock];
  }

  function* rows(blocks) {
    for (const block of [...blocks.keys()].sort((a, b) => a - b)) {
      for (const row of blocks.get(block)) if (row) yield row;
    }
  }

  function readRange(start, end, full) {
    if (full) metrics.fullReads++;
    else metrics.rangeReads++;
    if (end < start) return [];
    metrics.floorsRequested += end - start + 1;
    const list = read(start, end, full);
    if (!Array.isArray(list) || list.some(row => !Number.isSafeInteger(row?.message_id) || row.message_id < start || row.message_id > end)) {
      throw Error('聊天消息范围读取失败');
    }
    return list;
  }

  function snapshot({ reconcile = false } = {}) {
    const host = context();
    bind(host);
    const id = scope();
    const max = last();
    if (!Number.isSafeInteger(max) || max < -1) throw Error('聊天尚未就绪');
    const live = host.chat;
    const trusted = !!subscribed && Array.isArray(live) && live.length === max + 1;
    if (trusted && current?.trusted && currentScope !== id && native === live &&
        confirmedScope !== id && live[0] === firstMessage && live[max] === tailMessage) {
      throw Error('新聊天的消息尚未就绪，请重试');
    }
    let full = !trusted || needsFull || currentScope !== id || native !== live || reconcile && clock() - lastCheck >= reconciliationInterval;
    if (removed || max < finalFloor) {
      const tailRemoved = max === finalFloor - 1 && live?.[max] === penultimateMessage && sameStamp(penultimate, nativeStamp(live?.[max]));
      full ||= !tailRemoved;
      if (tailRemoved) dirty.add(finalFloor);
    }
    if (!full && max === finalFloor && !sameStamp(tail, nativeStamp(live[max]))) dirty.add(max);

    const beforeEpoch = epoch;
    const next = full ? new Map() : new Map(pages);
    const cloned = new Set(), patched = new Set();
    function put(floor, row) {
      const old = lookup(pages, floor);
      if (!full && (old === row || old && row && old.message === row.message && old.is_hidden === row.is_hidden)) return;
      const block = Math.floor(floor / floorBlock);
      if (!cloned.has(block)) {
        next.set(block, next.has(block) ? next.get(block).slice() : []);
        cloned.add(block);
      }
      next.get(block)[floor % floorBlock] = row ? Object.freeze({ ...row }) : undefined;
      patched.add(floor);
    }

    try {
      if (full) {
        for (const row of readRange(0, max, true)) put(row.message_id, row);
      } else {
        const fetched = new Set();
        if (max > finalFloor) {
          for (const row of readRange(finalFloor + 1, max, false)) put(row.message_id, row);
          for (const floor of dirty) if (floor > finalFloor && floor <= max) fetched.add(floor);
        }
        for (const floor of dirty) {
          if (floor < 0 || fetched.has(floor)) continue;
          if (floor > max) put(floor, undefined);
          else put(floor, readRange(floor, floor, false)[0]);
        }
      }
      if (scope() !== id || epoch !== beforeEpoch || last() !== max) throw Error('读取期间剧情已更新，请重试');
    } catch (error) {
      const retry = !full && scope() === id && epoch === beforeEpoch && last() === max;
      invalidate();
      if (retry) return snapshot();
      throw error;
    }

    if (full || patched.size) {
      for (const block of cloned) if (!next.get(block).some(Boolean)) next.delete(block);
      pages = next;
      revision++;
      journal = full ? [] : [...journal.slice(1 - journalLimit), { revision, floors: [...patched] }];
      if (full) lastCheck = clock();
    }
    needsFull = removed = false;
    dirty.clear();
    currentScope = id;
    native = live;
    firstMessage = live?.[0];
    tailMessage = live?.[max];
    finalFloor = max;
    tail = nativeStamp(live?.[max]);
    penultimateMessage = live?.[max - 1];
    penultimate = nativeStamp(penultimateMessage);
    if (current?.revision === revision && current.last === max && current.epoch === epoch) return current;
    const blocks = pages;
    const log = journal;
    const capturedRevision = revision;
    let list;
    current = {
      scope: id, trusted, revision: capturedRevision, epoch, last: max,
      get: floor => lookup(blocks, floor), values: () => rows(blocks), messages: () => list ||= [...rows(blocks)],
      changesSince(prior) {
        if (prior === capturedRevision) return [];
        if (!Number.isInteger(prior) || !log.length || prior < log[0].revision - 1 || prior >= capturedRevision) return null;
        return new Set(log.filter(change => change.revision > prior).flatMap(change => change.floors));
      },
    };
    return current;
  }

  return {
    snapshot, invalidate, touch, version: () => `${scope()}:${epoch}:${revision}`,
    metrics: () => ({ ...metrics, revision, trusted: current?.trusted ?? false }),
    destroy() { unbind(); pages = new Map(); current = undefined; native = undefined; },
  };
}
