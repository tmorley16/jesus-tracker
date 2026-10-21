import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { computeLayout, rowAtU } from './layoutModel';
import { BOOKS, BOOK_ABBR, BOOK_NAME, ROWS, deadAt, lightAt, loadTexts, rowForVerse, rowTitle, versePos, type Book, type Row, type Texts, type VersePos } from './model';
import { GospelConfig, TimelineConfig } from './Config';
import { Splitter } from './Splitter';
import { Stack, Synopsis } from './Synopsis';
import { Timeline } from './Timeline';
import { COMPACT_QUERY, layout, nav, playhead, scene, showRow, useUI } from './state';

const MapPane = lazy(() => import('./MapPane'));
const gospelVar = (b: Book) => ({ '--g': `var(--gospel-${b.toLowerCase()})` }) as CSSProperties;
const GOLDEN = (1 + Math.sqrt(5)) / 2;

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export default function Reader() {
  const [texts, setTexts] = useState<Texts | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadTexts().then(setTexts).catch((e: Error) => setError(e.message)); }, []);
  const compact = useMedia(COMPACT_QUERY);
  const map = useUI((s) => s.map);
  const timeline = useUI((s) => s.timeline);
  const visible = useUI((s) => s.visible);
  const single = useUI((s) => s.single);
  const mapShare = useUI((s) => s.mapShare);
  const textSize = useUI((s) => s.textSize);
  const appearance = useUI((s) => s.appearance);
  const spacing = useUI((s) => s.spacing);
  const reckoning = useUI((s) => s.reckoning);
  const compress = useUI((s) => s.compress);
  const phoneGospels = useUI((s) => s.phoneGospels);
  const one = compact && phoneGospels === 'one';
  // Phones have the controls beside the timeline, the gospels by their lanes, in place of the toolbar.
  const side = compact;
  // Phones can be set to one gospel at a time.
  const gospels = useMemo<Book[]>(() => (one ? (visible.length ? [visible.includes(single) ? single : visible[0]] : []) : visible), [one, visible, single]);
  // The map follows the gospels on screen, or all four when it's on its own.
  const mapBooks = useMemo<Book[]>(() => (gospels.length ? gospels : BOOKS), [gospels]);
  // Desktop: gospels to map in the golden ratio. Phones (stacked): 1.5 × a gospel's share, at most half.
  const share = mapShare ?? (compact ? Math.min(0.5, 1.5 / (gospels.length + 1.5)) : 1 / (1 + GOLDEN));
  const panesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.dataset.light = appearance === 'dark' ? 'night' : 'unstated';
    if (appearance !== 'dynamic') delete document.body.dataset.tint;
  }, [appearance]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || el.closest('input, select, textarea, [contenteditable]')) return;
      const ui = useUI.getState();
      if (e.key === '/') { e.preventDefault(); document.getElementById('goto')?.focus(); return; }
      if (e.key.toLowerCase() === 'm') { ui.toggleMap(); return; }
      if (e.key.toLowerCase() === 't' && !compact) { ui.toggleTimeline(); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= 4) { if (one) ui.setSingle(BOOKS[n - 1]); else ui.toggleBook(BOOKS[n - 1]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact, one]);

  // With only the map on screen there's no text to scroll: the timeline sets the row directly.
  useEffect(() => {
    if (gospels.length) return;
    const l = computeLayout(BOOKS, spacing, { reckoning, compress });
    layout.setState((s) => ({ ...l, version: s.version + 1 }));
    const setRow = (i: number, u: number) => { playhead.setState({ u, row: i, f: 0 }); useUI.getState().setCurrent(i); };
    nav.scrub = (u) => setRow(rowAtU(u, l.starts, l.ends), u);
    nav.toRow = (i) => setRow(i, l.starts[i]);
    const cur = useUI.getState().current;
    setRow(cur, l.starts[cur]);
    return () => { nav.scrub = null; nav.toRow = null; };
  }, [gospels.length, spacing, reckoning, compress]);

  const split = map ? (gospels.length ? 'split' : 'map') : 'text';
  return (
    <div className="jt" data-size={textSize} data-compact={compact ? '' : undefined}>
      {!side && <Toolbar compact={compact} one={one} gospels={gospels} />}
      {(timeline || compact) && <Timeline shown={mapBooks} compact={compact} side={side ? { left: <LaneChips one={one} gospels={gospels} />, right: <SideTools /> } : undefined} corner={side ? undefined : <TimelineConfig desk />} />}
      <div className="panes" ref={panesRef} data-layout={split} style={{ '--map-share': String(share) } as CSSProperties}>
        {gospels.length > 1 && compact && (phoneGospels === 'stacked' || phoneGospels === 'grid')
          ? <Stack texts={texts} shown={gospels} arrangement={phoneGospels} />
          : gospels.length > 0 && <Synopsis texts={texts} shown={gospels} single={gospels.length === 1} compact={compact} />}
        {gospels.length > 0 && <GospelConfig desk={!compact} />}
        {split === 'split' && <Splitter panesRef={panesRef} share={share} vertical={compact} />}
        {map && (
          <Suspense fallback={<div className="map-pane"><p className="map-loading">Loading the map…</p></div>}>
            <MapPane books={mapBooks} compact={compact} withText={gospels.length > 0} />
          </Suspense>
        )}
      </div>
      <TintSync shown={mapBooks} />
      <NowMark />
      {error && <p className="load-error" role="alert">The text didn’t load: {error}. Check your connection and reload the page.</p>}
    </div>
  );
}

