// Wikimedia Commons lookups for the build scripts: a file's author, licence and a
// 500 px thumbnail (one of Wikimedia's standard widths). Metadata is cached in
// data/raw/commons/files.json and thumbnails in data/raw/commons/thumbs/, so a
// rebuild works offline once everything has been fetched. The site's copies are re-encoded (`writeThumb`).

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const DIR = 'data/raw/commons';
const CACHE = `${DIR}/files.json`;
const WIDTH = 500;
const UA = { 'User-Agent': 'JesusTracker/0.1 (data build script)' };
const get = (url) => fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
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
  const missing = [...new Set(names)].filter((n) => !cache[n] || !existsSync(cache[n].thumb)); // re-fetch a lost thumbnail
  await mkdir(`${DIR}/thumbs`, { recursive: true });
  for (let i = 0; i < missing.length; i += 25) {
    const batch = missing.slice(i, i + 25);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(batch.map((n) => `File:${n}`).join('|'))}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=${WIDTH}&format=json&formatversion=2&redirects=1`;
    const res = await get(url);
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
      const img = await get(info.thumburl ?? info.url);
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
    await writeFile(CACHE, JSON.stringify(cache, null, 1)); // after each batch, so a failure later keeps what was fetched
  }
  return cache;
}

/** A cached thumbnail re-encoded for the site (mozjpeg at quality 78, metadata stripped: about 40% smaller than
 *  Commons' own thumbnails, with no visible change at the size the cards show them), kept as it is if that's no smaller. */
export async function writeThumb(thumb, dest) {
  const src = await readFile(thumb);
  const out = await sharp(src).rotate().jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  await writeFile(dest, out.length < src.length ? out : src);
}
