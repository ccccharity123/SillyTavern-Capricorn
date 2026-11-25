export function parseMemorySource(key) {
  const match = /^(\d+):(.+)$/.exec(key);
  if (!match) return null;
  const floor = Number(match[1]);
  return Number.isSafeInteger(floor) ? { floor, version: match[2] } : null;
}

// Recheck source identity without modifying stored revisions or user deletions.
export function canonicalRows(rows,messages,hash,deleted={}){
  const live=new Map(messages.map(m=>[m.message_id,hash(String(m.message??''))]));
  return canonicalRowsFromSources(rows, live, deleted);
}

export function canonicalRowsFromSources(rows, live, deleted = {}) {
  const active=[];
  for(const [key,row] of Object.entries(rows)){
    if(!row||deleted[key])continue;
    const source = parseMemorySource(key);
    if(!source){
      if(row.sourceMessage==null&&!/^\d+:/.test(key))active.push([key,row]);
      continue;
    }
    const { floor, version: digest } = source;
    if(live.get(floor)!==digest)continue;
    if(row.sourceMessage!=null&&row.sourceMessage!==floor)continue;
    if(row.sourceHash&&row.sourceHash!==digest)continue;
    active.push([key,row.sourceMessage===floor&&row.sourceHash===digest?row:{...row,sourceMessage:floor,sourceHash:digest}]);
  }
  return Object.fromEntries(active);
}
