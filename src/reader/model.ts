// The reader's view model: one row per harmony section (or sub-section), joined with
// the neutral display data. Built once at module load from bundled JSON.
import harmony from '../data/harmony.json';
import meta from '../data/sections.meta.json';
import mentions from '../data/mentions.json';

export type Book = 'MAT' | 'MRK' | 'LUK' | 'JHN';
export const BOOKS: Book[] = ['MAT', 'MRK', 'LUK', 'JHN'];
export const BOOK_NAME: Record<Book, string> = { MAT: 'Matthew', MRK: 'Mark', LUK: 'Luke', JHN: 'John' };
export const BOOK_ABBR: Record<Book, string> = { MAT: 'Mt', MRK: 'Mk', LUK: 'Lk', JHN: 'Jn' };
const OTHER_NAME: Record<string, string> = { ACT: 'Acts', '1CO': '1 Cor' };

export type Range = [number, number, number, number]; // chapter, verse → chapter, verse
export type LightState = 'unstated' | 'predawn' | 'dawn' | 'day' | 'midday' | 'evening' | 'night' | 'darkness';
export const LIGHT_NAME: Record<LightState, string> = {
  unstated: 'not stated', predawn: 'before dawn', dawn: 'early morning', day: 'daytime',
  midday: 'midday', evening: 'evening', night: 'night', darkness: 'darkness at midday',
};
export interface LightInfo { state: LightState; ref: string; words: string; basis: 'stated' | 'implied' }
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
  partStart: boolean;
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
  light: Partial<Record<Book, LightInfo>>;
  feast: { name: string; ref: string; words: string } | null;
  /** Whether Jesus is in the scene (the map's route line follows only him). */
  jesus: boolean;
  /** Verses per gospel in this row. */
  counts: Partial<Record<Book, number>>;
  /** Estimated date (decimal year) under each reckoning, interpolated between anchors. */
  date: Record<Reckoning, number>;
  /** Where this passage sits out of the gospel's own order, a note saying so. */
  outOfOrder: Partial<Record<Book, string>>;
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
  light: Record<string, Record<string, [LightState, string, string, 'stated' | 'implied']>>;
  jesusAbsent: { ids: string[] };
  mapStart: { id: string };
  areas: Record<string, number | string>;
  mountains: Record<string, Record<string, string> | string>;
  mountainPeaks?: Record<string, { named?: string[]; candidates?: string[] } | string>;
  dates: { anchors: [string, number, number, string][] };
}
const H = harmony as unknown as HarmonyFile;
const M = meta as unknown as MetaFile;
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
  let prevPart = '';
  for (const s of H.sections) {
    const sm = M.sections[s.id];
    const light: Row['light'] = {};
    for (const [b, [state, ref, words, basis]] of Object.entries(M.light[s.id] ?? {})) light[b as Book] = { state, ref, words, basis };
    const f = M.feasts[s.id];
    s.rows.forEach((r, k) => {
      const refs: Row['refs'] = {};
      const other: string[] = [];
      for (const [b, ranges] of Object.entries(r.refs)) {
        if ((BOOKS as string[]).includes(b)) refs[b as Book] = ranges;
        else other.push(`${OTHER_NAME[b] ?? b} ${fmtRanges(ranges)}`);
      }
      rows.push({
        i: rows.length,
        id: r.id,
        sectionId: s.id,
        n: s.n,
        part: s.part,
        partTitle: M.parts[s.part],
        partStart: k === 0 && s.part !== prevPart,
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
        repeats: {},
        mountain: typeof M.mountains[s.id] === 'object' ? (M.mountains[s.id] as Record<string, string>) : null,
        peaks: mountainPeaks(s.id),
        named: (mentions as Record<string, Partial<Record<string, string[]>>>)[r.id] ?? {},
      });
    });
    prevPart = s.part;
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

/** The light at a row for the given gospels: the most common stated or agreed state. */
export function lightFor(row: Row, books: Book[]): LightState {
  const counts = new Map<LightState, number>();
  for (const b of books) {
    if (!row.refs[b]) continue;
    const l = row.light[b];
    if (l) counts.set(l.state, (counts.get(l.state) ?? 0) + 1);
  }
  let best: LightState = 'unstated', n = 0;
  for (const [s, c] of counts) if (c > n) { best = s; n = c; }
  return best;
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

// Passages whose manuscript history the BSB marks with a note.
export const TEXT_NOTES: { book: Book; from: [number, number]; to: [number, number]; note: string }[] = [
  { book: 'MRK', from: [16, 9], to: [16, 20], note: 'Some early manuscripts end Mark at 16:8. The BSB includes verses 9–20 with a note.' },
  { book: 'JHN', from: [7, 53], to: [8, 11], note: 'The earliest manuscripts do not include John 7:53–8:11. The BSB includes it with a note.' },
];
