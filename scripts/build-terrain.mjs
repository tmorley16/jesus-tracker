// Peaks and contour lines for the map's mountain sections.
//
// Peaks are listed by Wikidata ID in src/data/sections.meta.json (`peaks`); their names,
// positions and Wikipedia articles come from Wikidata (CC0). Elevations and contours come
// from the AWS Terrain Tiles (Terrarium encoding; in this region SRTM and GMTED2010 from
// the USGS and ETOPO1 from NOAA), sampled at zoom 11 (about 65 m a pixel). Peaks whose
// windows overlap share one set of contours (a cluster), written to its own file so the
// map loads only what a section needs. Downloaded tiles are cached in data/raw/terrain.
//
// The same tiles also give contours over the whole region Jesus travels (and, coarser, Egypt):
// the "light on the land" the map draws in white around him.
//
//   node scripts/build-terrain.mjs   →  public/data/peaks.json, public/data/terrain/*.json (region.json: the light)

import { mkdir, readFile, writeFile, readdir, rm, rename } from 'node:fs/promises';
import { terrariumTile } from './lib/terrain.mjs';
import { entities, wikipediaUrl } from './lib/wikidata.mjs';

const Z = 11;
const meta = JSON.parse(await readFile('src/data/sections.meta.json', 'utf8'));
const peakDefs = Object.entries(meta.peaks).filter(([k]) => k !== '_about').map(([id, [r, summit]]) => ({ id, r, summit }));
const wd = await entities(peakDefs.map((p) => p.id));

// ---- web-mercator pixel maths at a zoom ----
function mercator(z) {
  const size = 256 * 2 ** z;
  return {
    size,
    px: ([lon, lat]) => [((lon + 180) / 360) * size, ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * size],
    ll: ([x, y]) => [(x / size) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI],
    metresPerPx: (lat) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / size,
  };
}
const { px: toPx, ll: toLL, metresPerPx } = mercator(Z);

// Outputs are written into a scratch folder (and peaks.json and lakes.json held back) until everything has been built,
// so a failed run (a tile that won't download) leaves the previous outputs in place.
const BUILD = 'data/raw/terrain-build';
await rm(BUILD, { recursive: true, force: true });
await mkdir(BUILD, { recursive: true });

const tile = (x, y, z = Z) => terrariumTile(x, y, z);

/** The elevation grid (pixel centres) covering [x0, x1) × [y0, y1) in global pixels at zoom z. */
async function grid(x0, y0, x1, y1, z = Z) {
  const w = x1 - x0, h = y1 - y0, g = new Float32Array(w * h);
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y1 - 1) / 256); ty++) for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x1 - 1) / 256); tx++) {
    const t = await tile(tx, ty, z);
    for (let py = 0; py < 256; py++) {
      const gy = ty * 256 + py - y0;
      if (gy < 0 || gy >= h) continue;
      for (let px = 0; px < 256; px++) { const gx = tx * 256 + px - x0; if (gx >= 0 && gx < w) g[gy * w + gx] = t[py * 256 + px]; }
    }
  }
  return { x0, y0, w, h, g };
}

