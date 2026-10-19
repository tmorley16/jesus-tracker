// Small geometry helpers for the map (distances under ~200 km, so flat-earth shortcuts are fine).
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
