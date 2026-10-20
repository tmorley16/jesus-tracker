// Keeps the map's labels from piling up when zoomed out: labels are placed in priority
// order and any that would overlap one already placed are hidden (their dots stay). A label
// that can (a place's or a peak's, set to the right of its dot) moves to the other side of
// its dot first. The labels the reader needs (priority under 1: the place shown, places the
// text names, where it's heading) are placed together, trying each side for each, so that
// as many of them as possible show.
import type { Map as MlMap } from 'maplibre-gl';
import type { LonLat } from './geo';

export interface Label {
  el: HTMLElement;
  ll: LonLat;
  /** Where the element sits against its point, as its Marker is anchored. */
  anchor: 'left' | 'center' | 'right';
  dx: number;
  /** Lower goes first; under 1, one the reader needs. */
  priority: number;
  /** Whether the text can go to the left of its dot instead (class "flip"). */
  flips?: boolean;
  w?: number;
  h?: number;
}

const PAD = 3;
type Box = [number, number, number, number];
const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export function declutter(map: MlMap, labels: Iterable<Label>, remeasure = false) {
  const items = [...labels];
  if (remeasure) for (const l of items) { l.w = undefined; l.h = undefined; }
  // Measured as set, with the text to the right of the dot: every class change first, then every read, then the
  // classes back, so the page lays out once rather than once a label.
  const unmeasured = items.filter((l) => l.w === undefined);
  const flipped = unmeasured.filter((l) => l.el.classList.contains('flip'));
  for (const l of flipped) l.el.classList.remove('flip');
  for (const l of unmeasured) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
  for (const l of flipped) l.el.classList.add('flip');
  const { clientWidth: W, clientHeight: H } = map.getContainer();
  // Moved to the other side of its point, the label's box is its mirror image.
  const at = new Map<Label, { x: number; y: number }>();
  const boxOf = (l: Label, flip: boolean): Box => {
    let p = at.get(l);
    if (!p) at.set(l, (p = map.project(l.ll)));
    const left = flip ? p.x - l.dx - l.w! : p.x + l.dx - (l.anchor === 'left' ? 0 : l.anchor === 'right' ? l.w! : l.w! / 2), top = p.y - l.h! / 2;
    return [left - PAD, top - PAD / 2, left + l.w! + PAD, top + l.h! + PAD / 2];
  };
  const onScreen = (b: Box) => b[2] > 0 && b[0] < W && b[3] > 0 && b[1] < H;
  items.sort((a, b) => a.priority - b.priority);
  const shown = items.filter((l) => l.w);

  // The labels the reader needs: every arrangement of sides (there are few), keeping the one that shows the most and
  // moves the fewest.
  const key = shown.filter((l) => l.priority < 1 && onScreen(boxOf(l, false))).slice(0, 6);
  let best = 0, bestShown = -1, bestMoved = 0;
  for (let mask = 0; mask < 1 << key.length; mask++) {
    if (key.some((l, i) => (mask >> i) & 1 && !l.flips)) continue;
    const placed: Box[] = [];
    for (const [i, l] of key.entries()) {
      const b = boxOf(l, !!((mask >> i) & 1));
      if (!placed.some((p) => overlaps(b, p))) placed.push(b);
    }
    let moved = 0;
    for (let m = mask; m; m >>= 1) moved += m & 1;
    if (placed.length > bestShown || (placed.length === bestShown && moved < bestMoved)) { best = mask; bestShown = placed.length; bestMoved = moved; }
  }
  const side = new Map(key.map((l, i) => [l, !!((best >> i) & 1)]));

  const placed: Box[] = [];
  for (const l of shown) {
    let flip = side.get(l) ?? false, box = boxOf(l, flip);
    let hit = onScreen(box) && placed.some((b) => overlaps(box, b));
    if (hit && l.flips && !side.has(l)) {
      const other = boxOf(l, true);
      if (!placed.some((b) => overlaps(other, b))) { box = other; flip = true; hit = false; }
    }
    l.el.classList.toggle('label-hidden', hit);
    l.el.classList.toggle('flip', flip && !hit);
    if (onScreen(box) && !hit) placed.push(box);
  }
}
