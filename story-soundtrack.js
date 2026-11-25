// Read-only association of explicit BGM tags with archived summary floors.
// Never infer a song for an untagged floor or persist duplicate memory.
export function indexStoryTracks(songs = []) {
  const index = new Map();
  for (const song of songs) {
    if (song?.floor == null || song.id == null) continue;
    const key = String(song.floor);
    let tracks = index.get(key);
    if (!tracks) index.set(key, tracks = new Map());
    const prior = tracks.get(song.id);
    if (!prior || (!prior.playable && song.playable)) tracks.set(song.id, song);
  }
  return new Map([...index].map(([key, tracks]) => [key, [...tracks.values()]]));
}
export function groupStoryTracks(rows, index, {chapter = '', query = '', match = () => true} = {}) {
  const grouped = new Map();
  for (const r of rows) {
    if (chapter && r.chapter !== chapter) continue;
    for (const t of index.get(String(r.floor)) || []) {
      if (query && !match(`${t.title} ${t.artist} ${r.title} ${r.content} ${r.chapter} ${r.traceText || ''}`, query)) continue;
      let g = grouped.get(t.id);
      if (!g) grouped.set(t.id, g = {t, rows: []});
      if (!g.t.playable && t.playable) g.t = t;
      if (g.rows[g.rows.length - 1] !== r) g.rows.push(r);
    }
  }
  return grouped;
}
