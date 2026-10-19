// Wikidata (CC0) lookups for the build scripts: English label, coordinates and English
// Wikipedia article. Responses are cached in data/raw/wikidata/entities.json, so a
// rebuild works offline once everything has been fetched.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const CACHE = 'data/raw/wikidata/entities.json';

export async function entities(ids) {
  let cache = {};
  try { cache = JSON.parse(await readFile(CACHE, 'utf8')); } catch { /* first run */ }
  const missing = [...new Set(ids)].filter((id) => id && !cache[id]);
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join('|')}&props=labels|claims|sitelinks&languages=en&sitefilter=enwiki&format=json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'JesusTracker/0.1 (data build script)' } });
    if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
    const j = await res.json();
    for (const id of batch) {
      const e = j.entities[id] ?? Object.values(j.entities).find((x) => x.redirects?.from === id);
      if (!e || e.missing !== undefined) throw new Error(`Wikidata has no item ${id}`);
      const c = e.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      cache[id] = { label: e.labels?.en?.value ?? null, enwiki: e.sitelinks?.enwiki?.title ?? null, lonlat: c ? [c.longitude, c.latitude] : null };
    }
  }
  if (missing.length) {
    await mkdir('data/raw/wikidata', { recursive: true });
    await writeFile(CACHE, JSON.stringify(cache, null, 1));
  }
  return cache;
}

export const wikipediaUrl = (title) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
