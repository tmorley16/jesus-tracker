// Jesus' route on the map. The text names some places exactly and others only as an area: a region (Galilee, Egypt),
// the area between the places where the accounts name different ones (Gadara, Gerasa), or, where it names no place, the
// likely area between the places named before and after. The route runs in straight lines and visits each area at one
// point, on dry land: where the straight way between the named places either side passes through it, or, if that way
// misses it, just inside it towards the way; on a trip out and back to one place, or between places the accounts
// differ on, its centre. His marker waits at that point, and the line turns there through a small circular arc (a
// fillet) whose middle is the point itself, so the line always reaches where he waits and doesn't zigzag at a point the
// text doesn't name. Named places keep their corners: he was there. The route is planned once, whole, so the line to
// where he is now is always the same line, rounded from the start, however the reader got there.
import { bearingDeg, haversineKm, lerp, type LonLat } from './geo';

/** A stop on the route, in reading order: a named place, or an area (`km`, its radius; `mid`: visited at its centre). */
export interface Step { row: number; key: string; ll: LonLat; km?: number; mid?: boolean }
export const stopId = (s: Step) => `${s.row}:${s.key}`;

/** The route worked out once for all its stops. */
export interface Plan {
  /** Where the route visits each area stop (by stop id): his marker waits there. */
  rest: Map<string, LonLat>;
  /** The whole route as one line through every stop in order, its turns at areas rounded. */
  line: LonLat[];
  /** Where each stop (by stop id) is on the line: the index of its point. */
  at: Map<string, number>;
}

/** Whether a point is dry land at least `km` from any shore (the sea's or a lake's). */
export type Ground = (ll: LonLat, km: number) => boolean;

/** How near an area's centre (as a share of its radius) the line must pass to count as going through it. */
const INNER = 0.6;
/** How far a visit is kept from the named places either side (as a share of the area's radius), so it shows. */
const APART = 0.3;
/** The radius of the turn at an area's point: a share of the area's radius, and at most CORNER_KM... */
const CORNER = 0.25, CORNER_KM = 25;
/** ...and smaller at a sharp turn, so the arc's corner lies no further than this share of the area's radius out. */
const CUT = 0.2;
/** How far his marker drifts about where it waits in an area, as a share of the area's radius. */
const DRIFT = 0.12;
/** How far (km) his marker drifts about its point in an area of radius `km`; the point is kept that far from water. */
export const driftKm = (km: number) => DRIFT * km;

// Flat kilometres about a latitude: plenty for the few hundred km between two named places.
type XY = [number, number];
function frame(lat: number) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  return { xy: ([lon, la]: LonLat): XY => [lon * kx, la * ky], ll: ([x, y]: XY): LonLat => [x / kx, y / ky] };
}
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const add = (a: XY, b: XY): XY => [a[0] + b[0], a[1] + b[1]];
const mul = (a: XY, k: number): XY => [a[0] * k, a[1] * k];
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1];
const len = (a: XY) => Math.hypot(a[0], a[1]);
const unit = (a: XY): XY => { const l = len(a); return l ? [a[0] / l, a[1] / l] : [0, 0]; };

/** The point of segment ab nearest p. */
function nearest(p: XY, a: XY, b: XY): XY {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return add(a, mul(ab, t));
}

/**
 * Where the route visits each area between named places a and b (either is missing at an end of the route), in order,
 * each measured from the visit before it:
 *  - The straight way on to b passes well inside the area (within INNER of its radius of the centre): where it passes
 *    nearest the centre, moved along the way if that's right by the place before or after (within APART of the radius).
 *  - It passes outside the area, or near its edge: INNER of the radius from the centre, towards the way.
 *  - Either way, moved towards the centre if it would still sit right by the place before or after.
 *  - Out from a place and back to it (or to one close by), at an end of the route, or between places the accounts
 *    differ on: the area's centre.
 *  - Then on dry land, the drift's reach from any shore, if it isn't already.
 */