// ---- land mask, so no contours are drawn in the sea (the tiles carry sea-floor depths) ----
const land = JSON.parse(await readFile('public/data/geo/land.json', 'utf8')).features.map((f) => {
  const rings = f.geometry.coordinates, xs = rings[0].map((p) => p[0]), ys = rings[0].map((p) => p[1]);
  return { rings, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
});
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const onLand = (p) => land.some(({ rings, box }) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && inRing(p, rings[0]) && !rings.slice(1).some((hole) => inRing(p, hole)));

// ---- marching squares → joined polylines ----
function isolines({ w, h, g }, level, skip) {
  const segs = [];
  const at = (x, y) => g[y * w + x];
  const lerp = (a, b) => (level - a) / (b - a);
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    if (skip(x + 0.5, y + 0.5)) continue;
    const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
    const c = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
    if (c === 0 || c === 15) continue;
    // Edge points and ids (shared with the neighbouring cell) for joining.
    const T = () => [[x + lerp(tl, tr), y], 2 * (y * w + x)];
    const B = () => [[x + lerp(bl, br), y + 1], 2 * ((y + 1) * w + x)];
    const L = () => [[x, y + lerp(tl, bl)], 2 * (y * w + x) + 1];
    const R = () => [[x + 1, y + lerp(tr, br)], 2 * (y * w + x + 1) + 1];
    const centreAbove = (tl + tr + br + bl) / 4 > level;
    const pairs = {
      1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 6: [[T, B]], 7: [[L, T]], 8: [[L, T]], 9: [[T, B]],
      11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]],
      5: centreAbove ? [[L, T], [B, R]] : [[T, R], [L, B]],
      10: centreAbove ? [[T, R], [L, B]] : [[L, T], [B, R]],
    }[c];
    for (const [p, q] of pairs) segs.push([p(), q()]);
  }
  // Join segments that share an edge point into polylines.
  const byEdge = new Map();
  segs.forEach((s, i) => { for (const [, id] of s) (byEdge.get(id) ?? byEdge.set(id, []).get(id)).push(i); });
  const used = new Uint8Array(segs.length), lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [segs[i][0], segs[i][1]];
    for (const end of [1, 0]) {
      for (;;) {
        const [, id] = end ? line[line.length - 1] : line[0];
        const next = (byEdge.get(id) ?? []).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        const [a, b] = segs[next], add = a[1] === id ? b : a;
        if (end) line.push(add); else line.unshift(add);
      }
    }
    lines.push(line.map(([p]) => p));
  }
  return lines;
}

/** Chaikin corner-cutting, so lines traced through the 65 m grid don't show its steps (ends stay put). */
function smooth(pts, rounds = 2) {
  let out = pts;
  for (let r = 0; r < rounds && out.length > 2; r++) {
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const [ax, ay] = out[i], [bx, by] = out[i + 1];
      next.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    let worst = tol, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i], t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > worst) { worst = d; idx = i; }
    }
    if (idx >= 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Binary morphology with a disc of radius r cells: grow (dilate) or shrink (erode) the cells set to 1. */
function morph(m, w, h, r, grow) {
  const offs = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) offs.push(dy * w + dx, dx, dy);
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = grow ? 0 : 1;
    for (let k = 0; k < offs.length; k += 3) {
      const xx = x + offs[k + 1], yy = y + offs[k + 2], s = xx >= 0 && yy >= 0 && xx < w && yy < h && m[y * w + x + offs[k]];
      if (grow ? s : !s) { v = grow ? 1 : 0; break; }
    }
    out[y * w + x] = v;
  }
  return out;
}

/** A separable Gaussian blur (sigma in cells) of a grid of values, edges clamped. */
function blur(m, w, h, sigma) {
  const k = Math.ceil(3 * sigma), wt = [];
  for (let i = -k; i <= k; i++) wt.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = wt.reduce((s, x) => s + x, 0), a = new Float32Array(m.length), b = new Float32Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -k; i <= k; i++) s += m[y * w + Math.min(w - 1, Math.max(0, x + i))] * wt[i + k]; a[y * w + x] = s / sum; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -k; i <= k; i++) s += a[Math.min(h - 1, Math.max(0, y + i)) * w + x] * wt[i + k]; b[y * w + x] = s / sum; }
  return b;
}

/** The slope (rise over run) at a point of a grid at zoom z: central differences 3 pixels wide, on the bilinear surface. */
function slopeIn(G, z) {
  const { ll, metresPerPx: mpp } = mercator(z);
  const at = (x, y) => {
    const xi = Math.max(0, Math.min(G.w - 2, Math.floor(x))), yi = Math.max(0, Math.min(G.h - 2, Math.floor(y)));
    const fx = Math.max(0, Math.min(1, x - xi)), fy = Math.max(0, Math.min(1, y - yi)), g = G.g, w = G.w;
    return (g[yi * w + xi] * (1 - fx) + g[yi * w + xi + 1] * fx) * (1 - fy) + (g[(yi + 1) * w + xi] * (1 - fx) + g[(yi + 1) * w + xi + 1] * fx) * fy;
  };
  const metres = (y) => mpp(ll([0, y + G.y0])[1]);
  return (x, y) => Math.hypot(at(x + 1.5, y) - at(x - 1.5, y), at(x, y + 1.5) - at(x, y - 1.5)) / (3 * metres(y));
}
/** A slope as a small code the map reads back as 0.2 % × 2^(q/3). */
const slopeCode = (s) => Math.max(0, Math.min(40, Math.round(3 * Math.log2(Math.max(s, 0.002) / 0.002))));

