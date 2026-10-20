// The reader's view model: one row per harmony section (or sub-section), joined with
// the neutral display data. Built once at module load from bundled JSON.
import harmony from '../data/harmony.json';
import meta from '../data/sections.meta.json';
import mentions from '../data/mentions.json';
import parallels from '../data/parallels.json';

export type Book = 'MAT' | 'MRK' | 'LUK' | 'JHN';
export const BOOKS: Book[] = ['MAT', 'MRK', 'LUK', 'JHN'];
export const BOOK_NAME: Record<Book, string> = { MAT: 'Matthew', MRK: 'Mark', LUK: 'Luke', JHN: 'John' };
export const BOOK_ABBR: Record<Book, string> = { MAT: 'Mt', MRK: 'Mk', LUK: 'Lk', JHN: 'Jn' };
const OTHER_NAME: Record<string, string> = { ACT: 'Acts', '1CO': '1 Cor' };

export type Range = [number, number, number, number]; // chapter, verse → chapter, verse
export type LightState = 'unstated' | 'predawn' | 'dawn' | 'day' | 'midday' | 'evening' | 'night' | 'darkness';
/** A time of day the text gives. `at` (chapter, verse in this row) is where it takes effect as the reading line passes;
 *  without it the state holds for the whole row. */
export interface LightInfo { state: LightState; ref: string; words: string; basis: 'stated' | 'implied'; at?: [number, number] }
type LightEntry = [LightState, string, string, 'stated' | 'implied', string?];
export type PlaceRef = string | Partial<Record<Book, string>> | null;
export type Reckoning = 'ad30' | 'ad33';
export const RECKONING_NAME: Record<Reckoning, string> = { ad30: 'AD 30 reckoning', ad33: 'AD 33 reckoning' };

/** Decimal year in astronomical numbering (0 = 1 BC) → "5 BC" / "AD 29". */
export function fmtYear(y: number): string {
  const year = Math.floor(y);
  return year <= 0 ? `${1 - year} BC` : `AD ${year}`;
}

export interface Row {
  i: number;
  id: string;
  sectionId: string;
  n: string;
  part: string;
  partTitle: string;
  sectionTitle: string;
  subTitle: string | null;
  subIndex: number;
  subCount: number;
  refs: Partial<Record<Book, Range[]>>;
  other: string[];
  place: PlaceRef;
  placeImplied: boolean;
  /** Where the text has Jesus set out from, per gospel (place key), when that's not the last place on the route. */
  from: Partial<Record<Book, string>>;
  /** Where the text has Jesus making for, per gospel, before he gets there (shown as a heading). */
  toward: Partial<Record<Book, { key: string; ref: string; words: string }>>;
  /** Per gospel, in the order they take effect. */
  light: Partial<Record<Book, LightInfo[]>>;
  feast: { name: string; ref: string; words: string } | null;
  /** Whether Jesus is in the scene (the map's route line follows only him). */
  jesus: boolean;
  /** Verses per gospel in this row. */
  counts: Partial<Record<Book, number>>;
  /** Estimated date (decimal year) under each reckoning, interpolated between anchors. */
  date: Record<Reckoning, number>;
  /** Where this passage sits out of the gospel's own order, a note saying so. */
  outOfOrder: Partial<Record<Book, string>>;
  /** Where the reader places this section somewhere other than Robertson does (meta `moves`), the note saying why. */
  moved: string | null;
  /** Verses ("c:v") that already appeared in an earlier section, with that section's number. */
  repeats: Partial<Record<Book, Record<string, string>>>;
  /** Where the text places Jesus on or near a mountain: the words, by book (Acts included). */
  mountain: Record<string, string> | null;
  /** The mountain for this section by Wikidata ID, where it's given (meta `mountainPeaks`): the one the text names, or the
   *  candidates where it doesn't; otherwise the map shows the named peaks near where Jesus is. */
  peaks: { ids: string[]; named: boolean } | null;
  /** The places the text names, by book (scripts/build-mentions.mjs), so the map can keep their labels in view. */
  named: Partial<Record<string, string[]>>;
}

