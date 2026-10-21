import { memo, useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { computeLayout, rowAtU } from './layoutModel';
import { BOOKS, BOOK_ABBR, BOOK_NAME, PARALLELS, ROWS, START_ROW, TEXT_NOTES, fmtRef, rowTitle, versesOf, type Book, type Row, type Texts } from './model';
import { NotePopover, VerseText, showVerse } from './Notes';
import { PlaceChip } from './places';
import { collapseHidden, layout, nav, playhead, useUI, type NotesShown } from './state';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const gospelVar = (b: Book) => ({ '--g': `var(--gospel-${b.toLowerCase()})` }) as CSSProperties;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Each pane's one gospel, the same array every render, so its rows (memoised) don't render again with the stack. */
const ONE = Object.fromEntries(BOOKS.map((b) => [b, [b]])) as Record<Book, Book[]>;

interface Geo { tops: number[]; heights: number[]; vis: number[]; origin: number; span: number; anchor: number }

/** Phones can show the gospels in panes of their own (stacked, or in quadrants), kept at one reading position. Locked
 *  (the default): every section is as long in each pane as in the longest, and the panes scroll together, in step,
 *  from the first pane. Otherwise each keeps its own length: the pane last touched leads (its scrolling sets the
 *  reading position) and the others follow it. */
const stack = {
  leader: 0, locked: false,
  panes: new Map<number, { scrub: (u: number, dragging: boolean) => void; toRow: (i: number) => void }>(),
  /** Each pane's way back to the reading position, measuring afresh: locked, once the lengths are even again. */
  restore: new Map<number, () => void>(),
  /** Locked: even out the sections' lengths again (after text reflows), on the next frame, then put each pane back at the
   *  reading position. */
  requestEqualize: () => {},
  /** Locked: stop the panes' fling, before the timeline or search moves them. */
  stopFling: () => {},
};

/** Whether the page has opened at its starting section yet: readers mounted later (a gospel shown again, another
 *  layout) keep the reading place instead. */
let opened = false;

/** Whether each reader is gliding (to a place the timeline or search asked for). */
const gliders = new Set<() => boolean>();

/** Phones, Gospel settings › Shrink missing: a track (a row of panes, or a column) none of whose gospels has the
 *  section at the reading line shrinks to half once the reading comes to rest; one that has it grows back at once, even
 *  mid-scroll. Rows and columns change together, written straight to the style (`write`), so nothing renders again. */
function useShrink(ref: RefObject<HTMLElement | null>, shown: Book[], rows: number[][], cols: number[][], write: (el: HTMLElement, rows: string[], cols: string[]) => void) {
  const shrink = useUI((s) => s.shrinkMissing);
  const key = JSON.stringify([shown, rows, cols]);
  useEffect(() => {
    const el = ref.current;
    const tracks = [...rows, ...cols];
    if (!el || !tracks.length || !shrink) return;
    const target = () => {
      const i = useUI.getState().current;
      const has = shown.map((b) => !!ROWS[i]?.refs[b]);
      if (!has.some(Boolean)) return tracks.map(() => 1); // a section none of them has: all alike
      return tracks.map((ks) => (ks.some((k) => has[k]) ? 1 : 0.5));
    };
    let now: number[] = [];
    const set = (next: number[]) => {
      if (next.length === now.length && next.every((v, k) => v === now[k])) return;
      now = next;
      const fr = (v: number) => `minmax(0, ${v}fr)`;
      write(el, now.slice(0, rows.length).map(fr), now.slice(rows.length).map(fr));
    };
    set(target());
    let timer = 0;
    const rest = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => { if ([...gliders].some((g) => g())) rest(); else set(target()); }, 300);
    };
    const off = useUI.subscribe((st, prev) => {
      if (st.current === prev.current) return;
      const t = target();
      set(now.map((v, k) => Math.max(v, t[k])));
      rest();
    });
    el.addEventListener('scroll', rest, { capture: true, passive: true });
    return () => { off(); el.removeEventListener('scroll', rest, { capture: true }); clearTimeout(timer); write(el, [], []); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, shrink]);
}

