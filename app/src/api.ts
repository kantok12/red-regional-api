import type { AppUser } from "./auth/AuthProvider";
import { API_URL } from "./config";

export type LatLon = [number, number];

export type Zone = {
  id: string;
  name: string;
  region: string | null;
  center: LatLon;
  bounds: [LatLon, LatLon];
};

export type Route = {
  key: string;
  mode: string;
  route: string;
  direction: string;
  headsign: string;
  color: string;
  textColor: string;
  schedules: Record<string, string>;
  shape: LatLon[];
};

export type Stop = { code: string; name: string; mode: string; lat: number; lon: number; routes: string[] };

export type Network = { zone: Zone; routes: Route[]; stops: Stop[] };

export type Vehicle = {
  id: string;
  plate: string;
  lat: number | null;
  lon: number | null;
  bearing: number | null;
  timestamp: string | null;
  mode: string;
  route: string;
  direction: string;
  routeKey: string;
  headsign: string;
};

export type Fleet = { vehicles: Vehicle[]; fetchedAt: string | null; errors: string[] };

export type StopArrivals = {
  predictions: {
    route: string;
    direction: string;
    timeLabel: string;
    distanceLabel: string;
    plate: string | null;
    realtime: boolean;
  }[];
  events: string[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** GET autenticado al backend; si el token venció, lo renueva y reintenta una vez. */
export async function apiGet<T>(user: AppUser, path: string): Promise<T> {
  const send = async (force: boolean) => {
    const token = await user.getIdToken(force);
    return fetch(`${API_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };
  let res = await send(false);
  if (res.status === 401) res = await send(true);
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  zones: (u: AppUser) => apiGet<Zone[]>(u, "/api/zones"),
  network: (u: AppUser, zone: string) => apiGet<Network>(u, `/api/zones/${zone}/network`),
  vehicles: (u: AppUser, zone: string) => apiGet<Fleet>(u, `/api/zones/${zone}/vehicles`),
  stop: (u: AppUser, zone: string, code: string, mode: string) =>
    apiGet<StopArrivals>(u, `/api/zones/${zone}/stops/${encodeURIComponent(code)}?mode=${encodeURIComponent(mode)}`),
};
