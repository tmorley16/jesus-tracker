import 'maplibre-gl/dist/maplibre-gl.css';
import { AttributionControl, LngLat, Map as MlMap, Marker, Popup, ScaleControl, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl';
// MapLibre 6 looks for its worker next to its own module, which bundling breaks;
// bundle the worker (with the code it imports) and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection } from 'geojson';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfigButton } from './Config';
import { bearingDeg, bounds, circleRing, dryLand, haversineKm, inRing, lerp, type LonLat } from './geo';
import { declutter, type Label } from './mapLabels';
import { AREAS, BIRTH, BOOK_ABBR, MAP_START, ROWS, mountainFor, rowTitle, storiesAt, type Book } from './model';
import { loadPlaces, type PlaceData } from './places';
import { focusAreas, focusFor, headingFor, journey, restingFor, routeStops, routeTo, splits, travelTarget, type Focus } from './journey';
import { between, driftKm, halfway, legsFor, planRoute, shareTo, stopId, type Ground, type Step } from './route';
import { nav, placeMarks, scene, useUI } from './state';
import { useStore } from 'zustand';
import { LandLight } from './landLight';
import { TravellerMarker } from './traveller';

setWorkerUrl(new URL(workerUrl, import.meta.url).href);

const JERUSALEM_SITES = new Set(['jerusalem', 'gethsemane', 'golgotha', 'gabbatha', 'bethesda', 'siloam', 'mount-of-olives']);
// Places packed close together: their labels appear only once the map is zoomed in.
const CLOSE_SITES = new Set([...JERUSALEM_SITES, 'bethany', 'emmaus', 'gennesaret', 'magadan', 'bethsaida']);
CLOSE_SITES.delete('jerusalem');
// Close enough to read the place, wide enough to see its neighbours and the lie of the land.
const zoomFor = (key: string, p: PlaceData) => (JERUSALEM_SITES.has(key) ? 12.4 : key === 'bethany' ? 11 : p.kind === 'water' ? 9 : 9.2);
const EMPTY = { type: 'FeatureCollection' as const, features: [] };
// The standard view: the land of the gospels, from Tyre to the Dead Sea.
const HOME = { center: [35.4, 32.1] as LonLat, zoom: 7 };
type FC = FeatureCollection;
// The world the map covers (west, south, east, north): Italy to Persia. The view stays inside it.
const WORLD = [5, 12, 60, 48];
// In mountain sections, named peaks this far (km) beyond the place or area shown are shown too.
const PEAK_REACH = 20;
// Where the accounts name different places (the region of the Gadarenes, of the Gerasenes), the light covers this far
// about each, in km.
const SPLIT_KM = 12;
// From his birth, while he rests in a scene he isn't in, a little of his light on the land stays (a share of its strength).
const RESTING_LIGHT = 0.35;
const ABBR: Record<string, string> = { ...BOOK_ABBR, ACT: 'Acts' };
// How often each place is named, for deciding which labels win when they crowd.
const MENTIONS = new Map<string, number>();
for (const r of ROWS) for (const k of r.place ? (typeof r.place === 'string' ? [r.place] : Object.values(r.place)) : []) MENTIONS.set(k!, (MENTIONS.get(k!) ?? 0) + 1);
const MOST = Math.max(...MENTIONS.values());

function readColours(el: Element) {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return { land: v('--land'), water: v('--water'), shore: v('--shore'), ink: v('--ink'), veil: v('--map-veil') || v('--veil') || 'rgba(0,0,0,0)' };
}
/** The colour with alpha a (accepts #rrggbb and rgb()/rgba(), which registered custom properties compute to). */
function withAlpha(colour: string, a: number) {
  const hex = colour.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex) return `rgba(${parseInt(hex[1], 16)}, ${parseInt(hex[2], 16)}, ${parseInt(hex[3], 16)}, ${a})`;
  const rgb = colour.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${a})` : colour;
}
// Drawn in white and registered as SDF, so each arrow takes its leg's colour (icon-color).
function arrowImage() {
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(6, 16); ctx.lineTo(12, 8.5); ctx.lineTo(18, 16); ctx.stroke();
  return ctx.getImageData(0, 0, 48, 48);
}
// Jesus' light and his route are white: a fine line, with no casing or shadow.
const WHITE = '#ffffff';
/** The newest leg runs from half-strength white where it starts to full white where he is, drawn up to `head` (0–1). */
function trailGradient(head: number): ExpressionSpecification {
  if (head >= 0.999) return ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(255, 255, 255, 0.5)', 1, WHITE];
  const h = Math.max(0.0001, head);
  return ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(255, 255, 255, 0.5)', h, WHITE, h + 0.0001, 'rgba(255, 255, 255, 0)', 1, 'rgba(255, 255, 255, 0)'];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const wikiUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
const osmUrl = ([lon, lat]: LonLat, z: number) => `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=${z}/${lat.toFixed(5)}/${lon.toFixed(5)}`;
const googleUrl = ([lon, lat]: LonLat) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(5)}%2C${lon.toFixed(5)}`;
interface Link { label: string; href: string }
/** Only web links reach the page (the data's URLs are third-party). */
const webUrl = (href: string) => /^https?:\/\//i.test(href);
function placeLinks(key: string, p: PlaceData): Link[] {
  const ll = p.candidates[0].lonlat;
  const z = p.kind === 'region' ? Math.max(5, Math.min(11, Math.round(12 - Math.log2((AREAS[key] ?? 20) / 2)))) : p.kind === 'water' ? 11 : 15;
  const links: Link[] = [];
  if (p.wiki) links.push({ label: p.wiki.title === p.name ? 'Wikipedia' : `Wikipedia: ${p.wiki.title}`, href: wikiUrl(p.wiki.title) });
  if (p.openbible) links.push({ label: 'OpenBible.info', href: p.openbible.url });
  // Google Maps where it has a point to show; OpenStreetMap, framed to the area, for regions.
  links.push(p.kind === 'region' ? { label: 'OpenStreetMap', href: osmUrl(ll, z) } : { label: 'Google Maps', href: googleUrl(ll) });
  return links.filter((l) => webUrl(l.href));
}
const linksHtml = (links: Link[]) => `<p class="pp-links">${links.filter((l) => webUrl(l.href)).map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</p>`;
/** A modern name OpenBible gives for where the place is shown, when it differs from the place's own. */
function modernName(p: PlaceData): string | null {
  const label = p.candidates[0]?.label ?? '';
  if (p.kind === 'region' || !label || label === p.name || /^(same place as|within|along|approximate)/i.test(label)) return null;
  return label;
}

interface Peak { id: string; name: string; wiki: { title: string; url: string } | null; lonlat: LonLat; elev: number; r: number; cluster: string; interval: number }
/** The corners of each peak's contour window, so the camera can take them in. */
const peakCorners = (peaks: Peak[]): LonLat[] => peaks.flatMap(({ lonlat: [x, y], r }) => {
  const dy = r / 111.3, dx = dy / Math.cos((y * Math.PI) / 180);
  return [[x - dx, y - dy], [x + dx, y + dy]] as LonLat[];
});

interface PopupContent { ll: LonLat; html: string; /** The place shown, whose stories the timeline marks. */ place?: string }
/** A popup's content: `full` for a click or tap (a place's photo and stories), otherwise the short hover version. */
type Content = (full: boolean) => PopupContent | null;
/**
 * One popup for the map. Hovering (mouse) previews it, with a grace period to reach its links; a click or tap pins the
 * full version until it's closed or the map is clicked. While a place's popup is open, the timeline marks the stories
 * set there. The popup is kept to the room on the roomier side of its point, scrolling within if it needs more.
 */