/** Locked panes: each section as long as its longest account, so the panes line up row for row. */
function equalize(el: HTMLElement) {
  const panes = [...el.querySelectorAll<HTMLElement>(':scope > .reader > .rows')].map((r) => [...r.querySelectorAll<HTMLElement>(':scope > section[data-row]:not([hidden])')]);
  if (!panes.length) return;
  // Measuring with the lengths cleared lets a shorter pane's scroll be cut back; put every pane back at the first's.
  const readers = [...el.querySelectorAll<HTMLElement>(':scope > .reader')];
  const top = readers[0]?.scrollTop ?? 0;
  for (const secs of panes) for (const sec of secs) sec.style.minHeight = '';
  const h = panes[0].map(() => 0);
  for (const secs of panes) secs.forEach((sec, i) => { h[i] = Math.max(h[i], sec.getBoundingClientRect().height); }); // exact: whole pixels drift apart
  for (const secs of panes) secs.forEach((sec, i) => { sec.style.minHeight = `${h[i]}px`; });
  for (const r of readers) if (r.scrollTop !== top) r.scrollTop = top;
}

export function Stack({ texts, shown, arrangement }: { texts: Texts | null; shown: Book[]; arrangement: 'stacked' | 'grid' }) {
  const spacing = useUI((s) => s.spacing);
  const reckoning = useUI((s) => s.reckoning);
  const compress = useUI((s) => s.compress);
  const textSize = useUI((s) => s.textSize);
  const notes = useUI((s) => s.notes);
  const locked = useUI((s) => s.paneSync) === 'locked';
  const keepHidden = useUI((s) => !collapseHidden(s.collapse, true));
  stack.locked = locked;
  const ref = useRef<HTMLDivElement>(null);
  // After the panes have rendered and measured (their layout effects run first): even out, or undo, the lengths.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (locked) equalize(el);
    else el.querySelectorAll<HTMLElement>('section[data-row]').forEach((sec) => { sec.style.minHeight = ''; });
  }, [locked, shown, texts, textSize, notes, arrangement]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !locked) { stack.requestEqualize = () => {}; return; }
    let pending = 0;
    stack.requestEqualize = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; equalize(el); for (const k of [...stack.restore.keys()].sort()) stack.restore.get(k)!(); }); };
    return () => { cancelAnimationFrame(pending); stack.requestEqualize = () => {}; };
  }, [locked]);
  // Locked: the panes scroll together. The browser's own scrolling of one pane would run ahead of the others, so a
  // finger (or wheel) on any pane moves them all in the same frame, with a fling of its own; the first pane leads, and
  // the others copy it whenever it moves.
  useEffect(() => {
    const el = ref.current;
    if (!el || !locked) return;
    const panes = () => [...el.querySelectorAll<HTMLElement>(':scope > .reader')];
    const first = panes()[0];
    if (!first) return;
    stack.leader = 0;
    const copy = () => { const t = first.scrollTop; for (const p of panes()) if (p !== first && Math.abs(p.scrollTop - t) >= 1) p.scrollTop = t; };
    const setTop = (t: number) => { first.scrollTop = t; copy(); };
    let fling = 0;
    const stopFling = () => { cancelAnimationFrame(fling); fling = 0; };
    stack.stopFling = stopFling;
    // Each move scrolls on from where the panes are, so a reflow mid-drag (a pane growing back) doesn't throw it off.
    let drag: { id: number; y0: number; y: number; moved: boolean; trail: [number, number][] } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || drag) return;
      stopFling();
      drag = { id: e.pointerId, y0: e.clientY, y: e.clientY, moved: false, trail: [[e.timeStamp, e.clientY]] };
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientY - drag.y0) < 6) return;
      drag.moved = true;
      setTop(first.scrollTop - (e.clientY - drag.y));
      drag.y = e.clientY;
      drag.trail.push([e.timeStamp, e.clientY]);
      while (drag.trail.length > 2 && e.timeStamp - drag.trail[0][0] > 100) drag.trail.shift();
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (!d.moved || e.type === 'pointercancel') return;
      const [t0, y0] = d.trail[0], [t1, y1] = d.trail[d.trail.length - 1];
      let v = t1 > t0 ? -(y1 - y0) / (t1 - t0) : 0; // px per ms, in the scroll's direction
      if (Math.abs(v) < 0.1) return;
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.min(32, now - last);
        last = now;
        v *= Math.pow(0.9975, dt);
        const before = first.scrollTop;
        setTop(before + v * dt);
        fling = Math.abs(v) > 0.02 && first.scrollTop !== before ? requestAnimationFrame(step) : 0;
      };
      fling = requestAnimationFrame(step);
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); stopFling(); setTop(first.scrollTop + e.deltaY); };
    first.addEventListener('scroll', copy, { passive: true });
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    copy();
    return () => {
      stopFling();
      stack.stopFling = () => {};
      first.removeEventListener('scroll', copy);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [locked, shown]);
  // The timeline is laid out from verse counts: all four gospels', unless hidden gospels are collapsed.
  useLayoutEffect(() => {
    const l = computeLayout(keepHidden ? BOOKS : shown, spacing, { reckoning, compress });
    layout.setState((s) => ({ ...l, version: s.version + 1 }));
    playhead.setState((p) => ({ ...p, u: l.starts[p.row] + p.f * (l.ends[p.row] - l.starts[p.row]) }));
  }, [shown, spacing, reckoning, compress, keepHidden]);
  useEffect(() => {
    if (stack.leader >= shown.length) stack.leader = 0;
    // The timeline and search move the leading pane, handing the lead to a pane whose gospel has the row.
    const lead = (i: number) => {
      stack.stopFling();
      if (stack.locked) return stack.panes.get(0); // the panes line up, and the first leads
      if (!ROWS[i]?.refs[shown[stack.leader]]) { const k = shown.findIndex((b) => ROWS[i]?.refs[b]); if (k >= 0) stack.leader = k; }
      return stack.panes.get(stack.leader);
    };
    nav.scrub = (u, dragging) => { const { starts, ends } = layout.getState(); lead(rowAtU(u, starts, ends))?.scrub(u, dragging); };
    nav.toRow = (i) => lead(i)?.toRow(i);
    return () => { nav.scrub = null; nav.toRow = null; };
  }, [shown]);
  // Quadrants: two rows and two columns of panes (three: two above one); stacked: a row each.
  const grid = arrangement === 'grid' && shown.length >= 3;
  const tracks = grid ? 2 : shown.length;
  useShrink(ref, shown,
    grid ? [[0, 1], [2, 3].filter((k) => k < shown.length)] : shown.map((_, k) => [k]),
    grid ? (shown.length === 4 ? [[0, 2], [1, 3]] : [[0], [1]]) : [],
    (el, rows, cols) => { el.style.gridTemplateRows = rows.length ? `auto ${rows.join(' ')}` : ''; el.style.gridTemplateColumns = cols.join(' '); });
  return (
    <div className="stack" ref={ref} data-arrangement={arrangement} data-count={shown.length} data-tracks={tracks} data-locked={locked ? '' : undefined}>
      <StackHead />
      {shown.map((b, k) => <Synopsis key={b} texts={texts} shown={ONE[b]} single compact pane={k} onScreen={shown} />)}
    </div>
  );
}

