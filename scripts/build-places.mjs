// Resolves the places named in src/data/sections.meta.json against OpenBible.info's
// Bible Geocoding Data (CC BY 4.0), keeping each place's competing identifications
// and their scores. Regions without an OpenBible point use a labelled approximate
// position given in the meta file. Each place's English Wikipedia article comes from
// the Wikidata item OpenBible links to (or one given in the meta file). Each place's
// photo is OpenBible's for the leading identification (or for the place), or one chosen in the meta file
// (`photo: [Commons file, caption]`); author and licence come from Wikimedia Commons.
//
//   node scripts/build-places.mjs   →  public/data/places.json, public/data/photos/{key}.jpg

import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileName, files } from './lib/commons.mjs';
import { entities } from './lib/wikidata.mjs';

const meta = JSON.parse(await readFile('src/data/sections.meta.json', 'utf8'));
const records = (await readFile('data/raw/openbible/ancient.jsonl', 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byName = new Map(records.map((r) => [r.friendly_id, r]));
const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '').trim();

const qid = {};
for (const [key, def] of Object.entries(meta.places)) {
  if (def.wikidata !== undefined) { qid[key] = def.wikidata; continue; }
  const rec = def.openbible && byName.get(def.openbible);
  qid[key] = rec ? Object.values(rec.linked_data ?? {}).map((v) => v.id).find((id) => /^Q\d+$/.test(id ?? '')) ?? null : null;
}
const wd = await entities(Object.values(qid).filter(Boolean));

const places = {};
const photoRefs = {}; // key → [Commons file, caption]
for (const [key, def] of Object.entries(meta.places)) {
  const place = { name: def.name, kind: def.kind ?? 'site', candidates: [] };
  const article = qid[key] && wd[qid[key]]?.enwiki;
  if (article) place.wiki = { id: qid[key], title: article, ...(def.wikiNote ? { note: def.wikiNote } : {}) };
  if (def.openbible) {
    const rec = byName.get(def.openbible);
    if (!rec) throw new Error(`OpenBible has no place called "${def.openbible}" (for ${key})`);
    place.openbible = { id: rec.id, name: rec.friendly_id, url: `https://www.openbible.info/geo/ancient/${rec.id}/${rec.url_slug ?? ''}`.replace(/\/$/, '') };
    for (const ident of rec.identifications) {
      const res = (ident.resolutions ?? []).find((r) => r.lonlat);
      if (!res) continue;
      const label = strip(ident.description).replace(/^another name for /, 'same place as ');
      const score = ident.score?.time_total ?? null;
      if (score !== null && score < 0) continue; // OpenBible marks rejected identifications with negative scores
      const t = ident.media?.thumbnail;
      if (!place.candidates.length && t?.credit_url?.includes('commons.wikimedia.org')) photoRefs[key] = [fileName(t.credit_url), strip(t.description)];
      place.candidates.push({ label, lonlat: res.lonlat.split(',').map(Number), score });
      if (place.candidates.length === 3) break;
    }
    if (!place.candidates.length) throw new Error(`No coordinates for ${key}`);
    const t = rec.media?.thumbnail; // the record's own photo, where its identification has none (Egypt)
    if (!photoRefs[key] && t?.credit_url?.includes('commons.wikimedia.org')) photoRefs[key] = [fileName(t.credit_url), strip(t.description)];
  } else {
    place.candidates.push({ label: 'approximate label position', lonlat: def.lonlat, score: null });
  }
  if (def.photo) photoRefs[key] = def.photo;
  places[key] = place;
}

const photos = await files(Object.values(photoRefs).map(([name]) => name));
// Copy into a fresh folder and swap it in only once every photo is there, so a
// failure part-way leaves the previous photos in place.
const PHOTOS = 'public/data/photos', NEXT = `${PHOTOS}.next`;
await rm(NEXT, { recursive: true, force: true });
await mkdir(NEXT, { recursive: true });
for (const [key, [name, caption]] of Object.entries(photoRefs)) {
  const { thumb, ...credit } = photos[name];
  await copyFile(thumb, `${NEXT}/${key}.jpg`);
  places[key].photo = { src: `data/photos/${key}.jpg`, caption, ...credit };
}
await rm(PHOTOS, { recursive: true, force: true });
await rename(NEXT, PHOTOS);

await writeFile('public/data/places.json', JSON.stringify({
  attribution: 'Place identifications and scores: OpenBible.info Bible Geocoding Data, CC BY 4.0. Region positions are approximate label positions. Wikipedia articles via Wikidata (CC0). Photos from Wikimedia Commons, each with its author and licence.',
  places,
}));
const multi = Object.entries(places).filter(([, p]) => p.candidates.length > 1).map(([k, p]) => `${k} (${p.candidates.map((c) => `${c.label} ${c.score}`).join(' / ')})`);
console.log(`${Object.keys(places).length} places → public/data/places.json`);
console.log(`with competing identifications: ${multi.join('; ')}`);
console.log(`no photo: ${Object.keys(places).filter((k) => !places[k].photo).join(', ') || 'none'}`);
console.log(`Wikipedia: ${Object.entries(places).map(([k, p]) => `${k} → ${p.wiki?.title ?? '(none)'}`).join('; ')}`);
