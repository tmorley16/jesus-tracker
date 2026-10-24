import { create } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Years, Spacing } from './layoutModel';
import { BOOKS, ROWS, START_ROW, type Book, type Reckoning } from './model';

export type { Spacing };
export type Appearance = 'dynamic' | 'light' | 'dark';
/** The map's land: one plain colour, or coloured by height (with a bluer sea). */
export type LandColour = 'plain' | 'height';
/** Jesus' marker on the map: the gold-ringed white circle, or a black cross, J or crown in the same white glow. */
export type MarkerKind = 'ring' | 'cross' | 'j' | 'crown';
const MARKER_KINDS: MarkerKind[] = ['ring', 'cross', 'j', 'crown'];
export type TextSize = 's' | 'm' | 'l';
/** Which of the BSB's footnotes the reader marks. */
export type NotesShown = 'all' | 'textual' | 'none';
/** On a phone: one gospel at a time, or several: side by side in one aligned reader, stacked in panes of their own, or
 *  in quadrants (three as two above one; two stacked). */
export type PhoneGospels = 'one' | 'columns' | 'stacked' | 'grid';
const PHONE_GOSPELS: PhoneGospels[] = ['one', 'columns', 'stacked', 'grid'];
/** The map's scale bar: kilometres or miles. */
export type Units = 'metric' | 'imperial';
/** Gospels in panes of their own: every section the same length in each, scrolled together; or each at its own length,
 *  following the one last touched. */
export type PaneSync = 'locked' | 'follow';

const KEY = 'jt-reader-settings';
interface Saved {
  visible: Book[];
  single: Book;
  map: boolean;
  /** The timeline scrubber under the toolbar. */
  timeline: boolean;
  /** Map's share of the panes (0–1); null = the default (desktop: gospels to map in the golden ratio; phones: 1.5 × a
   *  gospel's share, at most half). */
  mapShare: number | null;
  appearance: Appearance;
  textSize: TextSize;
  spacing: Spacing;
  reckoning: Reckoning;
  compress: boolean;
  /** In an area rather than at a named place, the traveller drifts within it. */
  wander: boolean;
  /** His light on the land: the contours near Jesus drawn in white (in an area, covering it in place of a shaded circle). */
  landLight: boolean;
  /** The map's overlay of modern towns and modern names. */
  modern: boolean;
  /** The map's line of the way Jesus has come (and the dashed heading where he makes for a place). */
  trail: boolean;
  marker: MarkerKind;
  landColour: LandColour;
  notes: NotesShown;
  phoneGospels: PhoneGospels;
  /** Phones: the timeline's phase bands and feast marks (desktops always show the phases). */
  phases: boolean;
  /** Desktops: the timeline's feast marks and its strip of the time of day. */
  timeMarks: boolean;
  /** Timeline settings › Collapse hidden gospels: the sections only hidden gospels tell left out of the timeline, or
   *  (off) kept in place, faded. null: the screen's default (on for desktops, off for phones); see collapseHidden(). */
  collapse: boolean | null;
  units: Units;
  paneSync: PaneSync;
  /** Phones, gospels in panes: a row of panes (or a quadrant column) none of whose gospels has the section shrinks. */
  shrinkMissing: boolean;
}
/** Settings version: 2 starts everyone once on Dynamic colours with the map shown; 3 compresses the hidden years; 4 starts the timeline's scale on Text again. */
const VERSION = 4;
function load(): Partial<Saved> & { v?: number } {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<Saved> & { v?: number }) : {}; // anything else (null, a number) is ignored
  } catch { return {}; }
}
function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ...s })); } catch { /* storage unavailable */ }
}

interface UI extends Saved {
  /** The gospels shown before the map took the whole screen, to restore later. */
  lastVisible: Book[];
  /** Index of the row at the reading line. */
  current: number;
  toggleBook(b: Book): void;
  setSingle(b: Book): void;
  toggleMap(): void;
  toggleTimeline(): void;
  showOnlyMap(): void;
  setMapShare(share: number | null): void;
  setAppearance(a: Appearance): void;
  setTextSize(t: TextSize): void;
  setSpacing(s: Spacing): void;
  setReckoning(r: Reckoning): void;
  setCompress(c: boolean): void;
  setWander(w: boolean): void;
  setLandLight(on: boolean): void;
  setModern(m: boolean): void;
  setTrail(on: boolean): void;
  setMarker(m: MarkerKind): void;
  setLandColour(l: LandColour): void;
  setNotes(n: NotesShown): void;
  setPhoneGospels(p: PhoneGospels): void;
  setPhases(on: boolean): void;
  setUnits(u: Units): void;
  setPaneSync(p: PaneSync): void;
  setShrinkMissing(on: boolean): void;
  setTimeMarks(on: boolean): void;
  setCollapse(on: boolean): void;
  setCurrent(i: number): void;
}

