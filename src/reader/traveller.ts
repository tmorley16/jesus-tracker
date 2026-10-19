// Jesus on the map: one marker that travels rather than jumps. A move waits until the
// camera sets off, then keeps pace with it (its progress is the camera's progress
// towards its target), so the marker and the view arrive together. A move starts from
// wherever the marker is drawn, drift included, so fast scrubbing never queues
// animations and nothing snaps back to a centre first.
//
// In an area (a region, or the likely area where no place is named) the marker drifts
// about the centre: the drift grows from nothing on arrival, so it carries straight on
// from the journey, and it keeps going until the next journey sets off from wherever
// the drift has taken it.
//
// His light is a second marker under everything else on the map (first after the canvas),
// so the glow never muddies a label or another marker; it moves and drifts with the point.
// Where the marker is drawn, drift included, is reported (onDraw), so the route's newest leg
// stays joined to it and the light on the land follows it.
import { Marker, MercatorCoordinate, type Map as MlMap } from 'maplibre-gl';
import type { LonLat } from './geo';
import type { Traveller as Kind } from './state';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const merc = (ll: LonLat) => MercatorCoordinate.fromLngLat(ll);
const mdist = (a: LonLat, b: LonLat) => { const p = merc(a), q = merc(b); return Math.hypot(p.x - q.x, p.y - q.y); };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const TAU = 2 * Math.PI;
const ICONS: Record<Kind, string> = {
  light: '',
  cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5v19M6 8.5h12"/></svg>',
  j: '<span>J</span>',
  crown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.5h16M4.5 17.5 3 8l5 4 4-7 4 7 5-4-1.5 9.5"/></svg>',
};

export interface Move {
  to: LonLat;
  /** Radius (km) of the area to drift within once there; null at a named place. */
  wanderKm: number | null;
  /** Called with 0–1 as the marker travels (1 on arrival). */
  onProgress?: (p: number) => void;
  /** Called once the marker is there (at once if it doesn't travel). */
  onArrive?: () => void;
}

/** A move under way: where it set off from (once the camera does), its progress, and the camera it keeps pace with. */
type Journey = Move & { from: LonLat | null; p: number; cam: { to: LonLat; d0: number; done: boolean } | null; t0: number | null };

interface Drift {
  /** The area's radius (km); null while the drift dies away. */
  km: number | null;
  t0: number;
  last: number;
  /** Current amplitude (px), easing towards the area's. */
  a: number;
  dx: number;
  dy: number;
}

export class TravellerMarker {
  readonly el: HTMLElement;
  private glowEl: HTMLElement;
  private sym: HTMLElement;
  private wanders: HTMLElement[];
  private marker: Marker;
  private glow: Marker;
  /** Where the marker's point is (the centre of any drift). */
  private pos: LonLat | null = null;
  private move: Journey | null = null;
  private frame = 0;
  private drift: Drift | null = null;
  private driftFrame = 0;
  /** Told where the marker is drawn whenever that changes (travelling or drifting), so the route and the light keep up. */
  onDraw: ((ll: LonLat) => void) | null = null;
  /** Told where a journey sets off from: wherever the drift had taken the marker. */
  onDepart: ((from: LonLat) => void) | null = null;

  constructor(private map: MlMap) {
    this.el = document.createElement('div');
    this.el.className = 'map-traveller off';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = '<div class="wander"><div class="sym"></div><span class="who">Jesus</span></div>';
    this.glowEl = document.createElement('div');
    this.glowEl.className = 'map-traveller-glow off';
    this.glowEl.setAttribute('aria-hidden', 'true');
    this.glowEl.innerHTML = '<div class="wander"><i></i></div>';
    this.sym = this.el.querySelector('.sym')!;
    this.wanders = [this.el, this.glowEl].map((e) => e.querySelector<HTMLElement>('.wander')!);
    this.marker = new Marker({ element: this.el, anchor: 'center' });
    this.glow = new Marker({ element: this.glowEl, anchor: 'center' });
  }

