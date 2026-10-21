// The land coloured by height, for the map's Land colour › Height option: a soft image laid over the land fill,
// from the AWS Terrain Tiles (Terrarium) at zoom 8 (about 520 m a pixel), over the Nile delta to Damascus. Low ground
// is sage, the hills sand and ochre, the heights terracotta, the highest (Hermon) pale stone: a colour for each height,
// nothing more (no vegetation or land use). The sea is left clear (flooded from the image's edges through ground at or
// below sea level, so the Jordan rift, below sea level but walled off from the sea, keeps its colour); the lakes are
// drawn over it on the map. Away from the places in the accounts the colour fades into the plain land, over a distance
// that wanders (smooth noise), so the coloured land has no edge or shape of its own.
//
//   node scripts/build-relief.mjs   →  public/data/relief.png, src/data/relief.json (its corners)

import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { terrariumTile } from './lib/terrain.mjs';

const Z = 8;
const BOX = { W: 29.5, S: 28.6, E: 37.8, N: 34.9 };
const NEAR_KM = 40, FAR_KM = 140; // full colour within NEAR_KM of a place, none past FAR_KM
const WOBBLE_KM = 28; // how far the noise moves the fade in or out

const SIZE = 256 * 2 ** Z;
const px = (lon) => ((lon + 180) / 360) * SIZE;
const py = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * SIZE; };
const lonOf = (x) => (x / SIZE) * 360 - 180;
const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / SIZE))) * 180) / Math.PI;

const x0 = Math.floor(px(BOX.W)), x1 = Math.ceil(px(BOX.E)), y0 = Math.floor(py(BOX.N)), y1 = Math.ceil(py(BOX.S));
const w = x1 - x0, h = y1 - y0;
const g = new Float32Array(w * h);
for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y1 - 1) / 256); ty++) for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x1 - 1) / 256); tx++) {
  const t = await terrariumTile(tx, ty, Z);
  for (let y = 0; y < 256; y++) {
    const gy = ty * 256 + y - y0;
    if (gy < 0 || gy >= h) continue;
    for (let x = 0; x < 256; x++) { const gx = tx * 256 + x - x0; if (gx >= 0 && gx < w) g[gy * w + gx] = t[y * 256 + x]; }
  }
}

// A few tiles carry stray rows far from their neighbours (a white streak in Arabia): such a pixel takes the median of
// the 3 × 3 around it.
{
  const src = g.slice(), n = new Float32Array(9);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n[k++] = src[(y + dy) * w + x + dx];
    const med = n.sort()[4], i = y * w + x;
    if (Math.abs(src[i] - med) > 250) g[i] = med;
  }
}

// The sea: ground at or below sea level reached from the image's edges, then a pixel more, so no colour spills past
// the map's own coastline.
const sea = new Uint8Array(w * h);
const queue = [];
const seed = (i) => { if (!sea[i] && g[i] <= 0) { sea[i] = 1; queue.push(i); } };
for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
while (queue.length) {
  const i = queue.pop(), x = i % w, y = (i / w) | 0;
  if (x > 0) seed(i - 1); if (x < w - 1) seed(i + 1); if (y > 0) seed(i - w); if (y < h - 1) seed(i + w);
}
const clear = sea.slice();
for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (sea[i - 1] || sea[i + 1] || sea[i - w] || sea[i + w]) clear[i] = 1; }

// Height (m) → colour, the land fill (#E2D4B0) lying about 600 m.
const RAMP = [
  [-420, [172, 188, 150]],
  [0, [192, 201, 158]],
  [300, [211, 208, 164]],
  [600, [226, 210, 168]],
  [900, [218, 188, 140]],
  [1300, [204, 164, 124]],
  [2000, [222, 210, 196]],
  [2800, [244, 240, 232]],
];
function colour(m) {
  if (m <= RAMP[0][0]) return RAMP[0][1];
  for (let k = 1; k < RAMP.length; k++) {
    const [h1, c1] = RAMP[k];
    if (m <= h1) { const [h0, c0] = RAMP[k - 1], t = (m - h0) / (h1 - h0); return c0.map((v, j) => v + (c1[j] - v) * t); }
  }
  return RAMP[RAMP.length - 1][1];
}

