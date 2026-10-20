import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { rowAtU } from './layoutModel';
import { BOOKS, BOOK_NAME, PARTS, RECKONING_NAME, ROWS, deadAt, fmtRef, fmtYear, lightAt, lightBreaks, rowTitle, type Book, type LightState } from './model';
import { PlaceChip } from './places';
import { layout, nav, placeMarks, playhead, useUI } from './state';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MAX_ZOOM = 90;

// Swatches for the light strip, matching the dynamic tints in app.css.
const TINT: Record<LightState | 'dead', string> = {
  unstated: 'transparent', predawn: '#AEB9C6', dawn: '#E9B79F', day: '#E6D29A', midday: '#F2EAD2',
  evening: '#D9A45E', night: '#59607A', darkness: '#2B2A28', dead: '#8A949C',
};

/** lightY null: no light strip (phones, to save room). */
/** feastY null: no feast marks (phones). rulerTop: the years along the top strip, where the needle's head runs, and no
 *  section names (titlesY is then the years' baseline). */
interface Geometry { h: number; partsH: number; feastY: number | null; lanesTop: number; laneH: number; laneGap: number; titlesY: number | null; lightY: number | null; miniY: number; font: number; rulerTop?: boolean }
const DESKTOP: Geometry = { h: 104, partsH: 18, feastY: 20, lanesTop: 24, laneH: 10, laneGap: 3, titlesY: 88, lightY: 95, miniY: 100, font: 11 };
const COMPACT: Geometry = { h: 67, partsH: 14, feastY: null, lanesTop: 19, laneH: 7, laneGap: 2, titlesY: 62, lightY: null, miniY: 64, font: 10 };
/** Phones with the controls beside the timeline: room for each gospel's chip beside its lane (CHIP_H tall), and no
 *  phase bands or section names (partsH 0); on the Time scale, the years along the top. */
const COMPACT_SIDE: Geometry = { h: 107, partsH: 0, feastY: null, lanesTop: 13, laneH: 12, laneGap: 13, titlesY: 10, lightY: null, miniY: 104, font: 10, rulerTop: true };
/** The same with the phases and feasts on (Timeline settings): the phase bands on top, the feasts under them, then the
 *  years on the Time scale. */
function sideGeometry(phases: boolean, chrono: boolean): Geometry {
  if (!phases) return COMPACT_SIDE;
  const lanesTop = chrono ? 34 : 22;
  return { ...COMPACT_SIDE, partsH: 13, feastY: 17, titlesY: 31, lanesTop, miniY: lanesTop + 91, h: lanesTop + 94 };
}
const CHIP_H = 22;
/** Touch: how far a finger moves before it counts as a drag, and how close to the needle a drag must start to move it. */
const TOUCH_SLOP = 6, NEEDLE_REACH = 26;

interface Colours { raised: string; sunk: string; paper: string; ink: string; soft: string; faint: string; line: string; glow: string; glowInk: string; gospel: Record<Book, string>; uiFont: string; monoFont: string }
function readColours(el: Element): Colours {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    raised: v('--paper-raised'), sunk: v('--paper-sunk'), paper: v('--paper'), ink: v('--ink'), soft: v('--ink-soft'), faint: v('--ink-faint'),
    line: v('--line'), glow: v('--glow'), glowInk: v('--glow-ink'),
    gospel: { MAT: v('--gospel-mat'), MRK: v('--gospel-mrk'), LUK: v('--gospel-luk'), JHN: v('--gospel-jhn') },
    uiFont: v('--font-ui') || 'system-ui', monoFont: v('--font-mono') || 'monospace',
  };
}
/** The page's light colours ease in over --light-duration (the minifier writes it as `.9s`), in ms. */
function lightDuration(): number {
  const dur = getComputedStyle(document.body).getPropertyValue('--light-duration').trim(), n = parseFloat(dur);
  return Number.isNaN(n) ? 900 : dur.endsWith('ms') ? n : n * 1000;
}
type LightPiece = { from: number; to: number; colour: string };
/** Each row's light strip for the given gospels, as pieces 0–1 through the row (from the verse counts). */
function lightPieces(shown: Book[]): (LightPiece[] | null)[] {
  return ROWS.map((row) => {
    const breaks = lightBreaks(row, shown), out: LightPiece[] = [];
    breaks.forEach((b, k) => {
      const state = deadAt(row, shown, b) ? 'dead' : lightAt(row, shown, b);
      if (state !== 'unstated') out.push({ from: b, to: breaks[k + 1] ?? 1, colour: TINT[state] });
    });
    return out.length ? out : null;
  });
}

