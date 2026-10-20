import { create } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Years, Spacing } from './layoutModel';
import { BOOKS, type Book, type Reckoning } from './model';

export type { Spacing };
export type Appearance = 'dynamic' | 'light' | 'dark';
export type TextSize = 's' | 'm' | 'l';
/** How Jesus is marked on the map. */
export type Traveller = 'light' | 'cross' | 'j' | 'crown';
const TRAVELLERS: Traveller[] = ['light', 'cross', 'j', 'crown'];
/** Which of the BSB's footnotes the reader marks. */
export type NotesShown = 'all' | 'textual' | 'none';

const KEY = 'jt-reader-settings';
interface Saved {
  visible: Book[];
  single: Book;
  map: boolean;
  /** The timeline scrubber under the toolbar. */
  timeline: boolean;
  /** Map's share of the panes (0–1); null = the default (1.5 × a gospel column, at most half). */
  mapShare: number | null;
  appearance: Appearance;
  textSize: TextSize;
  spacing: Spacing;
  reckoning: Reckoning;
  compress: boolean;
  traveller: Traveller;
  /** In an area rather than at a named place, the traveller drifts within it. */
  wander: boolean;
  /** His light on the land: the contours near Jesus drawn in white (in an area, covering it in place of a shaded circle). */
  landLight: boolean;
  /** The map's overlay of modern towns and modern names. */
  modern: boolean;
  notes: NotesShown;
}
/** Settings version: 2 starts everyone once on Dynamic colours with the map shown; 3 compresses the hidden years. */
const VERSION = 3;
function load(): Partial<Saved> & { v?: number } {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ...s })); } catch { /* storage unavailable */ }
}

interface UI extends Saved {
  /** The gospels shown before the map took the whole screen, to restore later. */
  lastVisible: Book[];
  settingsOpen: boolean;
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
  setTraveller(t: Traveller): void;
  setWander(w: boolean): void;
  setLandLight(on: boolean): void;
  setModern(m: boolean): void;
  setNotes(n: NotesShown): void;
  setSettingsOpen(open: boolean): void;
  setCurrent(i: number): void;
}

const raw = load();
// Before version 2 the first visit followed a dark device and started without the map; before 3 the hidden years weren't
// compressed by default. Drop those choices once.
const saved: Partial<Saved> = raw.v === VERSION ? raw : raw.v === 2 ? { ...raw, compress: undefined } : { ...raw, appearance: undefined, map: undefined, compress: undefined };
const isBook = (b: unknown): b is Book => (BOOKS as unknown[]).includes(b);
const validBooks = (v: unknown): Book[] | null => (Array.isArray(v) && v.every(isBook) ? (v as Book[]) : null);
// First visit: Dynamic colours whatever the device's setting, with the map on screen.
const savedMap = saved.map !== false;
const savedVisible = validBooks(saved.visible);

export const useUI = create<UI>()((set, get) => {
  const persist = () => {
    const { visible, single, map, timeline, mapShare, appearance, textSize, spacing, reckoning, compress, traveller, wander, landLight, modern, notes } = get();
    save({ visible, single, map, timeline, mapShare, appearance, textSize, spacing, reckoning, compress, traveller, wander, landLight, modern, notes });
  };
  const update = (patch: Partial<UI>) => { set(patch); persist(); };
  return {
    // Nothing may be on screen only while the map is.
    visible: savedVisible && (savedVisible.length || savedMap) ? savedVisible : [...BOOKS],
    lastVisible: savedVisible?.length ? savedVisible : [...BOOKS],
    single: isBook(saved.single) ? saved.single : 'MAT',
    map: savedMap,
    timeline: saved.timeline !== false,
    mapShare: typeof saved.mapShare === 'number' ? saved.mapShare : null,
    appearance: saved.appearance === 'light' || saved.appearance === 'dark' ? saved.appearance : 'dynamic',
    textSize: saved.textSize ?? 'm',
    spacing: saved.spacing === 'chrono' ? 'chrono' : 'text',
    reckoning: saved.reckoning === 'ad33' ? 'ad33' : 'ad30',
    compress: saved.compress !== false,
    traveller: TRAVELLERS.includes(saved.traveller as Traveller) ? (saved.traveller as Traveller) : 'light',
    wander: saved.wander !== false,
    landLight: saved.landLight !== false,
    modern: saved.modern === true,
    notes: saved.notes === 'textual' || saved.notes === 'none' ? saved.notes : 'all',
    settingsOpen: false,
    current: 0,
    toggleBook: (b) => {
      const { visible, map, single } = get();
      const next = visible.includes(b) ? visible.filter((x) => x !== b) : BOOKS.filter((x) => x === b || visible.includes(x));
      if (!next.length && !map) return; // keep at least one panel on screen
      update({ visible: next, lastVisible: next.length ? next : get().lastVisible, single: next.includes(single) || !next.length ? single : next[0] });
    },
    // Phones show one gospel at a time.
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
    setTraveller: (traveller) => update({ traveller }),
    setWander: (wander) => update({ wander }),
    setLandLight: (landLight) => update({ landLight }),
    setModern: (modern) => update({ modern }),
    setNotes: (notes) => update({ notes }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    setCurrent: (current) => { if (current !== get().current) set({ current }); },
  };
});

/** Reading position, updated on every scroll frame. u is 0–1 along the timeline. */
export const playhead = createStore<{ u: number; row: number; f: number }>(() => ({ u: 0, row: 0, f: 0 }));

/** At the reading line: whether Jesus has died and not yet risen (his light on the map goes out). */
export const scene = createStore<{ dead: boolean }>(() => ({ dead: false }));

/** Each row's span along the timeline (0–1), recomputed whenever the layout changes. */
export const layout = createStore<{ starts: number[]; ends: number[]; years: Years | null; version: number }>(() => ({ starts: [], ends: [], years: null, version: 0 }));

/** Commands the reader registers so the timeline and search can move it. */
export const nav: {
  scrub: ((u: number, dragging: boolean) => void) | null;
  toRow: ((i: number) => void) | null;
  /** Go to a row, first showing a gospel that has it if none on screen does. */
  showRow: ((i: number) => void) | null;
} = { scrub: null, toRow: null, showRow: null };

/** The place whose popup is open on the map, and the rows of the stories set there, marked on the timeline. */
export const placeMarks = createStore<{ key: string | null; rows: number[] }>(() => ({ key: null, rows: [] }));
