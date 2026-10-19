// Builds per-book verse JSON and the BSB's footnotes from the pinned BSB USJ files
// (data/raw/bsb/usj/bsb_usj/*.usj). Verses the BSB leaves out of its main text (e.g. Mt 17:21)
// are kept as empty strings so the reader can show that a verse number exists without text;
// their wording lives in the note on the verse before, which records the verse it supplies.
// The verse text itself is bsb.txt's, which the validator and the meta's quotes use.
//
//   node scripts/build-text.mjs   →  public/data/text/{MAT,MRK,LUK,JHN,ACT,1CO}.json
//                                    public/data/text/{MAT,MRK,LUK,JHN,ACT,1CO}.notes.json
//
// A note is { at, kind, body, omits? }: `at` is the character offset in the verse's text where
// the BSB places its marker; `kind` is 'textual' (manuscript readings), 'translation' (Or /
// Literally / Greek …), 'scripture' (the passage quoted or alluded to) or 'other'; `body` is a list of segments: a string, { q } for the BSB's
// italic alternative wording, { v } for a verse number inside it, { ref, loc } for a cross-reference.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const BOOKS = { Matthew: 'MAT', Mark: 'MRK', Luke: 'LUK', John: 'JHN', Acts: 'ACT', '1 Corinthians': '1CO' };
// Outside the gospels, keep only the chapters the harmony cites.
const KEEP = { ACT: [1], '1CO': [11, 15] };
// Paragraphs that aren't the text itself: headings, cross-reference lines, titles.
const SKIP = /^(h|toc\d|mt\d?|ms\d?|mr|s\d?|sr|r|d|sp|cl|rem|ide)$/;
const TEXTUAL = /manuscripts|\b(BYZ|TR|NA|SBL|WH|NE|ECM|SBLGNT|HF|PT|Tischendorf|Vulgate)\b|\bmss\b|\btexts\b|\binclude\b|\bdo not (have|contain)\b/;

// bsb.txt, for the cross-check.
const plain = {};
for (const line of (await readFile('data/raw/bsb/bsb.txt', 'utf8')).split(/\r?\n/)) {
  const m = line.match(/^(.+?) (\d+):(\d+)\t(.*)$/);
  if (m && BOOKS[m[1]]) plain[`${BOOKS[m[1]]} ${m[2]}:${m[3]}`] = m[4].trim();
}

const flatText = (n) => (typeof n === 'string' ? n : (n.content ?? []).map(flatText).join(''));

/** A note's content → segments, with the verse numbers of any verses it supplies. */
function noteBody(note) {
  const body = [], omits = [];
  const push = (seg) => {
    if (typeof seg === 'string' && typeof body.at(-1) === 'string') body[body.length - 1] += seg;
    else body.push(seg);
  };
  const walk = (n, quoted) => {
    if (typeof n === 'string') { if (quoted) push({ q: n }); else push(n); return; }
    if (n.marker === 'fr') return; // "17:20 " — the reader knows where it is
    if (n.marker === 'fv') { const v = flatText(n).trim(); omits.push(Number(v)); push({ v }); return; }
    if (n.type === 'ref') { push({ ref: flatText(n), loc: n.loc }); return; }
    for (const c of n.content ?? []) walk(c, quoted || n.marker === 'fqa' || n.marker === 'fq');
  };
  for (const c of note.content ?? []) walk(c, false);
  // Merge neighbouring quoted runs and tidy the ends.
  const out = [];
  for (const s of body) {
    const prev = out.at(-1);
    if (s.q !== undefined && prev?.q !== undefined) prev.q += s.q;
    else out.push(s);
  }
  if (typeof out[0] === 'string') out[0] = out[0].trimStart();
  if (typeof out.at(-1) === 'string') out[out.length - 1] = out.at(-1).trimEnd();
  // The USJ drops the space after some italic words ("Men" + "is implied").
  for (let i = 0; i + 1 < out.length; i++) {
    if (out[i].q !== undefined && typeof out[i + 1] === 'string' && /^[A-Za-z]/.test(out[i + 1]) && /[A-Za-z.]$/.test(out[i].q)) out[i + 1] = ` ${out[i + 1]}`;
  }
  return { body: out.filter((s) => s !== ''), omits };
}

function kindOf(body) {
  const words = body.map((s) => (typeof s === 'string' ? s : s.q ?? s.ref ?? s.v)).join('');
  if (TEXTUAL.test(words)) return 'textual';
  if (/^(Or|Literally|Greek|Hebrew|Aramaic|That is)\b/.test(words)) return 'translation';
  if (body[0]?.ref || (/^(See|Cited|Compare)\b/.test(body[0]) && body[1]?.ref)) return 'scripture';
  return 'other';
}

