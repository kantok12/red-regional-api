"""Red estática (GTFS) y telemetría en vivo, una instancia por zona.

Cada `ZoneService` tiene su propio cliente TransApp, su caché GTFS y su
`FleetPoller`. Los servicios se crean al primer pedido de la zona, y el poller
de cada una se pausa solo cuando nadie la consulta, así la API de TransApp
solo recibe carga por las ciudades que alguien está mirando.
"""
import csv
import io
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests.adapters import HTTPAdapter

from client import TransAppClient

POLL_INTERVAL = 10        # segundos entre el inicio de dos ciclos de consulta
IDLE_SWEEP_EVERY = 4      # rutas sin buses se revisan 1 de cada N ciclos
IDLE_AFTER = 60           # sin visitas en este lapso, el poller se pausa
NETWORK_TTL = 6 * 3600    # segundos que se reutiliza el GTFS
ZONES_TTL = 3600          # segundos que se reutiliza la lista de zonas
MAX_WORKERS = 16

# TransApp publica Merval como modo 2 dentro del GTFS de Gran Valparaíso.
VALPARAISO_ZONE_ID = "e944e47c-a4f6-4be2-a8b4-3ed1968062cb"

# Una sola sesión HTTP para todas las zonas: limita las conexiones abiertas.
_session = requests.Session()
_session.mount("https://", HTTPAdapter(pool_connections=1, pool_maxsize=4 * MAX_WORKERS))
_base_client = TransAppClient(session=_session)


# ---------------------------------------------------------------------------
# Zonas
# ---------------------------------------------------------------------------
def zone_summary(z: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": z["public_id"],
        "name": z["public_name"],
        "region": z.get("region_name"),
        "center": [z["city_center_latitude"], z["city_center_longitude"]],
        "bounds": [
            [z["lower_left_latitude"], z["lower_left_longitude"]],
            [z["upper_right_latitude"], z["upper_right_longitude"]],
        ],
    }


_zones_lock = threading.Lock()
_zones: Optional[Tuple[float, List[Dict[str, Any]]]] = None


def list_zones() -> List[Dict[str, Any]]:
    global _zones
    with _zones_lock:
        if _zones is None or time.time() - _zones[0] > ZONES_TTL:
            zones = [zone_summary(z) for z in _base_client.get_available_zones()]
            _zones = (time.time(), sorted(zones, key=lambda z: z["name"]))
        return _zones[1]


def find_zone(zone_id: str) -> Optional[Dict[str, Any]]:
    return next((z for z in list_zones() if z["id"] == zone_id), None)


# ---------------------------------------------------------------------------
# Red estática (GTFS)
# ---------------------------------------------------------------------------
def read_csv(z: zipfile.ZipFile, name: str) -> List[Dict[str, str]]:
    if name not in z.namelist():
        return []
    text = z.read(name).decode("utf-8-sig", "replace")
    return list(csv.DictReader(io.StringIO(text), delimiter=";"))


def build_network(client: TransAppClient, zone: Dict[str, Any]) -> Dict[str, Any]:
    """Descarga el GTFS de la zona y extrae rutas, trazados y paraderos."""
    res = client.session.get(f"{client.BASE_URL}/{client.zone_uuid}/gtfs/download/3", timeout=60)
    res.raise_for_status()

    with zipfile.ZipFile(io.BytesIO(res.content)) as z:
        route_rows = read_csv(z, "route.csv")
        shape_rows = read_csv(z, "shape.csv")
        stop_rows = read_csv(z, "stop.csv")

    shapes: Dict[str, List[Tuple[int, float, float]]] = {}
    for r in shape_rows:
        shapes.setdefault(r["id"], []).append(
            (int(r["sequence"]), float(r["latitude"]), float(r["longitude"]))
        )

    # route.csv repite cada ruta por tipo de día (L/S/D); se agrupa por ruta+sentido.
    allowed_modes = {"3", "2"} if zone["id"] == VALPARAISO_ZONE_ID else {"3"}
    routes: Dict[str, Dict[str, Any]] = {}
    for r in route_rows:
        if r.get("mode") not in allowed_modes:
            continue
        key = f"{r['mode']}_{r['route_name']}_{r['direction']}"
        if key in routes:
            routes[key]["schedules"][r["day_type"]] = r["schedule"]
            continue
        points = sorted(shapes.get(r["shape_id"], []))
        routes[key] = {
            "key": key,
            "mode": r["mode"],
            "route": r["route_name"],
            "direction": r["direction"],
            "headsign": r["headsign"],
            "color": r["color"] or "#555555",
            "textColor": r.get("text_color") or "#ffffff",
            "schedules": {r["day_type"]: r["schedule"]},
            "shape": [[lat, lon] for _, lat, lon in points],
        }

    stops = [
        {
            "code": s["stop_code"] or s["stop_id"],
            "name": s["name"],
            "mode": s["mode"],
            "lat": float(s["stop_lat"]),
            "lon": float(s["stop_lon"]),
            "routes": [x for x in s["routes"].split("|") if x],
        }
        for s in stop_rows
        if s.get("mode") in allowed_modes and s.get("stop_lat") and s.get("stop_lon")
    ]

    return {
        "zone": zone,
        "routes": sorted(routes.values(), key=lambda x: (x["route"], x["direction"])),
        "stops": stops,
    }