function visits(a: Step | null, areas: Step[], b: Step | null, rest: Map<string, LonLat>, ground?: Ground): LonLat[] {
  const out: LonLat[] = [];
  let from = a?.ll ?? null;
  for (const s of areas) {
    const r = s.km!, f = frame(s.ll[1]), c = f.xy(s.ll);
    let v = c;
    if (from && b && !s.mid) {
      const p = f.xy(from), q = f.xy(b.ll), pq = sub(q, p), L = len(pq);
      if (L >= 0.5 * r) {
        const n = nearest(c, p, q), d = len(sub(n, c));
        if (d <= INNER * r) {
          // Along the way rather than back past the place it's going to (Samaria before Sychar, not beyond it).
          const lo = (APART * r) / L, w = add(p, mul(pq, Math.max(lo, Math.min(1 - lo, dot(sub(n, p), pq) / (L * L)))));
          v = lo <= 0.5 && len(sub(w, c)) <= INNER * r ? w : n;
        } else v = add(c, mul(sub(n, c), (INNER * r) / d));
        const clear = (x: XY) => len(sub(x, p)) >= APART * r - 1e-6 && len(sub(x, q)) >= APART * r - 1e-6;
        for (let k = 1; k <= 10 && !clear(v); k++) v = add(v, mul(sub(c, v), 1 / (11 - k)));
      }
    }
    const at = ground ? onLand(f.ll(v), s, ground) : f.ll(v);
    rest.set(stopId(s), at);
    out.push(at);
    from = at;
  }
  return out;
}

/** The point nearest `at` (within INNER of the area's radius of its centre) that's dry land the drift's reach from any
 *  shore, so his marker never waits over water; `at` itself if it is, or if there's none. */
function onLand(at: LonLat, s: Step, ground: Ground): LonLat {
  const r = s.km!, margin = driftKm(r) + 0.3;
  if (ground(at, margin)) return at;
  const f = frame(at[1]), v = f.xy(at), c = f.xy(s.ll), step = Math.max(0.25, r / 60);
  for (let rho = step; rho <= 2 * r; rho += step) {
    // Of the points this far from it, the dry one nearest the area's centre.
    let best: XY | null = null, bestD = INNER * r;
    const n = Math.max(12, Math.ceil((2 * Math.PI * rho) / step));
    for (let k = 0; k < n; k++) {
      const x: XY = [v[0] + rho * Math.cos((2 * Math.PI * k) / n), v[1] + rho * Math.sin((2 * Math.PI * k) / n)];
      const dc = len(sub(x, c));
      if (dc <= bestD && ground(f.ll(x), margin)) { best = x; bestD = dc; }
    }
    if (best) return f.ll(best);
  }
  return at;
}

/** The turn at w between the legs from a and on to b, rounded for an area of radius `areaKm`: CORNER of the area's
 *  radius, less at a sharp turn so the arc's corner lies within CUT of the radius, and less where a leg is too short
 *  for it. Null where there's no turn to speak of, or it turns right back (out and back along the same way). */
function fillet(a: XY, w: XY, b: XY, areaKm: number) {
  const la = len(sub(w, a)), lb = len(sub(b, w));
  if (!la || !lb) return null;
  const u1 = unit(sub(w, a)), u2 = unit(sub(b, w));
  const turn = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  if (turn < 0.02 || turn > Math.PI - 0.05) return null;
  // How far in from the corner an arc of radius 1 reaches, at this turn.
  const reach = 1 / Math.cos(turn / 2) - 1;
  const want = Math.min(CORNER * areaKm, CORNER_KM, (CUT * areaKm) / reach);
  const t = Math.min(want * Math.tan(turn / 2), 0.45 * la, 0.45 * lb), r = t / Math.tan(turn / 2);
  const side = u1[0] * u2[1] - u1[1] * u2[0] > 0 ? 1 : -1;
  return { u1, turn, r, t, side, out: mul(unit(sub(u1, u2)), r * reach) };
}

/**
 * The line through `pts`, each inner point that's an area's (its radius in `areaKm`; 0 for a named place) on a small
 * circular arc tangent to both legs, with the point itself at the arc's middle: the corner the arc rounds is moved out
 * from the point by as much as the arc cuts in, worked out together for neighbouring areas. Also where each point is on
 * the line.
 */
