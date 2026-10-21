// His light on the land: the contour lines near Jesus drawn in white, fading with distance from him. A MapLibre custom
// layer (WebGL2) under the route. About a named place the light is a pool that travels with his marker; in an area (a
// region, or the likely area where no place is named) it grows smoothly to cover the area, in place of a shaded circle.
// In a mountain section the candidate peaks are lit too, each joined to his light by a lit corridor, and within their
// windows the mountains' own (finer) contours take over from the region's.
//
// Each line shows only where its lines sit far enough apart on screen, which the vertex shader tells from the slope
// stored at every point: finer contours appear on gentle ground and as the map zooms in, and steep ground doesn't turn
// to a white smear. Where the map shows the land from close in (Jerusalem, Capernaum) finer detail zones load as Jesus
// nears them and take over from the region's lines.
//
// Lines are drawn as instanced segments: each vertex is stored once, an instance draws the segment from one vertex to
// the next, and a flag ends a line. The region's lines are cut into short pieces sorted into a coarse grid, so a frame
// draws only the rows of cells the light reaches. Coordinates are kept relative to an origin near the data, so 32-bit
// floats stay precise at any zoom.
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { LonLat } from './geo';

/** Contours from scripts/build-terrain.mjs: integer mercator coordinates (1/unit) and slope codes q (slope
 *  0.002 × 2^(q/3)), delta-encoded along each line: [class, x0, y0, q0, dx1, dy1, dq1, …]. */
export interface ContourData { unit: number; lines: number[][] }
export interface RegionData extends ContourData { zones?: { id: string; ll: LonLat; km: number }[] }
/** A mountain's window (its peak and radius in km): within it the mountain's own contours take over. */
export interface MountainWindow { ll: LonLat; km: number }

type XY = [number, number];
const CELL = 1 / 4096; // culling grid cell, in mercator units (about 8 km here)
const PIECE = 24; // most vertices in a piece of line
const POINT_PX = 120; // radius of the light about a named place, in CSS pixels
const FAR_ZOOM = [5.8, 7.2]; // the light fades out as the map zooms out across these
const FAR_MIN = 0.03;
const MAX_WINDOWS = 8, MAX_ZONES = 4, MAX_PEAKS = 6, MAX_POOLS = 4;
const FLOATS = 4; // per vertex: x, y, class (a mountain line's band; < 0 ends a line), slope (< 0: not known)

const merc = (ll: LonLat): XY => { const m = MercatorCoordinate.fromLngLat(ll); return [m.x, m.y]; };
const kmToMerc = (km: number, lat: number) => km * 1000 * MercatorCoordinate.fromLngLat([0, lat]).meterInMercatorCoordinateUnits();
const ease = (t: number) => t * t * (3 - 2 * t);
const band = (z: number, a: number, b: number) => ease(Math.max(0, Math.min(1, (z - a) / (b - a))));
/** At most `max` of a list, saying so when some are left out (the shader has room for only so many). */
function capped<T>(list: T[], max: number, what: string) {
  if (list.length > max) console.warn(`land light: ${list.length} ${what}, only the first ${max} are lit`);
  return list.slice(0, max);
}
/** Fill a preallocated uniform array with vectors of `size`, zeroing the rest. */
function pack(dst: Float32Array, vs: ArrayLike<number>[], size: number) {
  dst.fill(0);
  for (let i = 0; i < vs.length && (i + 1) * size <= dst.length; i++) dst.set(vs[i], i * size);
  return dst;
}

/** A value easing towards its target over a set time. */
class Tween {
  private from: number; private to: number; private t0 = 0; private ms = 1;
  constructor(v: number) { this.from = this.to = v; }
  at(now: number) { return this.from + (this.to - this.from) * ease(Math.min(1, (now - this.t0) / this.ms)); }
  set(to: number, ms: number, now = performance.now()) { if (to === this.to) return; this.from = this.at(now); this.to = to; this.t0 = now; this.ms = ms; }
  get target() { return this.to; }
  done(now: number) { return now - this.t0 >= this.ms; }
}

