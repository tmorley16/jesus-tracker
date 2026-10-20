// Small geometry helpers for the map (distances under ~200 km, so flat-earth shortcuts are fine).
import type { FeatureCollection } from 'geojson';

export type LonLat = [number, number];
const RAD = Math.PI / 180;
const KM_PER_DEG = 111.32;

export function haversineKm([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export const lerp = (a: LonLat, b: LonLat, t: number): LonLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const midpoint = (a: LonLat, b: LonLat): LonLat => lerp(a, b, 0.5);

/** Compass bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const p1 = a[1] * RAD, p2 = b[1] * RAD, dl = (b[0] - a[0]) * RAD;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export function circleRing(center: LonLat, km: number, steps = 72): LonLat[] {
  const ring: LonLat[] = [];
  const dLat = km / KM_PER_DEG, dLon = km / (KM_PER_DEG * Math.cos(center[1] * RAD));
  for (let k = 0; k <= steps; k++) {
    const t = (2 * Math.PI * k) / steps;
    ring.push([center[0] + dLon * Math.sin(t), center[1] + dLat * Math.cos(t)]);
  }
  return ring;
}

export function bounds(points: LonLat[]): [LonLat, LonLat] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of points) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [[w, s], [e, n]];
}

/** Whether a point is inside a ring (even-odd). */
export function inRing([x, y]: LonLat, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Dry land, from the map's land and lakes: whether a point is on land, outside every lake, and at least `km` from any
 * shore (the sea's or a lake's). The shores' segments are filed by 0.1° cell (and by band of latitude, to count the
 * shores a line east from the point crosses), so each point checks only the few near it.
 */
export function dryLand(land: FeatureCollection, lakes: FeatureCollection): (ll: LonLat, km: number) => boolean {
  const CELL = 0.1, key = (cx: number, cy: number) => (cy + 2048) * 4096 + cx + 2048;
  type Seg = [number, number, number, number];
  const cells = new Map<number, Seg[]>(), bands = new Map<number, { s: Seg; lake: boolean }[]>();
  const file = (fc: FeatureCollection, lake: boolean) => {
    for (const f of fc.features) {
      const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const ring of polys.flat()) for (let i = 1; i < ring.length; i++) {
        const s: Seg = [ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1]];
        const x0 = Math.floor(Math.min(s[0], s[2]) / CELL), x1 = Math.floor(Math.max(s[0], s[2]) / CELL);
        for (let cy = Math.floor(Math.min(s[1], s[3]) / CELL); cy <= Math.floor(Math.max(s[1], s[3]) / CELL); cy++) {
          if (!bands.has(cy)) bands.set(cy, []);
          bands.get(cy)!.push({ s, lake });
          for (let cx = x0; cx <= x1; cx++) {
            const k = key(cx, cy);
            if (!cells.has(k)) cells.set(k, []);
            cells.get(k)!.push(s);
          }
        }
      }
    }
  };
  file(land, false);
  file(lakes, true);
  return ([x, y], km) => {
    const kx = KM_PER_DEG * Math.cos(y * RAD), ky = 110.57, rx = km / kx, ry = km / ky;
    for (let cy = Math.floor((y - ry) / CELL); cy <= Math.floor((y + ry) / CELL); cy++) {
      for (let cx = Math.floor((x - rx) / CELL); cx <= Math.floor((x + rx) / CELL); cx++) {
        for (const [x1, y1, x2, y2] of cells.get(key(cx, cy)) ?? []) {
          const ax = (x1 - x) * kx, ay = (y1 - y) * ky, dx = (x2 - x1) * kx, dy = (y2 - y1) * ky, l2 = dx * dx + dy * dy;
          const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
          if (Math.hypot(ax + dx * t, ay + dy * t) < km) return false;
        }
      }
    }
    let onLand = false, inLake = false;
    for (const { s: [x1, y1, x2, y2], lake } of bands.get(Math.floor(y / CELL)) ?? []) {
      if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) { if (lake) inLake = !inLake; else onLand = !onLand; }
    }
    return onLand && !inLake;
  };
}