function rounded(pts: LonLat[], areaKm: number[]): { line: LonLat[]; idx: number[] } {
  if (pts.length < 3) return { line: [...pts], idx: pts.map((_, i) => i) };
  const f = frame(pts.reduce((s, p) => s + p[1], 0) / pts.length), P = pts.map(f.xy), V = P.map((p): XY => [...p]);
  const turnAt = (i: number) => (areaKm[i] ? fillet(V[i - 1], V[i], V[i + 1], areaKm[i]) : null);
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 1; i < P.length - 1; i++) {
      if (!areaKm[i]) continue;
      const c = turnAt(i);
      V[i] = c ? add(P[i], c.out) : P[i];
    }
  }
  const line: XY[] = [P[0]], idx = [0];
  for (let i = 1; i < P.length; i++) {
    const c = i < P.length - 1 ? turnAt(i) : null;
    if (!c) { idx.push(line.length); line.push(P[i]); continue; }
    const start = sub(V[i], mul(c.u1, c.t)), centre = add(start, mul([-c.u1[1] * c.side, c.u1[0] * c.side], c.r));
    const a0 = Math.atan2(start[1] - centre[1], start[0] - centre[0]), steps = 2 * Math.max(1, Math.ceil(c.turn / (Math.PI / 12)));
    for (let k = 0; k <= steps; k++) {
      // The arc's middle is the area's point itself.
      if (k === steps / 2) { idx.push(line.length); line.push(P[i]); continue; }
      const ang = a0 + c.side * c.turn * (k / steps);
      line.push([centre[0] + Math.cos(ang) * c.r, centre[1] + Math.sin(ang) * c.r]);
    }
  }
  return { line: line.map(f.ll), idx };
}

/** The route for all its stops (on `ground`, where it's known): where it visits each area, and the line through them. */
export function planRoute(steps: Step[], ground?: Ground): Plan {
  const rest = new Map<string, LonLat>(), pts: LonLat[] = [], km: number[] = [];
  let a: Step | null = null, areas: Step[] = [];
  const close = (b: Step | null) => {
    visits(a, areas, b, rest, ground).forEach((v, k) => { pts.push(v); km.push(areas[k].km!); });
    if (b) { pts.push(b.ll); km.push(0); }
  };
  for (const s of steps) {
    if (s.km) { areas.push(s); continue; }
    close(s);
    a = s;
    areas = [];
  }
  close(null);
  const { line, idx } = rounded(pts, km);
  return { rest, line, at: new Map(steps.map((s, i) => [stopId(s), idx[i]])) };
}

/** The planned line from one stop to another. */
export const between = (plan: Plan, from: Step, to: Step): LonLat[] => plan.line.slice(plan.at.get(stopId(from)), (plan.at.get(stopId(to)) ?? -1) + 1);

/**
 * The legs to draw for the route so far (`pts`, ending where he is now), oldest first: the line between each pair of
 * named places, then the newest leg, from the last named place he left, through each area since, to where he is. All
 * of it is the planned line, so the newest leg is already rounded where he has passed through an area, and stays as it
 * is once he moves on.
 */
export function legsFor(pts: Step[], plan: Plan): LonLat[][] {
  const e = pts.length - 1;
  if (e < 1) return [];
  let k = pts[e].km ? e : e - 1;
  while (k > 0 && pts[k].km) k--;
  const legs: LonLat[][] = [];
  let a: Step | null = null;
  for (let i = 0; i <= k; i++) {
    const s = pts[i];
    if (s.km) continue;
    if (a) legs.push(between(plan, a, s));
    a = s;
  }
  legs.push(between(plan, pts[k], pts[e]));
  return legs;
}

/** How far along a line (0–1) its point `i` is. */
export function shareTo(line: LonLat[], i: number): number {
  let before = 0, total = 0;
  for (let k = 1; k < line.length; k++) {
    const d = haversineKm(line[k - 1], line[k]);
    total += d;
    if (k <= i) before += d;
  }
  return total ? before / total : 0;
}

/** The point halfway along a line, and its bearing there (null for a line under a kilometre). */
export function halfway(line: LonLat[]): { at: LonLat; bearing: number } | null {
  const ds = line.slice(1).map((p, k) => haversineKm(line[k], p)), total = ds.reduce((s, d) => s + d, 0);
  if (total < 1) return null;
  let left = total / 2;
  for (let k = 0; k < ds.length; k++) {
    if (left <= ds[k] && ds[k] > 0) return { at: lerp(line[k], line[k + 1], left / ds[k]), bearing: bearingDeg(line[k], line[k + 1]) };
    left -= ds[k];
  }
  return null;
}
