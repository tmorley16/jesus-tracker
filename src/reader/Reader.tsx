import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { computeLayout, rowAtU } from './layoutModel';
import { BOOKS, BOOK_ABBR, BOOK_NAME, ROWS, deadAt, lightAt, loadTexts, rowForVerse, rowTitle, versePos, type Book, type Reckoning, type Row, type Texts, type VersePos } from './model';
import { Splitter } from './Splitter';
import { Synopsis } from './Synopsis';
import { ScaleSwitch, Timeline } from './Timeline';
import { layout, nav, playhead, scene, useUI, type Appearance, type NotesShown, type TextSize, type Traveller } from './state';

const MapPane = lazy(() => import('./MapPane'));
const gospelVar = (b: Book) => ({ '--g': `var(--gospel-${b.toLowerCase()})` }) as CSSProperties;

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

/** After the reader has re-rendered for a newly shown gospel, move to a row. */
const goToRow = (i: number) => requestAnimationFrame(() => requestAnimationFrame(() => nav.toRow?.(i)));
/** Make sure a row's passage is on screen: on a phone switch to a gospel that has it, otherwise add one if none open has it. */
function ensureShown(i: number, compact: boolean, book?: Book) {
  const ui = useUI.getState();
  const row = ROWS[i];
  const target = book ?? BOOKS.find((b) => row.refs[b])!;
  if (compact) {
    if (ui.visible.length && (!row.refs[ui.single] || book)) ui.setSingle(target);
  } else if (ui.visible.length) {
    if (!ui.visible.some((b) => row.refs[b]) || (book && !ui.visible.includes(book))) ui.toggleBook(target);
  }
}

export default function Reader() {
  const [texts, setTexts] = useState<Texts | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadTexts().then(setTexts).catch((e: Error) => setError(e.message)); }, []);
  const compact = useMedia('(max-width: 760px)');
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
  const settingsOpen = useUI((s) => s.settingsOpen);
  // Phones show one gospel at a time.
  const gospels = useMemo<Book[]>(() => (compact ? (visible.length ? [visible.includes(single) ? single : visible[0]] : []) : visible), [compact, visible, single]);
  // The map follows the gospels on screen, or all four when it's on its own.
  const mapBooks = useMemo<Book[]>(() => (gospels.length ? gospels : BOOKS), [gospels]);
  const share = mapShare ?? Math.min(0.5, 1.5 / (gospels.length + 1.5));
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
      if (n >= 1 && n <= 4) { if (compact) ui.setSingle(BOOKS[n - 1]); else ui.toggleBook(BOOKS[n - 1]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact]);

  useEffect(() => {
    nav.showRow = (i) => { ensureShown(i, compact); goToRow(i); };
    return () => { nav.showRow = null; };
  }, [compact]);

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
      <Toolbar compact={compact} gospels={gospels} />
      {(timeline || compact) && <Timeline shown={mapBooks} compact={compact} />}
      <div className="panes" ref={panesRef} data-layout={split} style={{ '--map-share': String(share) } as CSSProperties}>
        {gospels.length > 0 && <Synopsis texts={texts} shown={gospels} single={gospels.length === 1} />}
        {split === 'split' && <Splitter panesRef={panesRef} share={share} vertical={compact} />}
        {map && (
          <Suspense fallback={<div className="map-pane"><p className="map-loading">Loading the map…</p></div>}>
            <MapPane books={mapBooks} />
          </Suspense>
        )}
      </div>
      {settingsOpen && <Settings />}
      <TintSync shown={mapBooks} />
      {error && <p className="load-error" role="alert">The text didn’t load: {error}. Check your connection and reload the page.</p>}
    </div>
  );
}

/** Where a verse sits in its row on screen (0–1 of the row's height), or by verse count where the reader isn't shown. */
function versePosOnScreen(row: Row): VersePos {
  const sec = document.getElementById(`row-${row.id}`);
  return (b, c, v) => {
    const el = sec?.querySelector<HTMLElement>(`.cell[data-book="${b}"] [data-cv="${c}:${v}"]`);
    if (!sec || !el || !sec.offsetHeight) return versePos(row, b, c, v);
    return (el.getBoundingClientRect().top - sec.getBoundingClientRect().top) / sec.offsetHeight;
  };
}

