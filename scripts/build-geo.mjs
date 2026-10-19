// Clips Natural Earth (public domain) land, lakes and rivers to the wider world around
// the gospels (Italy to Persia) and writes compact GeoJSON for the map view. The region
// of the gospels keeps full 10m detail; farther away, lines are simplified more the
// farther they are, so the files stay small.
//
//   node scripts/build-geo.mjs   →  public/data/geo/{land,lakes,rivers}.json

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const CORE = [30.6, 29.2, 37.6, 34.6]; // west, south, east, north (Egypt's delta to Damascus): full detail
const WIDE = [5, 12, 60, 48]; // Italy to Persia, the Black Sea to Ethiopia
const read = async (name) => JSON.parse(await readFile(`data/raw/naturalearth/${name}.geojson`, 'utf8'));

// Modern features the map shouldn't show: dam reservoirs, canals, and lakes whose
// present shape is a 20th-century creation.
const MODERN_WATER = /canal|channel|csatorna|aral|barsakelmes|sarygamysh|razazah/i;

/** Degrees outside the core region (0 inside). */
function outside([x, y]) {
  const [w, s, e, n] = CORE;
  const dx = x < w ? w - x : x > e ? x - e : 0, dy = y < s ? s - y : y > n ? y - n : 0;
  return Math.hypot(dx, dy);
}
/** Simplification tolerance in degrees: none in the core, growing to ~3 km far away. */
const tolAt = (p) => { const d = outside(p); return d === 0 ? 0 : Math.min(0.03, 0.0015 + 0.0012 * d); };
const round = (p) => { const k = outside(p) === 0 ? 1e4 : 1e3; return [Math.round(p[0] * k) / k, Math.round(p[1] * k) / k]; };

const KX = Math.cos((32 * Math.PI) / 180); // flatten longitude to roughly true distances
function segDist(p, a, b) {
  const px = p[0] * KX, py = p[1], ax = a[0] * KX, ay = a[1], bx = b[0] * KX, by = b[1];
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
/** Douglas–Peucker where each point is judged against its own tolerance. `pts` excludes any closing point. */
function simplify(pts, closed) {
  const n = pts.length;
  if (n < (closed ? 4 : 3)) return pts;
  const keep = new Uint8Array(n);
  let far = n - 1;
  if (closed) { let best = -1; for (let i = 1; i < n; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > best) { best = d; far = i; } } }
  keep[0] = keep[far] = 1;
  const stack = closed ? [[0, far], [far, n]] : [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a], B = pts[b % n];
    let worst = 1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], A, B), t = tolAt(pts[i]);
      const r = t === 0 ? (d > 0 ? Infinity : 0) : d / t;
      if (r > worst) { worst = r; idx = i; }
    }
    if (idx >= 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Sutherland–Hodgman against the wide box (convex), one ring at a time.
function clipRing(ring) {
  const [W, S, E, N] = WIDE;
  const edges = [(p) => p[0] >= W, (p) => p[0] <= E, (p) => p[1] >= S, (p) => p[1] <= N];
  const cut = [
    (a, b) => [W, a[1] + (b[1] - a[1]) * (W - a[0]) / (b[0] - a[0])],
    (a, b) => [E, a[1] + (b[1] - a[1]) * (E - a[0]) / (b[0] - a[0])],
    (a, b) => [a[0] + (b[0] - a[0]) * (S - a[1]) / (b[1] - a[1]), S],
    (a, b) => [a[0] + (b[0] - a[0]) * (N - a[1]) / (b[1] - a[1]), N],
  ];
  let out = ring.slice(0, -1);
  for (let k = 0; k < 4 && out.length; k++) {
    const input = out; out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      const inCur = edges[k](cur), inPrev = edges[k](prev);
      if (inCur) { if (!inPrev) out.push(cut[k](prev, cur)); out.push(cur); }
      else if (inPrev) out.push(cut[k](prev, cur));
    }
  }
  if (out.length < 3) return null;
  // Rings smaller than the local tolerance (tiny far-off islands) are dropped.
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of out) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const t = tolAt([(w + e) / 2, (s + n) / 2]);
  if (t > 0 && Math.max(e - w, n - s) < 3 * t) return null;
  const clean = simplify(out, true).map(round).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (clean.length < 3) return null;
  clean.push(clean[0]);
  return clean;
}
const polygons = (geom) => geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
const inBox = ([x, y], [W, S, E, N]) => x >= W && x <= E && y >= S && y <= N;

function clipPolygons(fc, keepProps, box = WIDE) {
  const features = [];
  for (const f of fc.features) for (const poly of polygons(f.geometry)) {
    if (!poly[0].some((p) => inBox(p, box))) continue;
    const outer = clipRing(poly[0]);
    if (!outer) continue;
    const rings = [outer, ...poly.slice(1).map(clipRing).filter(Boolean)];
    features.push({ type: 'Feature', properties: keepProps(f.properties), geometry: { type: 'Polygon', coordinates: rings } });
  }
  return { type: 'FeatureCollection', features };
}

function clipLines(fc, keepProps) {
  const features = [];
  for (const f of fc.features) {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const line of lines) {
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          const coords = simplify(run, false).map(round).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
          if (coords.length > 1) features.push({ type: 'Feature', properties: keepProps(f.properties), geometry: { type: 'LineString', coordinates: coords } });
        }
        run = [];
      };
      for (const p of line) { if (inBox(p, WIDE)) run.push(p); else flush(); }
      flush();
    }
  }
  return { type: 'FeatureCollection', features };
}

const land = clipPolygons(await read('ne_10m_land'), () => ({}));
// Minor islands only near the gospels; farther off they're specks.
const islands = clipPolygons(await read('ne_10m_minor_islands'), () => ({}), CORE);
land.features.push(...islands.features);
const lakesRaw = await read('ne_10m_lakes');
lakesRaw.features = lakesRaw.features.filter((f) => f.properties.featurecla !== 'Reservoir' && !MODERN_WATER.test(f.properties.name ?? ''));
const lakes = clipPolygons(lakesRaw, (p) => ({ name: p.name ?? null }));
const riversRaw = await read('ne_10m_rivers_lake_centerlines');
// Far from the gospels, only the larger rivers (Natural Earth scale rank ≤ 7).
riversRaw.features = riversRaw.features.filter((f) => !MODERN_WATER.test(f.properties.name ?? ''));
const rivers = clipLines(riversRaw, (p) => ({ name: p.name ?? null, r: p.scalerank }));
rivers.features = rivers.features.filter((f) => f.properties.r <= 7 || f.geometry.coordinates.some((p) => outside(p) === 0));

await mkdir('public/data/geo', { recursive: true });
for (const [name, fc] of Object.entries({ land, lakes, rivers })) {
  const json = JSON.stringify(fc);
  await writeFile(`public/data/geo/${name}.json`, json);
  const names = [...new Set(fc.features.map((f) => f.properties.name).filter(Boolean))];
  const pts = fc.features.reduce((n, f) => n + JSON.stringify(f.geometry.coordinates).split('],[').length, 0);
  console.log(`${name}: ${fc.features.length} features, ${pts} points, ${(json.length / 1024).toFixed(0)} KB${names.length ? ` — ${names.slice(0, 40).join(', ')}` : ''}`);
}