/** Where a verse sits in its row on screen (0–1 of the row's height), or by verse count where the reader isn't shown. */
function versePosOnScreen(row: Row): VersePos {
  // One section, or (gospels in panes of their own) one in each pane.
  const secs = [...document.querySelectorAll<HTMLElement>(`section.row[data-row="${row.i}"]`)];
  return (b, c, v) => {
    for (const sec of secs) {
      const el = sec.querySelector<HTMLElement>(`.cell[data-book="${b}"] [data-cv="${c}:${v}"]`);
      if (el && sec.offsetHeight) return (el.getBoundingClientRect().top - sec.getBoundingClientRect().top) / sec.offsetHeight;
    }
    return versePos(row, b, c, v);
  };
}

/** Dynamic colour: the page tint follows the time of day the visible accounts give, as the reading line passes the
 *  verses that give it; from Jesus' death until the angel at the tomb it turns cold, and his light on the map goes out. */
/** "Now" in the gold of Jesus' marker: a style naming the current section (a fine rule under its heading, and its § in
 *  gold), so no row re-renders as the reading line moves and rows rendered later are marked too. */
function NowMark() {
  useEffect(() => {
    const style = document.head.appendChild(document.createElement('style'));
    let last = -1;
    const mark = ({ row }: { row: number }) => {
      if (row === last) return;
      last = row;
      const now = `section.row[data-row="${row}"] > .row-head`;
      style.textContent = `${now} { box-shadow: inset 0 -1.5px 0 var(--now-line); } ${now} .kicker .n { color: var(--now-line); }`;
    };
    mark(playhead.getState());
    const un = playhead.subscribe(mark);
    return () => { un(); style.remove(); };
  }, []);
  return null;
}

function TintSync({ shown }: { shown: Book[] }) {
  const appearance = useUI((s) => s.appearance);
  useEffect(() => {
    const apply = () => {
      const { row: i, f } = playhead.getState();
      const row = ROWS[i];
      if (!row) return;
      const pos = versePosOnScreen(row);
      const dead = deadAt(row, shown, f, pos);
      if (dead !== scene.getState().dead) scene.setState({ dead });
      if (dead) document.body.dataset.dead = ''; else delete document.body.dataset.dead;
      if (appearance !== 'dynamic') return;
      const state = dead ? 'dead' : lightAt(row, shown, f, pos);
      if (state === 'unstated') delete document.body.dataset.tint;
      else if (document.body.dataset.tint !== state) document.body.dataset.tint = state;
    };
    apply();
    return playhead.subscribe((s, prev) => { if (s.row !== prev.row || s.f !== prev.f) apply(); });
  }, [shown, appearance]);
  return null;
}

/** Show or hide a gospel; one gospel at a time: switch to it, and tapping the open one with the map on leaves just the map. */
function pickBook(b: Book, one: boolean, gospels: Book[]) {
  const ui = useUI.getState();
  if (!one) { ui.toggleBook(b); return; }
  if (gospels.includes(b)) { if (ui.map) ui.showOnlyMap(); } else ui.setSingle(b);
}

const MapIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></svg>;
const SearchIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></svg>;

/** Phones, controls beside the timeline: each gospel's button by its lane. */
function LaneChips({ one, gospels }: { one: boolean; gospels: Book[] }) {
  useUI((s) => s.map); // one at a time, the open gospel's button depends on the map
  return (
    <div className="lane-chips" role="group" aria-label="Gospels on screen">
      {BOOKS.map((b) => (
        <button type="button" key={b} aria-pressed={gospels.includes(b)} style={gospelVar(b)} onClick={() => pickBook(b, one, gospels)} title={`Show or hide ${BOOK_NAME[b]}`}>
          <i aria-hidden="true" />{BOOK_ABBR[b]}
        </button>
      ))}
    </div>
  );
}

/** Phones, controls beside the timeline: the map, Go to, and the timeline's settings at the foot. */
function SideTools() {
  const map = useUI((s) => s.map);
  const ui = useUI.getState();
  const [searching, setSearching] = useState(false);
  return (
    <div className="side-tools">
      <button type="button" className="icon map-chip" aria-pressed={map} aria-label="Map" onClick={ui.toggleMap}><MapIcon /></button>
      <button type="button" className="icon" aria-label="Go to a passage or event" onClick={() => setSearching(true)}><SearchIcon /></button>
      <TimelineConfig />
      {searching && <GoTo compact onDone={() => setSearching(false)} />}
    </div>
  );
}

