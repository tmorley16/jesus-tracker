import { memo, useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { computeLayout, rowAtU } from './layoutModel';
import { BOOK_ABBR, BOOK_NAME, ROWS, TEXT_NOTES, fmtRef, versesOf, type Book, type Row, type Texts } from './model';
import { NotePopover, VerseText } from './Notes';
import { PlaceChip } from './places';
import { layout, nav, playhead, useUI } from './state';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const gospelVar = (b: Book) => ({ '--g': `var(--gospel-${b.toLowerCase()})` }) as CSSProperties;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Geo { tops: number[]; heights: number[]; vis: number[]; origin: number; span: number; anchor: number }

export function Synopsis({ texts, shown, single }: { texts: Texts | null; shown: Book[]; single: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const spacing = useUI((s) => s.spacing);
  const textSize = useUI((s) => s.textSize);
  const reckoning = useUI((s) => s.reckoning);
  const compress = useUI((s) => s.compress);
  const geo = useRef<Geo>({ tops: [], heights: [], vis: [], origin: 0, span: 1, anchor: 0 });
  const anim = useRef({ target: 0, tau: 160, raf: 0, last: 0, lastSet: 0 });
  const spacingRef = useRef(spacing);
  spacingRef.current = spacing;
  const shownRef = useRef(shown);
  shownRef.current = shown;

  // Every spacing maps the same way: a row's share of its timeline span = its share of its height.
  const update = useCallback(() => {
    const s = scrollRef.current, g = geo.current;
    if (!s || !g.vis.length) return;
    const y = s.scrollTop + g.anchor;
    let lo = 0, hi = g.vis.length - 1, k = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (g.tops[g.vis[mid]] <= y) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    const i = g.vis[k];
    const f = clamp((y - g.tops[i]) / Math.max(1, g.heights[i]), 0, 1);
    const { starts, ends } = layout.getState();
    const u = starts.length ? starts[i] + f * (ends[i] - starts[i]) : 0;
    playhead.setState({ u, row: i, f });
    useUI.getState().setCurrent(i);
  }, []);

  const measure = useCallback(() => {
    const s = scrollRef.current, wrap = rowsRef.current;
    if (!s || !wrap) return;
    const n = ROWS.length;
    const tops = new Array<number>(n).fill(0), heights = new Array<number>(n).fill(0);
    const vis: number[] = [];
    wrap.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => {
      if (el.hidden) return;
      const i = Number(el.dataset.row);
      tops[i] = el.offsetTop;
      vis.push(i);
    });
    const end = wrap.offsetTop + wrap.offsetHeight;
    for (let k = 0; k < vis.length; k++) heights[vis[k]] = (k + 1 < vis.length ? tops[vis[k + 1]] : end) - tops[vis[k]];
    // Hidden rows sit, with no height, where the next visible row starts.
    let next = end;
    for (let i = n - 1; i >= 0; i--) { if (heights[i] > 0) next = tops[i]; else tops[i] = next; }
    const origin = vis.length ? tops[vis[0]] : 0;
    const span = Math.max(1, end - origin);
    const headH = headRef.current?.offsetHeight ?? 0;
    s.style.setProperty('--cols-h', `${headH}px`);
    geo.current = { tops, heights, vis, origin, span, anchor: headH + (s.clientHeight - headH) * 0.22 };
    if (spacingRef.current === 'text') {
      const starts = new Array<number>(n), ends = new Array<number>(n);
      for (let i = 0; i < n; i++) { starts[i] = (tops[i] - origin) / span; ends[i] = starts[i] + heights[i] / span; }
      layout.setState((l) => ({ starts, ends, years: null, version: l.version + 1 }));
    } else {
      const { reckoning: r, compress: c } = useUI.getState();
      const model = computeLayout(shownRef.current, spacingRef.current, { reckoning: r, compress: c });
      layout.setState((l) => ({ ...model, version: l.version + 1 }));
    }
  }, []);

  const animateTo = useCallback((target: number, tau: number) => {
    const s = scrollRef.current;
    if (!s) return;
    target = clamp(target, 0, s.scrollHeight - s.clientHeight);
    if (reduceMotion()) { s.scrollTop = target; return; }
    const a = anim.current;
    a.target = target; a.tau = tau;
    // Long jumps: cut to a screen away, then glide the last stretch.
    const lead = s.clientHeight * 1.2;
    if (Math.abs(target - s.scrollTop) > lead * 2) s.scrollTop = target - Math.sign(target - s.scrollTop) * lead;
    a.lastSet = s.scrollTop;
    if (a.raf) return;
    a.last = performance.now();
    const step = (now: number) => {
      const cur = s.scrollTop;
      if (Math.abs(cur - a.lastSet) > 3) { a.raf = 0; return; } // something else moved the reader
      const dt = Math.min(64, now - a.last);
      a.last = now;
      let nextTop = cur + (a.target - cur) * (1 - Math.exp(-dt / a.tau));
      if (Math.abs(nextTop - cur) < 1) nextTop = cur + Math.sign(a.target - cur);
      if (Math.abs(a.target - nextTop) < 2) { s.scrollTop = a.target; a.raf = 0; return; }
      s.scrollTop = nextTop;
      a.lastSet = s.scrollTop;
      a.raf = requestAnimationFrame(step);
    };
    a.raf = requestAnimationFrame(step);
  }, []);
  const cancelAnim = useCallback(() => { if (anim.current.raf) { cancelAnimationFrame(anim.current.raf); anim.current.raf = 0; } }, []);

  // Commands for the timeline and search.
  useEffect(() => {
    nav.scrub = (u, dragging) => {
      const g = geo.current;
      const { starts, ends } = layout.getState();
      if (!g.vis.length || !starts.length) return;
      let i = rowAtU(u, starts, ends);
      if (!(g.heights[i] > 0)) i = g.vis.find((v) => v >= i) ?? g.vis[g.vis.length - 1]; // a row these gospels don't have
      const width = ends[i] - starts[i];
      const f = width > 0 ? clamp((u - starts[i]) / width, 0, 1) : 0;
      animateTo(g.tops[i] + f * g.heights[i] - g.anchor, dragging ? 55 : 150);
    };
    nav.toRow = (i) => {
      const g = geo.current, headH = headRef.current?.offsetHeight ?? 0;
      animateTo(g.tops[i] - headH - 4, 170);
    };
    return () => { nav.scrub = null; nav.toRow = null; };
  }, [animateTo]);

  // Re-measure when anything that changes heights changes, keeping the reading position.
  useLayoutEffect(() => {
    const { row, f } = playhead.getState();
    measure();
    const g = geo.current, s = scrollRef.current;
    if (s && g.vis.length && (row > 0 || f > 0)) {
      const i = g.heights[row] > 0 ? row : g.vis.find((v) => v >= row) ?? g.vis[g.vis.length - 1];
      s.scrollTop = g.tops[i] + (i === row ? f : 0) * g.heights[i] - g.anchor;
    }
    update();
  }, [shown, texts, textSize, spacing, reckoning, compress, measure, update]);

  useEffect(() => {
    const s = scrollRef.current, wrap = rowsRef.current;
    if (!s || !wrap) return;
    let ticking = false;
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); } };
    let pending = 0;
    // Text reflows (fonts arriving, a resize): keep the same place in the same row.
    const remeasure = () => {
      const atTop = s.scrollTop <= 2;
      const { row, f } = playhead.getState();
      measure();
      const g = geo.current;
      if (!atTop && !anim.current.raf) s.scrollTop = g.tops[row] + f * g.heights[row] - g.anchor;
      update();
    };
    const ro = new ResizeObserver(() => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        if ('dragging' in document.body.dataset) return; // the divider is moving; measure once on release
        remeasure();
      });
    });
    ro.observe(wrap);
    ro.observe(s);
    window.addEventListener('jt-drag-end', remeasure);
    s.addEventListener('scroll', onScroll, { passive: true });
    for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) s.addEventListener(ev, cancelAnim, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('jt-drag-end', remeasure);
      s.removeEventListener('scroll', onScroll);
      for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) s.removeEventListener(ev, cancelAnim);
    };
  }, [measure, update, cancelAnim]);

  const cols = { gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` };
  let lastPart = '';
  return (
    <div className="reader" ref={scrollRef} tabIndex={-1} aria-label="The gospel accounts, aligned by event">
      <div className="cols-head" ref={headRef} style={cols}>
        {shown.map((b) => <ColumnHead key={b} book={b} />)}
      </div>
      <div className="rows" ref={rowsRef}>
        {ROWS.map((row) => {
          const visible = shown.some((b) => row.refs[b]);
          const partStart = visible && row.part !== lastPart;
          if (visible) lastPart = row.part;
          return <RowView key={row.id} row={row} shown={shown} texts={texts} hidden={!visible} partStart={partStart} single={single} />;
        })}
      </div>
      <div className="reader-end" aria-hidden="true" />
      <NotePopover host={scrollRef} />
    </div>
  );
}

function ColumnHead({ book }: { book: Book }) {
  const current = useUI((s) => s.current);
  let chapter: number | null = null;
  for (let i = current; i >= 0 && chapter === null; i--) { const r = ROWS[i].refs[book]; if (r) chapter = r[r.length - 1][2]; }
  return (
    <div className="col-h" style={gospelVar(book)}>
      <span className="dot" aria-hidden="true" />
      <span className="col-name">{BOOK_NAME[book]}</span>
      {chapter !== null && <span className="col-ch">{chapter}</span>}
    </div>
  );
}

const RowView = memo(function RowView({ row, shown, texts, hidden, partStart, single }: {
  row: Row; shown: Book[]; texts: Texts | null; hidden: boolean; partStart: boolean; single: boolean;
}) {
  if (hidden) return <section data-row={row.i} hidden />;
  const others = single ? (['MAT', 'MRK', 'LUK', 'JHN'] as Book[]).filter((b) => row.refs[b] && !shown.includes(b)) : [];
  const setSingle = useUI.getState().setSingle;
  return (
    <section className="row" data-row={row.i} id={`row-${row.id}`} aria-labelledby={`h-${row.id}`}>
      {partStart && <div className="part-div"><span>{row.partTitle}</span></div>}
      <header className="row-head">
        <p className="kicker">
          <span className="n" title="Section number in Robertson’s Harmony of the Gospels (1922)">§{row.n}</span>
          {row.subTitle && <span>{row.sectionTitle} · {row.subIndex + 1} of {row.subCount}</span>}
        </p>
        <h3 id={`h-${row.id}`}>{row.subTitle ?? row.sectionTitle}</h3>
        <div className="row-meta">
          <PlaceChip row={row} book={single ? shown[0] : null} />
          {row.feast && <span className="chip" title={`${row.feast.ref}: “${row.feast.words}”`}>{row.feast.name} · {row.feast.ref}</span>}
          {row.other.map((o) => <span className="chip" key={o}>{o}</span>)}
          {others.length > 0 && (
            <span className="also">Also in{others.map((b) => (
              <button type="button" key={b} style={gospelVar(b)} onClick={() => setSingle(b)} aria-label={`Read ${BOOK_NAME[b]} here`}>{BOOK_ABBR[b]}</button>
            ))}</span>
          )}
        </div>
      </header>
      <div className="cells" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map((b) => <Cell key={b} row={row} book={b} texts={texts} labelEmpty={shown.length > 1} />)}
      </div>
    </section>
  );
});

function Cell({ row, book, texts, labelEmpty }: { row: Row; book: Book; texts: Texts | null; labelEmpty: boolean }) {
  const ranges = row.refs[book];
  const notesShown = useUI((s) => s.notes);
  if (!ranges) return <div className="cell empty" style={gospelVar(book)}>{labelEmpty && <span>Not in {BOOK_NAME[book]}</span>}</div>;
  const blocks = texts ? versesOf(texts[book], ranges) : null;
  const pos = (c: number, v: number) => c * 1000 + v;
  const note = TEXT_NOTES.find((n) => n.book === book && ranges.some(([c1, v1, c2, v2]) => pos(c1, v1) <= pos(...n.to) && pos(c2, v2) >= pos(...n.from)));
  const repeats = row.repeats[book];
  let letters = 0;
  const next = () => letters++;
  return (
    <div className="cell" style={gospelVar(book)}>
      <p className="cell-ref">{fmtRef(book, ranges)}</p>
      {row.outOfOrder[book] && <p className="cell-note order">{row.outOfOrder[book]}</p>}
      {note && <p className="cell-note textual">{note.note}</p>}
      {blocks ? blocks.map((verses, k) => (
        <p className="passage" key={k}>
          {verses.map((v) => {
            const again = repeats?.[`${v.c}:${v.v}`];
            return (
              <span key={`${v.c}:${v.v}`} className={again ? 'v again' : 'v'} title={again ? `This verse also appears in §${again}; Robertson divides it between sections.` : undefined}>
                {v.label ? <b className="vl">{v.c}:{v.v}</b> : <sup className="vn">{v.v}</sup>}
                <VerseText book={book} c={v.c} v={v.v} text={v.t} shown={notesShown} next={next} />
              </span>
            );
          })}
        </p>
      )) : <p className="passage loading" aria-busy="true">Loading {BOOK_NAME[book]}…</p>}
    </div>
  );
}