/** Dynamic colour: the page tint follows the time of day the visible accounts give, as the reading line passes the
 *  verses that give it; from Jesus' death until the angel at the tomb it turns cold, and his light on the map goes out. */
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

function Toolbar({ compact, gospels }: { compact: boolean; gospels: Book[] }) {
  const map = useUI((s) => s.map);
  const timeline = useUI((s) => s.timeline);
  const ui = useUI.getState();
  const [searching, setSearching] = useState(false);
  const pick = (b: Book) => {
    if (!compact) { ui.toggleBook(b); return; }
    // Phones: one gospel at a time; tapping the open one with the map on leaves just the map.
    if (gospels.includes(b)) { if (map) ui.showOnlyMap(); } else ui.setSingle(b);
  };
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
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></svg>{!compact && 'Map'}
        </button>
      </div>
      {(!compact || searching) && <GoTo compact={compact} onDone={() => setSearching(false)} />}
      <div className="tools">
        {compact && !searching && (
          <button type="button" className="icon" aria-label="Go to a passage or event" onClick={() => setSearching(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></svg>
          </button>
        )}
        {/* Phones always show the timeline, so there only the scale switch. */}
        <div className={!compact && timeline ? 'tl-group joined' : 'tl-group'}>
          {!compact && (
            <button type="button" className="icon timeline-btn" aria-pressed={timeline} aria-label="Timeline" onClick={ui.toggleTimeline} title="Show or hide the timeline (T)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18M3 9v6M21 9v6" /><rect x="10" y="7" width="4" height="10" rx="1.5" /></svg>
              Timeline
            </button>
          )}
          {(compact || timeline) && <ScaleSwitch />}
        </div>
        <button type="button" className="icon settings-btn" aria-label="Settings" aria-haspopup="dialog" onClick={() => ui.setSettingsOpen(!useUI.getState().settingsOpen)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg>
        </button>
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
    hits.push({ i: r.i, label: rowTitle(r), sub: `§${r.n} · ${BOOKS.filter((b) => r.refs[b]).map((b) => BOOK_ABBR[b]).join(' ')}`, book: null });
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
    ensureShown(h.i, compact, h.book ?? undefined);
    goToRow(h.i);
    setQ(''); setOpen(false); onDone();
    inputRef.current?.blur();
  };
  return (
    <div className="goto">
      <input
        id="goto"
        ref={inputRef}
        type="search"
        value={q}
        placeholder={compact ? 'Mk 6:30 or “storm”' : 'Go to: Mk 6:30, John 3, “storm”   ( / )'}
        aria-label="Go to a passage or an event"
        aria-expanded={open && hits.length > 0}
        aria-controls="goto-list"
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
      {open && hits.length > 0 && (
        <ul className="goto-list" id="goto-list" role="listbox">
          {hits.map((h, k) => (
            <li key={`${h.i}-${h.label}`} role="option" aria-selected={k === active} onMouseDown={(e) => { e.preventDefault(); pick(h); }} onMouseEnter={() => setActive(k)}>
              <span className="g-label">{h.label}</span><span className="g-sub">{h.sub}</span>
            </li>
          ))}
        </ul>
      )}
      {open && q.trim().length >= 2 && hits.length === 0 && <p className="goto-none">No passage or event matches “{q.trim()}”.</p>}
    </div>
  );
}

function Settings() {
  const appearance = useUI((s) => s.appearance);
  const textSize = useUI((s) => s.textSize);
  const reckoning = useUI((s) => s.reckoning);
  const compress = useUI((s) => s.compress);
  const traveller = useUI((s) => s.traveller);
  const wander = useUI((s) => s.wander);
  const landLight = useUI((s) => s.landLight);
  const notes = useUI((s) => s.notes);
  const ui = useUI.getState();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input:checked')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') ui.setSettingsOpen(false); };
    const onDown = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.settings-btn')) ui.setSettingsOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [ui]);
  const radio = <T extends string>(name: string, value: T, current: T, set: (v: T) => void, label: string, hint?: string) => (
    <label className="opt">
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => set(value)} />
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
    </label>
  );
  return (
    <div className="settings" role="dialog" aria-label="Settings" ref={panel}>
      <fieldset>
        <legend>Colours</legend>
        {radio<Appearance>('appearance', 'dynamic', appearance, ui.setAppearance, 'Dynamic', 'Papyrus, with a faint shift wherever the text gives a time of day')}
        {radio<Appearance>('appearance', 'light', appearance, ui.setAppearance, 'Light', 'Always papyrus')}
        {radio<Appearance>('appearance', 'dark', appearance, ui.setAppearance, 'Dark', 'Always night colours')}
      </fieldset>
      <fieldset>
        <legend>Text size</legend>
        <div className="row-opts">
          {radio<TextSize>('size', 's', textSize, ui.setTextSize, 'Small')}
          {radio<TextSize>('size', 'm', textSize, ui.setTextSize, 'Medium')}
          {radio<TextSize>('size', 'l', textSize, ui.setTextSize, 'Large')}
        </div>
      </fieldset>
      <fieldset>
        <legend>BSB notes</legend>
        <div className="row-opts">
          {radio<NotesShown>('notes', 'all', notes, ui.setNotes, 'All')}
          {radio<NotesShown>('notes', 'textual', notes, ui.setNotes, 'Manuscripts only')}
          {radio<NotesShown>('notes', 'none', notes, ui.setNotes, 'None')}
        </div>
        <p className="fine-print">A small letter marks each note: hover over it to read the note; click or tap to keep it open. Notes on the manuscripts are in the gospel’s colour.</p>
      </fieldset>
      <fieldset>
        <legend>Timeline in years</legend>
        <div className="row-opts">
          {radio<Reckoning>('reckoning', 'ad30', reckoning, ui.setReckoning, 'AD 30', 'Crucifixion in AD 30')}
          {radio<Reckoning>('reckoning', 'ad33', reckoning, ui.setReckoning, 'AD 33', 'Crucifixion in AD 33')}
        </div>
        <label className="opt">
          <input type="checkbox" checked={compress} onChange={(e) => ui.setCompress(e.target.checked)} />
          <span><b>Compress the hidden years</b><small>Shorten the long silences: childhood, and the years after age twelve</small></span>
        </label>
        <p className="fine-print">For the timeline’s Years scale. Dates are estimates from two common reckonings, interpolated between anchor events such as the Passovers in John.</p>
      </fieldset>
      <fieldset>
        <legend>Jesus on the map</legend>
        <div className="row-opts">
          {radio<Traveller>('traveller', 'light', traveller, ui.setTraveller, 'A light')}
          {radio<Traveller>('traveller', 'cross', traveller, ui.setTraveller, 'A cross')}
          {radio<Traveller>('traveller', 'j', traveller, ui.setTraveller, 'J')}
          {radio<Traveller>('traveller', 'crown', traveller, ui.setTraveller, 'A crown')}
        </div>
        <label className="opt">
          <input type="checkbox" checked={wander} onChange={(e) => ui.setWander(e.target.checked)} />
          <span><b>Drift within an area</b><small>Where the text gives only a region, or no place, the marker moves gently within the area instead of resting at its centre</small></span>
        </label>
        <label className="opt">
          <input type="checkbox" checked={landLight} onChange={(e) => ui.setLandLight(e.target.checked)} />
          <span><b>Light on the land</b><small>The contour lines around Jesus light up in white; in an area they light the whole area instead of a shaded circle</small></span>
        </label>
      </fieldset>
      <div className="about">
        <p><b>Keys:</b> 1–4 show or hide a gospel · M map · / go to · ← → on the timeline step through events.</p>
        <p>Text: Berean Standard Bible (public domain). Order and sections: A. T. Robertson, <i>A Harmony of the Gospels</i> (1922), public domain; titles rewritten to describe what each text narrates. Places: OpenBible.info (CC BY 4.0). Map: Natural Earth. Peaks and Wikipedia links: Wikidata (CC0). Terrain: SRTM and GMTED2010 (USGS), ETOPO1 (NOAA). Modern places: GeoNames (CC BY 4.0).</p>
      </div>
      <button type="button" className="close" onClick={() => ui.setSettingsOpen(false)}>Done</button>
    </div>
  );
}