# ---------------------------------------------------------------------------
# Telemetría en vivo
# ---------------------------------------------------------------------------
class FleetPoller:
    """Consulta synoptic/machines por ruta+sentido en un hilo de fondo.

    La API solo filtra por ruta, así que cada ciclo implica una petición por
    ruta+sentido. Para reducir carga, las rutas que en su última revisión no
    tenían buses solo se vuelven a consultar cada IDLE_SWEEP_EVERY ciclos.
    """

    def __init__(self, service: "ZoneService") -> None:
        self._service = service
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._by_route: Dict[str, List[Dict[str, Any]]] = {}
        self._snapshot: Dict[str, Any] = {"vehicles": [], "fetchedAt": None, "errors": [], "stats": {}}
        self._snapshot_at = 0.0
        self._last_request = time.time()
        self._cycle = 0
        threading.Thread(target=self._run, daemon=True).start()

    def snapshot(self) -> Dict[str, Any]:
        self._last_request = time.time()
        self._wake.set()
        with self._lock:
            # Tras una pausa por inactividad la foto quedó vieja: se informa como
            # "sin datos" para que el cliente reintente en vez de mostrarla.
            if time.time() - self._snapshot_at > 3 * POLL_INTERVAL:
                return {**self._snapshot, "vehicles": [], "fetchedAt": None}
            return self._snapshot

    def _run(self) -> None:
        while True:
            if time.time() - self._last_request > IDLE_AFTER:
                self._wake.clear()
                self._wake.wait()
            started = time.time()
            try:
                self._poll()
            except Exception as exc:  # p.ej. GTFS no disponible: se reintenta
                with self._lock:
                    self._snapshot = {**self._snapshot, "errors": [f"ciclo: {exc}"]}
            time.sleep(max(1.0, POLL_INTERVAL - (time.time() - started)))

    def _poll(self) -> None:
        client = self._service.client
        routes = self._service.network()["routes"]
        full_sweep = self._cycle % IDLE_SWEEP_EVERY == 0
        self._cycle += 1
        due = [r for r in routes if full_sweep or self._by_route.get(r["key"])]

        def fetch(route: Dict[str, Any]):
            try:
                data = client.get_synoptic_machines(
                    route["route"], route["direction"], mode=int(route["mode"])
                )
                return route, data.get("machines", []), None
            except Exception as exc:  # una ruta caída no debe tumbar la zona
                return route, None, f"{route['key']}: {exc}"

        started = time.time()
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            results = list(pool.map(fetch, due))

        errors = []
        for route, machines, error in results:
            if error:
                errors.append(error)
            else:
                self._by_route[route["key"]] = machines

        snapshot = {
            "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "vehicles": self._merge(routes),
            "errors": errors,
            "stats": {
                "routesTotal": len(routes),
                "routesQueried": len(due),
                "fullSweep": full_sweep,
                "seconds": round(time.time() - started, 2),
            },
        }
        with self._lock:
            self._snapshot = snapshot
            self._snapshot_at = time.time()

    def _merge(self, routes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        vehicles: Dict[str, Dict[str, Any]] = {}
        for route in routes:
            for m in self._by_route.get(route["key"], []):
                machine_id = m.get("machineId") or m.get("licensePlate")
                # Una patente o machineId se identifica dentro de su modo. Así un
                # tren nunca pisa a una micro que use el mismo identificador.
                vid = f"{route['mode']}:{machine_id}" if machine_id else None
                if not vid or vid in vehicles:
                    continue
                vehicles[vid] = {
                    "id": vid,
                    "plate": m.get("licensePlate") or "Sin patente",
                    "lat": m.get("latitude"),
                    "lon": m.get("longitude"),
                    "bearing": m.get("bearing"),
                    "timestamp": m.get("timestamp"),
                    "mode": route["mode"],
                    "route": route["route"],
                    "direction": route["direction"],
                    "routeKey": route["key"],
                    "headsign": route["headsign"],
                }
        return list(vehicles.values())


# ---------------------------------------------------------------------------
# Servicio por zona
# ---------------------------------------------------------------------------
class ZoneService:
    def __init__(self, zone: Dict[str, Any]) -> None:
        self.zone = zone
        self.client = TransAppClient(zone_uuid=zone["id"], session=_session)
        self._network_lock = threading.Lock()
        self._network: Optional[Tuple[float, Dict[str, Any]]] = None
        self._poller: Optional[FleetPoller] = None
        self._poller_lock = threading.Lock()

    def network(self) -> Dict[str, Any]:
        with self._network_lock:
            if self._network is None or time.time() - self._network[0] > NETWORK_TTL:
                self._network = (time.time(), build_network(self.client, self.zone))
            return self._network[1]

    def vehicles(self) -> Dict[str, Any]:
        with self._poller_lock:
            if self._poller is None:
                self._poller = FleetPoller(self)
        return self._poller.snapshot()

    def stop(self, stop_code: str, mode: int = 3) -> Dict[str, Any]:
        data = self.client.get_stop_info(stop_code, mode=mode)
        return {
            "predictions": [
                {
                    "route": p.get("route"),
                    "direction": p.get("direction"),
                    "timeLabel": p.get("timeLabel"),
                    "distanceLabel": p.get("distanceLabel"),
                    "plate": p.get("licensePlate"),
                    "realtime": p.get("realtime"),
                }
                for p in data.get("predictions", [])
            ],
            "events": [e.get("name") for e in data.get("events", [])],
        }


_services_lock = threading.Lock()
_services: Dict[str, ZoneService] = {}


def get_zone(zone_id: str) -> Optional[ZoneService]:
    """Devuelve el servicio de la zona, creándolo al primer pedido."""
    with _services_lock:
        service = _services.get(zone_id)
        if service is None:
            zone = find_zone(zone_id)
            if zone is None:
                return None
            service = _services[zone_id] = ZoneService(zone)
        return service