interface HarmonyFile {
  parts: { id: string; sections: string[] }[];
  sections: { id: string; n: string; part: string; rows: { id: string; refs: Record<string, Range[]>; counts: Record<string, number> }[] }[];
}
interface MetaFile {
  parts: Record<string, string>;
  sections: Record<string, { t: string; p?: PlaceRef; pb?: string; from?: Partial<Record<Book, [string, string, string]>>; toward?: Partial<Record<Book, [string, string, string]>> }>;
  rows: Record<string, string>;
  feasts: Record<string, [string, string, string]>;
  light: Record<string, Record<string, LightEntry | LightEntry[]>>;
  death: { from: string; at: Record<string, [string, string]>; until: string; untilRef: [string, string] };
  jesusAbsent: { ids: string[] };
  mapStart: { id: string };
  birth: { id: string };
  areas: Record<string, number | string>;
  mountains: Record<string, Record<string, string> | string>;
  mountainPeaks?: Record<string, { named?: string[]; candidates?: string[] } | string>;
  moves?: Record<string, { after: string; note: string } | string>;
  dates: { anchors: [string, number, number, string][] };
}
const H = harmony as unknown as HarmonyFile;
const M = meta as unknown as MetaFile;
const MOVES = Object.entries(M.moves ?? {}).filter((e): e is [string, { after: string; note: string }] => typeof e[1] === 'object');
/** Robertson's sections in reading order: each moved section follows the one given, in that section's part. */
function sectionOrder(): HarmonyFile['sections'] {
  const out = H.sections.filter((s) => !MOVES.some(([id]) => id === s.id));
  for (const [id, { after }] of MOVES) {
    const s = H.sections.find((x) => x.id === id), k = out.findIndex((x) => x.id === after);
    if (s && k >= 0) out.splice(k + 1, 0, { ...s, part: out[k].part });
  }
  return out;
}
function mountainPeaks(id: string): Row['peaks'] {
  const v = M.mountainPeaks?.[id];
  if (!v || typeof v !== 'object') return null;
  return v.named ? { ids: v.named, named: true } : v.candidates ? { ids: v.candidates, named: false } : null;
}

export function fmtRanges(ranges: Range[]): string {
  let prevChapter = -1;
  return ranges.map(([c1, v1, c2, v2]) => {
    const sameChapter = c1 === prevChapter && c1 === c2;
    prevChapter = c2;
    if (c1 !== c2) return `${c1}:${v1}–${c2}:${v2}`;
    const verses = v1 === v2 ? `${v1}` : `${v1}–${v2}`;
    return sameChapter ? verses : `${c1}:${verses}`;
  }).join(', ');
}
export const fmtRef = (book: Book, ranges: Range[]) => `${BOOK_ABBR[book]} ${fmtRanges(ranges)}`;
export const rowTitle = (row: Row) => row.subTitle ?? row.sectionTitle;

