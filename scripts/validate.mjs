// Checks the display data against the text it describes.
//
//   node scripts/validate.mjs
//
// - every harmony section and sub-section has a neutral title
// - every place key resolves
// - every "stated" time of day quotes the cited BSB verse verbatim
// - quoted words in titles (“…”) appear in that section's text
// - titles avoid loaded words

import { readFile } from 'node:fs/promises';

const harmony = JSON.parse(await readFile('src/data/harmony.json', 'utf8'));
const meta = JSON.parse(await readFile('src/data/sections.meta.json', 'utf8'));
const { places } = JSON.parse(await readFile('public/data/places.json', 'utf8'));
const text = {};
for (const b of ['MAT', 'MRK', 'LUK', 'JHN', 'ACT', '1CO']) text[b] = JSON.parse(await readFile(`public/data/text/${b}.json`, 'utf8'));

const ABBR = { Mt: 'MAT', Mk: 'MRK', Lk: 'LUK', Jn: 'JHN' };
const STATES = ['unstated', 'predawn', 'dawn', 'day', 'midday', 'evening', 'night', 'darkness'];
const LOADED = /\b(clearly|obviously|contradiction|contradicts|error|proves?|resolves?|alleged|so-called)\b/i;
const norm = (s) => s.toLowerCase().replace(/[“”‘’"'.,;:!?()—–-]/g, ' ').replace(/\s+/g, ' ').trim();
const problems = [];

function sectionText(section, only = null) {
  const parts = [];
  for (const row of section.rows) for (const [book, ranges] of Object.entries(row.refs)) if (!only || book === only) for (const [c1, v1, c2, v2] of ranges) {
    for (let c = c1; c <= c2; c++) {
      const verses = text[book]?.[c] ?? {};
      for (const [v, t] of Object.entries(verses)) if ((c > c1 || +v >= v1) && (c < c2 || +v <= v2)) parts.push(t);
    }
  }
  return norm(parts.join(' '));
}

for (const s of harmony.sections) {
  const m = meta.sections[s.id];
  if (!m?.t) { problems.push(`${s.id}: no title`); continue; }
  if (LOADED.test(m.t)) problems.push(`${s.id}: loaded word in title "${m.t}"`);
  for (const q of m.t.match(/“([^”]+)”/g) ?? []) {
    if (!sectionText(s).includes(norm(q))) problems.push(`${s.id}: title quote ${q} is not in the section's text`);
  }
  const keys = typeof m.p === 'object' && m.p ? Object.values(m.p) : m.p ? [m.p] : [];
  for (const k of keys) if (!places[k]) problems.push(`${s.id}: unknown place "${k}"`);
  if (s.rows.length > 1) for (const r of s.rows) if (!meta.rows[r.id]) problems.push(`${r.id}: no sub-section title`);
}
for (const id of Object.keys(meta.sections)) if (!harmony.sections.some((s) => s.id === id)) problems.push(`${id}: title for a section that doesn't exist`);

let stated = 0;
for (const [sid, byGospel] of Object.entries(meta.light)) {
  if (!harmony.sections.some((s) => s.id === sid)) problems.push(`light ${sid}: no such section`);
  for (const [book, [state, ref, words, basis]] of Object.entries(byGospel)) {
    if (!STATES.includes(state)) problems.push(`light ${sid} ${book}: unknown state "${state}"`);
    if (basis !== 'stated' && basis !== 'implied') problems.push(`light ${sid} ${book}: basis must be stated or implied`);
    const m = ref.match(/^(Mt|Mk|Lk|Jn) (\d+):(\d+)$/);
    if (!m || ABBR[m[1]] !== book) { problems.push(`light ${sid} ${book}: reference "${ref}" doesn't match the gospel`); continue; }
    const verse = text[book][m[2]]?.[m[3]];
    if (verse === undefined) problems.push(`light ${sid} ${book}: ${ref} doesn't exist`);
    else if (basis === 'stated') {
      stated++;
      if (!norm(verse).includes(norm(words))) problems.push(`light ${sid} ${book}: "${words}" is not in ${ref} (“${verse}”)`);
    }
  }
}

const ids = new Set(harmony.sections.map((s) => s.id));
for (const id of meta.jesusAbsent.ids) if (!ids.has(id)) problems.push(`jesusAbsent: no section ${id}`);
if (!ids.has(meta.mapStart?.id)) problems.push(`mapStart: no section ${meta.mapStart?.id}`);
// Departure points (from) and headings (toward): a known place, and words quoted from the cited verse of that gospel.
let departures = 0, headings = 0;
for (const [sid, m] of Object.entries(meta.sections)) for (const field of ['from', 'toward']) for (const [book, [key, ref, words]] of Object.entries(m[field] ?? {})) {
  if (field === 'from') departures++; else headings++;
  if (!places[key]) problems.push(`${sid} ${field} ${book}: unknown place "${key}"`);
  const r = ref.match(/^(Mt|Mk|Lk|Jn) (\d+):(\d+)$/);
  if (!r || ABBR[r[1]] !== book) { problems.push(`${sid} ${field} ${book}: reference "${ref}" doesn't match the gospel`); continue; }
  const verse = text[book][r[2]]?.[r[3]];
  if (verse === undefined) problems.push(`${sid} ${field} ${book}: ${ref} doesn't exist`);
  else if (!norm(verse).includes(norm(words))) problems.push(`${sid} ${field} ${book}: "${words}" is not in ${ref} (“${verse}”)`);
}
for (const [key, r] of Object.entries(meta.areas)) {
  if (key === '_about') continue;
  if (!places[key]) problems.push(`areas: unknown place "${key}"`);
  else if (typeof r !== 'number' || r <= 0) problems.push(`areas: radius for ${key} must be a positive number`);
}
const order = new Map(harmony.sections.map((s, i) => [s.id, i]));
for (const col of [1, 2]) {
  let prev = null;
  for (const a of meta.dates.anchors) {
    if (!order.has(a[0])) { problems.push(`dates: no section ${a[0]}`); continue; }
    if (prev && (order.get(a[0]) <= order.get(prev[0]) || a[col] <= prev[col])) problems.push(`dates: ${a[0]} must come after ${prev[0]} in order and in time (${col === 1 ? 'AD 30' : 'AD 33'})`);
    prev = a;
  }
}

let mountainQuotes = 0;
for (const [sid, byBook] of Object.entries(meta.mountains)) {
  if (sid === '_about') continue;
  const s = harmony.sections.find((x) => x.id === sid);
  if (!s) { problems.push(`mountains: no section ${sid}`); continue; }
  for (const [book, words] of Object.entries(byBook)) {
    mountainQuotes++;
    if (!sectionText(s, book).includes(norm(words))) problems.push(`mountains ${sid} ${book}: "${words}" is not in the section's ${book} text`);
  }
}
for (const [id, v] of Object.entries(meta.peaks)) {
  if (id === '_about') continue;
  if (!/^Q\d+$/.test(id)) problems.push(`peaks: "${id}" is not a Wikidata ID`);
  if (!Array.isArray(v) || v.length !== 2 || !(v[0] > 0) || !(v[1] >= 0)) problems.push(`peaks ${id}: expected [window radius km, summit search km]`);
}
// The mountain given for a section (named in the text, or candidates): a mountain section, and peaks the map knows.
for (const [sid, v] of Object.entries(meta.mountainPeaks ?? {})) {
  if (sid === '_about') continue;
  if (!meta.mountains[sid]) problems.push(`mountainPeaks: ${sid} is not a mountain section`);
  const ids = v?.named ?? v?.candidates;
  if (!Array.isArray(ids) || !ids.length || (v.named && v.candidates)) problems.push(`mountainPeaks ${sid}: expected { named: [IDs] } or { candidates: [IDs] }`);
  else for (const id of ids) if (!meta.peaks[id]) problems.push(`mountainPeaks ${sid}: ${id} is not in peaks`);
}

if (problems.length) {
  console.error(`${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`OK: ${harmony.sections.length} sections, ${Object.keys(meta.rows).length} sub-sections, ${Object.keys(places).length} places, ${stated} stated times, ${mountainQuotes} mountain quotes, ${departures} departure points and ${headings} headings checked against the BSB.`);
