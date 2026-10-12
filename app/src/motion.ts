// Animación entre actualizaciones (portada de dashboard/static/app.js): cada bus
// avanza por el trazado de su línea a su velocidad promedio de avance en los
// últimos minutos y, cuando llega una posición nueva, se corrige suavemente hacia ella.
import type { Route, Vehicle } from "./api";
import { ageSeconds, STALE_SECONDS } from "./fleet";

const ANIM = {
  defaultSpeed: 5.5,    // m/s mientras no hay 2 posiciones
  maxSpeed: 20,         // m/s; más que esto es ruido de GPS
  speedBoost: 1.15,     // algo más rápido que el promedio: mejor alcanzar que retroceder
  historyS: 180,        // ventana para el promedio de avance
  historyMax: 8,        // posiciones guardadas por bus
  maxExtrapolateS: 45,  // el GPS de cada bus se renueva cada ~30 s
  blendMs: 7000,        // tiempo para corregir hacia la posición real
  holdAheadM: 250,      // si va adelantado menos que esto, espera en vez de retroceder
  snapM: 1500,          // diferencias mayores se corrigen de golpe
  offRouteM: 100,       // más lejos del trazado: no se anima
};

export type BusPoint = { lat: number; lon: number; bearing: number | null };

type Geo = { kx: number; ky: number; xs: number[]; ys: number[]; cum: number[]; total: number };

type Track = {
  routeKey: string;
  geo: Geo;
  obsS: number;              // distancia sobre el trazado de la última posición real
  obsTs: string | null;      // timestamp GPS de esa posición
  recvAt: number;            // cuándo se recibió (Date.now())
  speed: number;             // m/s
  hist: { t: number; s: number }[];
  offset: number;            // diferencia inicial a corregir durante blendMs
  floorS: number;            // no retroceder de aquí (bus adelantado esperando)
};

// Los trazados se pasan a metros con una proyección equirectangular local, que
// a escala de ciudad es suficientemente precisa y muy barata de calcular.
function buildGeo(shape: [number, number][]): Geo {
  const kx = Math.cos(shape[0][0] * Math.PI / 180) * 111320;
  const ky = 110540;
  const xs = shape.map((p) => p[1] * kx);
  const ys = shape.map((p) => p[0] * ky);
  const cum = [0];
  for (let i = 1; i < shape.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  }
  return { kx, ky, xs, ys, cum, total: cum[cum.length - 1] };
}

// Distancia recorrida (s) del punto más cercano del trazado y qué tan lejos está.
// Con `hint` se prefiere el tramo cercano a la posición anterior, para no saltar
// a otra pasada del trazado cuando este vuelve por la misma calle.
function project(geo: Geo, lat: number, lon: number, hint: number | null) {
  const px = lon * geo.kx, py = lat * geo.ky;
  let best = { s: 0, d: Infinity }, near = { s: 0, d: Infinity };
  for (let i = 0; i < geo.xs.length - 1; i++) {
    const ax = geo.xs[i], ay = geo.ys[i];
    const dx = geo.xs[i + 1] - ax, dy = geo.ys[i + 1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    const s = geo.cum[i] + t * Math.sqrt(len2);
    if (d < best.d) best = { s, d };
    if (hint != null && s > hint - 300 && s < hint + 3000 && d < near.d) near = { s, d };
  }
  return near.d < 60 ? near : best;
}

function pointAt(geo: Geo, s: number): BusPoint {
  let lo = 0, hi = geo.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (geo.cum[mid] <= s) lo = mid; else hi = mid;
  }
  const seg = geo.cum[hi] - geo.cum[lo];
  const t = seg ? (s - geo.cum[lo]) / seg : 0;
  const dx = geo.xs[hi] - geo.xs[lo], dy = geo.ys[hi] - geo.ys[lo];
  return {
    lat: (geo.ys[lo] + t * dy) / geo.ky,
    lon: (geo.xs[lo] + t * dx) / geo.kx,
    bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360,
  };
}