function build(): Row[] {
  const rows: Row[] = [];
  const absent = new Set(M.jesusAbsent.ids);
  for (const s of sectionOrder()) {
    const sm = M.sections[s.id];
    const move = MOVES.find(([id]) => id === s.id)?.[1];
    const f = M.feasts[s.id];
    s.rows.forEach((r, k) => {
      const refs: Row['refs'] = {};
      const other: string[] = [];
      for (const [b, ranges] of Object.entries(r.refs)) {
        if ((BOOKS as string[]).includes(b)) refs[b as Book] = ranges;
        else other.push(`${OTHER_NAME[b] ?? b} ${fmtRanges(ranges)}`);
      }
      // An entry whose onset falls in an earlier sub-row holds for this whole row; one in a later sub-row isn't here yet.
      const light: Row['light'] = {};
      for (const [b, v] of Object.entries(M.light[s.id] ?? {})) {
        const ranges = refs[b as Book];
        if (!ranges) continue;
        const list: LightInfo[] = [];
        for (const [state, ref, words, basis, at] of (Array.isArray(v[0]) ? v : [v]) as LightEntry[]) {
          if (!at) { list.push({ state, ref, words, basis }); continue; }
          const [c, vs] = at.split(':').map(Number);
          if (inRanges(ranges, c, vs)) list.push({ state, ref, words, basis, at: [c, vs] });
          else if (c * 1000 + vs < ranges[0][0] * 1000 + ranges[0][1]) list.push({ state, ref, words, basis });
        }
        if (list.length) light[b as Book] = list;
      }
      rows.push({
        i: rows.length,
        id: r.id,
        sectionId: s.id,
        n: s.n,
        part: s.part,
        partTitle: M.parts[s.part],
        sectionTitle: sm.t,
        subTitle: s.rows.length > 1 ? M.rows[r.id] ?? null : null,
        subIndex: k,
        subCount: s.rows.length,
        refs,
        other,
        place: sm.p ?? null,
        placeImplied: sm.pb === 'implied',
        from: Object.fromEntries(Object.entries(sm.from ?? {}).map(([b, [key]]) => [b, key])),
        toward: Object.fromEntries(Object.entries(sm.toward ?? {}).map(([b, [key, ref, words]]) => [b, { key, ref, words }])),
        light,
        feast: f ? { name: f[0], ref: f[1], words: f[2] } : null,
        jesus: !absent.has(s.id),
        counts: Object.fromEntries(Object.entries(r.counts).filter(([b]) => (BOOKS as string[]).includes(b))),
        date: { ad30: 0, ad33: 0 },
        outOfOrder: {},
        moved: move?.note ?? null,
        repeats: {},
        mountain: typeof M.mountains[s.id] === 'object' ? (M.mountains[s.id] as Record<string, string>) : null,
        peaks: mountainPeaks(s.id),
        named: (mentions as Record<string, Partial<Record<string, string[]>>>)[r.id] ?? {},
      });
    });
  }

  // Dates: anchors sit on a section's first row; rows between anchors are spread evenly.
  const anchors = M.dates.anchors.map(([id, a30, a33]) => ({ i: rows.findIndex((r) => r.sectionId === id), ad30: a30, ad33: a33 }));
  for (const k of ['ad30', 'ad33'] as Reckoning[]) {
    const first = anchors[0];
    for (let i = 0; i < first.i; i++) rows[i].date[k] = first[k] - 0.1 * (first.i - i); // preface, prologue, genealogies
    for (let a = 0; a + 1 < anchors.length; a++) {
      const A = anchors[a], B = anchors[a + 1];
      for (let i = A.i; i < B.i; i++) rows[i].date[k] = A[k] + (B[k] - A[k]) * (i - A.i) / (B.i - A.i);
    }
    const last = anchors[anchors.length - 1];
    for (let i = last.i; i < rows.length; i++) rows[i].date[k] = last[k] + 0.002 * (i - last.i);
  }

  // Walk each gospel in harmony order. A passage whose first new verse comes before
  // the furthest point already reached sits outside that gospel's own sequence.
  for (const b of BOOKS) {
    const seen = new Map<string, Row>();
    let maxPos = -1;
    let maxRange: Range | null = null;
    for (const row of rows) {
      const ranges = row.refs[b];
      if (!ranges) continue;
      for (const rg of ranges) {
        let firstNew: number | null = null;
        // Chapters inside a cross-chapter range run to their last verse; 200 covers any chapter.
        for (let c = rg[0]; c <= rg[2]; c++) {
          const from = c === rg[0] ? rg[1] : 1, to = c === rg[2] ? rg[3] : 200;
          for (let v = from; v <= to; v++) {
            const key = `${c}:${v}`;
            const prior = seen.get(key);
            if (prior) {
              if (prior.id !== row.id) (row.repeats[b] ??= {})[key] = prior.n;
            } else {
              if (firstNew === null) firstNew = c * 1000 + v;
              seen.set(key, row);
            }
          }
        }
        if (firstNew !== null && firstNew < maxPos && maxRange && !row.outOfOrder[b]) {
          row.outOfOrder[b] = `In ${BOOK_NAME[b]}’s own order this comes before ${fmtRanges([maxRange])}.`;
        }
        // A moved section doesn't carry the walk forward, so the rows it was moved past keep their place;
        // where it jumps ahead, it says which passage it follows in this gospel.
        if (row.moved) {
          if (firstNew !== null && firstNew > maxPos && !row.outOfOrder[b]) {
            const before = rows.flatMap((r) => (r === row ? [] : r.refs[b] ?? [])).filter((x) => x[2] * 1000 + x[3] < firstNew)
              .sort((x, y) => (y[2] * 1000 + y[3]) - (x[2] * 1000 + x[3]))[0];
            if (before && before[2] * 1000 + before[3] > maxPos) row.outOfOrder[b] = `In ${BOOK_NAME[b]}’s own order this comes later, after ${fmtRanges([before])}.`;
          }
          continue;
        }
        const end = rg[2] * 1000 + rg[3];
        if (end > maxPos) { maxPos = end; maxRange = rg; }
      }
    }
  }
  return rows;
}