const raw = load();
// Before version 2 the first visit followed a dark device and started without the map; before 3 the hidden years weren't
// compressed by default; before 4 the timeline could stay on Time from trying it. Drop those choices once.
const saved: Partial<Saved> = raw.v === VERSION ? raw : raw.v === 3 ? { ...raw, spacing: undefined } : raw.v === 2 ? { ...raw, compress: undefined, spacing: undefined } : { ...raw, appearance: undefined, map: undefined, compress: undefined, spacing: undefined };
const isBook = (b: unknown): b is Book => (BOOKS as unknown[]).includes(b);
const validBooks = (v: unknown): Book[] | null => (Array.isArray(v) && v.every(isBook) ? (v as Book[]) : null);
// First visit: Dynamic colours whatever the device's setting, with the map on screen.
const savedMap = saved.map !== false;
const savedVisible = validBooks(saved.visible);

export const useUI = create<UI>()((set, get) => {
  const persist = () => {
    const { visible, single, map, timeline, mapShare, appearance, textSize, spacing, reckoning, compress, wander, landLight, modern, trail, marker, landColour, notes, phoneGospels, phases, timeMarks, collapse, units, paneSync, shrinkMissing } = get();
    save({ visible, single, map, timeline, mapShare, appearance, textSize, spacing, reckoning, compress, wander, landLight, modern, trail, marker, landColour, notes, phoneGospels, phases, timeMarks, collapse, units, paneSync, shrinkMissing });
  };
  const update = (patch: Partial<UI>) => { set(patch); persist(); };
  return {
    // Nothing may be on screen only while the map is.
    visible: savedVisible && (savedVisible.length || savedMap) ? savedVisible : [...BOOKS],
    lastVisible: savedVisible?.length ? savedVisible : [...BOOKS],
    single: isBook(saved.single) ? saved.single : 'MAT',
    map: savedMap,
    timeline: saved.timeline !== false,
    mapShare: typeof saved.mapShare === 'number' && saved.mapShare >= 0.2 && saved.mapShare <= 0.8 ? saved.mapShare : null,
    appearance: saved.appearance === 'light' || saved.appearance === 'dark' ? saved.appearance : 'dynamic',
    textSize: saved.textSize === 's' || saved.textSize === 'l' ? saved.textSize : 'm',
    spacing: saved.spacing === 'chrono' ? 'chrono' : 'text',
    reckoning: saved.reckoning === 'ad33' ? 'ad33' : 'ad30',
    compress: saved.compress !== false,
    wander: saved.wander !== false,
    landLight: saved.landLight !== false,
    modern: saved.modern === true,
    trail: saved.trail !== false,
    marker: MARKER_KINDS.includes(saved.marker as MarkerKind) ? (saved.marker as MarkerKind) : 'ring',
    landColour: saved.landColour === 'plain' ? 'plain' : 'height',
    notes: saved.notes === 'textual' || saved.notes === 'none' ? saved.notes : 'all',
    phoneGospels: PHONE_GOSPELS.includes(saved.phoneGospels as PhoneGospels) ? (saved.phoneGospels as PhoneGospels) : 'grid',
    phases: saved.phases === true,
    timeMarks: saved.timeMarks !== false,
    // (Before the switch: hiddenGospels 'fade', a desktop keeping them, is the switch off.)
    collapse: typeof saved.collapse === 'boolean' ? saved.collapse : (saved as { hiddenGospels?: string }).hiddenGospels === 'fade' ? false : null,
    units: saved.units === 'imperial' ? 'imperial' : 'metric',
    paneSync: saved.paneSync === 'follow' ? 'follow' : 'locked',
    shrinkMissing: saved.shrinkMissing === true,
    current: START_ROW,
    toggleBook: (b) => {
      const { visible, map, single } = get();
      const next = visible.includes(b) ? visible.filter((x) => x !== b) : BOOKS.filter((x) => x === b || visible.includes(x));
      if (!next.length && !map) return; // keep at least one panel on screen
      update({ visible: next, lastVisible: next.length ? next : get().lastVisible, single: next.includes(single) || !next.length ? single : next[0] });
    },
    // Phones set to one gospel at a time.
    setSingle: (b) => {
      const { visible } = get();
      update({ single: b, visible: visible.includes(b) ? visible : visible.length ? [...visible, b] : [b] });
    },
    toggleMap: () => {
      const { map, visible, lastVisible, single } = get();
      if (!map) { update({ map: true }); return; }
      update({ map: false, visible: visible.length ? visible : lastVisible.length ? lastVisible : [single] });
    },
    toggleTimeline: () => update({ timeline: !get().timeline }),
    showOnlyMap: () => {
      const { visible, lastVisible } = get();
      update({ map: true, visible: [], lastVisible: visible.length ? visible : lastVisible });
    },
    setMapShare: (mapShare) => update({ mapShare }),
    setAppearance: (appearance) => update({ appearance }),
    setTextSize: (textSize) => update({ textSize }),
    setSpacing: (spacing) => update({ spacing }),
    setReckoning: (reckoning) => update({ reckoning }),
    setCompress: (compress) => update({ compress }),
    setWander: (wander) => update({ wander }),
    setLandLight: (landLight) => update({ landLight }),
    setModern: (modern) => update({ modern }),
    setTrail: (trail) => update({ trail }),
    setMarker: (marker) => update({ marker }),
    setLandColour: (landColour) => update({ landColour }),
    setNotes: (notes) => update({ notes }),
    setPhoneGospels: (phoneGospels) => update({ phoneGospels }),
    setPhases: (phases) => update({ phases }),
    setUnits: (units) => update({ units }),
    setPaneSync: (paneSync) => update({ paneSync }),
    setShrinkMissing: (shrinkMissing) => update({ shrinkMissing }),
    setTimeMarks: (timeMarks) => update({ timeMarks }),
    setCollapse: (collapse) => update({ collapse }),
    setCurrent: (current) => { if (current !== get().current) set({ current }); },
  };
});