/** Decode a contour file into lines of points in mercator units, each with its slope. */
function decode(data: ContourData) {
  return data.lines.map((l) => {
    const pts: [number, number, number][] = [];
    let x = 0, y = 0, q = 0;
    for (let i = 1; i + 2 < l.length; i += 3) { x += l[i]; y += l[i + 1]; q += l[i + 2]; pts.push([x / data.unit, y / data.unit, 0.002 * 2 ** (q / 3)]); }
    return { kind: l[0], pts };
  });
}

/** Shared by both shaders: how lit a point of the land is, for the set of lines being drawn (u_set: 0 the region's, 1 a
 *  mountain's, 2 a detail zone's, 3 the outline of the water he's at). */
const LIGHT = `
uniform vec2 u_centre;
uniform float u_radius;
uniform float u_inner;
uniform float u_strength;
uniform int u_set;
uniform vec3 u_peaks[${MAX_PEAKS}];
uniform int u_peakCount;
uniform float u_link;
uniform float u_mountain;
uniform vec3 u_windows[${MAX_WINDOWS}];
uniform int u_windowCount;
uniform vec4 u_zones[${MAX_ZONES}];
uniform int u_zoneCount;
uniform vec4 u_zone;
uniform vec3 u_pools[${MAX_POOLS}];
uniform int u_poolCount;
uniform float u_poolStrength;
uniform float u_outline;
float lightAt(vec2 p) {
  // The outline of the water he's at is lit all round.
  if (u_set == 3) return u_outline;
  // The pool about him, and in a mountain section each candidate peak, joined to him by a corridor that narrows or
  // widens from his light to the peak's window.
  float f = 1.0 - smoothstep(u_inner, 1.0, length(p - u_centre) / u_radius);
  for (int k = 0; k < ${MAX_PEAKS}; k++) {
    if (k >= u_peakCount) break;
    vec2 ab = u_peaks[k].xy - u_centre;
    float t = clamp(dot(p - u_centre, ab) / max(dot(ab, ab), 1e-14), 0.0, 1.0);
    float r = mix(u_link, u_peaks[k].z, t);
    f = max(f, (1.0 - smoothstep(0.45, 1.0, length(p - u_centre - ab * t) / r)) * u_mountain);
  }
  float a = f * u_strength;
  // Where the accounts name different places, a pool of light over the area about each.
  for (int k = 0; k < ${MAX_POOLS}; k++) {
    if (k >= u_poolCount) break;
    a = max(a, (1.0 - smoothstep(0.5, 1.0, length(p - u_pools[k].xy) / u_pools[k].z)) * u_poolStrength);
  }
  // Inside a mountain's window its own contours take over; inside a detail zone, the zone's.
  if (u_set == 1) a *= u_mountain;
  else for (int w = 0; w < ${MAX_WINDOWS}; w++) {
    if (w >= u_windowCount) break;
    a *= mix(1.0, smoothstep(0.85, 1.0, length(p - u_windows[w].xy) / u_windows[w].z), u_mountain);
  }
  if (u_set == 0) for (int z = 0; z < ${MAX_ZONES}; z++) {
    if (z >= u_zoneCount) break;
    a *= mix(1.0, smoothstep(0.85, 1.0, length(p - u_zones[z].xy) / u_zones[z].z), u_zones[z].w);
  }
  if (u_set == 2) a *= (1.0 - smoothstep(0.85, 1.0, length(p - u_zone.xy) / u_zone.z)) * u_zone.w;
  return a;
}`;

