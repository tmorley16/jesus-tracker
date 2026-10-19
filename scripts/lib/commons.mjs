// Wikimedia Commons lookups for the build scripts: a file's author, licence and a
// 500 px thumbnail (one of Wikimedia's standard widths). Metadata is cached in
// data/raw/commons/files.json and thumbnails in data/raw/commons/thumbs/, so a
// rebuild works offline once everything has been fetched.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DIR = 'data/raw/commons';
const CACHE = `${DIR}/files.json`;
const WIDTH = 500;
const UA = { 'User-Agent': 'JesusTracker/0.1 (data build script)' };
const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** "File:X.jpg", "X.jpg" or a commons.wikimedia.org/wiki/File:… URL → "X.jpg". */
export function fileName(ref) {
  const m = ref.match(/\/wiki\/File:(.+)$/);
  return decodeURIComponent(m ? m[1] : ref).replace(/^File:/, '').replace(/_/g, ' ');
}

/** Metadata for each file: { page, author, licence, licenceUrl, thumb (local path of the cached thumbnail) }. */
export async function files(names) {
  let cache = {};
  try { cache = JSON.parse(await readFile(CACHE, 'utf8')); } catch { /* first run */ }
  const missing = [...new Set(names)].filter((n) => !cache[n]);
  await mkdir(`${DIR}/thumbs`, { recursive: true });
  for (let i = 0; i < missing.length; i += 25) {
    const batch = missing.slice(i, i + 25);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(batch.map((n) => `File:${n}`).join('|'))}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=${WIDTH}&format=json&formatversion=2&redirects=1`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`Commons answered ${res.status}`);
    const j = await res.json();
    const alias = new Map([...(j.query.normalized ?? []), ...(j.query.redirects ?? [])].map((r) => [r.from, r.to]));
    for (const name of batch) {
      let title = `File:${name}`;
      while (alias.has(title)) title = alias.get(title);
      const page = j.query.pages.find((p) => p.title === title);
      const info = page?.imageinfo?.[0];
      if (!info) throw new Error(`Commons has no file "${name}"`);
      const m = info.extmetadata ?? {};
      const thumb = `${DIR}/thumbs/${createHash('sha1').update(name).digest('hex').slice(0, 16)}.jpg`;
      const img = await fetch(info.thumburl ?? info.url, { headers: UA });
      if (!img.ok) throw new Error(`Commons thumbnail for "${name}" answered ${img.status}`);
      await writeFile(thumb, Buffer.from(await img.arrayBuffer()));
      cache[name] = {
        page: info.descriptionurl,
        author: [m.Artist, m.Credit].map((x) => strip(x?.value)).find((s) => s && !/^No machine-readable/i.test(s)) ?? null,
        licence: strip(m.LicenseShortName?.value) || null,
        licenceUrl: m.LicenseUrl?.value ?? null,
        thumb,
      };
    }
  }
  if (missing.length) await writeFile(CACHE, JSON.stringify(cache, null, 1));
  return cache;
}
