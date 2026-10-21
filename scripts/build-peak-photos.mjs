// Photos of the named peaks: each peak's Wikidata image (P18, CC0 data; the photo's own licence from Wikimedia
// Commons), a 500 px thumbnail per peak, added to the peaks build-terrain wrote. Run after build-terrain.mjs.
//
//   node scripts/build-peak-photos.mjs   →  public/data/peak-photos/{id}.jpg, photo fields in public/data/peaks.json

import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { files } from './lib/commons.mjs';
import { entities } from './lib/wikidata.mjs';

const data = JSON.parse(await readFile('public/data/peaks.json', 'utf8'));
const wd = await entities(data.peaks.map((p) => p.id));
const refs = Object.fromEntries(data.peaks.filter((p) => wd[p.id]?.image).map((p) => [p.id, wd[p.id].image]));
const photos = await files(Object.values(refs));
// A fresh folder, swapped in once every photo is there, so a failure part-way leaves the previous photos in place.
const DIR = 'public/data/peak-photos', NEXT = `${DIR}.next`;
await rm(NEXT, { recursive: true, force: true });
await mkdir(NEXT, { recursive: true });
for (const p of data.peaks) {
  delete p.photo;
  const name = refs[p.id];
  if (!name) continue;
  const { thumb, ...credit } = photos[name];
  await copyFile(thumb, `${NEXT}/${p.id}.jpg`);
  p.photo = { src: `data/peak-photos/${p.id}.jpg`, caption: p.name, ...credit };
}
await rm(DIR, { recursive: true, force: true });
await rename(NEXT, DIR);
await writeFile('public/data/peaks.json', JSON.stringify(data));
console.log(`peak photos: ${Object.keys(refs).length} of ${data.peaks.length}; none for ${data.peaks.filter((p) => !p.photo).map((p) => p.name).join(', ') || '-'}`);
