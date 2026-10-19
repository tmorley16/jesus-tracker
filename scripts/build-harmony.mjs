// Parses the "Analytical outline" of Robertson's Harmony of the Gospels (1922,
// public domain; Project Gutenberg #36264) into a section table, then checks that
// every verse of the four gospels is covered.
//
//   node scripts/build-text.mjs && node scripts/build-harmony.mjs   →  src/data/harmony.json
//
// Robertson's own section titles are kept as `sourceTitle`; the neutral titles the
// site shows live in src/data/sections.meta.json.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const BOOK = { 'Matt.': 'MAT', Mark: 'MRK', Luke: 'LUK', John: 'JHN', Acts: 'ACT', '1 Cor.': '1CO' };
const GOSPELS = ['MAT', 'MRK', 'LUK', 'JHN'];
const BOOK_RE = /^(Matt\.|Mark|Luke|John|Acts|1 Cor\.)\s+(.*)$/;

const text = {};
for (const code of [...GOSPELS, 'ACT', '1CO']) text[code] = JSON.parse(await readFile(`public/data/text/${code}.json`, 'utf8'));
const lastVerse = (book, chapter) => Math.max(...Object.keys(text[book][chapter] ?? { 0: '' }).map(Number));

// ---- refs: "Mark 1:14; Matt. 4:12; Luke 3:19-20; 4:14; John 4:1-4." -------------------------
function parseRefs(raw, where) {
  const ranges = {};
  let book = null;
  for (let seg of raw.replace(/\.$/, '').split(';')) {
    seg = seg.trim();
    if (!seg) continue;
    const m = seg.match(BOOK_RE);
    if (m) { book = BOOK[m[1]]; seg = m[2]; }
    if (!book) throw new Error(`${where}: no book for "${seg}"`);
    let chapter = null; // set once an item names a chapter:verse
    for (let item of seg.split(',')) {
      item = item.trim();
      if (!item) continue;
      let r;
      if ((r = item.match(/^(\d+):(\d+)-(\d+):(\d+)$/))) { // 7:13-8:1
        chapter = +r[3];
        push(book, [+r[1], +r[2], +r[3], +r[4]]);
      } else if ((r = item.match(/^(\d+):(\d+)(?:-(\d+))?$/))) { // 5:1-2 or 2:21
        chapter = +r[1];
        push(book, [chapter, +r[2], chapter, +(r[3] ?? r[2])]);
      } else if ((r = item.match(/^(\d+)(?:-(\d+))?$/))) {
        if (chapter !== null) { // "32-36" after "6:27-30" = verses in the same chapter
          push(book, [chapter, +r[1], chapter, +(r[2] ?? r[1])]);
        } else { // "5-7" or "12" right after the book name = whole chapters
          const c1 = +r[1], c2 = +(r[2] ?? r[1]);
          push(book, [c1, 1, c2, lastVerse(book, c2)]);
        }
      } else {
        throw new Error(`${where}: can't read "${item}" in "${raw}"`);
      }
    }
  }
  return ranges;
  function push(b, range) { (ranges[b] ??= []).push(range); }
}

// ---- outline -------------------------------------------------------------------------------
const src = (await readFile('data/raw/robertson/pg36264.txt', 'utf8')).replace(/\r\n/g, '\n');
// The headings also appear in the table of contents; the outline itself starts at
// the heading that is immediately followed by PART I.
const start = src.search(/ANALYTICAL OUTLINE OF THE HARMONY\s+PART I:/);
const end = src.indexOf('TABLE FOR FINDING ANY PASSAGE IN THE HARMONY', start);
if (start < 0 || end < 0) throw new Error('Could not find the analytical outline in the Robertson text');
const lines = src.slice(start, end).split('\n').slice(1);

const parts = [];
const sections = [];
let part = null, sect = null, pendingTitle = [], refsBuf = null, inGroups = false;

function flushRefs() {
  if (refsBuf === null) return;
  const refs = parseRefs(refsBuf, sect ? `Sect. ${sect.n}` : 'outline');
  if (!sect.refs) {
    sect.refs = refs;
  } else { // a sub-section inside Sect. 54 or 64
    const titleLines = pendingTitle.map((t) => t.replace(/^_|_$/g, '').trim());
    const groupIdx = titleLines.length > 1 && /^_/.test(pendingTitle[0]) ? 1 : 0;
    if (groupIdx) sect.currentGroup = titleLines[0];
    sect.rows.push({ id: `${sect.id}-${sect.rows.length + 1}`, sourceTitle: titleLines.slice(groupIdx).join(' '), group: sect.currentGroup ?? null, refs });
  }
  pendingTitle = [];
  refsBuf = null;
}