function makePopup(map: MlMap, pick: (place: string) => boolean) {
  const popup = new Popup({ closeButton: false, closeOnClick: false, closeOnMove: false, focusAfterOpen: false, offset: 14, maxWidth: '300px', className: 'map-popup' });
  let showT = 0, hideT = 0, owner: object | null = null, pinned = false;
  const pin = (on: boolean) => { pinned = on; popup.getElement()?.classList.toggle('pinned', on); };
  const open = (c: PopupContent, by: object, pinIt: boolean) => {
    clearTimeout(hideT);
    owner = by;
    popup.setLngLat(c.ll).setHTML(c.html);
    if (!popup.isOpen()) popup.addTo(map);
    pin(pinIt);
    const el = popup.getElement();
    const h = map.getContainer().clientHeight, y = map.project(c.ll).y;
    let room = Math.max(y, h - y) - 34;
    // A pinned card short of room (a phone's map): move the place towards the far edge so the card fits.
    const want = Math.min(h - 60, 330);
    if (pinIt && room < want) {
      const above = y >= h - y, shift = Math.min(want - room, above ? h - 26 - y : y - 26);
      if (shift > 0) { map.panBy([0, above ? -shift : shift], { animate: false }); room += shift; }
    }
    const body = el.querySelector<HTMLElement>('.maplibregl-popup-content');
    if (body) {
      body.style.maxHeight = `${Math.max(120, room)}px`;
      body.style.setProperty('--pp-photo-max', `${Math.round(Math.max(56, room * 0.45))}px`);
      // If the name, the shortest story list and the links at the foot still don't fit, the photo gives way.
      const img = body.querySelector<HTMLElement>('.pp-photo img');
      for (let k = 0; img && k < 3; k++) {
        const over = body.scrollHeight - body.clientHeight;
        if (over <= 0) break;
        // On a short map the photo goes altogether before the links or the name would be cut off.
        if (img.offsetHeight <= 56) { img.closest<HTMLElement>('.pp-photo')!.style.display = 'none'; break; }
        body.style.setProperty('--pp-photo-max', `${Math.round(Math.max(56, img.offsetHeight - over - 2))}px`);
      }
    }
    popup.setLngLat(c.ll); // re-anchor for the capped height
    el.onpointerenter = () => clearTimeout(hideT);
    el.onpointerleave = (e) => { if (e.pointerType === 'mouse') hideSoon(); };
    el.onclick = (e) => {
      e.stopPropagation();
      const t = e.target as Element;
      const story = t.closest<HTMLElement>('[data-row]');
      if (!story) return;
      e.preventDefault();
      pin(true); // stay open, to step through the place's stories
      el.querySelectorAll('[data-row][aria-current]').forEach((a) => a.removeAttribute('aria-current'));
      story.setAttribute('aria-current', 'true');
      nav.showRow?.(Number(story.dataset.row));
    };
    placeMarks.setState(c.place ? { key: c.place, rows: storiesAt(c.place).map((st) => st.i) } : { key: null, rows: [] });
  };
  const hide = () => {
    clearTimeout(showT); clearTimeout(hideT); popup.remove(); owner = null; pinned = false;
    if (placeMarks.getState().key) placeMarks.setState({ key: null, rows: [] });
  };
  const hideSoon = () => { clearTimeout(showT); clearTimeout(hideT); if (!pinned) hideT = window.setTimeout(hide, 300); };
  const hover = (by: object, content: Content) => {
    clearTimeout(hideT); clearTimeout(showT);
    // Pinned, or already showing this one (the mouse moving about a region's area): nothing to rebuild.
    if (pinned || (owner === by && popup.isOpen())) return;
    showT = window.setTimeout(() => { const c = content(false); if (c) open(c, by, false); }, 150);
  };
  const show = (by: object, content: Content) => {
    clearTimeout(showT);
    if (owner === by && popup.isOpen() && pinned) { hide(); return; }
    const c = content(true);
    if (c?.place && pick(c.place)) return; // phones: the place card shows it instead
    if (c) open(c, by, true);
  };
  const attach = (el: HTMLElement, content: Content) => {
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hover(el, content); });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideSoon(); });
    el.addEventListener('click', (e) => { e.stopPropagation(); show(el, content); });
  };
  map.on('click', hide);
  map.on('dragstart', () => { if (!pinned) hide(); });
  return { attach, hover, show, hideSoon, hide };
}

const CREDITS = 'Natural Earth · Places: <a href="https://www.openbible.info/geo/" target="_blank" rel="noopener">OpenBible.info</a> (CC BY 4.0) · Peaks: Wikidata · Terrain: USGS SRTM, GMTED2010; NOAA ETOPO1 · Modern: <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0)';

