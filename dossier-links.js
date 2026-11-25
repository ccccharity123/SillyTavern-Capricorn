// Read-only links from already public, active dossier projections.
const name = v => typeof v === 'string' ? v.trim().normalize('NFKC') : '';
const kinds = new Set(['关系','事件','成长','伏笔']);
export function indexDossierLinks(entities = [], isActive = () => true) {
  const people = new Map(), links = new Map();
  for (const row of entities) {
    if (row.kind !== '人物' || !isActive(row)) continue;
    const key = name(row.title);
    if (!key) continue;
    if (people.has(key)) people.set(key, null);
    else people.set(key, row.id);
  }
  for (const row of entities) {
    if (!kinds.has(row.kind) || !isActive(row)) continue;
    // Only structured explicit participants, never substring or alias inference.
    const participants = row.fields?.人物;
    if (!Array.isArray(participants)) continue;
    for (const key of new Set(participants.map(name).filter(Boolean))) {
      const id = people.get(key);
      if (!id) continue;
      if (!links.has(id)) links.set(id, []);
      links.get(id).push(row);
    }
  }
  return links;
}