// ---- peaks and clusters ----
const peaks = peakDefs.map((p) => {
  const e = wd[p.id];
  if (!e?.lonlat) throw new Error(`Wikidata has no coordinates for ${p.id}`);
  return { id: p.id, name: e.label, wiki: e.enwiki, lonlat: e.lonlat, r: p.r, summit: p.summit };
});
const km = (a, b) => { const R = 6371, t = Math.PI / 180, dLat = (b[1] - a[1]) * t, dLon = (b[0] - a[0]) * t; return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLon / 2) ** 2)); };
const parent = peaks.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
for (let i = 0; i < peaks.length; i++) for (let j = i + 1; j < peaks.length; j++) if (km(peaks[i].lonlat, peaks[j].lonlat) < peaks[i].r + peaks[j].r) parent[find(i)] = find(j);
const clusters = new Map();
peaks.forEach((p, i) => (clusters.get(find(i)) ?? clusters.set(find(i), []).get(find(i))).push(p));

const out = [];
let totalKb = 0;
for (const members of clusters.values()) {
  const cid = members[0].id.toLowerCase();
  // Window: the circles around the cluster's peaks, in pixels.
  const circles = members.map((p) => { const [cx, cy] = toPx(p.lonlat); return { cx, cy, rp: (p.r * 1000) / metresPerPx(p.lonlat[1]) }; });
  const x0 = Math.floor(Math.min(...circles.map((c) => c.cx - c.rp))) - 1, x1 = Math.ceil(Math.max(...circles.map((c) => c.cx + c.rp))) + 2;
  const y0 = Math.floor(Math.min(...circles.map((c) => c.cy - c.rp))) - 1, y1 = Math.ceil(Math.max(...circles.map((c) => c.cy + c.rp))) + 2;
  const G = await grid(x0, y0, x1, y1);
  const dist = (x, y) => Math.min(...circles.map((c) => Math.hypot(x + x0 - c.cx, y + y0 - c.cy) / c.rp)); // 0 at a peak, 1 at the window's edge
  // Each peak's summit: the highest point within its search radius (the marker moves there),
  // or with a radius of 0 the terrain at Wikidata's position.
  for (const p of members) {
    const [cx, cy] = toPx(p.lonlat), rp = (p.summit * 1000) / metresPerPx(p.lonlat[1]);
    let best = G.g[(Math.floor(cy) - y0) * G.w + (Math.floor(cx) - x0)], at = null;
    for (let y = Math.floor(cy - rp); y <= Math.ceil(cy + rp); y++) for (let x = Math.floor(cx - rp); x <= Math.ceil(cx + rp); x++) {
      if (!rp || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > rp) continue;
      const v = G.g[(y - y0) * G.w + (x - x0)];
      if (v > best) { best = v; at = [x + 0.5, y + 0.5]; }
    }
    p.elev = Math.round(best);
    if (at) p.lonlat = toLL(at).map((v) => Math.round(v * 1e5) / 1e5);
  }
  // Interval: the finest of these that gives at most 24 levels over the window's relief.
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (dist(x + 0.5, y + 0.5) <= 1) { const v = G.g[y * G.w + x]; if (v > 0 || onLand(toLL([x + x0 + 0.5, y + y0 + 0.5]))) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  const interval = [10, 20, 25, 50, 100, 200].find((s) => (hi - lo) / s <= 24) ?? 500;
  const slopeAt = slopeIn(G, Z);
  const features = [];
  for (let level = Math.ceil(lo / interval) * interval; level <= hi; level += interval) {
    // Every fourth level is an index line (x); i is the spacing of the level's class (4, 2 or 1 intervals), which with
    // the slope at each point (codes q) lets the map thin the lines where they'd crowd on screen.
    const x = level % (interval * 4) === 0 ? 1 : 0, i = x ? interval * 4 : level % (interval * 2) === 0 ? interval * 2 : interval;
    for (const line of isolines(G, level, (x, y) => dist(x, y) > 1)) {
      // Split into runs by fade band (0 near the peaks, 2 at the window's edge) and drop runs at sea.
      const band = (p) => { const d = dist(p[0], p[1]); return d < 0.6 ? 0 : d < 0.85 ? 1 : 2; };
      let run = [line[0]], b = band(line[0]);
      const flush = () => {
        if (run.length < 2) return;
        const sm = simplify(smooth(run), 0.4);
        const pts = sm.map(([x, y]) => toLL([x + x0, y + y0])).map(([lon, lat]) => [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]);
        const mid = pts[Math.floor(pts.length / 2)];
        if (pts.length > 1 && onLand(mid)) features.push({ type: 'Feature', properties: { e: level, b, x, i, q: sm.map(([x, y]) => slopeCode(slopeAt(x, y))) }, geometry: { type: 'LineString', coordinates: pts } });
      };
      for (let i = 1; i < line.length; i++) {
        const nb = band(line[i]);
        run.push(line[i]);
        if (nb !== b) { flush(); run = [line[i]]; b = nb; }
      }
      flush();
    }
  }
  const json = JSON.stringify({ type: 'FeatureCollection', features });
  await writeFile(`${BUILD}/${cid}.json`, json);
  totalKb += json.length / 1024;
  for (const p of members) out.push({ id: p.id, name: p.name, wiki: p.wiki ? { title: p.wiki, url: wikipediaUrl(p.wiki) } : null, lonlat: p.lonlat, elev: p.elev, r: p.r, cluster: cid, interval });
  console.log(`${cid}: ${members.map((p) => `${p.name} ${p.elev} m`).join(', ')} — ${interval} m contours from ${Math.round(lo)} to ${Math.round(hi)} m, ${features.length} lines, ${(json.length / 1024).toFixed(0)} KB`);
}
const peaksJson = JSON.stringify({
  attribution: 'Peaks: Wikidata (CC0). Elevations and contours: AWS Terrain Tiles (SRTM and GMTED2010 courtesy of the U.S. Geological Survey; ETOPO1, U.S. National Oceanic and Atmospheric Administration).',
  peaks: out,
});
console.log(`${out.length} peaks → public/data/peaks.json; contours ${totalKb.toFixed(0)} KB in ${clusters.size} files → public/data/terrain/`);

// ---- the light on the land: contours over the region Jesus travels, which the map draws in white around him ----
// Traced like the mountain contours above (which take over within a mountain's window). Each level has a class by the
// coarsest of 200, 100, 50, 25 and 12.5 m it falls on (0–4); the map shows a class only where its lines would sit far
// enough apart on screen, which it tells from the slope stored at every point (code q: 0.2 % × 2^(q/3)). The region from
// the zoom-11 tiles at 50 m levels (50 m only around Jerusalem); Egypt, seen from further out, at 100 m from zoom-8
// tiles; and, in their own files loaded as Jesus nears them, detail zones the map shows from close in (Jerusalem, and the
// north shore about Capernaum) at 12.5 m from zoom-12 tiles. Coordinates are integers in 1/unit of the web-mercator
// world, and coordinates and slope codes are delta-encoded along each line: [class, x0, y0, q0, dx1, dy1, dq1, …].
const ATTRIBUTION = 'Contours: AWS Terrain Tiles (SRTM and GMTED2010 courtesy of the U.S. Geological Survey; ETOPO1, U.S. National Oceanic and Atmospheric Administration).';
const JERUSALEM = [35.2345, 31.7767];
const placeLL = JSON.parse(await readFile('public/data/places.json', 'utf8')).places;
const llOf = (key) => placeLL[key].candidates[0].lonlat;
const classOf = (level) => { const l2 = Math.round(level * 2); return l2 % 400 === 0 ? 0 : l2 % 200 === 0 ? 1 : l2 % 100 === 0 ? 2 : l2 % 50 === 0 ? 3 : 4; };

/** Contour lines over a box (or within `circle` km of a point) at zoom z, every `step` m from `from`, encoded. */
async function traceLight({ z, box, circle, step, from, unit, tol, keep = () => true }) {
  const { size, px, ll, metresPerPx: mpp } = mercator(z);
  const [ax, ay] = px([box[0], box[3]]), [bx, by] = px([box[2], box[1]]);
  const G = await grid(Math.floor(ax), Math.floor(ay), Math.ceil(bx), Math.ceil(by), z);
  // Within a circle: only the cells inside it.
  let skip = () => false;
  if (circle) {
    const [cx, cy] = px(circle.ll), r = (circle.km * 1000) / mpp(circle.ll[1]);
    skip = (x, y) => Math.hypot(x + G.x0 - cx, y + G.y0 - cy) > r;
  }
  const slope = slopeIn(G, z);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (!skip(x + 0.5, y + 0.5)) { const v = G.g[y * G.w + x]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const out = [];
  let points = 0;
  for (let level = Math.max(from, Math.ceil(lo / step) * step); level <= hi; level += step) {
    if (level === 0) continue; // the coast is drawn already
    const cls = classOf(level);
    for (const line of isolines(G, level, skip)) {
      const pts = simplify(smooth(line), tol);
      // Inland only (the tiles carry sea-floor depths): the line's ends and middle mostly on land.
      const probes = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]].map(([x, y]) => ll([x + G.x0, y + G.y0]));
      if (probes.filter(onLand).length < 2 || !keep(cls, probes[1])) continue;
      const q = pts.map(([x, y]) => [Math.round(((x + G.x0) / size) * unit), Math.round(((y + G.y0) / size) * unit), slopeCode(slope(x, y))]);
      // A point that rounds onto the last one written is left out; deltas run from the last point written, where the
      // decoder's running sums are.
      const enc = [cls, ...q[0]];
      let last = q[0];
      for (let i = 1; i < q.length; i++) {
        const dx = q[i][0] - last[0], dy = q[i][1] - last[1];
        if (dx || dy) { enc.push(dx, dy, q[i][2] - last[2]); last = q[i]; }
      }
      if (enc.length < 7) continue;
      out.push(enc);
      points += (enc.length - 1) / 3;
    }
  }
  return { lines: out, points };
}

