// Utilidades de presentación compartidas por web y móvil (portadas de
// dashboard/static/app.js).
import type { Route, Vehicle } from "./api";

export const STALE_SECONDS = 180; // la API ya entrega posiciones con 60–90 s de atraso

export type RouteStyle = { bg: string; fg: string };
export const DEFAULT_STYLE: RouteStyle = { bg: "#555555", fg: "#ffffff" };

// Si la red usa el mismo color para casi todas sus líneas, se asigna uno de
// esta paleta para poder distinguirlas en el mapa.
const PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#0f9fa8", "#d6338a",
  "#7a8f00", "#9a6324", "#800000", "#2f4f8f", "#008060", "#c06000", "#5b2c83", "#b8860b", "#1e7b9c"];

export const byRouteName = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });

/** Color por línea; recolorea la red si casi todas comparten color. */
export function routeStyles(routes: Route[]): Map<string, RouteStyle> {
  const names = [...new Set(routes.map((r) => serviceKey(r.mode, r.route)))].sort(byRouteName);
  const distinct = new Set(routes.map((r) => r.color.toLowerCase())).size;
  const recolor = distinct < Math.min(names.length, 4);
  const styles = new Map<string, RouteStyle>();
  for (const r of routes) {
    const key = serviceKey(r.mode, r.route);
    if (styles.has(key)) continue;
    styles.set(key, recolor
      ? { bg: PALETTE[names.indexOf(key) % PALETTE.length], fg: "#ffffff" }
      : { bg: r.color, fg: r.textColor });
  }
  return styles;
}

export function ageSeconds(ts: string | null): number {
  return ts ? Math.max(0, (Date.now() - Date.parse(ts)) / 1000) : Infinity;
}

export function formatAge(sec: number): string {
  if (!isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  return `${Math.floor(sec / 3600)} h`;
}

export function cardinal(deg: number | null): string {
  if (deg == null) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return `${dirs[Math.round(deg / 45) % 8]} (${Math.round(deg)}°)`;
}

export const directionLabel = (d: string) => (d === "I" ? "Ida" : d === "R" ? "Regreso" : d);

/** Identificador visible único: una misma etiqueta puede existir en más de un modo. */
export const serviceKey = (mode: string, route: string) => `${mode}:${route}`;
export const isMetro = (mode: string) => mode === "2";
export const serviceLabel = (mode: string, route: string) => `${isMetro(mode) ? "Metro" : "Línea"} ${route}`;

export const isStale = (v: Vehicle) => ageSeconds(v.timestamp) > STALE_SECONDS;

export function filterVehicles(vehicles: Vehicle[], focusRoute: string | null, search: string): Vehicle[] {
  const q = search.trim().toLowerCase();
  return vehicles.filter((v) =>
    v.lat != null && v.lon != null &&
    (!focusRoute || serviceKey(v.mode, v.route) === focusRoute) &&
    (!q || v.plate.toLowerCase().includes(q) || v.route.toLowerCase().includes(q)));
}