const VS = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_half;
uniform float u_kind[5];
uniform float u_mpp;
${LIGHT}
in vec2 a_corner;
in vec4 a_a;
in vec4 a_b;
out vec2 v_pos;
out float v_across;
out float v_k;
out float v_w;
const float INTERVAL[5] = float[5](200.0, 100.0, 50.0, 25.0, 12.5);
// Like a topographic map's: the coarser the class, the stronger the line.
const float WEIGHT[5] = float[5](1.0, 0.85, 0.75, 0.65, 0.55);
// How much a line shows at a point of this slope: as the map zooms in, and only where its class's lines sit far enough
// apart on screen. A mountain's lines (u_set 1) carry z = band + 4 × index + 10 × their class's spacing (m), and also
// fade by band towards the window's edge; an outline (u_set 3) always shows.
float classAt(float z, float slope) {
  if (u_set == 3) return 1.0;
  if (u_set == 1) {
    float rem = mod(z, 10.0), ix = rem > 3.5 ? 1.0 : 0.0, b = rem - 4.0 * ix, spacing = floor(z / 10.0);
    float km = (b < 0.5 ? 1.0 : b < 1.5 ? 0.75 : 0.4) * (ix > 0.5 ? 1.0 : 0.75);
    if (slope <= 0.0 || spacing <= 0.0) return km;
    // A mountain's rings are many in a small space when it's seen from far out: only those well apart show.
    return km * smoothstep(3.2, 5.2, spacing / slope / u_mpp);
  }
  int kind = int(z + 0.5);
  float k = u_kind[kind] * WEIGHT[kind];
  if (slope <= 0.0) return k;
  // Where a class's lines would sit under about 3 px apart (fading out from 4.2 px, gone by 2.2) they're left out
  // rather than blurring together.
  return k * smoothstep(2.2, 4.2, INTERVAL[kind] / slope / u_mpp);
}
void main() {
  v_across = a_corner.y * u_half;
  v_pos = a_a.xy;
  v_k = 0.0;
  if (a_a.z < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float ka = classAt(a_a.z, a_a.w), kb = classAt(a_a.z, a_b.w);
  // A segment that would come out unlit or unseen isn't drawn at all (the same for its four corners).
  if (max(ka, kb) * max(lightAt(a_a.xy), lightAt(a_b.xy)) < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  v_k = mix(ka, kb, a_corner.x);
  // Index lines (every 200 m, or a mountain's every fourth ring) a little bolder.
  v_w = u_set == 1 ? (mod(a_a.z, 10.0) > 3.5 ? 1.4 : 1.0) : u_set == 3 ? 1.0 : (a_a.z < 0.5 ? 1.4 : 1.0);
  vec4 ca = u_matrix * vec4(a_a.xy, 0.0, 1.0), cb = u_matrix * vec4(a_b.xy, 0.0, 1.0);
  vec2 sa = ca.xy / ca.w * u_viewport * 0.5, sb = cb.xy / cb.w * u_viewport * 0.5;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 t = len > 1e-3 ? d / len : vec2(1.0, 0.0), n = vec2(-t.y, t.x);
  // Each end reaches out by the half width, so the pieces of a line meet without gaps.
  vec2 s = mix(sa - t * u_half, sb + t * u_half, a_corner.x) + n * a_corner.y * u_half;
  v_pos = mix(a_a.xy, a_b.xy, len > 1e-3 ? dot(s - sa, t) / len : 0.0);
  gl_Position = vec4(s / (u_viewport * 0.5), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
uniform float u_core;
uniform float u_half;
${LIGHT}
in vec2 v_pos;
in float v_across;
in float v_k;
in float v_w;
out vec4 frag;
void main() {
  float a = lightAt(v_pos) * v_k;
  if (a < 0.004) discard;
  float x = abs(v_across), core = u_core * v_w, halo = 1.0 - x / u_half;
  frag = vec4(a * max(1.0 - smoothstep(core - 0.5, core + 0.5, x), 0.16 * halo * halo));
}`;

interface Lines { verts: Float32Array; buf: WebGLBuffer | null }
interface Zone { id: string; c: XY; r: number; lines: Lines | null; loading: boolean; fade: Tween }

export class LandLight implements CustomLayerInterface {
  readonly id = 'land-light';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  /** Off: nothing is drawn (Settings › Light on the land). */
  enabled = true;
  private map: MlMap | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private quad: WebGLBuffer | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private origin: XY = [0.6, 0.4];
  private region: (Lines & { cols: number; rows: number; gx0: number; gy0: number; starts: Uint32Array }) | null = null;
  private zones: Zone[] = [];
  private loadZone: ((id: string) => Promise<ContourData>) | null = null;
  // A mountain section: its contours, its windows, the peaks lit, and how present it is (fading in and out).
  private mountain: Lines | null = null;
  private windows: [number, number, number][] = [];
  private peaks: [number, number, number][] = [];
  private mountainSrc: { fc: FeatureCollection | null; windows: MountainWindow[]; peaks: MountainWindow[] } = { fc: null, windows: [], peaks: [] };
  private m = new Tween(0);
  // Pools of light about the places where the accounts differ (p), and the outline of the water he's at (o).
  // Their sources are kept so that they can be placed again if the origin moves (the region loading after them).
  private pools: [number, number, number][] = [];
  private poolSrc: MountainWindow[] = [];
  private p = new Tween(0);
  private outline: (Lines & { key: string; rings: LonLat[][] }) | null = null;
  private o = new Tween(0);
  // Preallocated per-frame uniform data.
  private mat = new Float32Array(16);
  private kinds = new Float32Array(5);
  private peaksU = new Float32Array(MAX_PEAKS * 3);
  private windowsU = new Float32Array(MAX_WINDOWS * 3);
  private zonesU = new Float32Array(MAX_ZONES * 4);
  private poolsU = new Float32Array(MAX_POOLS * 3);
  private loadedZones: Zone[] = [];
  // The light: where his marker is drawn, the area it covers (blended in by e), its strength (s).
  private marker: XY | null = null;
  private area: { c: XY; r: number } | null = null;
  private areaFrom: { c: XY; r: number } | null = null;
  private areaT = new Tween(1);
  private e = new Tween(0);
  private s = new Tween(0);

  /** The region's contours (relative to an origin at their top-left), and how to load its detail zones. */
  setRegion(data: RegionData, loadZone: (id: string) => Promise<ContourData>) {
    const lines = decode(data);
    let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
    for (const l of lines) for (const [x, y] of l.pts) { gx0 = Math.min(gx0, x); gy0 = Math.min(gy0, y); gx1 = Math.max(gx1, x); gy1 = Math.max(gy1, y); }
    this.origin = [gx0, gy0];
    const cols = Math.ceil((gx1 - gx0) / CELL) + 1, rows = Math.ceil((gy1 - gy0) / CELL) + 1;
    // Cut each line into pieces short enough to stay within about half a cell, filed by the cell of their middle.
    const pieces: { cell: number; kind: number; pts: [number, number, number][] }[] = [];
    for (const l of lines) {
      let cur = [l.pts[0]], bx0 = l.pts[0][0], by0 = l.pts[0][1], bx1 = bx0, by1 = by0;
      const flush = () => {
        if (cur.length > 1) pieces.push({ cell: Math.floor(((by0 + by1) / 2 - gy0) / CELL) * cols + Math.floor(((bx0 + bx1) / 2 - gx0) / CELL), kind: l.kind, pts: cur });
      };
      for (let i = 1; i < l.pts.length; i++) {
        const p = l.pts[i], [x, y] = p;
        const nx0 = Math.min(bx0, x), ny0 = Math.min(by0, y), nx1 = Math.max(bx1, x), ny1 = Math.max(by1, y);
        if (cur.length >= PIECE || nx1 - nx0 > CELL / 2 || ny1 - ny0 > CELL / 2) {
          flush();
          const last = cur[cur.length - 1];
          cur = [last]; bx0 = Math.min(last[0], x); by0 = Math.min(last[1], y); bx1 = Math.max(last[0], x); by1 = Math.max(last[1], y);
        } else { bx0 = nx0; by0 = ny0; bx1 = nx1; by1 = ny1; }
        cur.push(p);
      }
      flush();
    }
    pieces.sort((a, b) => a.cell - b.cell);
    const total = pieces.reduce((n, p) => n + p.pts.length, 0);
    const verts = new Float32Array(total * FLOATS), starts = new Uint32Array(cols * rows + 1);
    let v = 0, cell = 0;
    for (const p of pieces) {
      while (cell <= p.cell) starts[cell++] = v;
      p.pts.forEach(([x, y, s], i) => { verts.set([x - gx0, y - gy0, i < p.pts.length - 1 ? p.kind : -1, s], v * FLOATS); v++; });
    }
    while (cell <= cols * rows) starts[cell++] = v;
    this.region = { verts, buf: null, cols, rows, gx0, gy0, starts };
    this.loadZone = loadZone;
    this.zones = capped(data.zones ?? [], MAX_ZONES, 'detail zones').map((z) => { const [x, y, r] = this.rel(z); return { id: z.id, c: [x, y], r, lines: null, loading: false, fade: new Tween(0) }; });
    // The mountain's lines, the pools and the outline were placed against the old origin.
    if (this.mountainSrc.fc) this.setMountain(this.mountainSrc.fc, this.mountainSrc.windows, this.mountainSrc.peaks);
    this.pools = this.poolSrc.map((w) => this.rel(w));
    if (this.outline) {
      if (this.outline.buf) this.gl?.deleteBuffer(this.outline.buf);
      this.outline = this.outlineLines(this.outline.key, this.outline.rings);
    }
    this.map?.triggerRepaint();
  }

  /** A circle (centre and radius in km) relative to the origin, in mercator units. */
  private rel(w: MountainWindow): [number, number, number] {
    const [x, y] = merc(w.ll);
    return [x - this.origin[0], y - this.origin[1], kmToMerc(w.km, w.ll[1])];
  }

  private outlineLines(key: string, rings: LonLat[][]) {
    return { ...this.lineSet(rings.map((r) => ({ kind: 0, pts: r.map((ll) => [...merc(ll), -1] as [number, number, number]) }))), key, rings };
  }

  /** A whole line set, relative to the origin (no culling: a zone's, or a mountain's). */
  private lineSet(lines: { kind: number; pts: [number, number, number][] }[]): Lines {
    const [ox, oy] = this.origin, out: number[] = [];
    for (const l of lines) l.pts.forEach(([x, y, s], i) => out.push(x - ox, y - oy, i < l.pts.length - 1 ? l.kind : -1, s));
    return { verts: new Float32Array(out), buf: null };
  }

  /** A mountain section: its contours (bands b: 0 near the peaks, 2 at the window's edge), the windows they fill, and
   *  the candidate peaks to light (window radius in km); null to end it, which fades it out. */
  setMountain(fc: FeatureCollection | null, windows: MountainWindow[], peaks: MountainWindow[]) {
    this.mountainSrc = { fc, windows, peaks };
    if (!fc) { this.m.set(0, 800); this.map?.triggerRepaint(); return; }
    this.windows = capped(windows, MAX_WINDOWS, 'mountain windows').map((w) => this.rel(w));
    this.peaks = capped(peaks, MAX_PEAKS, 'peaks').map((w) => this.rel(w));
    if (this.mountain?.buf) this.gl?.deleteBuffer(this.mountain.buf);
    // Each line's band, index flag and class spacing packed as band + 4 × index + 10 × spacing; its slope at each point.
    const lines = fc.features.filter((f) => f.geometry.type === 'LineString').map((f) => {
      const pr = f.properties ?? {}, q = Array.isArray(pr.q) ? (pr.q as number[]) : null;
      return {
        kind: Number(pr.b ?? 0) + 4 * Number(pr.x ?? 0) + 10 * Number(pr.i ?? 0),
        pts: (f.geometry as GeoJSON.LineString).coordinates.map((ll, j) => [...merc(ll as LonLat), q ? 0.002 * 2 ** (q[j] / 3) : -1] as [number, number, number]),
      };
    });
    this.mountain = this.lineSet(lines);
    this.m.set(1, 1200);
    this.map?.triggerRepaint();
  }

  /** Where his marker is drawn (null: not placed). */
  follow(ll: LonLat | null) {
    this.marker = ll ? merc(ll) : null;
    const now = performance.now();
    // Nothing to draw again while the layer is off or his light is out.
    if (!this.enabled || (this.s.target === 0 && this.s.done(now))) return;
    // Only a light that is (partly) about the marker needs drawing again.
    if (this.e.target < 1 || !this.e.done(now)) this.map?.triggerRepaint();
  }

  /** A pool of light about him: at a named place, or travelling; fainter (`strength` under 1) while he rests. */
  point(strength = 1) {
    this.e.set(0, 900);
    this.s.set(strength, 600);
    this.map?.triggerRepaint();
  }

  /** Grow to cover an area: its centre and radius (km). */
  cover(c: LonLat, km: number) {
    const next = { c: merc(c), r: kmToMerc(km, c[1]) }, now = performance.now();
    if (this.area && this.e.at(now) > 0.01 && (this.area.c[0] !== next.c[0] || this.area.c[1] !== next.c[1] || this.area.r !== next.r)) {
      // From one area straight to another: the covered circle moves and resizes.
      this.areaFrom = this.areaNow(now);
      this.areaT = new Tween(0);
      this.areaT.set(1, 1200, now);
    }
    this.area = next;
    this.e.set(1, 1400, now);
    this.s.set(1, 600, now);
    this.map?.triggerRepaint();
  }

  /** Out: a scene he isn't in, or no single place. */
  off() {
    this.s.set(0, 600);
    this.map?.triggerRepaint();
  }

  /** Pools of light over the areas about places (where the accounts name different places), each with its radius in
   *  km; null fades them out. */
  setPools(list: MountainWindow[] | null) {
    if (!list?.length) { this.p.set(0, 700); this.map?.triggerRepaint(); return; }
    this.poolSrc = capped(list, MAX_POOLS, 'pools');
    this.pools = this.poolSrc.map((w) => this.rel(w));
    this.p.set(1, 1000);
    this.map?.triggerRepaint();
  }

  /** The outline of the water he's at (its shore, as rings), lit all round; null fades it out. */
  setOutline(key: string | null, rings: LonLat[][] = []) {
    if (!key) { this.o.set(0, 700); this.map?.triggerRepaint(); return; }
    if (this.outline?.key !== key) {
      if (this.outline?.buf) this.gl?.deleteBuffer(this.outline.buf);
      this.outline = this.outlineLines(key, rings);
    }
    this.o.set(1, 900);
    this.map?.triggerRepaint();
  }

  /** For tests: the region's points loaded, the detail zones loaded, a mountain's lines and lit peaks, how far the
   *  light covers an area (0–1), its strength, the pools lit and the outline's strength. */
  status() {
    const now = performance.now();
    return {
      points: this.region ? this.region.verts.length / FLOATS : 0, zones: this.zones.filter((z) => z.lines).map((z) => z.id),
      mountainPoints: this.mountain ? this.mountain.verts.length / FLOATS : 0, peaks: this.peaks.length, mountain: this.m.at(now),
      cover: this.e.at(now), strength: this.s.at(now), enabled: this.enabled,
      pools: this.p.target ? this.pools.length : 0, outline: this.o.at(now),
    };
  }

  onAdd(map: MlMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`land light shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'a_corner');
    gl.bindAttribLocation(prog, 1, 'a_a');
    gl.bindAttribLocation(prog, 2, 'a_b');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`land light program: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
    for (const u of ['u_matrix', 'u_viewport', 'u_half', 'u_set', 'u_kind', 'u_mpp', 'u_centre', 'u_radius', 'u_inner', 'u_strength', 'u_core',
      'u_peaks', 'u_peakCount', 'u_link', 'u_mountain', 'u_windows', 'u_windowCount', 'u_zones', 'u_zoneCount', 'u_zone',
      'u_pools', 'u_poolCount', 'u_poolStrength', 'u_outline']) this.loc[u] = gl.getUniformLocation(prog, u);
    this.vao = gl.createVertexArray();
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  }

  onRemove(_map: MlMap, gl: WebGL2RenderingContext) {
    // The vertices stay; their buffers are made again on the next draw if the layer is added back.
    for (const l of [this.region, this.mountain, this.outline, ...this.zones.map((z) => z.lines)]) if (l?.buf) { gl.deleteBuffer(l.buf); l.buf = null; }
    if (this.quad) gl.deleteBuffer(this.quad);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.prog) gl.deleteProgram(this.prog);
    this.quad = this.vao = this.prog = null;
    this.loc = {};
    this.map = null;
    this.gl = null;
  }

  private areaNow(now: number) {
    if (!this.area) return null;
    const k = this.areaT.at(now), f = this.areaFrom;
    if (!f || k >= 1) return this.area;
    return { c: [f.c[0] + (this.area.c[0] - f.c[0]) * k, f.c[1] + (this.area.c[1] - f.c[1]) * k] as XY, r: f.r + (this.area.r - f.r) * k };
  }

  render(gl: WebGL2RenderingContext, opts: CustomRenderMethodInput) {
    const map = this.map;
    if (!map || !this.prog || !this.enabled) return;
    const now = performance.now();
    const moving = !this.e.done(now) || !this.s.done(now) || !this.areaT.done(now) || !this.m.done(now) || !this.p.done(now) || !this.o.done(now) || this.zones.some((z) => !z.fade.done(now));
    if (moving) map.triggerRepaint();
    // A mountain section, pools or an outline that have faded out are let go.
    if (this.m.target === 0 && this.m.done(now) && this.mountain) {
      if (this.mountain.buf) gl.deleteBuffer(this.mountain.buf);
      this.mountain = null; this.windows = []; this.peaks = [];
    }
    if (this.p.target === 0 && this.p.done(now) && this.pools.length) { this.pools = []; this.poolSrc = []; }
    if (this.o.target === 0 && this.o.done(now) && this.outline) {
      if (this.outline.buf) gl.deleteBuffer(this.outline.buf);
      this.outline = null;
    }
    const e = this.e.at(now), mt = this.m.at(now), pv = this.p.at(now), ov = this.o.at(now), area = this.areaNow(now);
    const at = this.marker ?? area?.c ?? null;
    // His light needs somewhere to be about; the pools and an outline don't.
    const s = at ? this.s.at(now) : 0;
    if (!this.region || (s < 0.002 && pv < 0.002 && ov < 0.002)) return;
    // Centre and reach: the pool about the marker, blended into the area as it grows to cover it.
    const zoom = map.getZoom(), dpr = map.getPixelRatio(), lat = map.getCenter().lat;
    const pointR = POINT_PX / (512 * 2 ** zoom);
    // Zoomed far out the pool would reach the edge of the region the contours cover and show it as a box, so the light
    // dies away as the map zooms out past the broad view of the land.
    const far = FAR_MIN + (1 - FAR_MIN) * band(zoom, FAR_ZOOM[0], FAR_ZOOM[1]);
    const [ox, oy] = this.origin;
    const here: XY = at ?? (this.pools.length ? [this.pools[0][0] + ox, this.pools[0][1] + oy] : [ox, oy]);
    const c: XY = area && e > 0 ? [here[0] + (area.c[0] - here[0]) * e, here[1] + (area.c[1] - here[1]) * e] : here;
    const r = area && e > 0 ? pointR + (area.r - pointR) * e : pointR;
    const lc: XY = [c[0] - ox, c[1] - oy];

    // Detail zones load as the light comes within 30 km of them, and fade in.
    for (const z of this.zones) {
      if (z.lines || z.loading || !this.loadZone || Math.hypot(lc[0] - z.c[0], lc[1] - z.c[1]) > z.r + kmToMerc(30, lat)) continue;
      z.loading = true;
      // (Placed against the origin when they arrive; the layer may have been removed meanwhile.)
      this.loadZone(z.id).then((d) => { z.lines = this.lineSet(decode(d)); z.fade.set(1, 700); this.map?.triggerRepaint(); }).catch(() => { /* the region's lines stay */ });
    }
    const zones = this.loadedZones;
    zones.length = 0;
    for (const z of this.zones) if (z.lines) zones.push(z);

    const M = opts.defaultProjectionData.mainMatrix as ArrayLike<number>, mat = this.mat;
    for (let i = 0; i < 16; i++) mat[i] = M[i];
    for (let i = 0; i < 4; i++) mat[12 + i] = M[i] * ox + M[4 + i] * oy + M[12 + i];
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.loc.u_matrix, false, mat);
    gl.uniform2f(this.loc.u_viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const half = 2 * dpr;
    gl.uniform1f(this.loc.u_half, half);
    gl.uniform1f(this.loc.u_core, 0.5 * dpr);
    gl.uniform2f(this.loc.u_centre, lc[0], lc[1]);
    gl.uniform1f(this.loc.u_radius, r);
    // A pool about him; covering an area, an even wash that fades towards its edge.
    gl.uniform1f(this.loc.u_inner, 0.1 + 0.4 * e);
    gl.uniform1f(this.loc.u_strength, (0.85 - 0.15 * e) * s * far);
    // Classes (200, 100, 50, 25, 12.5 m) come in as the map zooms in, the 100 m ones only past the broad views of a
    // region (which read best with the 200 m lines alone); the slope then decides where each shows.
    const kinds = this.kinds;
    kinds[0] = 0.4 + 0.6 * band(zoom, 7, 8.5); kinds[1] = band(zoom, 9.4, 10); kinds[2] = band(zoom, 9.6, 10.2); kinds[3] = band(zoom, 9.8, 10.4); kinds[4] = band(zoom, 10.2, 10.8);
    gl.uniform1fv(this.loc.u_kind, kinds);
    gl.uniform1f(this.loc.u_mpp, (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom));
    gl.uniform3fv(this.loc.u_peaks, pack(this.peaksU, this.peaks, 3));
    gl.uniform1i(this.loc.u_peakCount, this.peaks.length);
    gl.uniform1f(this.loc.u_link, r * 0.6);
    gl.uniform1f(this.loc.u_mountain, mt);
    gl.uniform3fv(this.loc.u_windows, pack(this.windowsU, this.windows, 3));
    gl.uniform1i(this.loc.u_windowCount, this.windows.length);
    const zu = this.zonesU;
    zu.fill(0);
    zones.forEach((z, i) => { zu[i * 4] = z.c[0]; zu[i * 4 + 1] = z.c[1]; zu[i * 4 + 2] = z.r; zu[i * 4 + 3] = z.fade.at(now); });
    gl.uniform4fv(this.loc.u_zones, zu);
    gl.uniform1i(this.loc.u_zoneCount, zones.length);
    gl.uniform3fv(this.loc.u_pools, pack(this.poolsU, this.pools, 3));
    gl.uniform1i(this.loc.u_poolCount, this.pools.length);
    gl.uniform1f(this.loc.u_poolStrength, 0.75 * pv * far);
    gl.uniform1f(this.loc.u_outline, 0.9 * ov * far);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribDivisor(1, 1);
    gl.vertexAttribDivisor(2, 1);
    const stride = FLOATS * 4;
    const draw = (lines: Lines, from: number, to: number) => {
      if (to - from < 2) return;
      if (!lines.buf) {
        lines.buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, lines.buf);
        gl.bufferData(gl.ARRAY_BUFFER, lines.verts, gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, lines.buf);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, from * stride);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, (from + 1) * stride);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, to - from - 1);
    };

    // The region: only the rows of cells the light reaches (pieces reach up to half a cell beyond their own): the pool
    // about him, with a mountain section the corridors to its peaks, and any pools.
    const R = this.region;
    gl.uniform1i(this.loc.u_set, 0);
    let [bx0, by0, bx1, by1] = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = (x: number, y: number, pad: number) => { bx0 = Math.min(bx0, x - pad); by0 = Math.min(by0, y - pad); bx1 = Math.max(bx1, x + pad); by1 = Math.max(by1, y + pad); };
    if (s >= 0.002) {
      grow(lc[0], lc[1], r + CELL / 2 + half / (512 * 2 ** zoom * dpr));
      if (mt > 0) for (const [x, y, pr] of this.peaks) grow(x, y, Math.max(pr, r) + CELL / 2);
    }
    if (pv > 0) for (const [x, y, pr] of this.pools) grow(x, y, pr + CELL / 2);
    const ca = Math.max(0, Math.floor(bx0 / CELL)), cb = Math.min(R.cols - 1, Math.floor(bx1 / CELL));
    const ra = Math.max(0, Math.floor(by0 / CELL)), rb = Math.min(R.rows - 1, Math.floor(by1 / CELL));
    if (bx0 <= bx1 && ca <= cb) for (let row = ra; row <= rb; row++) draw(R, R.starts[row * R.cols + ca], R.starts[row * R.cols + cb + 1]);
    // Detail zones: those that meet the box the light reaches.
    gl.uniform1i(this.loc.u_set, 2);
    for (const z of zones) {
      const dx = Math.max(bx0 - z.c[0], 0, z.c[0] - bx1), dy = Math.max(by0 - z.c[1], 0, z.c[1] - by1);
      if (bx0 > bx1 || dx * dx + dy * dy > z.r * z.r) continue;
      gl.uniform4f(this.loc.u_zone, z.c[0], z.c[1], z.r, z.fade.at(now));
      draw(z.lines!, 0, z.lines!.verts.length / FLOATS);
    }
    // A mountain section's contours.
    if (this.mountain && mt > 0) {
      gl.uniform1i(this.loc.u_set, 1);
      draw(this.mountain, 0, this.mountain.verts.length / FLOATS);
    }
    // The outline of the water he's at, a little wider than the contours.
    if (this.outline && ov > 0) {
      gl.uniform1i(this.loc.u_set, 3);
      gl.uniform1f(this.loc.u_core, 0.9 * dpr);
      draw(this.outline, 0, this.outline.verts.length / FLOATS);
    }
    gl.bindVertexArray(null);
  }
}