export default function MapPane({ books, compact = false }: { books: Book[]; compact?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const traveller = useRef<TravellerMarker | null>(null);
  const popup = useRef<ReturnType<typeof makePopup> | null>(null);
  const head = useRef(1); // how much of the newest leg is drawn (0–1)
  const revealing = useRef(''); // the leg being drawn as Jesus travels it
  const routeKeys = useRef<string[]>([]);
  const focusRef = useRef<Focus>({ kind: 'none' });
  const declutterSoon = useRef<(remeasure?: boolean) => void>(() => {});
  const labels = useRef({ places: new Map<string, Label>(), focus: [] as Label[], peaks: [] as Label[], modern: new Map<string, Label>() });
  const markers = useRef({ places: new Map<string, HTMLElement>(), focus: [] as Marker[], peaks: [] as Marker[], modern: new Map<string, Marker>() });
  const contours = useRef(new Map<string, Promise<FC>>());
  const modernData = useRef<Promise<[string, number, number, number][]> | null>(null);
  const applyColours = useRef<() => void>(() => {});
  const landLight = useRef<LandLight | null>(null);
  const drawRoute = useRef<() => void>(() => {});
  // What the route's sources were last sent, so an unchanged route isn't sent again.
  const sent = useRef<{ plan: unknown; trail: string; arrows: string }>({ plan: null, trail: '', arrows: '' });
  // The lakes' shapes, so the shore of the water he's at can light up.
  const lakeShapes = useRef<FC | null>(null);
  const [places, setPlaces] = useState<Record<string, PlaceData> | null>(null);
  // Dry land (from the map's land and lakes), so the route's points in areas keep off the water.
  const [ground, setGround] = useState<Ground | null>(null);
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [ready, setReady] = useState(false);
  // The map's own data (land, lakes, rivers, places) failed to load.
  const [failed, setFailed] = useState(false);
  // The places by Wikidata ID, to tell a peak that is also a place (the Mount of Olives).
  const placesByWiki = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [k, p] of Object.entries(places ?? {})) if (p.wiki?.id) m.set(p.wiki.id, [...(m.get(p.wiki.id) ?? []), k]);
    return m;
  }, [places]);
  const current = useUI((s) => s.current);
  const travellerKind = useUI((s) => s.traveller);
  const wander = useUI((s) => s.wander);
  const landLightOn = useUI((s) => s.landLight);
  const modern = useUI((s) => s.modern);
  const units = useUI((s) => s.units);
  const scaleRef = useRef<ScaleControl | null>(null);
  // Phones: the map's toggles and credits behind one button.
  // Phones: the card can fold away to the right, leaving a tab with the place's name; it starts folded there. It is
  // also where a tapped place shows (in place of the popup): the place, the stories set there and its links.
  const [cardFolded, setCardFolded] = useState(compact);
  const [picked, setPicked] = useState<string | null>(null);
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const booksKey = books.join(',');
  const steps = useMemo(() => (places ? journey(books, places) : []), [booksKey, places]); // eslint-disable-line react-hooks/exhaustive-deps
  const routeSteps = useMemo(() => (places ? routeStops(books, places, steps) : []), [steps, places]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planRoute(routeSteps, ground ?? undefined), [routeSteps, ground]);
  // For tests (?debug): the route's stops, where the marker waits in each area, the planned line and each stop on it.
  useEffect(() => {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __jtRoute: unknown }).__jtRoute = { steps: routeSteps, rest: Object.fromEntries(plan.rest), line: plan.line, at: Object.fromEntries(plan.at) };
  }, [routeSteps, plan]);
  const split = useMemo(() => splits(books), [booksKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const focus = useMemo<Focus>(() => (places ? focusFor(current, books, places, steps) : { kind: 'none' }), [current, steps, places]); // eslint-disable-line react-hooks/exhaustive-deps
  const mountain = useMemo(() => mountainFor(ROWS[current], books), [current, booksKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const heading = useMemo(() => (places ? headingFor(current, books, places) : null), [current, booksKey, places]); // eslint-disable-line react-hooks/exhaustive-deps
  const resting = useMemo(() => (places ? restingFor(current, books, places, steps) : null), [current, steps, places]); // eslint-disable-line react-hooks/exhaustive-deps
  // The mountain: the one the text names, or the candidates given where it doesn't name one, or else the named peaks
  // near the place or area shown.
  const given = ROWS[current].peaks, givenNamed = !!given?.named;
  // Mountains (the toggle beside Modern places): on by itself where the text places Jesus on or near a mountain. The
  // reader can turn them off there, or on anywhere else (every named mountain, marked but not lit), until such a
  // stretch of the text begins or ends.
  const autoMountains = mountain.length > 0;
  const [mountainsChoice, setMountainsChoice] = useState<boolean | null>(null);
  const [autoWas, setAutoWas] = useState(autoMountains);
  if (autoWas !== autoMountains) { setAutoWas(autoMountains); setMountainsChoice(null); }
  const mountainsOn = mountainsChoice ?? autoMountains;
  const peaksNow = useMemo(() => {
    if (!mountainsOn) return [];
    if (!mountain.length) return peaks;
    if (given) return peaks.filter((p) => given.ids.includes(p.id));
    const areas = focusAreas(focus);
    return peaks.filter((p) => areas.some((a) => haversineKm(a.c, p.lonlat) <= a.r + PEAK_REACH));
  }, [mountainsOn, mountain, focus, peaks, given]);
  // The same peaks from one section to the next (through the Sermon on the Mount) stay put rather than being redrawn.
  const peakIds = peaksNow.map((p) => p.id).join(',');
  const nearPeaks = useMemo(() => peaksNow, [peakIds]); // eslint-disable-line react-hooks/exhaustive-deps
  // The peaks the text calls for: lit, joined to his light, and framed with the place shown.
  const textPeaks = useMemo(() => (autoMountains ? nearPeaks : []), [autoMountains, nearPeaks]);
  focusRef.current = focus;

  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    let labelFrame = 0;
    (async () => {
      const get = (p: string) => fetch(new URL(p, document.baseURI)).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });
      // The light's contours download alongside the map's own data, ready by the time the map has loaded.
      const regionLines = get('data/terrain/region.json');
      regionLines.catch(() => { /* the light is a nicety */ });
      let data;
      try {
        // The peaks are a nicety too: without them the map still shows.
        data = await Promise.all([get('data/geo/land.json'), get('data/geo/lakes.json'), get('data/geo/rivers.json'), loadPlaces(), get('data/peaks.json').catch(() => ({ peaks: [] as Peak[] }))]);
      } catch (e) {
        console.error('Map data failed to load', e);
        if (!cancelled) setFailed(true);
        return;
      }
      const [land, lakes, rivers, pl, pk] = data;
      if (cancelled || !boxRef.current) return;
      lakeShapes.current = lakes;
      const c = readColours(boxRef.current);
      const [W, S, E, N] = WORLD;
      const style: StyleSpecification = {
        version: 8,
        transition: { duration: 900, delay: 0 },
        sources: {
          land: { type: 'geojson', data: land },
          lakes: { type: 'geojson', data: lakes },
          rivers: { type: 'geojson', data: rivers },
          veil: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[W, S], [E, S], [E, N], [W, N], [W, S]]] } } },
          area: { type: 'geojson', data: EMPTY },
          trail: { type: 'geojson', data: EMPTY, lineMetrics: true },
          arrows: { type: 'geojson', data: EMPTY },
          heading: { type: 'geojson', data: EMPTY },
          'heading-tip': { type: 'geojson', data: EMPTY },
        },
        layers: [
          { id: 'sea', type: 'background', paint: { 'background-color': c.water } },
          { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': c.land } },
          { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': c.shore, 'line-width': 0.9 } },
          { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': c.water } },
          { id: 'lake-shore', type: 'line', source: 'lakes', paint: { 'line-color': c.shore, 'line-width': 1 } },
          {
            // Far from the gospels only the great rivers show until the map is zoomed in.
            id: 'rivers', type: 'line', source: 'rivers',
            paint: {
              'line-color': c.shore,
              'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 11, 2.2],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, ['case', ['<=', ['get', 'r'], 4], 0.9, 0], 7, ['case', ['<=', ['get', 'r'], 7], 1, 0.35], 9, 1],
            },
          },
          { id: 'veil', type: 'fill', source: 'veil', paint: { 'fill-color': c.veil } },
          { id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': WHITE, 'fill-opacity': 0.12 } },
          { id: 'area-edge', type: 'line', source: 'area', paint: { 'line-color': withAlpha(c.ink, 0.35), 'line-width': 1.2, 'line-dasharray': [2, 2] } },
          {
            // Earlier legs: white at half strength. The newest leg joins them (q) while the text has him heading
            // somewhere else, or he isn't in the scene.
            id: 'trail-old', type: 'line', source: 'trail', filter: ['any', ['>', ['get', 'age'], 0], ['==', ['get', 'q'], 1]], layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': WHITE, 'line-width': 1.5, 'line-opacity': 0.5 },
          },
          {
            id: 'trail', type: 'line', source: 'trail', filter: ['all', ['==', ['get', 'age'], 0], ['!=', ['get', 'q'], 1]], layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-width': 2, 'line-gradient': trailGradient(1) },
          },
          // Where the text has him heading: a fine dashed white line part of the way towards the place.
          { id: 'heading', type: 'line', source: 'heading', layout: { 'line-cap': 'butt' }, paint: { 'line-color': WHITE, 'line-width': 1.6, 'line-dasharray': [3, 2.4] } },
        ],
      };
      const map = new MlMap({
        container: boxRef.current, style, center: HOME.center, zoom: HOME.zoom, minZoom: 4.5, maxZoom: 15, maxBounds: [[W + 1, S + 1], [E - 1, N - 1]],
        attributionControl: false, pixelRatio: Math.min(2, window.devicePixelRatio || 1), dragRotate: false, pitchWithRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __jtMap: MlMap }).__jtMap = map;
      const scale = new ScaleControl({ maxWidth: 110, unit: useUI.getState().units });
      scaleRef.current = scale;
      map.addControl(scale, 'bottom-left');
      // Tapping or clicking the scale switches between kilometres and miles.
      const scaleEl = boxRef.current.querySelector<HTMLElement>('.maplibregl-ctrl-scale');
      if (scaleEl) {
        const flip = () => { const ui = useUI.getState(); ui.setUnits(ui.units === 'metric' ? 'imperial' : 'metric'); };
        scaleEl.setAttribute('role', 'button');
        scaleEl.tabIndex = 0;
        scaleEl.title = 'Switch between kilometres and miles';
        scaleEl.setAttribute('aria-label', 'Map scale: switch between kilometres and miles');
        scaleEl.addEventListener('click', flip);
        scaleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
      }
      map.addControl(new AttributionControl({ compact: true, customAttribution: CREDITS }));
      // Start with the credits folded behind their (i) button, clear of the map's own controls.
      const attrib = boxRef.current.querySelector('.maplibregl-ctrl-attrib');
      attrib?.classList.remove('maplibregl-compact-show');
      attrib?.removeAttribute('open');
      mapRef.current = map;
      ro = new ResizeObserver(() => { map.resize(); declutterSoon.current(); });
      ro.observe(boxRef.current);
      const box = boxRef.current;
      const pop = makePopup(map, (place) => {
        if (!compactRef.current) return false;
        setPicked(place);
        setCardFolded(false);
        return true;
      });
      popup.current = pop;
      // Phones: a tap on the map away from any place takes the card back to the place in the text.
      map.on('click', () => { if (compactRef.current) setPicked(null); });

      // Labels: placed in priority order on every zoom frame, so they never pile up.
      let remeasure = false;
      declutterSoon.current = (again = false) => {
        remeasure ||= again;
        if (labelFrame) return;
        labelFrame = requestAnimationFrame(() => {
          labelFrame = 0;
          const L = labels.current;
          declutter(map, [...L.places.values(), ...L.focus, ...L.peaks, ...L.modern.values()], remeasure);
          remeasure = false;
        });
      };
      const zoomBand = () => {
        const band = map.getZoom() >= 10.5 ? 'near' : 'far';
        if (box.dataset.zoom !== band) { box.dataset.zoom = band; declutterSoon.current(true); }
      };
      map.on('zoom', () => { zoomBand(); declutterSoon.current(); });
      // Panning doesn't move labels against each other, but brings others into view, which may overlap.
      map.on('moveend', () => declutterSoon.current());
      zoomBand();
      document.fonts?.ready.then(() => declutterSoon.current(true));

      for (const [key, p] of Object.entries(pl)) {
        if (p.kind === 'region' && !AREAS[key]) continue;
        const el = document.createElement('div');
        el.className = `map-place kind-${p.kind}${CLOSE_SITES.has(key) ? ' close' : ''}${JERUSALEM_SITES.has(key) && key !== 'jerusalem' ? ' in-city' : ''}`;
        const today = modernName(p);
        el.innerHTML = `<i></i><span>${esc(p.name)}</span>${today ? `<small class="modern-name">today: ${esc(today)}</small>` : ''}`;
        const anchor = p.kind === 'site' ? 'left' : 'center';
        new Marker({ element: el, anchor, offset: p.kind === 'site' ? [-4, 0] : [0, 0] }).setLngLat(p.candidates[0].lonlat).addTo(map);
        markers.current.places.set(key, el);
        labels.current.places.set(key, { el, ll: p.candidates[0].lonlat, anchor, dx: p.kind === 'site' ? -4 : 0, priority: 5, flips: p.kind === 'site' });
        pop.attach(el, (full) => ({ ll: p.candidates[0].lonlat, html: placePopup(key, p, full), place: key }));
      }
      // Hovering or clicking the highlighted region's circle shows the region's popup too (the map's own click
      // handler, which closes the popup, runs first).
      map.on('mousemove', 'area-fill', (e) => {
        const f = focusRef.current;
        if (f.kind === 'region') pop.hover(f, (full) => ({ ll: [e.lngLat.lng, e.lngLat.lat], html: placePopup(f.key, f.place, full), place: f.key }));
      });
      map.on('click', 'area-fill', (e) => {
        const f = focusRef.current;
        if (f.kind === 'region') pop.show(f, (full) => ({ ll: [e.lngLat.lng, e.lngLat.lat], html: placePopup(f.key, f.place, full), place: f.key }));
      });
      map.on('mouseleave', 'area-fill', () => pop.hideSoon());

      traveller.current = new TravellerMarker(map);
      traveller.current.setKind(useUI.getState().traveller);
      // The light on the land follows the marker, drift and all (the route doesn't: it's the line as planned).
      traveller.current.onDraw = (ll) => landLight.current?.follow(ll);
      map.on('load', () => {
        if (cancelled) return;
        map.addImage('jt-arrow', arrowImage(), { pixelRatio: 2, sdf: true });
        map.addLayer({
          id: 'arrows', type: 'symbol', source: 'arrows',
          layout: { 'icon-image': 'jt-arrow', 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['get', 'age'], 0, 0.85, 2, 0.6] },
          paint: { 'icon-color': WHITE, 'icon-opacity': ['case', ['all', ['==', ['get', 'age'], 0], ['!=', ['get', 'q'], 1]], 1, 0.5] },
        });
        map.addLayer({
          id: 'heading-tip', type: 'symbol', source: 'heading-tip',
          layout: { 'icon-image': 'jt-arrow', 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': 1 },
          paint: { 'icon-color': WHITE },
        });
        // His light on the land, over the time of day's veil and under the route.
        const light = new LandLight();
        light.enabled = useUI.getState().landLight;
        landLight.current = light;
        map.addLayer(light, 'area-fill');
        regionLines.then((d) => { if (!cancelled) light.setRegion(d, (id) => get(`data/terrain/detail-${id}.json`)); }).catch(() => { /* the light is a nicety */ });
        setReady(true);
      });
      setPlaces(pl);
      setGround(() => dryLand(land, lakes));
      setPeaks(pk.peaks);
    })();
    // Re-read the colours (the page's light or its tint) and repaint.
    applyColours.current = () => {
      const map = mapRef.current;
      // (Not isStyleLoaded: that's false whenever a source is loading tiles, e.g. throughout a camera flight.)
      if (!map || !boxRef.current || !map.getLayer('veil')) return;
      const c = readColours(boxRef.current);
      map.setPaintProperty('sea', 'background-color', c.water);
      map.setPaintProperty('land', 'fill-color', c.land);
      map.setPaintProperty('coast', 'line-color', c.shore);
      map.setPaintProperty('lakes', 'fill-color', c.water);
      map.setPaintProperty('lake-shore', 'line-color', c.shore);
      map.setPaintProperty('rivers', 'line-color', c.shore);
      map.setPaintProperty('veil', 'fill-color', c.veil);
      map.setPaintProperty('area-edge', 'line-color', withAlpha(c.ink, 0.35));
    };
    // The page's light colours ease in over --light-duration, so read them again once they've settled
    // (read at once, the veil would keep the colour the light started from, e.g. none in dark mode).
    let settled = 0;
    const mo = new MutationObserver(() => {
      applyColours.current();
      window.clearTimeout(settled);
      const dur = getComputedStyle(document.body).getPropertyValue('--light-duration').trim(), n = parseFloat(dur);
      settled = window.setTimeout(() => applyColours.current(), (Number.isNaN(n) ? 900 : dur.endsWith('ms') ? n : n * 1000) + 60);
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-light', 'data-tint'] });
    return () => {
      cancelled = true;
      window.clearTimeout(settled);
      cancelAnimationFrame(labelFrame);
      declutterSoon.current = () => {};
      mo.disconnect();
      ro?.disconnect();
      popup.current?.hide();
      traveller.current?.destroy();
      traveller.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      sent.current = { plan: null, trail: '', arrows: '' };
    };
  }, []);

  useEffect(() => { traveller.current?.setKind(travellerKind); }, [travellerKind, ready]);

  // Follow the reading position.
  useEffect(() => {
    const map = mapRef.current;
    const tr = traveller.current;
    if (!map || !tr || !places || !ready) return;
    const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined;

    // The line: Jesus' places so far, one feature per leg, newest leg age 0 (route.ts).
    const pts = routeTo(routeSteps, current);
    const prevKeys = routeKeys.current;
    routeKeys.current = pts.map((p) => p.key);
    const forward = pts.length > prevKeys.length && prevKeys.every((k, i) => pts[i].key === k);
    // In an area his marker waits where the line passes through it (route.ts), not at the area's centre; the light
    // still covers the whole area. Likewise where he rests, in a scene he isn't in.
    const last = pts[pts.length - 1];
    const restOf = (s: Step) => plan.rest.get(stopId(s)) ?? s.ll;
    const onTheWay = <T extends { to: LonLat; areaKm: number | null }>(t: T | null) =>
      t && (t.areaKm && last?.km && haversineKm(last.ll, t.to) < 0.5 ? { ...t, to: restOf(last), centre: t.to } : { ...t, centre: t.to });
    const target = onTheWay(travelTarget(focus));
    const restAt = onTheWay(resting);
    // The legs, all of them the line as planned (route.ts), the newest from the last named place he left to where he is
    // now. He sets off from the stop before this one, along the way between them, after any stretch through an area he
    // was already in.
    const legs = legsFor(pts, plan), newest = legs[legs.length - 1];
    const prev = pts[pts.length - 2];
    const end = last && restOf(last), dep = prev && restOf(prev);
    const way = newest && prev ? between(plan, prev, last) : null;
    // The text has him heading somewhere he hasn't reached: that's the motion to show, so the newest leg (how he got
    // here) goes quiet, grey like the rest of the route.
    const ahead = target && heading && haversineKm(target.to, heading.place.candidates[0].lonlat) > 3 ? heading : null;
    // ...and likewise in a scene he isn't in: he isn't moving, so nothing on his route is picked out.
    const quiet = !!ahead || (!target && !!resting);
    // The heading: a dashed line from where he is, part of the way (up to 30 km) towards the place, named at its tip.
    const dest = ahead?.place.candidates[0].lonlat, toDest = dest && target ? haversineKm(target.to, dest) : 0;
    const tip = dest && target && toDest ? lerp(target.to, dest, Math.min(0.5 * toDest, 30) / toDest) : null;
    // Out of sight while the route moved on (or appearing for the first time): set off from where the newest leg leaves,
    // unless it was last seen where it's going (back in the same place, or within the same area).
    const seen = tr.position, near = target ? Math.max(0.5, (target.areaKm ?? 0) / 2) : 0;
    if (target && end && dep && tr.hidden && haversineKm(end, target.to) < 0.5 && !(seen && haversineKm(seen, target.to) <= near)) tr.startAt(dep);
    const from = tr.position;
    // Grow the newest leg as Jesus travels it, when the marker is setting off from where it leaves
    // (or is still on its way along it when the reading line moves on within the same place).
    const legKey = newest ? newest.join('|') : '';
    const continuing = !!legKey && revealing.current === legKey && tr.travellingTo(target?.to);
    const reveal = !quiet && (continuing || !!(forward && target && end && dep && from && haversineKm(end, target.to) < 0.5 && haversineKm(dep, from) < 0.1));
    revealing.current = reveal ? legKey : '';
    const setHead = (h: number) => {
      head.current = h;
      map.setPaintProperty('trail', 'line-gradient', trailGradient(h));
    };
    // Any stretch of the newest leg before he sets off (through an area he was already in) is drawn already.
    const h0 = newest && way ? shareTo(newest, newest.length - way.length) : 0;
    setHead(reveal ? (continuing ? head.current : h0) : 1);
    const q = (age: number) => (quiet && age === 0 ? 1 : 0);

    let arrowShown = !reveal;
    // The legs and arrows are sent only when they change (the effect runs on every row the reading line passes).
    const trailKey = [...pts.map(stopId), quiet].join('|');
    if (sent.current.plan !== plan || sent.current.trail !== trailKey) {
      src('trail')?.setData({ type: 'FeatureCollection', features: legs.map((line, k) => ({ type: 'Feature', properties: { age: legs.length - 1 - k, q: q(legs.length - 1 - k) }, geometry: { type: 'LineString', coordinates: line } })) });
      sent.current = { plan, trail: trailKey, arrows: '' };
    }
    const recentLegs = legs.slice(-3).map((line, k, all) => ({ age: all.length - 1 - k, mid: halfway(line) }));
    drawRoute.current = () => {
      const arrowsKey = `${trailKey}|${arrowShown}`;
      if (sent.current.arrows === arrowsKey) return;
      sent.current.arrows = arrowsKey;
      src('arrows')?.setData({ type: 'FeatureCollection', features: recentLegs.flatMap(({ age, mid }) => (mid && (arrowShown || age > 0) ? [{ type: 'Feature' as const, properties: { age, q: q(age), bearing: mid.bearing }, geometry: { type: 'Point' as const, coordinates: mid.at } }] : [])) });
    };
    drawRoute.current();
    // The heading sets off from where he waits.
    src('heading')?.setData(tip && target ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [target.to, tip] } }] } : EMPTY);
    const ring = focus.kind === 'likely' ? circleRing(focus.center, focus.radius) : focus.kind === 'region' ? circleRing(focus.place.candidates[0].lonlat, focus.radius) : null;
    src('area')?.setData(ring ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] } : EMPTY);

    // Jesus' marker: travels to the place (or where the route visits the area) as the camera does, along the line as the
    // newest leg grows behind it; in a scene he isn't in, it rests, dimmed, where he was last placed (travelling back
    // there if the reader has scrolled back). His light on the land goes with him, and on arriving in an area grows to
    // cover it (where the accounts differ, each place has its own pool instead). While he rests it's out, until he is
    // born; from then on a little of it stays, as does a little of his glow.
    const light = landLight.current;
    if (target) {
      tr.setResting(false);
      tr.show(true);
      light?.point();
      tr.go({
        to: target.to,
        path: reveal && way ? way : undefined,
        wanderKm: wander && target.areaKm ? driftKm(target.areaKm) : null,
        onProgress: reveal ? (p) => {
          const h = h0 + (1 - h0) * p;
          setHead(h);
          if (!arrowShown && h >= 0.5) { arrowShown = true; drawRoute.current(); }
          if (p >= 1) revealing.current = '';
        } : undefined,
        onArrive: () => {
          if (target.areaKm && focus.kind !== 'differ') light?.cover(target.centre, target.areaKm);
        },
      });
    } else if (restAt) {
      const born = current >= BIRTH;
      tr.show(true);
      tr.setResting(true, born);
      if (born) light?.point(RESTING_LIGHT);
      else light?.off();
      tr.go({ to: restAt.to, wanderKm: wander && restAt.areaKm ? driftKm(restAt.areaKm) : null });
    } else {
      tr.setResting(false);
      tr.show(false);
      light?.off();
    }
    // At the water itself (the Sea of Galilee), its shore lights up all round; where the accounts name different places
    // (Gadara, Gerasa), a pool of light covers the area about each.
    let shore: LonLat[][] | null = null;
    if (focus.kind === 'site' && focus.place.kind === 'water') {
      const ll = focus.place.candidates[0].lonlat;
      for (const f of lakeShapes.current?.features ?? []) {
        const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        const hit = polys.find((p) => inRing(ll, p[0]));
        if (hit) { shore = hit.map((ring) => ring as LonLat[]); break; }
      }
    }
    light?.setOutline(shore && 'key' in focus ? focus.key : null, shore ?? []);
    // (A scene he isn't in gets no light, wherever it's set.)
    light?.setPools(focus.kind === 'differ' && focus.present ? focus.places.map((p) => ({ ll: p.place.candidates[0].lonlat, km: SPLIT_KM })) : null);

    // Places: visited (on the route so far, or named where the accounts differ), current, and label priority.
    const visited = new Set(pts.map((p) => p.key));
    for (const s of split) { if (s.row > current) break; s.keys.forEach((k) => visited.add(k)); }
    const recent = new Set(pts.slice(-5).map((p) => p.key));
    const currentKeys = new Set(focus.kind === 'differ' ? focus.places.map((p) => p.key) : 'key' in focus ? [focus.key] : []);
    // Places the text on screen names keep their labels, even close in to their neighbours (scripts/build-mentions.mjs).
    const shownRow = ROWS[current], namedKeys = new Set(books.filter((b) => shownRow.refs[b]).flatMap((b) => shownRow.named[b] ?? []));
    // A mountain the text names (the Mount of Olives) is what the scene is about: its label comes before other names.
    const mountainKeys = new Set(givenNamed ? given!.ids.flatMap((id) => placesByWiki.get(id) ?? []) : []);
    for (const [k, el] of markers.current.places) {
      el.classList.toggle('visited', visited.has(k));
      el.classList.toggle('current', currentKeys.has(k));
      el.classList.toggle('ahead', !!ahead && k === ahead.key);
      el.classList.toggle('named', namedKeys.has(k) || mountainKeys.has(k));
      const l = labels.current.places.get(k)!;
      // Regions and waters read from the map itself, so towns win over their labels.
      const kind = places[k].kind;
      l.priority = currentKeys.has(k) || (ahead && k === ahead.key) ? 0 : mountainKeys.has(k) ? 0.3 : namedKeys.has(k) ? 0.5 : (kind === 'region' ? 7 : (recent.has(k) ? 3 : visited.has(k) ? 4 : 5) + (kind === 'water' ? 1 : 0)) + (1 - (MENTIONS.get(k) ?? 0) / MOST) * 0.9;
    }
    markers.current.focus.forEach((m) => m.remove());
    markers.current.focus = [];
    labels.current.focus = [];
    const add = (cls: string, ll: LonLat, html = '', anchor: 'center' | 'right' | 'left' = 'center', label = false, dx = anchor === 'right' ? 7 : 0) => {
      const el = document.createElement('div');
      el.className = cls;
      el.innerHTML = html;
      el.setAttribute('aria-hidden', 'true');
      markers.current.focus.push(new Marker({ element: el, anchor, offset: [dx, 0] }).setLngLat(ll).addTo(map));
      if (label) labels.current.focus.push({ el, ll, anchor, dx, priority: 1 });
    };

    // The heading's tip (the line itself is drawn with the route), with the place's name beyond it on the side the
    // line is heading.
    if (tip && ahead && target) {
      const bearing = bearingDeg(target.to, tip);
      src('heading-tip')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { bearing }, geometry: { type: 'Point', coordinates: tip } }] });
      const east = bearing < 180;
      add('map-heading', tip, `<span>toward ${esc(ahead.place.name)}</span>`, east ? 'left' : 'right', true, east ? 12 : -12);
    } else src('heading-tip')?.setData(EMPTY);

    let t = 0;
    const fly = (fn: () => void) => { t = window.setTimeout(fn, 220); };
    // In mountain sections the view takes in the nearby peaks and their contours as well
    // (at a named place, only the peaks close by, so the place itself stays readable),
    // and any heading's tip, or where Jesus is resting during a scene he isn't in.
    const corners = peakCorners(textPeaks);
    // The card covers the top of the map, so whatever is framed sits below it.
    const pad = (p: number) => {
      const card = boxRef.current?.parentElement?.querySelector<HTMLElement>('.map-card');
      const below = card ? card.offsetTop + card.offsetHeight : 0;
      return { top: Math.min(p + below, map.getContainer().clientHeight * 0.45), right: p, bottom: p, left: p };
    };
    const flyTo = (ll: LonLat, zoom: number, travel: boolean, extra: LonLat[] = []) => {
      let center = ll;
      const peaksNear = peakCorners(textPeaks.filter((p) => haversineKm(p.lonlat, ll) <= 8));
      if (peaksNear.length || extra.length) {
        const cam = map.cameraForBounds(bounds([ll, ...peaksNear, ...extra]) as LngLatBoundsLike, { padding: pad(70), maxZoom: 12.4 });
        if (cam?.center && cam.zoom !== undefined) { const c = LngLat.convert(cam.center); center = [c.lng, c.lat]; zoom = Math.min(peaksNear.length ? zoom + 2 : zoom, cam.zoom); }
      }
      map.flyTo({ center, zoom, speed: 0.9, curve: 1.3 });
      if (travel) tr.cameraStarted(center);
    };
    const fitTo = (pts: LonLat[], p: number, maxZoom: number, travel: boolean) => {
      const b = bounds([...pts, ...corners]) as LngLatBoundsLike;
      const padding = pad(p);
      const cam = map.cameraForBounds(b, { padding, maxZoom });
      map.fitBounds(b, { padding, maxZoom, duration: 1400 });
      if (travel && cam?.center) { const c = LngLat.convert(cam.center); tr.cameraStarted([c.lng, c.lat]); }
    };
    const tipPts = tip ? [tip] : [];
    if (focus.kind === 'site') {
      const ll = focus.place.candidates[0].lonlat;
      // Other proposed sites: labels on the left of the ring; the place's own label is on the right.
      focus.place.candidates.slice(1).forEach((cand) => add('map-candidate', cand.lonlat, `<span>${esc(cand.label)}</span><i></i>`, 'right', true));
      fly(() => flyTo(ll, zoomFor(focus.key, focus.place), true, tipPts));
    } else if (focus.kind === 'scene') {
      const ll = focus.place.candidates[0].lonlat;
      // The scene, marked as a scene (not Jesus): an open diamond.
      add('map-scene', ll, '<i></i><span>scene</span>');
      const rest = restAt && haversineKm(restAt.to, ll) <= 150 ? [restAt.to] : [];
      fly(() => { flyTo(ll, zoomFor(focus.key, focus.place), false, rest); tr.setOff(); });
    } else if (focus.kind === 'differ' && !focus.present) {
      // A scene he isn't in, set at different places by the accounts: an open diamond at each, never a light; his
      // marker rests where the text last placed him.
      focus.places.forEach((p) => add('map-scene', p.place.candidates[0].lonlat, `<i></i><span>${p.books.map((b) => BOOK_ABBR[b]).join(', ')}</span>`));
      const lls = focus.places.map((p) => p.place.candidates[0].lonlat);
      const rest = restAt && haversineKm(restAt.to, lls[0]) <= 150 ? [restAt.to] : [];
      fly(() => { fitTo([...lls, ...rest], 90, 10, false); tr.setOff(); });
    } else if (focus.kind === 'differ') {
      // The accounts name different places: a dimmer light at each, labelled with its gospels. Its glow, like his,
      // goes under every other marker and label.
      focus.places.forEach((p) => {
        const ll = p.place.candidates[0].lonlat;
        add('map-split-glow', ll, '<i></i>');
        map.getCanvasContainer().insertBefore(markers.current.focus[markers.current.focus.length - 1].getElement(), map.getCanvas().nextSibling);
        add('map-split', ll, `<i></i><span>${p.books.map((b) => BOOK_ABBR[b]).join(', ')}</span>`);
      });
      // ...and Jesus' marker waits in the area between them.
      fly(() => fitTo([...focus.places.map((p) => p.place.candidates[0].lonlat), ...(target ? [target.to] : [])], 90, 10, !!target));
    } else if (ring && target) {
      fly(() => fitTo([...ring, ...tipPts], 50, 10.5, true));
    } else if (restAt) {
      fly(() => tr.setOff());
    } else if (current < MAP_START) {
      // Back at the start, before Jesus is on the map: the whole standard view.
      fly(() => map.flyTo({ center: HOME.center, zoom: HOME.zoom, speed: 0.9, curve: 1.3 }));
    }
    declutterSoon.current(true);
    return () => window.clearTimeout(t);
  }, [focus, steps, routeSteps, plan, split, current, places, placesByWiki, ready, wander, textPeaks, heading, resting]);

  // Mountain sections: the named peaks near the place or area shown, with their contours (or, turned on by hand
  // elsewhere, every named mountain, marked only).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markers.current.peaks.forEach((m) => m.remove());
    markers.current.peaks = [];
    labels.current.peaks = [];
    for (const p of nearPeaks) {
      const el = document.createElement('div');
      el.className = 'map-peak';
      // A peak that is also one of the places (the Mount of Olives) is named by the place's own label, so its triangle
      // stands without a second one; a mountain the text names comes before other labels.
      const isPlace = placesByWiki.has(p.id);
      el.innerHTML = isPlace ? '<i></i>' : `<i></i><span>${esc(p.name)}<small> ≈ ${p.elev} m</small></span>`;
      markers.current.peaks.push(new Marker({ element: el, anchor: 'left', offset: [-6, 0] }).setLngLat(p.lonlat).addTo(map));
      if (!isPlace) labels.current.peaks.push({ el, ll: p.lonlat, anchor: 'left', dx: -6, priority: givenNamed ? 0.5 : 2, flips: true });
      popup.current?.attach(el, () => ({ ll: p.lonlat, html: peakPopup(p) }));
    }
    declutterSoon.current(true);
    const ids = [...new Set(textPeaks.map((p) => p.cluster))];
    if (!ids.length) { landLight.current?.setMountain(null, [], []); return; }
    let live = true;
    Promise.all(ids.map((id) => {
      let set = contours.current.get(id);
      if (!set) {
        // A failed load isn't kept, so the next mountain section tries again.
        set = fetch(new URL(`data/terrain/${id}.json`, document.baseURI)).then((r) => { if (!r.ok) throw new Error(`${id}: ${r.status}`); return r.json() as Promise<FC>; });
        set.catch(() => contours.current.delete(id));
        contours.current.set(id, set);
      }
      return set;
    })).then((sets) => {
      if (!live) return;
      // The candidate peaks light up in white, joined to his light; inside their windows their own contours take
      // over from the region's.
      const fc: FC = { type: 'FeatureCollection', features: sets.flatMap((s) => s.features) };
      const win = (p: Peak) => ({ ll: p.lonlat, km: p.r });
      landLight.current?.setMountain(fc, peaks.filter((p) => ids.includes(p.cluster)).map(win), textPeaks.map(win));
    }).catch(() => { /* contours are a nicety; the peaks still show */ });
    return () => { live = false; };
  }, [nearPeaks, textPeaks, peaks, placesByWiki, givenNamed, ready]);

  // Light on the land (Settings): with it on, an area is shown by the light itself rather than a shaded circle (the
  // circle stays, unseen, for hovering). From his death until the angel at the tomb the light goes out.
  const dead = useStore(scene, (s) => s.dead);
  useEffect(() => {
    const map = mapRef.current, light = landLight.current;
    if (!map || !light || !ready) return;
    light.enabled = landLightOn && !dead;
    map.triggerRepaint();
    map.setPaintProperty('area-fill', 'fill-opacity', landLightOn ? 0 : 0.12);
    map.setPaintProperty('area-edge', 'line-opacity', landLightOn ? 0 : 1);
  }, [landLightOn, dead, ready]);

  // Modern places: towns and cities of today, and the modern names of the sites, when switched on.
  useEffect(() => {
    const map = mapRef.current, box = boxRef.current;
    if (!map || !box || !ready) return;
    box.dataset.modern = modern ? 'on' : 'off';
    const shown = markers.current.modern, L = labels.current.modern;
    const clear = () => { shown.forEach((m) => m.remove()); shown.clear(); L.clear(); };
    if (!modern) { clear(); declutterSoon.current(true); return; }
    // A failed load isn't kept, so the next pan or toggle tries again.
    const load = () => (modernData.current ??= fetch(new URL('data/geo/modern.json', document.baseURI))
      .then((r) => { if (!r.ok) throw new Error(`modern.json: ${r.status}`); return r.json(); })
      .then((j) => j.places)
      .catch((e) => { modernData.current = null; throw e; }));
    let live = true;
    const update = async () => {
      let all: [string, number, number, number][];
      try { all = await load(); } catch { return; /* the overlay is a nicety */ }
      if (!live) return;
      const z = map.getZoom(), b = map.getBounds().toArray(), pad = 0.3;
      const want = new Set<string>();
      all.forEach(([name, lon, lat, minZ], rank) => {
        if (minZ > z + 0.25 || lon < b[0][0] - pad || lon > b[1][0] + pad || lat < b[0][1] - pad || lat > b[1][1] + pad) return;
        const id = `${name}|${lon}|${lat}`;
        want.add(id);
        if (shown.has(id)) return;
        const el = document.createElement('div');
        el.className = 'map-modern';
        el.innerHTML = `<i></i><span>${esc(name)}</span>`;
        el.setAttribute('aria-hidden', 'true');
        shown.set(id, new Marker({ element: el, anchor: 'left', offset: [-3, 0] }).setLngLat([lon, lat]).addTo(map));
        L.set(id, { el, ll: [lon, lat], anchor: 'left', dx: -3, priority: 8 + rank / 1000 });
      });
      for (const [id, m] of shown) if (!want.has(id)) { m.remove(); shown.delete(id); L.delete(id); }
      declutterSoon.current(true);
    };
    update();
    map.on('moveend', update);
    return () => { live = false; map.off('moveend', update); };
  }, [modern, ready]);

  useEffect(() => { scaleRef.current?.setUnit(units); }, [units, ready]);

  const row = ROWS[current];
  const name = (s: Step | null) => (s && places ? places[s.key].name : '');
  const focusKey = focus.kind === 'site' || focus.kind === 'region' || focus.kind === 'scene' ? focus.key : null;
  // Phones: a tapped place other than the one in the text, shown in the card.
  const pickedPlace = compact && picked && picked !== focusKey && places?.[picked] ? { key: picked, place: places[picked] } : null;
  const cardKey = pickedPlace?.key ?? focusKey;
  const linkPlace = places && cardKey ? placeLinks(cardKey, places[cardKey]) : null;
  // While the card is open on a phone, the timeline marks the stories set at its place (as the popup does).
  const marksKey = compact && !cardFolded ? cardKey : null;
  useEffect(() => {
    if (!compact) return;
    if (marksKey) placeMarks.setState({ key: marksKey, rows: storiesAt(marksKey).map((st) => st.i) });
    else if (placeMarks.getState().key) placeMarks.setState({ key: null, rows: [] });
  }, [compact, marksKey]);
  /** The stories set at a place, each a link that takes the reader there (phones' card). */
  const stories = (key: string) => {
    const list = storiesAt(key);
    if (!list.length) return null;
    return (
      <ol className="pp-stories" aria-label="Stories set here">
        {list.map((st) => {
          const r = ROWS[st.i];
          const notes = [st.books && st.books.map((b) => BOOK_ABBR[b]).join(', '), st.implied && 'implied'].filter(Boolean).join(' · ');
          return (
            <li key={st.i}>
              <a href="#" aria-current={r.sectionId === row.sectionId ? 'true' : undefined} onClick={(e) => { e.preventDefault(); nav.showRow?.(st.i); }}>
                <span className="pp-n">§{r.n}</span> {r.sectionTitle}{notes && <> <em>{notes}</em></>}
              </a>
            </li>
          );
        })}
      </ol>
    );
  };
  const effects = landLightOn && wander;
  return (
    <div className="map-pane">
      <div className="map-box" ref={boxRef} role="region" aria-label="Map of the places in the accounts on screen" />
      {compact && cardFolded && (
        <button type="button" className="map-card-tab" aria-label="Show the place card" onClick={() => setCardFolded(false)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6l-6 6 6 6" /></svg>
          <span>{focusKey && places ? places[focusKey].name : focus.kind === 'differ' ? focus.places.map((p) => p.place.name).join(' · ') : focus.kind === 'likely' ? 'Place not named' : 'Place'}</span>
        </button>
      )}
      <div className="map-card" aria-live="polite" hidden={compact && cardFolded}>
        {compact && (
          <button type="button" className="map-card-fold" aria-label="Fold the place card away" onClick={() => { setCardFolded(true); setPicked(null); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6l6 6-6 6" /></svg>
          </button>
        )}
        {pickedPlace ? (
          <>
            {pickedPlace.place.photo && <div dangerouslySetInnerHTML={{ __html: photoHtml(pickedPlace.place) }} />}
            <p className="map-place-name">{pickedPlace.place.name}{(() => { const today = modernName(pickedPlace.place); return pickedPlace.place.kind === 'region' ? <em> · a region</em> : today ? <em> · shown at {today}</em> : null; })()}</p>
            {pickedPlace.place.wiki?.note && <p className="map-place-name muted">Wikipedia link: {pickedPlace.place.wiki.note}</p>}
            <button type="button" className="map-back" onClick={() => setPicked(null)}>← Back to the place in the text</button>
          </>
        ) : <>
        <p className="kicker">§{row.n} · {books.filter((b) => row.refs[b]).map((b) => BOOK_ABBR[b]).join(' ')}</p>
        <p className="map-title">{rowTitle(row)}</p>
        {focus.kind === 'site' && (
          <>
            <p className="map-place-name">{focus.place.name}{row.placeImplied && <em> · implied by the context</em>}</p>
            {focus.place.candidates.length > 1 && (
              <ul className="cands">
                {focus.place.candidates.map((c, i) => <li key={c.label}>{i === 0 ? 'Shown: ' : ''}{c.label}{c.score !== null && <span title="OpenBible.info score out of 1000: how well the reference works support this location"> · {c.score}</span>}</li>)}
              </ul>
            )}
          </>
        )}
        {focus.kind === 'region' && <p className="map-place-name">{focus.place.name} <em>· a region{row.placeImplied ? ', implied by the context' : ''}</em></p>}
        {focus.kind === 'scene' && (
          <p className="map-place-name">
            {focus.place.name} <em>· Jesus isn’t in this scene{resting ? `; his marker waits at ${resting.name}, where the text last placed him` : '; the line shows only his movements'}</em>
          </p>
        )}
        {focus.kind === 'differ' && <p className="map-place-name">{focus.places.map((p) => `${p.place.name} (${p.books.map((b) => BOOK_ABBR[b]).join(', ')})`).join(' · ')} <em>· the accounts name different places{focus.present ? '; his marker waits between them' : `; Jesus isn’t in this scene${resting ? `; his marker waits at ${resting.name}, where the text last placed him` : ''}`}</em></p>}
        {focus.kind === 'likely' && (
          <p className="map-place-name muted">
            Place not named. {focus.before && focus.after
              ? focus.before.key === focus.after.key
                ? `Likely around ${name(focus.before)}, the place named before and after.`
                : `Likely between ${name(focus.before)} and ${name(focus.after)}, the places named before and after.`
              : `Likely near ${name(focus.before ?? focus.after)}, the ${focus.before ? 'last' : 'next'} place named.`}
          </p>
        )}
        {failed && <p className="map-place-name muted">The map’s data couldn’t be loaded. Reload the page to try again.</p>}
        {focus.kind === 'none' && !failed && (
          <p className="map-place-name muted">
            {row.jesus ? 'No place is named here.' : `No place is named, and Jesus isn’t in this scene${resting ? `; his marker waits at ${resting.name}, where the text last placed him.` : '.'}`}
          </p>
        )}
        {heading && travelTarget(focus) && (
          <p className="map-heading-note">
            <b>→ {heading.place.name}</b> {[...heading.quotes.reduce((m, q) => m.set(q.words, [...(m.get(q.words) ?? []), q.ref]), new Map<string, string[]>())].map(([w, refs]) => `“${w}” (${refs.join('; ')})`).join(' · ')}
          </p>
        )}
        {mountain.length > 0 && (
          <p className="map-mountain">
            {[...mountain.reduce((m, q) => m.set(q.words, [...(m.get(q.words) ?? []), ABBR[q.book]]), new Map<string, string[]>())].map(([w, bs]) => `“${w}” (${bs.join(', ')})`).join(' · ')}
            <em>{!mountainsOn ? ' · mountains hidden' : !nearPeaks.length ? '' : given?.named ? ` · shown with its contours` : given ? ` · the mountain isn't named; candidates shown: ${nearPeaks.map((p) => p.name).join(' or ')}` : ` · named peaks within ${PEAK_REACH} km are shown with contours`}</em>
          </p>
        )}
        </>}
        {compact && cardKey && stories(cardKey)}
        {linkPlace && (
          <p className="map-links">
            {linkPlace.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noopener">{l.label}</a>)}
          </p>
        )}
      </div>
      {(() => {
        const toggles = (
          <>
            <button type="button" className="map-toggle" aria-pressed={mountainsOn} onClick={() => setMountainsChoice(!mountainsOn)} title="Show the named mountains (on by itself where the text places Jesus on or near a mountain)">
              Mountains
            </button>
            <button type="button" className="map-toggle" aria-pressed={modern} onClick={() => useUI.getState().setModern(!modern)} title="Show today’s towns and the modern names of the sites">
              Modern places
            </button>
          </>
        );
        if (!compact) return <div className="map-toggles">{toggles}</div>;
        // Phones: the toggles, the effects and the credits behind one button in the corner, beside the scale.
        return (
          <ConfigButton
            label="Map layers and credits" className="map-more" badge={mountainsOn || modern}
            icon={<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 12.5l9 5 9-5" /><path d="M3 17l9 5 9-5" /></svg>}
          >
            <div className="map-more-toggles">
              {toggles}
              <button type="button" className="map-toggle" aria-pressed={effects} onClick={() => { const ui = useUI.getState(); ui.setLandLight(!effects); ui.setWander(!effects); }} title="His light on the land, and his marker's drift within an area">
                Effects
              </button>
            </div>
            <p className="map-credits" dangerouslySetInnerHTML={{ __html: `Map: <a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a> · ${CREDITS}` }} />
          </ConfigButton>
        );
      })()}
    </div>
  );
}

function placePopup(key: string, p: PlaceData, full: boolean): string {
  const today = modernName(p);
  const sub = p.kind === 'region' ? 'A region' : today ? `Shown at ${today}` : null;
  const stories = full ? storiesHtml(key) : storiesAt(key).length ? '<p class="pp-h">Click for the photo and stories</p>' : '';
  return `${full ? photoHtml(p) : ''}<p class="pp-title">${esc(p.name)}</p>${sub ? `<p class="pp-sub">${esc(sub)}</p>` : ''}${p.wiki?.note ? `<p class="pp-sub">Wikipedia link: ${esc(p.wiki.note)}</p>` : ''}${stories}${linksHtml(placeLinks(key, p))}`;
}
function photoHtml(p: PlaceData): string {
  const ph = p.photo;
  if (!ph) return '';
  const caption = ph.caption.charAt(0).toUpperCase() + ph.caption.slice(1);
  const by = creditName(ph.author);
  const title = [by ? `Photo: ${by}` : 'Photo', ph.licence, 'Wikimedia Commons'].filter(Boolean).join(' · ');
  const credit = webUrl(ph.page) ? `<a href="${esc(ph.page)}" target="_blank" rel="noopener" title="${esc(title)}">${esc(by ?? 'Photo')}</a>` : `<span title="${esc(title)}">${esc(by ?? 'Photo')}</span>`;
  return `<figure class="pp-photo"><img src="${esc(new URL(ph.src, document.baseURI).href)}" alt="${esc(caption)}" decoding="async"><figcaption>${esc(caption)}. ${credit}</figcaption></figure>`;
}
/** Just the photographer's name from a Commons author line ("Bill Rice from Flat Rock, MI, …" → "Bill Rice"); the link has the rest. */
function creditName(author: string | null): string | null {
  if (!author || /^https?:/.test(author)) return null;
  const name = author.replace(/^The original uploader was /i, '').replace(/\s+(from|at|on)\s.*$/i, '').replace(/\s*\(.*$/, '').replace(/,.*$/, '').trim();
  return name || null;
}
/** The stories set at a place, each a link that takes the reader there. */
function storiesHtml(key: string): string {
  const stories = storiesAt(key);
  if (!stories.length) return '';
  const section = ROWS[useUI.getState().current].sectionId;
  const items = stories.map((st) => {
    const r = ROWS[st.i];
    const notes = [st.books && st.books.map((b) => BOOK_ABBR[b]).join(', '), st.implied && 'implied'].filter(Boolean).join(' · ');
    return `<li><a href="#" data-row="${st.i}"${r.sectionId === section ? ' aria-current="true"' : ''}><span class="pp-n">§${esc(r.n)}</span> ${esc(r.sectionTitle)}${notes ? ` <em>${esc(notes)}</em>` : ''}</a></li>`;
  });
  return `<ol class="pp-stories" aria-label="Stories set here">${items.join('')}</ol>`;
}
function peakPopup(p: Peak): string {
  const links: Link[] = [];
  if (p.wiki) links.push({ label: 'Wikipedia', href: p.wiki.url });
  links.push({ label: 'Google Maps', href: googleUrl(p.lonlat) });
  return `<p class="pp-title">${esc(p.name)}</p><p class="pp-sub">≈ ${p.elev} m above sea level (terrain data); contours every ${p.interval} m</p>${linksHtml(links)}`;
}