function displayS(m: Track, now: number) {
  const elapsed = now - m.recvAt;
  const travel = m.speed * Math.min(elapsed / 1000, ANIM.maxExtrapolateS);
  const blend = m.offset * Math.max(0, 1 - elapsed / ANIM.blendMs);
  return Math.min(m.geo.total, Math.max(m.floorS, m.obsS + travel + blend));
}

/** Estado de la animación de la flota de una zona. */
export class BusMotion {
  private geos = new Map<string, Geo>();
  private tracks = new Map<string, Track>();

  constructor(routes: Route[]) {
    for (const r of routes) if (r.shape.length >= 2) this.geos.set(r.key, buildGeo(r.shape));
  }

  get size() { return this.tracks.size; }

  /**
   * Se llama con cada foto nueva de la flota. Solo se reancla un bus cuando
   * cambia su posición GPS (timestamp) o su recorrido.
   */
  update(vehicles: Vehicle[], now = Date.now()) {
    const seen = new Set<string>();
    for (const v of vehicles) {
      seen.add(v.id);
      const geo = this.geos.get(v.routeKey);
      const prev = this.tracks.get(v.id);
      const sameRoute = prev?.routeKey === v.routeKey ? prev : null;
      if (sameRoute && sameRoute.obsTs === v.timestamp) continue;
      if (!geo || v.lat == null || v.lon == null) { this.tracks.delete(v.id); continue; }

      const p = project(geo, v.lat, v.lon, sameRoute ? sameRoute.obsS : null);
      if (p.d > ANIM.offRouteM) { this.tracks.delete(v.id); continue; }

      // Promedio de avance: distancia recorrida sobre el trazado entre la posición
      // más antigua de la ventana y la actual. Incluye detenciones en paraderos y
      // semáforos, así el bus no corre y frena a cada actualización.
      const t = v.timestamp ? Date.parse(v.timestamp) : now;
      let hist = sameRoute ? sameRoute.hist.filter((h) => t - h.t <= ANIM.historyS * 1000) : [];
      if (hist.length && p.s < hist[hist.length - 1].s - ANIM.holdAheadM) hist = [];  // cambió de pasada
      hist.push({ t, s: p.s });
      if (hist.length > ANIM.historyMax) hist = hist.slice(-ANIM.historyMax);
      let speed = ANIM.defaultSpeed;
      const dt = (t - hist[0].t) / 1000;
      if (dt > 0) speed = Math.max(0, Math.min(ANIM.maxSpeed, (p.s - hist[0].s) / dt)) * ANIM.speedBoost;
      if (ageSeconds(v.timestamp) > STALE_SECONDS) speed = 0;

      // Transición desde donde se ve el bus ahora hacia la nueva posición real.
      let offset = 0, floorS = -Infinity;
      if (sameRoute) {
        const diff = displayS(sameRoute, now) - p.s;
        if (Math.abs(diff) > ANIM.snapM) {
          // salto grande (dato raro o cambio de pasada): se corrige de golpe
        } else if (diff > 0 && diff <= ANIM.holdAheadM && speed > 0.5) {
          floorS = p.s + diff;  // va adelantado: espera a que la posición real lo alcance
        } else {
          offset = diff;        // va atrasado (o muy adelantado): se desliza hasta alcanzarla
        }
      }
      this.tracks.set(v.id, {
        routeKey: v.routeKey, geo, obsS: p.s, obsTs: v.timestamp,
        recvAt: now, speed, hist, offset, floorS,
      });
    }
    for (const id of this.tracks.keys()) if (!seen.has(id)) this.tracks.delete(id);
  }

  /** Posición animada del bus, o null si no se anima (fuera de su trazado, sin GPS…). */
  pointOf(id: string, now = Date.now()): BusPoint | null {
    const m = this.tracks.get(id);
    return m ? pointAt(m.geo, displayS(m, now)) : null;
  }
}

/** Dónde dibujar el bus ahora: la posición animada o, si no se anima, la del GPS. */
export function busPosition(v: Vehicle, motion: BusMotion | null, now = Date.now()): BusPoint {
  return motion?.pointOf(v.id, now) ?? { lat: v.lat!, lon: v.lon!, bearing: v.bearing };
}