function Toolbar({ compact, one, gospels }: { compact: boolean; one: boolean; gospels: Book[] }) {
  const map = useUI((s) => s.map);
  const timeline = useUI((s) => s.timeline);
  const ui = useUI.getState();
  const [searching, setSearching] = useState(false);
  const pick = (b: Book) => pickBook(b, one, gospels);
  return (
    <header className="toolbar">
      {!compact && <p className="brand">Jesus Tracker</p>}
      <div className="gospels" role="group" aria-label="Panels on screen">
        {BOOKS.map((b) => (
          <button type="button" key={b} aria-pressed={gospels.includes(b)} style={gospelVar(b)} onClick={() => pick(b)} title={`Show or hide ${BOOK_NAME[b]} (${BOOKS.indexOf(b) + 1})`}>
            <i aria-hidden="true" />{compact ? BOOK_ABBR[b] : BOOK_NAME[b]}
          </button>
        ))}
        <button type="button" className="map-chip" aria-pressed={map} aria-label="Map" onClick={ui.toggleMap} title="Show or hide the map (M)">
          <MapIcon />{!compact && 'Map'}
        </button>
        <button type="button" className="map-chip timeline-chip" aria-pressed={timeline} aria-label="Timeline" onClick={ui.toggleTimeline} title="Show or hide the timeline (T)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18M3 9v6M21 9v6" /><rect x="10" y="7" width="4" height="10" rx="1.5" /></svg>
          {!compact && 'Timeline'}
        </button>
      </div>
      {(!compact || searching) && <GoTo compact={compact} onDone={() => setSearching(false)} />}
      <div className="tools">
        {compact && !searching && (
          <button type="button" className="icon" aria-label="Go to a passage or event" onClick={() => setSearching(true)}>
            <SearchIcon />
          </button>
        )}
      </div>
    </header>
  );
}

const REF_RE = /^\s*(mt|matt?|matthew|mk|mar|mark|lk|luk|luke|jn|jhn|joh|john)\.?\s*(\d{1,2})(?:\s*[:.]\s*(\d{1,3})|\s+(\d{1,3}))?\s*$/i;
const BOOK_FROM: Record<string, Book> = { mt: 'MAT', mat: 'MAT', matt: 'MAT', matthew: 'MAT', mk: 'MRK', mar: 'MRK', mark: 'MRK', lk: 'LUK', luk: 'LUK', luke: 'LUK', jn: 'JHN', jhn: 'JHN', joh: 'JHN', john: 'JHN' };
interface Hit { i: number; label: string; sub: string; book: Book | null }

function search(q: string): Hit[] {
  const m = q.match(REF_RE);
  if (m) {
    const book = BOOK_FROM[m[1].toLowerCase()];
    const c = Number(m[2]), v = Number(m[3] ?? m[4] ?? 1);
    const i = rowForVerse(book, c, v);
    return i < 0 ? [] : [{ i, label: `${BOOK_NAME[book]} ${c}:${v}`, sub: `§${ROWS[i].n} ${rowTitle(ROWS[i])}`, book }];
  }
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const hits: Hit[] = [];
  for (const r of ROWS) {
    if (!`${r.sectionTitle} ${r.subTitle ?? ''}`.toLowerCase().includes(t)) continue;
    const books = BOOKS.filter((b) => r.refs[b]).map((b) => BOOK_ABBR[b]);
    // A row no gospel has (only 1 Cor) names its own passage; going there shows the next row the gospels have.
    hits.push({ i: r.i, label: rowTitle(r), sub: `§${r.n} · ${(books.length ? books : r.other).join(' ')}`, book: null });
    if (hits.length === 8) break;
  }
  return hits;
}

function GoTo({ compact, onDone }: { compact: boolean; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => search(q), [q]);
  useEffect(() => { if (compact) inputRef.current?.focus(); }, [compact]);
  const pick = (h: Hit) => {
    showRow(h.i, h.book ?? undefined);
    setQ(''); setOpen(false); onDone();
    inputRef.current?.blur();
  };
  const listed = open && hits.length > 0;
  return (
    <div className="goto">
      <input
        id="goto"
        ref={inputRef}
        type="search"
        value={q}
        placeholder={compact ? 'Mk 6:30 or “storm”' : 'Go to: Mk 6:30, John 3, “storm”   ( / )'}
        aria-label="Go to a passage or an event"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listed}
        aria-controls="goto-list"
        aria-activedescendant={listed && hits[active] ? `goto-opt-${active}` : undefined}
        autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => { setOpen(false); if (compact && !q) onDone(); }, 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); pick(hits[active]); }
          else if (e.key === 'Escape') { setQ(''); setOpen(false); onDone(); inputRef.current?.blur(); }
        }}
      />
      {listed && (
        <ul className="goto-list" id="goto-list" role="listbox" aria-label="Passages and events">
          {hits.map((h, k) => (
            <li key={`${h.i}-${h.label}`} id={`goto-opt-${k}`} role="option" aria-selected={k === active} onMouseDown={(e) => { e.preventDefault(); pick(h); }} onMouseEnter={() => setActive(k)}>
              <span className="g-label">{h.label}</span><span className="g-sub">{h.sub}</span>
            </li>
          ))}
        </ul>
      )}
      {open && q.trim().length >= 2 && hits.length === 0 && <p className="goto-none" role="status">No passage or event matches “{q.trim()}”.</p>}
    </div>
  );
}