/** The section at the reading line, once for all the panes. */
function StackHead() {
  const row = ROWS[useUI((s) => s.current)];
  return (
    <p className="stack-head">
      <span className="n" title="Section number in Robertson’s Harmony of the Gospels (1922)">§{row.n}</span>
      <span className="t">{rowTitle(row)}</span>
      <PlaceChip row={row} book={null} />
    </p>
  );
}

export function Synopsis({ texts, shown, single, compact, pane, onScreen = shown }: {
  texts: Texts | null; shown: Book[]; single: boolean; compact: boolean;
  /** Which pane this is, in a stack of them. */
  pane?: number;
  /** Every gospel on screen, in this pane or others. */
  onScreen?: Book[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const spacing = useUI((s) => s.spacing);
  const textSize = useUI((s) => s.textSize);
  const reckoning = useUI((s) => s.reckoning);
  const compress = useUI((s) => s.compress);
  const notes = useUI((s) => s.notes);
  const geo = useRef<Geo>({ tops: [], heights: [], vis: [], origin: 0, span: 1, anchor: 0 });
  const anim = useRef({ target: (() => 0) as () => number, tau: 160, raf: 0, last: 0, lastSet: 0 });
  const spacingRef = useRef(spacing);
  spacingRef.current = spacing;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const compactRef = useRef(compact);
  compactRef.current = compact;
  // All four gospels lay the timeline out unless hidden gospels are collapsed (Timeline settings).
  const keepHidden = useUI((s) => !collapseHidden(s.collapse, compact));
  const allFourRef = useRef(keepHidden);
  allFourRef.current = keepHidden;
  const leads = () => paneRef.current === undefined || stack.leader === paneRef.current;

  // Every spacing maps the same way: a row's share of its timeline span = its share of its height.
  const update = useCallback(() => {
    const s = scrollRef.current, g = geo.current;
    if (!s || !g.vis.length || !leads()) return;
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
    // A pane reads at the line it would have at its full share of the stack, so a pane shrinking or growing (see
    // Stack) doesn't move its text, and every pane reads at the same line.
    let h = s.clientHeight;
    const st = s.parentElement;
    if (paneRef.current !== undefined && st?.dataset.tracks) h = (st.clientHeight - (st.firstElementChild as HTMLElement).offsetHeight) / Number(st.dataset.tracks);
    geo.current = { tops, heights, vis, origin, span, anchor: headH + (h - headH) * 0.22 };
    if (paneRef.current !== undefined) return; // a stack lays out the timeline itself
    // Keeping hidden gospels (phones' default), the timeline is laid out from the verse counts of all four gospels, so
    // a hidden gospel's own sections keep their place on it (the needle skips them); otherwise the Text timeline is a
    // map of the page as shown.
    if (spacingRef.current === 'text' && !allFourRef.current) {
      const starts = new Array<number>(n), ends = new Array<number>(n);
      for (let i = 0; i < n; i++) { starts[i] = (tops[i] - origin) / span; ends[i] = starts[i] + heights[i] / span; }
      layout.setState((l) => ({ starts, ends, years: null, version: l.version + 1 }));
    } else {
      const { reckoning: r, compress: c } = useUI.getState();
      const model = computeLayout(allFourRef.current ? BOOKS : shownRef.current, spacingRef.current, { reckoning: r, compress: c });
      layout.setState((l) => ({ ...model, version: l.version + 1 }));
    }
  }, []);

  const animateTo = useCallback((aim: () => number, tau: number) => {
    const s = scrollRef.current;
    if (!s) return;
    // The target is worked out again each frame, so text reflowing on the way (a pane resizing) doesn't leave it stale.
    const at = () => clamp(aim(), 0, s.scrollHeight - s.clientHeight);
    const target = at();
    if (reduceMotion()) { s.scrollTop = target; return; }
    const a = anim.current;
    a.target = at; a.tau = tau;
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
      const target = a.target();
      let nextTop = cur + (target - cur) * (1 - Math.exp(-dt / a.tau));
      if (Math.abs(nextTop - cur) < 1) nextTop = cur + Math.sign(target - cur);
      if (Math.abs(target - nextTop) < 2) { s.scrollTop = target; a.raf = 0; return; }
      s.scrollTop = nextTop;
      a.lastSet = s.scrollTop;
      a.raf = requestAnimationFrame(step);
    };
    a.raf = requestAnimationFrame(step);
  }, []);
  useEffect(() => {
    const g = () => anim.current.raf !== 0;
    gliders.add(g);
    return () => { gliders.delete(g); };
  }, []);
  // Side by side on a phone: a gospel's column narrows where it lacks the section.
  useShrink(scrollRef, shown, [], compact && pane === undefined && shown.length > 1 ? shown.map((_, k) => [k]) : [],
    (el, _rows, cols) => { if (cols.length) el.style.setProperty('--cols', cols.join(' ')); else el.style.removeProperty('--cols'); });
  const cancelAnim = useCallback(() => { if (anim.current.raf) { cancelAnimationFrame(anim.current.raf); anim.current.raf = 0; } }, []);

  // Commands for the timeline and search (in a stack, the stack passes them to the leading pane).
  useEffect(() => {
    const cmd = { scrub: (u: number, dragging: boolean) => {
      const g = geo.current;
      const { starts, ends } = layout.getState();
      if (!g.vis.length || !starts.length) return;
      let i = rowAtU(u, starts, ends);
      if (!(g.heights[i] > 0)) i = g.vis.find((v) => v >= i) ?? g.vis[g.vis.length - 1]; // a row these gospels don't have
      const width = ends[i] - starts[i];
      const f = width > 0 ? clamp((u - starts[i]) / width, 0, 1) : 0;
      animateTo(() => { const g = geo.current; return g.tops[i] + f * g.heights[i] - g.anchor; }, dragging ? 55 : 150);
    }, toRow: (i: number) => {
      animateTo(() => geo.current.tops[i] - (headRef.current?.offsetHeight ?? 0) - 4, 170);
    } };
    if (pane !== undefined) {
      stack.panes.set(pane, cmd);
      return () => { if (stack.panes.get(pane) === cmd) stack.panes.delete(pane); };
    }
    nav.scrub = cmd.scrub;
    nav.toRow = cmd.toRow;
    return () => { nav.scrub = null; nav.toRow = null; };
  }, [animateTo, pane]);

  // A pane that doesn't lead follows the reading position: the same place in the same row, or where the next row
  // its gospel has begins.
  useEffect(() => {
    if (pane === undefined) return;
    return playhead.subscribe(({ row, f }) => {
      const s = scrollRef.current, g = geo.current;
      if (!s || !g.vis.length || leads() || stack.locked) return;
      cancelAnim();
      s.scrollTop = g.tops[row] + (g.heights[row] > 0 ? f * g.heights[row] : 0) - g.anchor;
    });
  }, [pane, cancelAnim]);

  // Re-measure when anything that changes heights changes, keeping the reading position. Until the text has come, the
  // reader opens with the starting section's heading at the top.
  const opening = useRef(!opened);
  useLayoutEffect(() => {
    const { row, f } = playhead.getState();
    measure();
    const g = geo.current, s = scrollRef.current;
    if (s && g.vis.length && opening.current && g.heights[START_ROW] > 0) {
      s.scrollTop = g.tops[START_ROW] - (headRef.current?.offsetHeight ?? 0) - 4;
      if (texts) { opening.current = false; opened = true; }
    } else if (s && g.vis.length && (row > 0 || f > 0)) {
      const i = g.heights[row] > 0 ? row : g.vis.find((v) => v >= row) ?? g.vis[g.vis.length - 1];
      s.scrollTop = g.tops[i] + (i === row ? f : 0) * g.heights[i] - g.anchor;
    }
    update();
  }, [shown, texts, textSize, notes, spacing, reckoning, compress, compact, keepHidden, measure, update]);

  useEffect(() => {
    const s = scrollRef.current, wrap = rowsRef.current;
    if (!s || !wrap) return;
    let ticking = false;
    // In a stack the others follow at once (a frame's wait shows as lag); a lone reader waits for the frame.
    const onScroll = () => {
      if (paneRef.current !== undefined) { update(); return; }
      if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); }
    };
    let pending = 0;
    // Text reflows (fonts arriving, a resize): keep the same place in the same row.
    const restore = () => {
      const atTop = s.scrollTop <= 2;
      const { row, f } = playhead.getState();
      measure();
      if (anim.current.raf) return; // a glide on its way aims afresh at each frame, and its scrolling reads the position
      const g = geo.current;
      if (!atTop) s.scrollTop = g.tops[row] + f * g.heights[row] - g.anchor;
      update();
    };
    // Locked panes measured before their lengths are even again would move the reading position: after a reflow (a
    // change of width, or of the text; not a pane shrinking in height) they wait for that, and it brings them back.
    const remeasure = () => {
      const wait = paneRef.current !== undefined && stack.locked && reflow;
      reflow = false;
      if (wait) stack.requestEqualize();
      else restore();
    };
    if (paneRef.current !== undefined) stack.restore.set(paneRef.current, restore);
    let reflow = true, width = s.clientWidth;
    const ro = new ResizeObserver((entries) => {
      if (entries.some((e) => e.target === wrap) || s.clientWidth !== width) reflow = true;
      width = s.clientWidth;
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
    // Touching a pane stops any easing and, in a stack, gives it the lead.
    const touched = () => { cancelAnim(); if (paneRef.current !== undefined && !stack.locked) stack.leader = paneRef.current; };
    for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) s.addEventListener(ev, touched, { passive: true });
    return () => {
      if (paneRef.current !== undefined && stack.restore.get(paneRef.current) === restore) stack.restore.delete(paneRef.current);
      ro.disconnect();
      window.removeEventListener('jt-drag-end', remeasure);
      s.removeEventListener('scroll', onScroll);
      for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) s.removeEventListener(ev, touched);
    };
  }, [measure, update, cancelAnim]);

  const cols = { gridTemplateColumns: `var(--cols, repeat(${shown.length}, minmax(0, 1fr)))` };
  let lastPart = '';
  let lastGap = false;
  return (
    <div className="reader" ref={scrollRef} tabIndex={-1} aria-label={pane === undefined ? 'The gospel accounts, aligned by event' : BOOK_NAME[shown[0]]} data-cols={shown.length}>
      <div className="cols-head" ref={headRef} style={cols}>
        {shown.map((b) => <ColumnHead key={b} book={b} short={compact && shown.length > 1} />)}
      </div>
      <div className="rows" ref={rowsRef}>
        {ROWS.map((row) => {
          const visible = shown.some((b) => row.refs[b]);
          // In a pane, a section only the other panes' gospels have is a short hatched strip, so this pane scrolls on
          // through it smoothly while the others read it.
          if (!visible && pane !== undefined && onScreen.some((b) => row.refs[b])) {
            const first = !lastGap;
            lastGap = true;
            return <section key={row.id} className="row gap" data-row={row.i} style={gospelVar(shown[0])}>{first && <span>Not in {BOOK_NAME[shown[0]]}</span>}</section>;
          }
          if (visible) lastGap = false;
          const partStart = visible && row.part !== lastPart;
          if (visible) lastPart = row.part;
          return <RowView key={row.id} row={row} shown={shown} onScreen={onScreen} texts={texts} hidden={!visible} partStart={partStart} single={single} compact={compact} notes={notes} idSuffix={pane ? `-${pane}` : ''} />;
        })}
      </div>
      <div className="reader-end" aria-hidden="true" />
      <NotePopover host={scrollRef} />
    </div>
  );
}

