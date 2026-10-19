import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useUI } from './state';

const MIN = 0.2, MAX = 0.8;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

/** The divider between the gospels and the map. Past 80% either way, that side takes the whole screen. */
export function Splitter({ panesRef, share, vertical }: { panesRef: RefObject<HTMLDivElement | null>; share: number; vertical: boolean }) {
  const [over, setOver] = useState<'map' | 'text' | null>(null);
  const overRef = useRef<'map' | 'text' | null>(null); // read on release, which can beat the re-render
  const ui = useUI.getState();

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
  const end = () => {
    delete document.body.dataset.dragging;
    window.dispatchEvent(new Event('jt-drag-end'));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.dataset.dragging = '';
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const raw = rawShare(e);
    setPreview(raw > MAX + 0.03 ? 'map' : raw < MIN - 0.03 ? 'text' : null);
    useUI.getState().setMapShare(clamp(raw));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const decided = overRef.current;
    setPreview(null);
    end();
    if (decided) {
      ui.setMapShare(null); // a fresh split next time starts from the default
      if (decided === 'map') ui.showOnlyMap(); else ui.toggleMap();
    }
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
    window.dispatchEvent(new Event('jt-drag-end'));
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-label="Resize the map"
      aria-valuemin={MIN * 100}
      aria-valuemax={MAX * 100}
      aria-valuenow={Math.round(share * 100)}
      aria-valuetext={`Map ${Math.round(share * 100)}% of the screen`}
      tabIndex={0}
      title="Drag to resize · double-click to reset · past 80% one side takes the whole screen"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { setPreview(null); end(); } }}
      onDoubleClick={() => { ui.setMapShare(null); window.dispatchEvent(new Event('jt-drag-end')); }}
      onKeyDown={onKeyDown}
    >
      <span className="grip" aria-hidden="true" />
      {over && <span className="split-hint" role="status">{over === 'map' ? 'Release to show only the map' : 'Release to show only the gospels'}</span>}
    </div>
  );
}