/** Reading position, updated on every scroll frame. u is 0–1 along the timeline. */
export const playhead = createStore<{ u: number; row: number; f: number }>(() => ({ u: 0, row: START_ROW, f: 0 }));

/** At the reading line: whether Jesus has died and not yet risen (his light on the map goes out). */
export const scene = createStore<{ dead: boolean }>(() => ({ dead: false }));

/** Each row's span along the timeline (0–1), recomputed whenever the layout changes. */
export const layout = createStore<{ starts: number[]; ends: number[]; years: Years | null; version: number }>(() => ({ starts: [], ends: [], years: null, version: 0 }));

/** Phones (Reader lays out by the same query). */
export const COMPACT_QUERY = '(max-width: 760px)';
/** Whether the timeline leaves out the sections only hidden gospels tell (by default on desktops, not on phones). */
export const collapseHidden = (collapse: boolean | null, compact: boolean) => collapse ?? !compact;
/** Whether the screen shows one gospel at a time: a phone set to that. */
const oneAtATime = () => useUI.getState().phoneGospels === 'one' && window.matchMedia(COMPACT_QUERY).matches;

/** Go to a row, first making sure its passage is on screen: on a phone showing one gospel at a time, switch to a gospel that has it (to `book` when
 *  given); otherwise add one if none open has it (or `book` if it isn't open). A row no gospel has (only 1 Cor) changes
 *  nothing on screen, and the reader goes to where it sits: the next row shown. */
export function showRow(i: number, book?: Book) {
  const row = ROWS[i];
  if (!row) return;
  const ui = useUI.getState();
  const target = book && row.refs[book] ? book : BOOKS.find((b) => row.refs[b]);
  if (target && ui.visible.length) {
    if (oneAtATime()) {
      if (!row.refs[ui.single] || book) ui.setSingle(target);
    } else if (!ui.visible.some((b) => row.refs[b]) || (book && !ui.visible.includes(book))) ui.toggleBook(target);
  }
  // After the reader has re-rendered and measured any newly shown gospel.
  requestAnimationFrame(() => requestAnimationFrame(() => nav.toRow?.(i)));
}

/** Commands the reader registers so the timeline and search can move it. */
export const nav: {
  scrub: ((u: number, dragging: boolean) => void) | null;
  toRow: ((i: number) => void) | null;
  /** Go to a row, first showing a gospel that has it if none on screen does. */
  showRow: ((i: number) => void) | null;
} = { scrub: null, toRow: null, showRow: (i) => showRow(i) };

/** The place whose popup is open on the map, and the rows of the stories set there, marked on the timeline. */
export const placeMarks = createStore<{ key: string | null; rows: number[] }>(() => ({ key: null, rows: [] }));