/** The chapter of a gospel at or before a row. */
function chapterAt(book: Book, row: number): number | null {
  for (let i = row; i >= 0; i--) { const r = ROWS[i].refs[book]; if (r) return r[r.length - 1][2]; }
  return null;
}

function ColumnHead({ book, short }: { book: Book; short: boolean }) {
  // Renders again only when the chapter changes, not at every section.
  const chapter = useUI((s) => chapterAt(book, s.current));
  // An × at the right hides the gospel, as its chip does (at least one panel stays on screen).
  const canHide = useUI((s) => s.visible.length > 1 || s.map);
  return (
    <div className="col-h" style={gospelVar(book)}>
      <span className="dot" aria-hidden="true" />
      <span className="col-name" title={short ? BOOK_NAME[book] : undefined}>{short ? BOOK_ABBR[book] : BOOK_NAME[book]}</span>
      {chapter !== null && <span className="col-ch">{chapter}</span>}
      {canHide && (
        <button
          type="button" className="col-off" aria-label={`Hide ${BOOK_NAME[book]}`} title={`Hide ${BOOK_NAME[book]}`}
          onClick={() => { const ui = useUI.getState(); if (ui.phoneGospels === 'one' && ui.map) ui.showOnlyMap(); else ui.toggleBook(book); }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
        </button>
      )}
    </div>
  );
}

const RowView = memo(function RowView({ row, shown, onScreen, texts, hidden, partStart, single, compact, notes, idSuffix }: {
  row: Row; shown: Book[]; onScreen: Book[]; texts: Texts | null; hidden: boolean; partStart: boolean; single: boolean; compact: boolean; notes: NotesShown;
  /** Keeps ids unique when the gospels are in panes of their own. */
  idSuffix: string;
}) {
  if (hidden) return <section data-row={row.i} hidden />;
  const others = single ? BOOKS.filter((b) => row.refs[b] && !onScreen.includes(b)) : [];
  const setSingle = useUI.getState().setSingle;
  const meta = (
    <div className="row-meta">
      <PlaceChip row={row} book={single ? shown[0] : null} />
      {row.feast && <span className="chip feast" title={`${row.feast.ref}: “${row.feast.words}”`}>{row.feast.name} · {row.feast.ref}</span>}
      {row.other.map((o) => <span className="chip" key={o}>{o}</span>)}
      {others.length > 0 && (
        <span className="also">Also in{others.map((b) => (
          <button type="button" key={b} style={gospelVar(b)} onClick={() => setSingle(b)} aria-label={`Read ${BOOK_NAME[b]} here`}>{BOOK_ABBR[b]}</button>
        ))}</span>
      )}
    </div>
  );
  // Phones keep only the heading pinned while the section scrolls; its chips scroll away with the text.
  return (
    <section className="row" data-row={row.i} id={`row-${row.id}${idSuffix}`} aria-labelledby={`h-${row.id}${idSuffix}`}>
      {partStart && <div className="part-div"><span>{row.partTitle}</span></div>}
      <header className="row-head">
        <p className="kicker">
          <span className="n" title="Section number in Robertson’s Harmony of the Gospels (1922)">§{row.n}</span>
          {row.subTitle && <span>{row.sectionTitle} · {row.subIndex + 1} of {row.subCount}</span>}
        </p>
        <h3 id={`h-${row.id}${idSuffix}`}>{row.subTitle ?? row.sectionTitle}</h3>
        {!compact && meta}
      </header>
      {compact && meta}
      {row.moved && row.subIndex === 0 && <p className="row-note">{row.moved}</p>}
      <div className="cells" style={{ gridTemplateColumns: `var(--cols, repeat(${shown.length}, minmax(0, 1fr)))` }}>
        {shown.map((b) => <Cell key={b} row={row} book={b} texts={texts} labelEmpty={shown.length > 1} notesShown={notes} />)}
      </div>
    </section>
  );
});

function Cell({ row, book, texts, labelEmpty, notesShown }: { row: Row; book: Book; texts: Texts | null; labelEmpty: boolean; notesShown: NotesShown }) {
  const ranges = row.refs[book];
  if (!ranges) return <div className="cell empty" style={gospelVar(book)}>{labelEmpty && <span>Not in {BOOK_NAME[book]}</span>}</div>;
  const blocks = texts ? versesOf(texts[book], ranges) : null;
  const pos = (c: number, v: number) => c * 1000 + v;
  const note = TEXT_NOTES.find((n) => n.book === book && ranges.some(([c1, v1, c2, v2]) => pos(c1, v1) <= pos(...n.to) && pos(c2, v2) >= pos(...n.from)));
  const repeats = row.repeats[book];
  let letters = 0;
  const next = () => letters++;
  return (
    <div className="cell" data-book={book} style={gospelVar(book)}>
      <p className="cell-ref">{fmtRef(book, ranges)}</p>
      {row.outOfOrder[book] && <p className="cell-note order">{row.outOfOrder[book]}</p>}
      {note && <p className="cell-note textual">{note.note}</p>}
      {blocks ? blocks.map((verses, k) => (
        <p className="passage" key={k}>
          {verses.map((v) => {
            const again = repeats?.[`${v.c}:${v.v}`];
            const pars = again ? undefined : PARALLELS.get(`${book} ${v.c}:${v.v}`);
            return (
              <span key={`${v.c}:${v.v}`} data-cv={`${v.c}:${v.v}`} className={again ? 'v again' : 'v'} title={again ? `This verse also appears in §${again}; Robertson divides it between sections.` : undefined}>
                {v.label ? <b className="vl">{v.c}:{v.v}</b> : <sup className="vn">{v.v}</sup>}
                {pars?.map((p) => (
                  <button
                    type="button" key={p.ref} className="par" style={gospelVar(p.book)} onClick={() => showVerse(p.book, p.c, p.v)}
                    title={`Similar passage: ${p.ref}, §${ROWS[p.row].n} ${rowTitle(ROWS[p.row])}. Some synopses print the two side by side; Robertson’s harmony places them on different occasions.`}
                  >≈ {p.ref}</button>
                ))}
                <VerseText book={book} c={v.c} v={v.v} text={v.t} shown={notesShown} next={next} />
              </span>
            );
          })}
        </p>
      )) : <p className="passage loading" aria-busy="true">Loading {BOOK_NAME[book]}…</p>}
    </div>
  );
}