for (const raw of lines) {
  const line = raw.replace(/\s+$/, '');
  const t = line.trim();
  if (!t) continue;
  let m;
  if ((m = t.match(/^PART ([IVX]+): (.+)$/))) {
    flushRefs();
    part = { id: `p${parts.length + 1}`, roman: m[1], sourceTitle: m[2], sections: [] };
    parts.push(part); sect = null; inGroups = false;
    continue;
  }
  if (/^SECTIONS \d+-\d+$/.test(t)) continue;
  if (t === '_Eight Groups in the Period_') { inGroups = true; continue; }
  if ((m = t.match(/^Sect\. (\d+[ab]?): (.+)$/))) {
    flushRefs();
    inGroups = false;
    sect = { id: `s${m[1]}`, n: m[1], part: part.id, sourceTitle: m[2], refs: null, rows: [] };
    sections.push(sect); part.sections.push(sect.id);
    continue;
  }
  if (inGroups) continue; // Part VII's group list is entered by hand in sections.meta.json
  if (!sect) { part.sourceTitle += ` ${t}`; continue; } // a wrapped PART title
  if (refsBuf !== null) { refsBuf += ` ${t}`; if (t.endsWith('.')) flushRefs(); continue; }
  if (BOOK_RE.test(t)) { refsBuf = t; if (t.endsWith('.')) flushRefs(); continue; }
  if (!sect.refs) sect.sourceTitle += ` ${t}`; // a wrapped section title
  else pendingTitle.push(t); // a sub-section title (Sect. 54, 64)
}
flushRefs();

for (const s of sections) {
  if (!s.rows.length) s.rows.push({ id: s.id, sourceTitle: null, group: null, refs: s.refs });
  delete s.currentGroup;
}

// Robertson followed the RV, which omits a few verses entirely. Where the BSB keeps the
// verse number with no main text (e.g. Mt 17:21), attach it to the range that ends just
// before it, so the reader can show the gap with its footnote.
for (const book of GOSPELS) for (const [c, verses] of Object.entries(text[book])) for (const [v, t] of Object.entries(verses)) {
  if (t) continue;
  const rowsHere = sections.flatMap((s) => s.rows).filter((r) => r.refs[book]?.some(([c1, v1, c2, v2]) => (c1 < +c || (c1 === +c && v1 <= +v)) && (c2 > +c || (c2 === +c && v2 >= +v))));
  if (rowsHere.length) continue;
  for (const row of sections.flatMap((s) => s.rows)) {
    const r = row.refs[book]?.find(([, , c2, v2]) => c2 === +c && v2 === +v - 1);
    if (r) { r[3] = +v; console.log(`  attached ${book} ${c}:${v} (no main text in the BSB) to ${row.id}`); break; }
  }
}

// ---- coverage check ------------------------------------------------------------------------
const seen = {};
for (const s of sections) for (const row of s.rows) for (const [book, ranges] of Object.entries(row.refs)) {
  if (!GOSPELS.includes(book)) continue;
  for (const [c1, v1, c2, v2] of ranges) {
    for (let c = c1; c <= c2; c++) {
      const from = c === c1 ? v1 : 1, to = c === c2 ? v2 : lastVerse(book, c);
      for (let v = from; v <= to; v++) {
        if (text[book][c]?.[v] === undefined) console.warn(`  ! ${row.id} cites ${book} ${c}:${v}, which doesn't exist`);
        ((seen[book] ??= {})[`${c}:${v}`] ??= []).push(row.id);
      }
    }
  }
}
const report = {};
for (const book of GOSPELS) {
  const missing = [], dup = [];
  for (const [c, verses] of Object.entries(text[book])) for (const v of Object.keys(verses)) {
    const hits = seen[book]?.[`${c}:${v}`];
    if (!hits) missing.push(`${c}:${v}`);
    else if (hits.length > 1) dup.push(`${c}:${v} (${hits.join(', ')})`);
  }
  report[book] = { missing, duplicated: dup };
  const shown = missing.length > 40 ? `${missing.slice(0, 40).join(' ')} …` : missing.join(' ');
  console.log(`${book}: ${missing.length} verses not in any section${missing.length ? ` → ${shown}` : ''}; ${dup.length} in more than one`);
  if (dup.length) console.log(`   repeated: ${dup.slice(0, 30).join('; ')}${dup.length > 30 ? ' …' : ''}`);
}

// Verse counts per row and gospel: the timeline's text-length fallback when no text is on screen.
for (const s of sections) for (const row of s.rows) {
  row.counts = {};
  for (const [book, ranges] of Object.entries(row.refs)) {
    if (!GOSPELS.includes(book)) continue;
    let n = 0;
    for (const [c1, v1, c2, v2] of ranges) for (let c = c1; c <= c2; c++) {
      const from = c === c1 ? v1 : 1, to = c === c2 ? v2 : lastVerse(book, c);
      for (let v = from; v <= to; v++) if (text[book][c]?.[v] !== undefined) n++;
    }
    row.counts[book] = n;
  }
}

const out = {
  source: 'A. T. Robertson, A Harmony of the Gospels for Students of the Life of Christ (1922), based on the Broadus harmony; Project Gutenberg #36264 (public domain).',
  parts,
  sections,
};
await mkdir('src/data', { recursive: true });
await writeFile('src/data/harmony.json', JSON.stringify(out, null, 1));
await writeFile('src/data/harmony.coverage.json', JSON.stringify(report, null, 1));
console.log(`\n${parts.length} parts, ${sections.length} sections, ${sections.reduce((n, s) => n + s.rows.length, 0)} rows → src/data/harmony.json`);
