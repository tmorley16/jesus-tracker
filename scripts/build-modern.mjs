// Modern towns and cities for the map's optional "Modern places" overlay, from GeoNames
// (cities with more than 15,000 people; CC BY 4.0). Near the gospels every such town is
// kept; farther away only cities over 300,000. Each gets the zoom at which it appears,
// by population. Neighbourhoods and abandoned places are left out; no borders or
// country names are used.
//
//   node scripts/build-modern.mjs   →  public/data/geo/modern.json

import { readFile, writeFile } from 'node:fs/promises';

const CORE = [33.8, 29.4, 37.2, 33.8];
const WIDE = [5, 12, 60, 48];
const SKIP = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW']); // section of a place, historical, abandoned, destroyed
const inBox = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
const minZoom = (pop) => (pop >= 1e6 ? 4.5 : pop >= 3e5 ? 6 : pop >= 1e5 ? 7.5 : pop >= 4e4 ? 8.5 : 9.5);

const rows = (await readFile('data/raw/geonames/cities15000.txt', 'utf8')).split('\n').filter(Boolean).map((l) => l.split('\t'));
const places = [];
for (const r of rows) {
  const [name, lat, lon, fcode, pop] = [r[2], +r[4], +r[5], r[7], +r[14]];
  if (SKIP.has(fcode) || !inBox(WIDE, lon, lat)) continue;
  if (!inBox(CORE, lon, lat) && pop < 3e5) continue;
  places.push([name, Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4, minZoom(pop), pop]);
}
places.sort((a, b) => b[4] - a[4]);
await writeFile('public/data/geo/modern.json', JSON.stringify({
  attribution: 'Modern places: GeoNames (CC BY 4.0), towns over 15,000 people.',
  places: places.map(([n, x, y, z]) => [n, x, y, z]),
}));
console.log(`modern places: ${places.length} (${places.filter((p) => inBox(CORE, p[1], p[2])).length} near the gospels) → public/data/geo/modern.json`);