export const ROWS: Row[] = build();
/** The first row the map shows Jesus in (Mary visits Elizabeth); before it, no marker and no route. */
export const MAP_START = Math.max(0, ROWS.findIndex((r) => r.sectionId === M.mapStart.id));
/** The row in which Jesus is born: from here on his resting marker keeps a little of its glow. */
export const BIRTH = Math.max(0, ROWS.findIndex((r) => r.sectionId === M.birth.id));
/** Radius (km) of places drawn as areas: regions, and Egypt. */
export const AREAS: Record<string, number> = Object.fromEntries(Object.entries(M.areas).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
/** Distinct places a row names for the given gospels, with the gospels naming each. */
export function placesFor(row: Row, books: Book[]): { key: string; books: Book[] }[] {
  if (!row.place) return [];
  const present = books.filter((b) => row.refs[b]);
  if (typeof row.place === 'string') return [{ key: row.place, books: present }];
  const byKey = new Map<string, Book[]>();
  for (const b of present) { const k = row.place[b]; if (k) byKey.set(k, [...(byKey.get(k) ?? []), b]); }
  return [...byKey].map(([key, bs]) => ({ key, books: bs }));
}
export interface Story { i: number; books: Book[] | null; implied: boolean }
const storyCache = new Map<string, Story[]>();
/** The sections set at a place, each at its first row; `books` lists the gospels naming it where the accounts differ. */
export function storiesAt(key: string): Story[] {
  let stories = storyCache.get(key);
  if (!stories) {
    stories = ROWS.filter((r) => r.subIndex === 0 && r.place && (r.place === key || (typeof r.place === 'object' && Object.values(r.place).includes(key))))
      .map((r) => ({ i: r.i, books: typeof r.place === 'object' ? BOOKS.filter((b) => (r.place as Partial<Record<Book, string>>)[b] === key) : null, implied: r.placeImplied }));
    storyCache.set(key, stories);
  }
  return stories;
}
/** The mountain words for the gospels on screen (Acts counts whenever the row is shown). */
export function mountainFor(row: Row, books: Book[]): { book: string; words: string }[] {
  if (!row.mountain || !books.some((b) => row.refs[b])) return [];
  return Object.entries(row.mountain).filter(([b]) => !(BOOKS as string[]).includes(b) || (books.includes(b as Book) && row.refs[b as Book])).map(([book, words]) => ({ book, words }));
}
export const PARTS = H.parts.map((p) => ({ id: p.id, title: M.parts[p.id], first: ROWS.findIndex((r) => r.part === p.id), last: ROWS.map((r) => r.part).lastIndexOf(p.id) }));

function inRanges(ranges: Range[], c: number, v: number) {
  const p = c * 1000 + v;
  return ranges.some(([c1, v1, c2, v2]) => c1 * 1000 + v1 <= p && p <= c2 * 1000 + v2);
}
/** Where a verse sits in a row (0–1), counting verses: used where the reader isn't on screen to measure it. */
export function versePos(row: Row, book: Book, c: number, v: number): number {
  const ranges = row.refs[book];
  if (!ranges) return 1;
  const total = row.counts[book] ?? 1;
  const lens = ranges.map(([c1, v1, c2, v2]) => (c1 === c2 ? v2 - v1 + 1 : 0));
  const cross = lens.filter((l) => !l).length;
  // A range across chapters gets whatever the counted ranges leave over.
  const rest = cross ? Math.max(1, (total - lens.reduce((a, l) => a + l, 0)) / cross) : 0;
  let before = 0;
  for (let k = 0; k < ranges.length; k++) {
    const [c1, v1, c2, v2] = ranges[k], len = lens[k] || rest;
    if (inRanges([ranges[k]], c, v)) return (before + (c === c1 ? v - v1 : len - 1 - (c === c2 ? v2 - v : 0))) / total;
    before += len;
  }
  return 1;
}
/** Where a verse sits in a row (0–1); the first verse of a gospel's passage counts as the row's start. */
export type VersePos = (book: Book, c: number, v: number) => number;
const firstVerse = (row: Row, b: Book, c: number, v: number) => row.refs[b]?.[0][0] === c && row.refs[b]?.[0][1] === v;

/** The light at the reading line (f, 0–1 through the row) for the given gospels. Each gospel gives the last state it
 *  has reached; the one that took effect latest wins (time moves on), then the most common, then gospel order. */
export function lightAt(row: Row, books: Book[], f = 0, pos: VersePos = (b, c, v) => versePos(row, b, c, v)): LightState {
  const found = new Map<LightState, { at: number; n: number }>();
  for (const b of books) {
    if (!row.refs[b]) continue;
    let cur: { state: LightState; at: number } | null = null;
    for (const l of row.light[b] ?? []) {
      const at = !l.at || firstVerse(row, b, ...l.at) ? 0 : pos(b, ...l.at);
      if (at <= f) cur = { state: l.state, at };
    }
    if (!cur) continue;
    const e = found.get(cur.state);
    found.set(cur.state, { at: Math.max(cur.at, e?.at ?? 0), n: (e?.n ?? 0) + 1 });
  }
  let best: LightState = 'unstated', bestAt = -1, n = 0;
  for (const [s, e] of found) if (e.at > bestAt || (e.at === bestAt && e.n > n)) { best = s; bestAt = e.at; n = e.n; }
  return best;
}
/** Where in a row the light may change, from the verse counts: for drawing the timeline's light strip. */
export function lightBreaks(row: Row, books: Book[]): number[] {
  const out = new Set<number>([0]);
  for (const b of books) for (const l of row.light[b] ?? []) if (l.at && !firstVerse(row, b, ...l.at)) out.add(versePos(row, b, ...l.at));
  if (row.i === DEATH.row) for (const b of books) { const d = DEATH.at[b]; if (d && row.refs[b]) out.add(versePos(row, b, ...d)); }
  return [...out].sort((a, b) => a - b);
}

/** From Jesus' death (the verse in each gospel) until the angel at the tomb (meta `death`). */
export const DEATH = (() => {
  const at: Partial<Record<Book, [number, number]>> = {};
  for (const [b, [ref]] of Object.entries(M.death.at)) {
    const m = ref.match(/(\d+):(\d+)$/)!;
    at[b as Book] = [Number(m[1]), Number(m[2])];
  }
  const row = ROWS.findIndex((r) => r.sectionId === M.death.from && BOOKS.some((b) => at[b] && r.refs[b] && inRanges(r.refs[b]!, ...at[b]!)));
  return { at, row, until: ROWS.findIndex((r) => r.sectionId === M.death.until) };
})();
/** Whether Jesus has died and not yet risen at the reading line. */
export function deadAt(row: Row, books: Book[], f = 0, pos: VersePos = (b, c, v) => versePos(row, b, c, v)): boolean {
  if (row.i > DEATH.row && row.i < DEATH.until) return true;
  if (row.i !== DEATH.row) return false;
  return books.some((b) => DEATH.at[b] && row.refs[b] && pos(b, ...DEATH.at[b]!) <= f);
}

export function placeKey(row: Row, book: Book | null): string | null {
  if (!row.place) return null;
  if (typeof row.place === 'string') return row.place;
  if (book && row.place[book]) return row.place[book]!;
  return Object.values(row.place)[0] ?? null;
}

// ---- text -------------------------------------------------------------------------------
export type BookText = Record<string, Record<string, string>>;
export type Texts = Record<Book, BookText>;

/** A segment of a BSB footnote: plain words, the BSB's italic alternative wording, a verse number inside it, or a cross-reference. */
export type NoteSeg = string | { q: string } | { v: string } | { ref: string; loc: string };
export type NoteKind = 'textual' | 'translation' | 'scripture' | 'other';
export const NOTE_KIND_NAME: Record<NoteKind, string> = { textual: 'Manuscripts', translation: 'Translation', scripture: 'Scripture', other: 'Note' };
/** A BSB footnote. `at` is where the BSB puts its marker in the verse; `omits` lists verses it supplies that the main text leaves out. */
export interface Note { at: number; kind: NoteKind; body: NoteSeg[]; omits?: number[] }
export type BookNotes = Record<string, Note[]>; // "c:v" → notes
/** The BSB footnotes, filled in by loadTexts (a book without notes is an empty record). */
export const NOTES: Partial<Record<Book, BookNotes>> = {};

export async function loadTexts(): Promise<Texts> {
  const entries = await Promise.all(BOOKS.map(async (b) => {
    const [res, notes] = await Promise.all([
      fetch(new URL(`data/text/${b}.json`, document.baseURI)),
      fetch(new URL(`data/text/${b}.notes.json`, document.baseURI)).then((r) => (r.ok ? r.json() : {})).catch(() => ({})), // the text reads without them
    ]);
    if (!res.ok) throw new Error(`Couldn't load ${BOOK_NAME[b]} (${res.status})`);
    NOTES[b] = notes;
    return [b, await res.json()] as const;
  }));
  return Object.fromEntries(entries) as Texts;
}

/** The note that supplies a verse the BSB leaves out of its main text, with the verse it's attached to. */
export function noteForOmitted(book: Book, c: number, v: number): { key: string; i: number } | null {
  const notes = NOTES[book] ?? {};
  for (let w = v - 1; w >= 1; w--) {
    const i = notes[`${c}:${w}`]?.findIndex((n) => n.omits?.includes(v)) ?? -1;
    if (i >= 0) return { key: `${c}:${w}`, i };
  }
  return null;
}

/** "MRK 9:29" / "LUK 9:43-45" → book and first verse, for the gospels only. */
export function parseLoc(loc: string): { book: Book; c: number; v: number } | null {
  const m = loc.match(/^(MAT|MRK|LUK|JHN) (\d+):(\d+)/);
  return m ? { book: m[1] as Book, c: Number(m[2]), v: Number(m[3]) } : null;
}

export interface Verse { c: number; v: number; t: string; label: boolean }
export function versesOf(text: BookText, ranges: Range[]): Verse[][] {
  return ranges.map(([c1, v1, c2, v2]) => {
    const out: Verse[] = [];
    for (let c = c1; c <= c2; c++) {
      const chapter = text[c] ?? {};
      const last = c === c2 ? v2 : Math.max(...Object.keys(chapter).map(Number));
      for (let v = c === c1 ? v1 : 1; v <= last; v++) {
        const t = chapter[v];
        if (t === undefined) continue;
        out.push({ c, v, t, label: out.length === 0 || v === 1 });
      }
    }
    return out;
  });
}

/** Find the first row that contains a verse of a gospel. */
export function rowForVerse(book: Book, c: number, v: number): number {
  const pos = c * 1000 + v;
  return ROWS.findIndex((r) => r.refs[book]?.some(([c1, v1, c2, v2]) => pos >= c1 * 1000 + v1 && pos <= c2 * 1000 + v2));
}

/** A passage that synopses print beside this one, where the harmony places the two on different occasions. */
export interface Parallel { book: Book; c: number; v: number; ref: string; row: number }
/** "MAT 18:21-22" → book and range. */
function parsePassage(s: string): { book: Book; range: Range } | null {
  const m = s.match(/^(MAT|MRK|LUK|JHN) (\d+):(\d+)(?:-(?:(\d+):)?(\d+))?$/);
  if (!m) return null;
  const c = Number(m[2]), v = Number(m[3]);
  return { book: m[1] as Book, range: [c, v, m[4] ? Number(m[4]) : c, m[5] ? Number(m[5]) : v] };
}
/** Links by "BOOK c:v" of the verse each passage starts at (src/data/parallels.json). */
export const PARALLELS: Map<string, Parallel[]> = new Map();
for (const set of (parallels as { sets: string[][] }).sets) {
  const [hub, ...rest] = set.map(parsePassage);
  if (!hub || rest.some((p) => !p)) continue;
  const link = (from: { book: Book; range: Range }, to: { book: Book; range: Range }) => {
    const row = rowForVerse(to.book, to.range[0], to.range[1]);
    if (row < 0 || row === rowForVerse(from.book, from.range[0], from.range[1])) return;
    const key = `${from.book} ${from.range[0]}:${from.range[1]}`;
    PARALLELS.set(key, [...(PARALLELS.get(key) ?? []), { book: to.book, c: to.range[0], v: to.range[1], ref: fmtRef(to.book, [to.range]), row }]);
  };
  for (const p of rest as { book: Book; range: Range }[]) { link(hub, p); link(p, hub); }
}

// Passages whose manuscript history the BSB marks with a note.
export const TEXT_NOTES: { book: Book; from: [number, number]; to: [number, number]; note: string }[] = [
  { book: 'MRK', from: [16, 9], to: [16, 20], note: 'Some early manuscripts end Mark at 16:8. The BSB includes verses 9–20 with a note.' },
  { book: 'JHN', from: [7, 53], to: [8, 11], note: 'The earliest manuscripts do not include John 7:53–8:11. The BSB includes it with a note.' },
];
