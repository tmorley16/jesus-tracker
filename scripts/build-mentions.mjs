// The places each section's text names, by gospel, so the map can make sure a place named in what's on screen is
// labelled (not crowded out by its neighbours or hidden as the map zooms out).
//
// Names are matched in the BSB text (public/data/text/*.json) as written, longest first, and a match is masked
// before the shorter names are tried, so "Sea of Galilee" doesn't also count as Galilee, nor "Bethany beyond the
// Jordan" as Bethany or the Jordan. Only proper names are matched (not "the lake" or "the mountain").
//
//   node scripts/build-mentions.mjs   →  src/data/mentions.json  { rowId: { BOOK: [place keys] } }

import { readFile, writeFile } from 'node:fs/promises';

const harmony = JSON.parse(await readFile('src/data/harmony.json', 'utf8'));
const { places } = JSON.parse(await readFile('public/data/places.json', 'utf8'));
const BOOKS = ['MAT', 'MRK', 'LUK', 'JHN', 'ACT'];
const text = Object.fromEntries(await Promise.all(BOOKS.map(async (b) => [b, JSON.parse(await readFile(`public/data/text/${b}.json`, 'utf8'))])));

// How each place is written in the text, where that isn't simply its name.
const WRITTEN = {
  'bethany-jordan': ['Bethany beyond the Jordan'],
  'sea-of-galilee': ['Sea of Galilee', 'Sea of Tiberias', 'Lake of Gennesaret'],
  'mount-of-olives': ['Mount of Olives', 'Olivet'],
  'samaria-galilee': ['between Samaria and Galilee'],
  'wilderness': ['wilderness of Judea'],
  'beyond-jordan': ['beyond the Jordan', 'across the Jordan'],
  'jordan': ['Jordan'],
  'bethesda': ['Bethesda', 'Bethzatha'],
  'siloam': ['Siloam'],
  'gabbatha': ['Gabbatha', 'Stone Pavement'],
  'golgotha': ['Golgotha', 'the Skull'],
  'magadan': ['Magadan', 'Dalmanutha'],
  'gadara': ['Gadarenes', 'Gadara'],
  'gerasa': ['Gerasenes', 'Gerasa'],
};
const patterns = Object.entries(places).flatMap(([key, p]) => (WRITTEN[key] ?? [p.name]).map((w) => ({ key, w })));
patterns.sort((a, b) => b.w.length - a.w.length);

const versesIn = (book, [c1, v1, c2, v2]) => {
  const out = [];
  for (let c = c1; c <= c2; c++) for (let v = c === c1 ? v1 : 1; c < c2 || v <= v2; v++) {
    const t = text[book]?.[c]?.[v];
    if (t === undefined) break;
    out.push(t);
  }
  return out;
};

const mentions = {};
let rows = 0, count = 0;
for (const s of harmony.sections) for (const r of s.rows) {
  rows++;
  for (const [book, ranges] of Object.entries(r.refs ?? {})) {
    if (!BOOKS.includes(book)) continue;
    let t = ranges.flatMap((rg) => versesIn(book, rg)).join(' ');
    const keys = new Set();
    for (const { key, w } of patterns) {
      const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      if (re.test(t)) { keys.add(key); t = t.replace(re, (m) => ' '.repeat(m.length)); }
    }
    if (!keys.size) continue;
    (mentions[r.id] ??= {})[book] = [...keys].sort();
    count += keys.size;
  }
}
// One row per line, so a change shows as a change to that row.
const lines = Object.entries(mentions).map(([id, m]) => `${JSON.stringify(id)}:${JSON.stringify(m)}`);
await writeFile('src/data/mentions.json', `{\n${lines.join(',\n')}\n}\n`);
console.log(`${Object.keys(mentions).length} of ${rows} rows name a place (${count} by book) → src/data/mentions.json`);
