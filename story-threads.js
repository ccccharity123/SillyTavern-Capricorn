// Exact, versioned source links only. No inferred causal edges.
export function indexStoryThreads(rows, entities) {
  const positions = new Map(rows.flatMap((r,i)=>typeof r.sourceKey === 'string' && r.sourceKey.trim() ? [[r.sourceKey,i]] : []));
  const bySource = new Map();
  for (const entity of entities) {
    if (!['事件','伏笔'].includes(entity.kind)) continue;
    const nodes = [...new Set(Array.isArray(entity.sources) ? entity.sources : [])].filter(k=>positions.has(k)).sort((a,b)=>positions.get(a)-positions.get(b));
    if (!nodes.length) continue;
    const thread = {id:entity.id, kind:entity.kind, title:entity.title, status:entity.kind==='伏笔' ? entity.status || '' : '', nodes};
    for (let i=0;i<nodes.length;i++) {
      const key=nodes[i];
      if (!bySource.has(key)) bySource.set(key,[]);
      bySource.get(key).push({thread,previous:nodes[i-1],next:nodes[i+1]});
    }
  }
  return bySource;
}
