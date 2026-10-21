// Where Jesus is on the map, row by row: the stops on his route (the places the text names; where the accounts name
// different places, the area between them; and where the text names none, the likely area between the places named
// before and after), and what the map shows for each row (its focus).
import { haversineKm, midpoint, type LonLat } from './geo';
import { AREAS, MAP_START, ROWS, placesFor, type Book } from './model';
import type { PlaceData } from './places';
import type { Step } from './route';

/** A stop at a place: a region is an area, at its centre with its radius. */
const stopAt = (row: number, key: string, p: PlaceData): Step => ({ row, key, ll: p.candidates[0].lonlat, ...(p.kind === 'region' ? { km: AREAS[key] ?? 20 } : {}) });
/**
 * Where Jesus is, in reading order from the map's start: rows where he's in the scene and the shown gospels agree on
 * one named place (a region is an area about its centre). Where the text has him set out from elsewhere (Nazareth,
 * Lk 2:4), that place is a stop first.
 */
export function journey(books: Book[], places: Record<string, PlaceData>): Step[] {
  const steps: Step[] = [];
  for (const r of ROWS) {
    if (r.i < MAP_START || !r.jesus || !books.some((b) => r.refs[b])) continue;
    const named = placesFor(r, books);
    if (named.length !== 1) continue;
    const key = named[0].key, p = places[key];
    if (!p) continue;
    const from = books.map((b) => (r.refs[b] ? r.from[b] : undefined)).find((k) => k && places[k]);
    if (from && from !== key && steps[steps.length - 1]?.key !== from) steps.push(stopAt(r.i, from, places[from]));
    steps.push(stopAt(r.i, key, p));
  }
  return steps;
}
/**
 * The stops on the route: the named places; where the accounts name different places, the area between them (visited
 * at its centre); and where no place is named, the likely area (worked out from the named places alone), so the line
 * always joins Jesus' marker to where it was.
 */
export function routeStops(books: Book[], places: Record<string, PlaceData>, steps: Step[]): Step[] {
  const out: Step[] = [];
  const push = (s: Step) => { const last = out[out.length - 1]; if (!last || haversineKm(last.ll, s.ll) > 0.5 || last.key !== s.key && !s.key.startsWith('~')) out.push(s); };
  let j = 0;
  for (let i = MAP_START; i < ROWS.length; i++) {
    while (j < steps.length && steps[j].row <= i) push(steps[j++]);
    const f = focusFor(i, books, places, steps);
    if (f.kind === 'likely') push({ row: i, key: `~${i}`, ll: f.center, km: f.radius });
    else if (f.kind === 'differ' && f.present) push({ row: i, key: `~${i}`, ll: f.center, km: f.radius, mid: true });
  }
  return out;
}
/** The route so far: the places Jesus has been, in order, up to row `i` (repeats of the same place merged). */
export function routeTo(steps: Step[], i: number): Step[] {
  const pts: Step[] = [];
  for (const s of steps) { if (s.row > i) break; if (!pts.length || pts[pts.length - 1].key !== s.key) pts.push(s); }
  return pts;
}
/** Rows where Jesus is in the scene but the shown gospels name different places (all of them count as visited). */
export function splits(books: Book[]): { row: number; keys: string[] }[] {
  return ROWS.filter((r) => r.i >= MAP_START && r.jesus && books.some((b) => r.refs[b])).map((r) => ({ row: r.i, keys: placesFor(r, books).map((n) => n.key) })).filter((s) => s.keys.length > 1);
}

export type Focus =
  | { kind: 'site'; key: string; place: PlaceData }
  | { kind: 'region'; key: string; place: PlaceData; radius: number }
  | { kind: 'likely'; center: LonLat; radius: number; before: Step | null; after: Step | null }
  | { kind: 'scene'; key: string; place: PlaceData }
  | { kind: 'differ'; places: { key: string; books: Book[]; place: PlaceData }[]; center: LonLat; radius: number; present: boolean }
  | { kind: 'none' };