  private toggle(cls: string, on: boolean) {
    this.el.classList.toggle(cls, on);
    this.glowEl.classList.toggle(cls, on);
  }

  /** Resting: Jesus isn't in the scene, so the marker waits, dimmed and labelled, where he was last placed. */
  setResting(on: boolean) { this.toggle('resting', on); }

  /** Set off now, at its own pace, for a move the camera isn't following (the camera is on another scene). */
  setOff() {
    const m = this.move;
    if (!m) return;
    this.depart(m);
    m.cam = null;
    m.t0 = performance.now();
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.step);
  }

  /** The marker's point (the centre of any drift; null before its first placing). */
  get position(): LonLat | null { return this.pos; }

  setKind(kind: Kind) {
    this.el.dataset.kind = kind;
    this.sym.innerHTML = ICONS[kind];
  }

  show(on: boolean) {
    this.toggle('off', !on);
    // Hidden mid-drift: keep the spot it was last seen, for the next journey to start from.
    if (!on) this.settle();
  }

  /** Whether the marker is out of sight: not placed yet, or hidden. */
  get hidden(): boolean { return !this.pos || this.el.classList.contains('off'); }

  /** While out of sight, put the marker at `ll` without travelling (a journey it wasn't seen to make). */
  startAt(ll: LonLat) {
    if (!this.hidden) return;
    cancelAnimationFrame(this.frame);
    this.move = null;
    this.endDrift();
    if (this.pos) this.onDepart?.(this.pos);
    this.place(ll);
  }

  /** Whether a move to `ll` is under way. */
  travellingTo(ll: LonLat | undefined): boolean {
    return !!this.move && !!ll && mdist(this.move.to, ll) < 1e-9;
  }

  /** Go to a new place: waits for `cameraStarted`, or travels on its own if the camera doesn't move. */
  go(m: Move) {
    // Asked again for where it's already going: carry on (no restart, no hop).
    if (this.travellingTo(m.to)) { Object.assign(this.move!, { onProgress: m.onProgress, onArrive: m.onArrive, wanderKm: m.wanderKm }); m.onProgress?.(this.move!.p); return; }
    cancelAnimationFrame(this.frame);
    const here = !!this.pos && mdist(this.pos, m.to) < 1e-9;
    if (!this.pos || here || reducedMotion()) {
      // A jump (reduced motion, or the first placing) still leaves from where the marker was.
      if (!here) { this.settle(); if (this.pos) this.onDepart?.(this.pos); this.place(m.to); }
      this.move = null;
      m.onProgress?.(1);
      this.setDrift(m.wanderKm);
      m.onArrive?.();
      return;
    }
    // Any drift goes on until the camera sets off; the journey starts from wherever it is then.
    this.move = { ...m, from: null, p: 0, cam: null, t0: null };
    m.onProgress?.(0);
  }

  /** The camera is setting off for `camTo`; keep pace with it. */
  cameraStarted(camTo: LonLat) {
    const m = this.move;
    if (!m) return;
    const from = this.depart(m);
    const c = this.map.getCenter(), d0 = mdist([c.lng, c.lat], camTo);
    // A camera that barely moves (already in view) can't set the pace; travel by time instead.
    m.cam = d0 > 0.25 * mdist(from, m.to) ? { to: camTo, d0, done: false } : null;
    // The flight's end, or the reader taking hold of the map, ends the move.
    if (m.cam) this.map.once('moveend', () => { if (this.move === m && m.cam) m.cam.done = true; });
    m.t0 = performance.now();
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.step);
  }

  private step = (now: number) => {
    const m = this.move;
    if (!m || !m.from) return;
    let p: number;
    if (m.cam) {
      const c = this.map.getCenter();
      p = m.cam.done ? 1 : 1 - mdist([c.lng, c.lat], m.cam.to) / m.cam.d0;
    } else p = ease(Math.min(1, (now - m.t0!) / 700));
    p = Math.max(m.p, Math.min(1, p));
    m.p = p;
    this.place([m.from[0] + (m.to[0] - m.from[0]) * p, m.from[1] + (m.to[1] - m.from[1]) * p]);
    m.onProgress?.(p);
    if (p < 1) this.frame = requestAnimationFrame(this.step);
    else { this.move = null; this.setDrift(m.wanderKm); m.onArrive?.(); }
  };

  /** Set off: from wherever the drift has taken the marker (it settles there). */
  private depart(m: Journey): LonLat {
    if (m.from) return m.from;
    this.settle();
    m.from = this.pos!;
    this.onDepart?.(m.from);
    return m.from;
  }

  private place(ll: LonLat) {
    this.pos = ll;
    this.marker.setLngLat(ll);
    this.glow.setLngLat(ll);
    if (!this.el.isConnected) {
      this.marker.addTo(this.map);
      this.glow.addTo(this.map);
      // The glow goes under every other marker and label.
      this.map.getCanvasContainer().insertBefore(this.glowEl, this.map.getCanvas().nextSibling);
    }
    this.onDraw?.(ll);
  }

  /** Where the marker is drawn: its point, moved by any drift. */
  private drawn(): LonLat | null {
    const d = this.drift;
    if (!this.pos || !d || (!d.dx && !d.dy)) return this.pos;
    const p = this.map.project(this.pos), ll = this.map.unproject([p.x + d.dx, p.y + d.dy]);
    return [ll.lng, ll.lat];
  }

  /** Start, resize or let die away the drift about the marker's point. */
  private setDrift(km: number | null) {
    if (!km || reducedMotion()) {
      if (this.drift) this.drift.km = null; // eases back to the centre, then stops
      return;
    }
    if (this.drift) { this.drift.km = km; return; }
    const now = performance.now();
    this.drift = { km, t0: now, last: now, a: 0, dx: 0, dy: 0 };
    this.el.classList.add('wandering');
    this.driftFrame = requestAnimationFrame(this.driftStep);
  }

  // A slow figure about the centre. Every term is zero at the start and the amplitude grows
  // from zero, so the drift begins from rest exactly where the journey ended.
  private driftStep = (now: number) => {
    const d = this.drift;
    if (!d) return;
    const dt = Math.min(0.1, (now - d.last) / 1000);
    d.last = now;
    d.a += ((d.km ? this.amplitude(d.km) : 0) - d.a) * Math.min(1, dt * 1.6);
    if (!d.km && d.a < 0.25) { this.endDrift(); return; }
    const t = (now - d.t0) / 1000;
    d.dx = d.a * (0.75 * Math.sin((TAU * t) / 11) + 0.25 * Math.sin((TAU * t) / 4.3));
    d.dy = 0.8 * d.a * (0.7 * Math.sin((TAU * t) / 7.3) + 0.3 * Math.sin((TAU * t) / 3.1));
    const shift = `translate(${d.dx.toFixed(2)}px, ${d.dy.toFixed(2)}px)`;
    for (const w of this.wanders) w.style.transform = shift;
    const ll = this.drawn();
    if (ll) this.onDraw?.(ll);
    this.driftFrame = requestAnimationFrame(this.driftStep);
  };

  /** Stop drifting, moving the marker's point to where the drift has drawn it, so nothing jumps. */
  private settle() {
    const d = this.drift;
    if (!d) return;
    this.endDrift();
    if (this.pos && Math.hypot(d.dx, d.dy) > 0.05) {
      const p = this.map.project(this.pos), ll = this.map.unproject([p.x + d.dx, p.y + d.dy]);
      this.place([ll.lng, ll.lat]);
    }
  }

  private endDrift() {
    cancelAnimationFrame(this.driftFrame);
    const was = this.drift;
    this.drift = null;
    for (const w of this.wanders) w.style.transform = '';
    this.el.classList.remove('wandering');
    if (was && this.pos) this.onDraw?.(this.pos);
  }

  /** Drift amplitude in pixels: a fifth of the area's radius at this zoom, kept small so it still reads as the centre. */
  private amplitude(km: number) {
    const lat = this.pos?.[1] ?? 32;
    const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** this.map.getZoom());
    return Math.max(4, Math.min(32, (km * 1000) / mpp / 5));
  }
}