function rowAt(u: number): number {
  const { starts, ends } = layout.getState();
  return rowAtU(u, starts, ends);
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid; else hi = mid - 1; }
  return lo > 2 ? `${text.slice(0, lo)}…` : '';
}

/** The timeline's scale: by length of text, or estimated years. */
export function ScaleSwitch() {
  const spacing = useUI((s) => s.spacing);
  const setSpacing = useUI((s) => s.setSpacing);
  return (
    <div className="timeline-scale" role="group" aria-label="Timeline scale">
      <button type="button" aria-pressed={spacing !== 'chrono'} onClick={() => setSpacing('text')} title="By length of text: the timeline works like a map of the page">Text</button>
      <button type="button" aria-pressed={spacing === 'chrono'} onClick={() => setSpacing('chrono')} title="Chronological: estimated historical years (AD 30 or AD 33 reckoning in Settings)">Time</button>
    </div>
  );
}

export function Timeline({ shown, compact, side }: {
  shown: Book[]; compact: boolean;
  /** Phones: controls beside the timeline (left, by the lanes; right, the tools) in place of the toolbar. */
  side?: { left: ReactNode; right: ReactNode };
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phases = useUI((s) => s.phases);
  const chrono = useUI((s) => s.spacing) === 'chrono';
  const hasSide = !!side;
  const geom = useMemo(() => (hasSide ? sideGeometry(phases, chrono) : compact ? COMPACT : DESKTOP), [hasSide, phases, chrono, compact]);
  const view = useRef({ k: 1, o: 0, w: 0 });
  const io = useRef({
    hoverU: null as number | null, dragU: null as number | null, pointers: new Map<number, number>(), pinch: null as null | { d: number; k: number; u: number }, lastManual: 0,
    // A finger on the timeline: undecided until it moves or lifts; then it drags the needle, pans the zoomed view, or
    // (once a pinch has ended under it) does nothing.
    touch: null as null | { id: number; x0: number; o0: number; onNeedle: boolean; mode: 'pending' | 'scrub' | 'pan' | 'none'; trail: [number, number][] },
    /** A pan's short glide after the finger lifts. */
    glide: 0,
  });
  const [tip, setTip] = useState<{ x: number; row: number } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const appearance = useUI((s) => s.appearance);
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const raf = useRef(0);
  // Colours are read from the page only while the light is changing (and on a change of appearance), not every frame.
  const colours = useRef<Colours | null>(null);
  const light = useRef<{ shown: Book[]; pieces: (LightPiece[] | null)[] } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const { k, o, w } = view.current;
    const g = geom, dpr = Math.min(2, window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');
    if (!ctx || !w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, g.h);
    const col = colours.current ??= readColours(wrap);
    const { gospel, uiFont, monoFont } = col;
    const onBar = appearanceRef.current === 'dark' ? col.paper : '#FFFFFF';
    const { starts, ends, years } = layout.getState();
    if (!starts.length) return;
    const X = (u: number) => (u - o) * k * w;
    const shownSet = new Set(shownRef.current);
    let font = '';
    const setFont = (f: string) => { if (f !== font) { ctx.font = f; font = f; } };

    // Part bands (none beside the side controls).
    ctx.textBaseline = 'alphabetic';
    if (g.partsH) PARTS.forEach((p, idx) => {
      const x0 = X(starts[p.first]), x1 = X(ends[p.last]);
      if (x1 < 0 || x0 > w || x1 - x0 < 0.5) return;
      ctx.fillStyle = idx % 2 ? col.sunk : col.raised;
      ctx.fillRect(x0, 0, x1 - x0, g.partsH);
      ctx.fillStyle = col.line;
      ctx.fillRect(Math.round(x0), 0, 1, g.h);
      setFont(`600 ${g.font}px ${uiFont}`);
      const left = Math.max(x0, 0) + 5, room = Math.min(x1, w) - left - 4;
      const label = ellipsize(ctx, p.title, room);
      if (label) { ctx.fillStyle = col.soft; ctx.fillText(label, left, g.partsH - 5); }
    });

    // Gospel lanes.
    BOOKS.forEach((_, li) => {
      const y = g.lanesTop + li * (g.laneH + g.laneGap);
      ctx.fillStyle = col.line;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, y + g.laneH / 2, w, 1);
      ctx.globalAlpha = 1;
    });
    for (let i = 0; i < ROWS.length; i++) {
      const s = starts[i], e = ends[i];
      if (e <= s) continue;
      const x0 = X(s), x1 = X(e);
      if (x1 < -2 || x0 > w + 2) continue;
      const width = x1 - x0, gap = width > 4 ? 1 : 0;
      const row = ROWS[i];
      // Phones beside the side controls: the first open gospel's bar also names the section, where there's room.
      const titled = g.rulerTop ? BOOKS.find((b) => row.refs[b] && shownSet.has(b)) : undefined;
      BOOKS.forEach((b, li) => {
        const ranges = row.refs[b];
        if (!ranges) return;
        const y = g.lanesTop + li * (g.laneH + g.laneGap);
        ctx.globalAlpha = shownSet.has(b) ? 1 : 0.2;
        ctx.fillStyle = gospel[b];
        ctx.fillRect(x0, y, Math.max(1, width - gap), g.laneH);
        ctx.globalAlpha = 1;
        // References on the bars where they fit (lanes too thin for text on phones with the toolbar on top).
        if ((!compact || g.rulerTop) && shownSet.has(b) && width > 24) {
          const [c, vv] = ranges[0];
          const label = width > 62 ? `${c}:${vv}` : `${c}`;
          setFont(`600 ${g.laneH - 1}px ${monoFont}`);
          const lw = ctx.measureText(label).width;
          if (lw < width - 5) {
            ctx.fillStyle = onBar;
            ctx.fillText(label, x0 + 3, y + g.laneH - 1.5);
            if (b === titled && width - lw > 60) {
              setFont(`500 ${g.laneH - 1}px ${uiFont}`);
              const t = ellipsize(ctx, rowTitle(row), width - lw - 13);
              if (t) ctx.fillText(t, x0 + lw + 8, y + g.laneH - 1.5);
            }
          }
        }
      });
      if (row.feast && g.feastY !== null) {
        ctx.fillStyle = col.glowInk;
        ctx.beginPath();
        ctx.moveTo(x0, g.feastY - 3); ctx.lineTo(x0 + 3, g.feastY); ctx.lineTo(x0, g.feastY + 3); ctx.lineTo(x0 - 3, g.feastY);
        ctx.closePath(); ctx.fill();
      }
      if (g.titlesY !== null && !g.rulerTop && !years && width > 72) {
        setFont(`${g.font}px ${uiFont}`);
        const t = ellipsize(ctx, `§${row.n} ${rowTitle(row)}`, width - 8);
        if (t) { ctx.fillStyle = col.soft; ctx.fillText(t, x0 + 4, g.titlesY); }
      }
    }

    // Chronological spacing: a year ruler, with compressed silences hatched as breaks.
    if (years && g.titlesY !== null) {
      const lanesH = 4 * (g.laneH + g.laneGap);
      ctx.strokeStyle = col.line;
      ctx.lineWidth = 1;
      for (const [a, b] of years.breaks) {
        const x0 = X(a), x1 = X(b);
        if (x1 < 0 || x0 > w) continue;
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, g.lanesTop, x1 - x0, lanesH); ctx.clip();
        for (let x = x0 - lanesH; x < x1 + lanesH; x += 5) { ctx.beginPath(); ctx.moveTo(x, g.lanesTop + lanesH); ctx.lineTo(x + lanesH, g.lanesTop); ctx.stroke(); }
        ctx.restore();
      }
      const inBreak = (u: number) => years.breaks.some(([a, b]) => u > a + 1e-9 && u < b - 1e-9);
      setFont(`${g.font}px ${monoFont}`);
      ctx.fillStyle = col.soft;
      let lastX = -Infinity;
      for (let y = Math.ceil(years.first); y <= Math.floor(years.last); y++) {
        const u = years.toU(y);
        const x = X(u);
        if (inBreak(u) || x < -30 || x > w + 30 || x - lastX < (compact ? 40 : 54)) continue;
        if (g.rulerTop) ctx.fillRect(Math.round(x), g.titlesY - 9, 1, 10);
        else ctx.fillRect(Math.round(x), g.titlesY - 11, 1, 4);
        ctx.fillText(fmtYear(y), x + 3, g.titlesY); // the label names the year that starts at the tick
        lastX = x;
      }
    }

    // Light strip — only in the dynamic colour mode, and not on phones.
    if (appearanceRef.current === 'dynamic' && g.lightY !== null) {
      const lightY = g.lightY;
      // A row whose light changes part-way is drawn in pieces, from the verse counts (worked out once per set of gospels).
      if (light.current?.shown !== shownRef.current) light.current = { shown: shownRef.current, pieces: lightPieces(shownRef.current) };
      const pieces = light.current.pieces;
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < ROWS.length; i++) {
        const s = starts[i], e = ends[i], ps = pieces[i];
        if (!ps || e <= s) continue;
        if (X(e) < 0 || X(s) > w) continue;
        for (const p of ps) {
          const x0 = X(s + p.from * (e - s)), x1 = X(s + p.to * (e - s));
          ctx.fillStyle = p.colour;
          ctx.fillRect(x0, lightY, Math.max(1, x1 - x0), 3);
        }
      }
      ctx.globalAlpha = 1;
    }

    // The stories set at the place whose popup is open on the map: a pin above each, a line down through the lanes
    // and a bar under them spanning the story.
    const marks = placeMarks.getState().rows;
    if (marks.length) {
      const lanesBottom = g.lanesTop + 4 * (g.laneH + g.laneGap) - g.laneGap;
      ctx.fillStyle = col.ink;
      for (const i of marks) {
        let j = i;
        while (j + 1 < ROWS.length && ROWS[j + 1].sectionId === ROWS[i].sectionId) j++;
        const s = starts[i], e = ends[j];
        if (e <= s) continue;
        const x0 = X(s), x1 = X(e), xm = (x0 + x1) / 2;
        if (x1 < -6 || x0 > w + 6) continue;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(Math.round(xm), 9, 1, lanesBottom - 9);
        ctx.fillRect(x0, lanesBottom + 2, Math.max(2, x1 - x0), 2);
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(xm + 0.5, 5, 3.5, Math.PI * 0.85, Math.PI * 0.15);
        ctx.lineTo(xm + 0.5, 11.5);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Overview of the visible window when zoomed.
    if (k > 1.001) {
      ctx.fillStyle = col.line;
      ctx.fillRect(0, g.miniY, w, 2);
      ctx.fillStyle = col.soft;
      ctx.fillRect(o * w, g.miniY - 0.5, Math.max(6, w / k), 3);
    }

    const hover = io.current.hoverU;
    if (hover !== null && io.current.dragU === null) {
      ctx.fillStyle = col.faint;
      for (let y = 0; y < g.h; y += 4) ctx.fillRect(Math.round(X(hover)), y, 1, 2);
    }

    const pu = io.current.dragU ?? playhead.getState().u;
    const px = X(pu);
    if (px >= -6 && px <= w + 6) {
      ctx.fillStyle = col.ink;
      ctx.fillRect(Math.round(px) - 1, 6, 2, g.h - 6);
      ctx.fillStyle = col.glow;
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.arc(px, 6, 8, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col.glowInk;
      ctx.beginPath(); ctx.arc(px, 6, 4.5, 0, Math.PI * 2); ctx.fill();
    }
  }, [geom, compact]);

  const requestDraw = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; draw(); });
  }, [draw]);

  const setView = useCallback((k: number, o: number) => {
    k = clamp(k, 1, MAX_ZOOM);
    view.current.k = k;
    view.current.o = clamp(o, 0, 1 - 1 / k);
    setZoomed(k > 1.001);
    requestDraw();
  }, [requestDraw]);

  const zoomAt = useCallback((u: number, factor: number) => {
    const { k, o } = view.current;
    const nk = clamp(k * factor, 1, MAX_ZOOM);
    setView(nk, u - (u - o) * (k / nk));
  }, [setView]);

  const uAt = (clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { k, o } = view.current;
    return clamp(o + (clientX - rect.left) / rect.width / k, 0, 1);
  };

  // Size the canvas to its box.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const w = canvas.parentElement!.clientWidth;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      view.current.w = w;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(geom.h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${geom.h}px`;
      draw();
    });
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, [draw, geom.h]);

  // Follow the reader: redraw, and keep the playhead in view while zoomed.
  useEffect(() => {
    const unPlay = playhead.subscribe(({ u }) => {
      const { k, o } = view.current, now = performance.now();
      if (k > 1.001 && io.current.dragU === null && now - io.current.lastManual > 1500 && (u < o + 0.06 / k || u > o + 0.94 / k)) {
        view.current.o = clamp(u - 0.35 / k, 0, 1 - 1 / k);
      }
      requestDraw();
    });
    const unLayout = layout.subscribe(requestDraw);
    const unMarks = placeMarks.subscribe(requestDraw);
    return () => { unPlay(); unLayout(); unMarks(); };
  }, [requestDraw]);

  // Colours change with the light: read them and redraw each frame for the length of the transition (--light-duration),
  // then keep the settled colours until the light changes again.
  useEffect(() => {
    let until = 0, id = 0;
    const tick = () => {
      colours.current = null;
      draw();
      id = performance.now() < until ? requestAnimationFrame(tick) : 0;
    };
    const start = () => { cancelAnimationFrame(id); until = performance.now() + lightDuration() + 60; tick(); };
    const mo = new MutationObserver(start);
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-light', 'data-tint'] });
    start();
    return () => { mo.disconnect(); cancelAnimationFrame(id); };
  }, [draw, appearance]);
  // A different set of gospels changes the lanes' emphasis and the light strip.
  useEffect(() => { requestDraw(); }, [shown, requestDraw]);

  // Wheel zooms around the cursor; sideways scroll (or Shift) pans. Needs a non-passive listener.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      io.current.lastManual = performance.now();
      const { k, o } = view.current;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / view.current.w / k;
        setView(k, o + d);
      } else {
        zoomAt(uAt(e.clientX), Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)));
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [setView, zoomAt]);

  // A row none of the gospels on screen has can't be picked: the needle skips to the nearest story that can.
  const available = (i: number) => shownRef.current.some((b) => ROWS[i].refs[b]);
  const snapU = (u: number) => {
    const { starts, ends } = layout.getState();
    if (!starts.length) return u;
    const ok = (i: number) => ends[i] > starts[i] && available(i);
    const i = rowAtU(u, starts, ends);
    if (ok(i)) return u;
    let a = i - 1, b = i + 1;
    while (a >= 0 && !ok(a)) a--;
    while (b < ROWS.length && !ok(b)) b++;
    const da = a >= 0 ? u - ends[a] : Infinity, db = b < ROWS.length ? starts[b] - u : Infinity;
    if (da === Infinity && db === Infinity) return u;
    return da <= db ? ends[a] - (ends[a] - starts[a]) * 0.001 : starts[b];
  };
  const scrub = (u: number, dragging: boolean) => {
    u = snapU(u);
    io.current.dragU = dragging ? u : null;
    nav.scrub?.(u, dragging);
    requestDraw();
  };

  // Touch: a tap moves the needle there; a drag that starts on the needle moves it; any other drag pans the zoomed view
  // (or, with nothing to pan, moves the needle); two fingers zoom without moving it.
  // After a pan, the view glides on a little and stops quickly.
  const glide = (trail: [number, number][]) => {
    const [t0, x0] = trail[0], [t1, x1] = trail[trail.length - 1];
    let v = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0; // px per ms
    if (Math.abs(v) < 0.15) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(32, now - last), { k, o, w } = view.current;
      last = now;
      v *= Math.pow(0.99, dt);
      io.current.lastManual = now;
      setView(k, o - (v * dt) / w / k);
      io.current.glide = Math.abs(v) > 0.03 && view.current.o !== o ? requestAnimationFrame(step) : 0;
    };
    io.current.glide = requestAnimationFrame(step);
  };
  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelAnimationFrame(io.current.glide);
    io.current.glide = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = io.current;
    p.pointers.set(e.pointerId, e.clientX);
    if (p.pointers.size === 2) {
      const [a, b] = [...p.pointers.values()];
      p.pinch = { d: Math.abs(a - b) || 1, k: view.current.k, u: uAt((a + b) / 2) };
      if (p.dragU !== null) scrub(p.dragU, false);
      if (p.touch) p.touch.mode = 'none';
      return;
    }
    setTip(null);
    if (e.pointerType === 'touch') {
      const rect = canvasRef.current!.getBoundingClientRect(), { k, o, w } = view.current;
      const needleX = (playhead.getState().u - o) * k * w;
      p.touch = { id: e.pointerId, x0: e.clientX, o0: o, onNeedle: Math.abs(e.clientX - rect.left - needleX) <= NEEDLE_REACH, mode: 'pending', trail: [[e.timeStamp, e.clientX]] };
      return;
    }
    scrub(uAt(e.clientX), true);
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = io.current;
    if (p.pointers.has(e.pointerId)) p.pointers.set(e.pointerId, e.clientX);
    if (p.pinch && p.pointers.size === 2) {
      const [a, b] = [...p.pointers.values()];
      const nk = clamp(p.pinch.k * (Math.abs(a - b) || 1) / p.pinch.d, 1, MAX_ZOOM);
      const rect = canvasRef.current!.getBoundingClientRect();
      const mid = ((a + b) / 2 - rect.left) / rect.width;
      p.lastManual = performance.now();
      setView(nk, p.pinch.u - mid / nk);
      return;
    }
    const t = p.touch;
    if (t && t.id === e.pointerId) {
      if (t.mode === 'pending' && Math.abs(e.clientX - t.x0) > TOUCH_SLOP) t.mode = t.onNeedle || view.current.k <= 1.001 ? 'scrub' : 'pan';
      if (t.mode === 'scrub') scrub(uAt(e.clientX), true);
      else if (t.mode === 'pan') {
        const { k, w } = view.current;
        p.lastManual = performance.now();
        setView(k, t.o0 - (e.clientX - t.x0) / w / k);
        t.trail.push([e.timeStamp, e.clientX]);
        while (t.trail.length > 2 && e.timeStamp - t.trail[0][0] > 80) t.trail.shift();
      }
      return;
    }
    if (p.dragU !== null) { scrub(uAt(e.clientX), true); return; }
    if (e.pointerType === 'mouse') {
      const u = uAt(e.clientX);
      p.hoverU = u;
      const rect = canvasRef.current!.getBoundingClientRect();
      setTip({ x: e.clientX - rect.left, row: rowAt(u) });
      requestDraw();
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    const p = io.current;
    p.pointers.delete(e.pointerId);
    if (p.pinch) { if (p.pointers.size < 2) p.pinch = null; return; }
    const t = p.touch;
    if (t && t.id === e.pointerId) {
      p.touch = null;
      if (t.mode === 'scrub' || (t.mode === 'pending' && !cancelled)) scrub(uAt(e.clientX), false);
      if (t.mode === 'pan' && !cancelled) glide(t.trail);
      return;
    }
    if (p.dragU !== null) scrub(uAt(e.clientX), false);
  };
  const onPointerLeave = () => { io.current.hoverU = null; setTip(null); requestDraw(); };

  const stepRow = (dir: 1 | -1) => {
    const { starts, ends } = layout.getState();
    let i = playhead.getState().row + dir;
    while (i >= 0 && i < ROWS.length && (ends[i] <= starts[i] || !available(i))) i += dir;
    if (i >= 0 && i < ROWS.length) nav.toRow?.(i);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const u = playhead.getState().u;
    if (e.key === 'ArrowRight') { e.preventDefault(); stepRow(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stepRow(-1); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); io.current.lastManual = performance.now(); zoomAt(u, 1.6); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(u, 1 / 1.6); }
    else if (e.key === '0') { e.preventDefault(); setView(1, 0); }
    else if (e.key === 'Home') { e.preventDefault(); nav.scrub?.(snapU(0), false); }
    else if (e.key === 'End') { e.preventDefault(); nav.scrub?.(snapU(1), false); }
  };

  const current = useUI((s) => s.current);
  const spacing = useUI((s) => s.spacing);
  const reckoning = useUI((s) => s.reckoning);
  const tipRow = tip ? ROWS[tip.row] : null;
  const dateText = (i: number) => `c. ${fmtYear(ROWS[i].date[reckoning])}`;
  return (
    <div
      className={side ? 'timeline side' : 'timeline'} ref={wrapRef}
      style={side ? { '--lanes-top': `${geom.lanesTop - (CHIP_H - geom.laneH) / 2}px`, '--chip-h': `${CHIP_H}px`, '--chip-gap': `${geom.laneH + geom.laneGap - CHIP_H}px`, '--tl-h': `${geom.h}px` } as CSSProperties : undefined}
    >
      {side?.left}
      <div
        className="timeline-track"
        tabIndex={0}
        role="slider"
        aria-label="Timeline of the harmony: drag to move through the accounts"
        aria-valuemin={1}
        aria-valuemax={ROWS.length}
        aria-valuenow={current + 1}
        aria-valuetext={`§${ROWS[current].n} ${rowTitle(ROWS[current])}${spacing === 'chrono' ? `, ${dateText(current)}` : ''}`}
        onKeyDown={onKeyDown}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(e) => onPointerUp(e, true)}
          onPointerLeave={onPointerLeave}
        />
      </div>
      {/* The timeline keeps its full width: the scale switch is in the toolbar, and zooming is by wheel, pinch or the
          + − 0 keys, with a way back to the whole timeline floating on it while zoomed. */}
      {side?.right}
      {zoomed && (
        <div className="timeline-controls">
          <button type="button" className="whole" onClick={() => setView(1, 0)} aria-label="Show the whole timeline" title="Show the whole timeline (0)">
            {compact
              ? <><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5M8 10.5h5" /></svg>Zoom out</>
              : '⤢ Whole timeline'}
          </button>
        </div>
      )}
      {tipRow && (
        <div className="timeline-tip" style={{ left: clamp(tip!.x - 150, 6, Math.max(6, view.current.w - 306)) }} role="tooltip">
          <p className="kicker">§{tipRow.n} · {tipRow.partTitle}{tipRow.subTitle ? ` · ${tipRow.sectionTitle}` : ''}</p>
          <p className="tip-title">{rowTitle(tipRow)}</p>
          <p className="tip-date">{dateText(tipRow.i)} · {RECKONING_NAME[reckoning]} (estimate)</p>
          <ul>
            {BOOKS.filter((b) => tipRow.refs[b]).map((b) => (
              <li key={b} className={shown.includes(b) ? '' : 'off'} style={{ ['--g' as string]: `var(--gospel-${b.toLowerCase()})` }}>
                <i aria-hidden="true" />{fmtRef(b, tipRow.refs[b]!)}<span className="sr">{shown.includes(b) ? '' : ` (${BOOK_NAME[b]} hidden)`}</span>
              </li>
            ))}
            {tipRow.other.map((o) => <li key={o} className="other">{o}</li>)}
          </ul>
          <div className="tip-meta"><PlaceChip row={tipRow} book={shown.length === 1 ? shown[0] : null} />{tipRow.feast && <span className="chip">{tipRow.feast.name}</span>}</div>
        </div>
      )}
    </div>
  );
}
