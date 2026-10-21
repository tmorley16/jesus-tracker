import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useUI } from './state';

const MIN = 0.2, MAX = 0.8;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));
const remeasure = () => window.dispatchEvent(new Event('jt-drag-end'));

/** The divider between the gospels and the map. Past 80% either way, that side takes the whole screen.
 *  While dragging, only the panes' --map-share moves (no store update or save per frame); the share is kept on release. */
export function Splitter({ panesRef, share, vertical }: { panesRef: RefObject<HTMLDivElement | null>; share: number; vertical: boolean }) {
  const [over, setOver] = useState<'map' | 'text' | null>(null);
  const overRef = useRef<'map' | 'text' | null>(null); // read on release, which can beat the re-render
  const [live, setLive] = useState<number | null>(null); // the share while dragging
  const liveRef = useRef<number | null>(null);
  const ui = useUI.getState();
  const shown = live ?? share;

  // The map is on the right (desktop) or on top (phones).
  const rawShare = (e: PointerEvent) => {
    const r = panesRef.current!.getBoundingClientRect();
    return vertical ? (e.clientY - r.top) / r.height : (r.right - e.clientX) / r.width;
  };
  const setPreview = (o: 'map' | 'text' | null) => {
    overRef.current = o;
    setOver(o);
    if (panesRef.current) { if (o) panesRef.current.dataset.over = o; else delete panesRef.current.dataset.over; }
  };
  /** Put the panes' share in the DOM directly; React's own value is put back before any commit so its diff stays true. */
  const setDomShare = (v: number) => panesRef.current?.style.setProperty('--map-share', String(v));
  const finish = (restore: boolean) => {
    liveRef.current = null;
    setLive(null);
    setPreview(null);
    if (restore) setDomShare(share);
    delete document.body.dataset.dragging;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); // no text selection or native drag (of a link nearby) to cancel the pointer mid-resize
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.dataset.dragging = '';
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const raw = rawShare(e);
    const o = raw > MAX + 0.03 ? 'map' : raw < MIN - 0.03 ? 'text' : null;
    if (o !== overRef.current) setPreview(o);
    const v = clamp(raw);
    liveRef.current = v;
    setLive(v);
    setDomShare(v);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const decided = overRef.current, v = liveRef.current;
    finish(decided !== null || v === null);
    if (decided) {
      ui.setMapShare(null); // a fresh split next time starts from the default
      if (decided === 'map') ui.showOnlyMap(); else ui.toggleMap();
    } else if (v !== null) ui.setMapShare(v);
    remeasure();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = vertical ? 'ArrowDown' : 'ArrowLeft', shrink = vertical ? 'ArrowUp' : 'ArrowRight';
    let next: number | null = null;
    if (e.key === grow) next = share + 0.02;
    else if (e.key === shrink) next = share - 0.02;
    else if (e.key === 'Home') next = MIN;
    else if (e.key === 'End') next = MAX;
    if (next === null) return;
    e.preventDefault();
    ui.setMapShare(clamp(next));
    remeasure();
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-label="Resize the map"
      aria-valuemin={MIN * 100}
      aria-valuemax={MAX * 100}
      aria-valuenow={Math.round(shown * 100)}
      aria-valuetext={`Map ${Math.round(shown * 100)}% of the screen`}
      tabIndex={0}
      title="Drag to resize · double-click to reset · past 80% one side takes the whole screen"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { finish(true); remeasure(); } }}
      onDoubleClick={() => { ui.setMapShare(null); remeasure(); }}
      onKeyDown={onKeyDown}
    >
      <span className="grip" aria-hidden="true" />
      {over && <span className="split-hint" role="status">{over === 'map' ? 'Release to show only the map' : 'Release to show only the gospels'}</span>}
    </div>
  );
}