const UNIT = 4 * 256 * 2 ** Z; // about 16 m
const lightLines = [];
for (const R of [
  { name: 'Phoenicia to Judea', z: Z, box: [34.55, 31.15, 36.35, 33.65], step: 50, from: -400, keep: (cls, p) => cls < 2 || km(p, JERUSALEM) <= 20 },
  { name: 'Egypt', z: 8, box: [29.6, 28.7, 33.0, 31.6], step: 100, from: 100 },
]) {
  const { lines, points } = await traceLight({ ...R, unit: UNIT, tol: 0.6 });
  lightLines.push(...lines);
  console.log(`light on the land, ${R.name}: ${lines.length} lines, ${points} points (${R.step} m levels, zoom ${R.z})`);
}
// Detail zones: where the map shows the land from close in.
const DETAIL_UNIT = 16 * 256 * 2 ** Z; // about 4 m
const zones = [];
for (const D of [{ id: 'jerusalem', place: 'jerusalem', km: 9 }, { id: 'capernaum', place: 'capernaum', km: 9 }]) {
  const c = llOf(D.place), dLat = D.km / 111.2, dLon = dLat / Math.cos((c[1] * Math.PI) / 180);
  const { lines, points } = await traceLight({ z: 12, box: [c[0] - dLon, c[1] - dLat, c[0] + dLon, c[1] + dLat], circle: { ll: c, km: D.km }, step: 12.5, from: -425, unit: DETAIL_UNIT, tol: 0.5 });
  const json = JSON.stringify({ attribution: ATTRIBUTION, unit: DETAIL_UNIT, ll: c, km: D.km, lines });
  await writeFile(`${BUILD}/detail-${D.id}.json`, json);
  zones.push({ id: D.id, ll: c, km: D.km });
  console.log(`light on the land, detail about ${D.place}: ${lines.length} lines, ${points} points (12.5 m levels, zoom 12) → detail-${D.id}.json (${(json.length / 1024).toFixed(0)} KB)`);
}
// The Sea of Galilee's shore, traced from the same tiles (zoom 12) so it lines up with the contours: the water surface
// is flat in the terrain data, so the cells within 1 m of it, joined to the lake's centre, are the lake. That line
// wanders cell by cell through the marshy deltas and up stream mouths, which lit up as a blotchy band, so the lake is
// opened and closed with a ~100 m disc (dropping inlets and spits narrower than ~200 m), blurred by ~80 m and traced
// at the middle: one clean line of about 225 points. It replaces the coarser Natural Earth outline in
// public/data/geo/lakes.json (written by build-geo.mjs, which runs first).
let lakesJson;
{
  const centre = llOf('sea-of-galilee'), z = 12, { px, ll } = mercator(z);
  const [ax, ay] = px([35.45, 32.95]), [bx, by] = px([35.72, 32.65]);
  const G = await grid(Math.floor(ax), Math.floor(ay), Math.ceil(bx), Math.ceil(by), z);
  // The water's level: the middle of the values about the lake's centre (all the same, where it's water).
  const [cx, cy] = px(centre), near = [];
  for (let dy = -20; dy <= 20; dy++) for (let dx = -20; dx <= 20; dx++) near.push(G.g[(Math.round(cy) - G.y0 + dy) * G.w + Math.round(cx) - G.x0 + dx]);
  near.sort((a, b) => a - b);
  const water = near[near.length >> 1];
  const { w, h } = G, lake = new Uint8Array(w * h), todo = [(Math.round(cy) - G.y0) * w + Math.round(cx) - G.x0];
  while (todo.length) {
    const i = todo.pop();
    if (lake[i] || G.g[i] > water + 1) continue;
    lake[i] = 1;
    const x = i % w, y = (i - x) / w;
    if (x > 0) todo.push(i - 1);
    if (x < w - 1) todo.push(i + 1);
    if (y > 0) todo.push(i - w);
    if (y < h - 1) todo.push(i + w);
  }
  const R = 3, opened = morph(morph(lake, w, h, R, false), w, h, R, true), closed = morph(morph(opened, w, h, R, true), w, h, R, false);
  const rings = isolines({ w, h, g: blur(closed, w, h, 2.5) }, 0.5, () => false).map((line) => line.map(([x, y]) => [x + G.x0, y + G.y0]));
  const shore = rings.filter((r) => r.length > 100 && inRing([cx, cy], r)).sort((a, b) => b.length - a.length)[0];
  if (!shore) throw new Error('no shoreline found for the Sea of Galilee');
  const ring = simplify(shore, 0.4).map(ll).map(([lon, lat]) => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0]);
  const lakes = JSON.parse(await readFile('public/data/geo/lakes.json', 'utf8'));
  const f = lakes.features.find((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).some((p) => inRing(centre, p[0])));
  if (!f) throw new Error('the Sea of Galilee is not in lakes.json');
  f.geometry = { type: 'Polygon', coordinates: [ring] };
  lakesJson = JSON.stringify(lakes);
  console.log(`Sea of Galilee: shore traced at ${(water + 1).toFixed(1)} m (water ${water.toFixed(1)} m), ${ring.length} points → public/data/geo/lakes.json`);
}
const lightJson = JSON.stringify({ attribution: ATTRIBUTION, unit: UNIT, zones, lines: lightLines });
await writeFile(`${BUILD}/region.json`, lightJson);
console.log(`light on the land → public/data/terrain/region.json (${(lightJson.length / 1024).toFixed(0)} KB)`);
// Everything built: swap the new terrain folder in and write the files held back.
await rm('public/data/terrain', { recursive: true, force: true });
await rename(BUILD, 'public/data/terrain');
await writeFile('public/data/peaks.json', peaksJson);
await writeFile('public/data/geo/lakes.json', lakesJson);
const cached = await readdir(`data/raw/terrain/${Z}`).catch(() => []);
console.log(`terrain tiles cached in data/raw/terrain/${Z} (${cached.length} columns)`);