function parseBook(code, usj) {
  const verses = {}, notes = {};
  let c = 0, key = null, buf = '';
  const finish = () => {
    if (!key) return;
    const lead = buf.length - buf.trimStart().length;
    const text = buf.trim();
    verses[key] = text;
    for (const n of notes[key] ?? []) n.at = Math.min(text.length, Math.max(0, n.at - lead));
    key = null; buf = '';
  };
  const append = (s) => {
    if (!key) return;
    s = s.replace(/\s+/g, ' ');
    if (buf.endsWith(' ') && s.startsWith(' ')) s = s.slice(1);
    buf += s;
  };
  const walk = (n) => {
    if (typeof n === 'string') { append(n); return; }
    if (n.type === 'chapter') { finish(); c = Number(n.number); return; }
    if (n.type === 'verse') { finish(); key = `${c}:${n.number}`; return; }
    if (n.type === 'note') {
      if (!key || n.marker !== 'f') return;
      const { body, omits } = noteBody(n);
      const note = { at: buf.trimEnd().length, kind: kindOf(body), body };
      if (omits.length) note.omits = omits;
      (notes[key] ??= []).push(note);
      return;
    }
    if (n.type === 'para') {
      if (SKIP.test(n.marker)) return;
      append(' ');
      for (const k of n.content ?? []) walk(k);
      append(' ');
      return;
    }
    for (const k of n.content ?? []) walk(k);
  };
  for (const n of usj.content) walk(n);
  finish();

  // Chapters as the reader wants them, with the BSB's omitted verses as empty strings.
  const chapters = {};
  for (const [k, t] of Object.entries(verses)) {
    const [ch, v] = k.split(':').map(Number);
    if (KEEP[code] && !KEEP[code].includes(ch)) continue;
    (chapters[ch] ??= {})[v] = t;
  }
  for (const vs of Object.values(chapters)) {
    const nums = Object.keys(vs).map(Number);
    for (let v = 1; v < Math.max(...nums); v++) vs[v] ??= '';
  }
  // `omits` only where the verse a note supplies is missing from the main text (not where an
  // alternative reading merely spans verse numbers, as at Mt 19:17 or Mk 16:8).
  for (const [k, ns] of Object.entries(notes)) for (const n of ns) {
    if (!n.omits) continue;
    n.omits = n.omits.filter((v) => chapters[k.split(':')[0]]?.[v] === '');
    if (!n.omits.length) delete n.omits;
  }
  const kept = Object.fromEntries(Object.entries(notes).filter(([k]) => chapters[k.split(':')[0]]));
  return { chapters, notes: kept };
}

// The USJ's typography differs from bsb.txt in small ways (spaces round dashes at line breaks,
// editorial [’’] marks), so the text is bsb.txt's and each note moves to the same place in it,
// counted in characters other than spaces and bracketed marks.
const sig = (s) => s.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, '');
function place(usjText, at, text) {
  const want = sig(usjText.slice(0, at));
  if (!sig(text).startsWith(want)) return null;
  let i = 0, n = 0;
  while (n < want.length && i < text.length) { if (!/\s/.test(text[i])) n++; i++; }
  return i;
}

await mkdir('public/data/text', { recursive: true });
let unplaced = 0;
for (const code of Object.values(BOOKS)) {
  const usj = JSON.parse(await readFile(`data/raw/bsb/usj/bsb_usj/${code}.usj`, 'utf8'));
  const { chapters, notes } = parseBook(code, usj);
  for (const [ch, vs] of Object.entries(chapters)) for (const [v, t] of Object.entries(vs)) {
    const text = plain[`${code} ${ch}:${v}`] ?? t;
    for (const n of notes[`${ch}:${v}`] ?? []) {
      const at = place(t, n.at, text);
      if (at === null) { unplaced++; console.warn(`  ${code} ${ch}:${v}: note placed at the end (the texts differ before it)`); }
      n.at = at ?? text.length;
    }
    vs[v] = text;
  }
  await writeFile(`public/data/text/${code}.json`, JSON.stringify(chapters));
  await writeFile(`public/data/text/${code}.notes.json`, JSON.stringify(notes));
  const all = Object.values(notes).flat();
  const verses = Object.values(chapters).reduce((n, c) => n + Object.keys(c).length, 0);
  const empty = Object.values(chapters).reduce((n, c) => n + Object.values(c).filter((t) => !t).length, 0);
  const kinds = ['textual', 'translation', 'scripture', 'other'].map((k) => `${all.filter((n) => n.kind === k).length} ${k}`).join(', ');
  console.log(`${code}: ${Object.keys(chapters).length} chapters, ${verses} verses${empty ? `, ${empty} without main text` : ''}; ${all.length} notes (${kinds})`);
}
if (unplaced) console.warn(`${unplaced} notes could not be placed exactly`);