export function focusFor(i: number, books: Book[], places: Record<string, PlaceData>, steps: Step[]): Focus {
  const row = ROWS[i];
  const named = placesFor(row, books).filter((n) => places[n.key]);
  const key = named[0]?.key;
  // Before the map's start (Mary's visit to Elizabeth) Jesus isn't on the map at all.
  if (i < MAP_START) return key ? { kind: 'scene', key, place: places[key] } : { kind: 'none' };
  if (named.length > 1) {
    // The area between them: about the middle of the places, reaching each.
    const lls = named.map((n) => places[n.key].candidates[0].lonlat);
    const center: LonLat = [lls.reduce((s, p) => s + p[0], 0) / lls.length, lls.reduce((s, p) => s + p[1], 0) / lls.length];
    const radius = Math.max(6, ...lls.map((p) => haversineKm(center, p)));
    return { kind: 'differ', places: named.map((n) => ({ ...n, place: places[n.key] })), center, radius, present: row.jesus };
  }
  if (!row.jesus) return key ? { kind: 'scene', key, place: places[key] } : { kind: 'none' };
  if (key) {
    const place = places[key];
    return place.kind === 'region' ? { kind: 'region', key, place, radius: AREAS[key] ?? 20 } : { kind: 'site', key, place };
  }
  // Jesus is in the scene but no place is named: an area between the places named before and after.
  let before: Step | null = null, after: Step | null = null;
  for (const s of steps) { if (s.row < i) before = s; else if (s.row > i) { after = s; break; } }
  // (However many sections pass without a place named: the area is where those places put him, no wider.)
  let center: LonLat, radius: number;
  if (before && after && before.key === after.key) { center = before.ll; radius = 8; }
  else if (before && after) { center = midpoint(before.ll, after.ll); radius = Math.max(6, haversineKm(before.ll, after.ll) / 2 + 4); }
  else if (before || after) { center = (before ?? after)!.ll; radius = 15; }
  else return { kind: 'none' };
  return { kind: 'likely', center, radius: Math.min(45, radius), before, after };
}
/** Where Jesus' marker goes for a focus, and the area (km) it may drift within. */
export function travelTarget(f: Focus): { to: LonLat; areaKm: number | null } | null {
  if (f.kind === 'site') return { to: f.place.candidates[0].lonlat, areaKm: null };
  if (f.kind === 'region') return { to: f.place.candidates[0].lonlat, areaKm: f.radius };
  if (f.kind === 'likely') return { to: f.center, areaKm: f.radius };
  if (f.kind === 'differ' && f.present) return { to: f.center, areaKm: f.radius };
  return null;
}
/** Where the text has Jesus making for (not yet reached), with the words of each gospel on screen that say so. */
export interface Heading { key: string; place: PlaceData; quotes: { book: string; ref: string; words: string }[] }
export function headingFor(i: number, books: Book[], places: Record<string, PlaceData>): Heading | null {
  const row = ROWS[i];
  if (i < MAP_START || !row.jesus) return null;
  const quotes = books.filter((b) => row.refs[b] && row.toward[b] && places[row.toward[b]!.key]).map((b) => ({ book: b as string, ...row.toward[b]! }));
  return quotes.length ? { key: quotes[0].key, place: places[quotes[0].key], quotes } : null;
}

/** Where Jesus was last placed, for scenes he isn't in: the marker rests there. */
export interface Rest { to: LonLat; areaKm: number | null; name: string }
export function restingFor(i: number, books: Book[], places: Record<string, PlaceData>, steps: Step[]): Rest | null {
  if (i < MAP_START || ROWS[i].jesus) return null;
  for (let j = i - 1; j >= MAP_START; j--) {
    const r = ROWS[j];
    if (!r.jesus || !books.some((b) => r.refs[b])) continue;
    const f = focusFor(j, books, places, steps);
    const t = travelTarget(f);
    if (t && f.kind === 'differ') return { ...t, name: `the area between ${f.places.map((p) => p.place.name).join(' and ')}` };
    if (t && (f.kind === 'site' || f.kind === 'region')) return { ...t, name: f.place.name };
    if (t && f.kind === 'likely') return { ...t, name: `an area near ${places[(f.before ?? f.after)!.key].name}` };
  }
  return null;
}

/** The points and radii (km) a focus covers, for finding nearby peaks. */
export function focusAreas(f: Focus): { c: LonLat; r: number }[] {
  if (f.kind === 'site' || f.kind === 'scene') return [{ c: f.place.candidates[0].lonlat, r: 0 }];
  if (f.kind === 'region') return [{ c: f.place.candidates[0].lonlat, r: f.radius }];
  if (f.kind === 'likely') return [{ c: f.center, r: f.radius }];
  if (f.kind === 'differ') return f.places.map((p) => ({ c: p.place.candidates[0].lonlat, r: 0 }));
  return [];
}