// Distance (km) from the nearest place in the accounts: a chamfer distance transform in pixels, then km at each row's
// latitude.
const places = Object.values(JSON.parse(await readFile('public/data/places.json', 'utf8')).places).map((p) => p.candidates?.[0]?.lonlat).filter(Boolean);
const dist = new Float32Array(w * h).fill(1e9);
for (const [lon, lat] of places) {
  const x = Math.round(px(lon) - x0), y = Math.round(py(lat) - y0);
  if (x >= 0 && x < w && y >= 0 && y < h) dist[y * w + x] = 0;
}
const D = Math.SQRT2;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = y * w + x;
  let d = dist[i];
  if (x > 0) d = Math.min(d, dist[i - 1] + 1);
  if (y > 0) { d = Math.min(d, dist[i - w] + 1); if (x > 0) d = Math.min(d, dist[i - w - 1] + D); if (x < w - 1) d = Math.min(d, dist[i - w + 1] + D); }
  dist[i] = d;
}
for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
  const i = y * w + x;
  let d = dist[i];
  if (x < w - 1) d = Math.min(d, dist[i + 1] + 1);
  if (y < h - 1) { d = Math.min(d, dist[i + w] + 1); if (x < w - 1) d = Math.min(d, dist[i + w + 1] + D); if (x > 0) d = Math.min(d, dist[i + w - 1] + D); }
  dist[i] = d;
}
// Smooth value noise, two octaves (about 60 and 25 km), the same on every build.
const hash = (i, j) => { let n = Math.imul(i, 374761393) + Math.imul(j, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const smooth = (t) => t * t * (3 - 2 * t);
function noise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = smooth(x - i), v = smooth(y - j);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * u, b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * u;
  return (a + (b - a) * v) * 2 - 1;
}
const wobble = (x, y) => (noise(x / 115, y / 115) * 0.7 + noise(x / 48 + 17.3, y / 48 + 5.1) * 0.3) * WOBBLE_KM;

const rgba = Buffer.alloc(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = y * w + x;
  if (clear[i]) continue;
  const pxKm = (40075.017 * Math.cos((latOf(y0 + y + 0.5) * Math.PI) / 180)) / SIZE;
  const t = Math.min(1, Math.max(0, (dist[i] * pxKm + wobble(x, y) - NEAR_KM) / (FAR_KM - NEAR_KM))), fade = 1 - smooth(t);
  if (fade <= 0) continue;
  const c = colour(g[i]);
  rgba[i * 4] = Math.round(c[0]); rgba[i * 4 + 1] = Math.round(c[1]); rgba[i * 4 + 2] = Math.round(c[2]);
  rgba[i * 4 + 3] = Math.round(255 * fade);
}

// ---- a minimal PNG encoder (8-bit RGBA, each row filtered against the pixel to its left) ----
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
for (let y = 0; y < h; y++) {
  raw[y * (stride + 1)] = 1;
  for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = (rgba[y * stride + x] - (x >= 4 ? rgba[y * stride + x - 4] : 0)) & 255;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
await writeFile('public/data/relief.png', png);

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [r6(lonOf(x)), r6(latOf(y))]);
await writeFile('src/data/relief.json', JSON.stringify({
  about: 'Corners (top left, top right, bottom right, bottom left) of public/data/relief.png, built by scripts/build-relief.mjs.',
  attribution: 'Land colour: AWS Terrain Tiles (SRTM and GMTED2010, USGS; ETOPO1, NOAA).',
  corners,
}, null, 2) + '\n');
console.log(`relief: ${w} × ${h} px, ${(png.length / 1024).toFixed(0)} KB`);
