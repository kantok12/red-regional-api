"""Panel de monitoreo en tiempo real de buses Red Regional (por defecto Gran Valparaíso).

Servidor Flask que actúa de proxy hacia la API de TransApp (que exige
cabeceras propias y no admite CORS) y sirve el frontend con el mapa.

Un único hilo en segundo plano consulta la telemetría y guarda la última
"foto" de la flota; los navegadores leen esa foto, de modo que la API
recibe la misma carga sin importar cuántas pestañas estén abiertas.

    python dashboard/server.py            # http://127.0.0.1:5000
    ZONE=arica python dashboard/server.py # otra zona (nombre de TransAppClient.ZONES o UUID)
"""
import csv
import io
import os
import sys
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

from flask import Flask, jsonify, send_from_directory
from requests.adapters import HTTPAdapter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from client import TransAppClient  # noqa: E402

_zone = os.environ.get("ZONE", "valparaiso")
ZONE_ID = TransAppClient.ZONES.get(_zone.lower(), _zone)
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

POLL_INTERVAL = 10        # segundos entre el inicio de dos ciclos de consulta
IDLE_SWEEP_EVERY = 4      # rutas sin buses se revisan 1 de cada N ciclos
IDLE_AFTER = 60           # sin visitas en este lapso, el poller se pausa
NETWORK_TTL = 6 * 3600    # segundos que se reutiliza el GTFS
MAX_WORKERS = 16

app = Flask(__name__, static_folder=None)

client = TransAppClient(zone_uuid=ZONE_ID)
_adapter = HTTPAdapter(pool_connections=1, pool_maxsize=MAX_WORKERS)
client.session.mount("https://", _adapter)

_network_lock = threading.Lock()
_network: Optional[Tuple[float, Dict[str, Any]]] = None
_zone_info: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Red estática (GTFS)
# ---------------------------------------------------------------------------
def read_csv(z: zipfile.ZipFile, name: str) -> List[Dict[str, str]]:
    if name not in z.namelist():
        return []
    text = z.read(name).decode("utf-8-sig", "replace")
    return list(csv.DictReader(io.StringIO(text), delimiter=";"))


def load_zone_info() -> Dict[str, Any]:
    global _zone_info
    if _zone_info is None:
        z = next(z for z in client.get_available_zones() if z["public_id"] == ZONE_ID)
        _zone_info = {
            "id": ZONE_ID,
            "name": z["public_name"],
            "region": z.get("region_name"),
            "center": [z["city_center_latitude"], z["city_center_longitude"]],
            "bounds": [
                [z["lower_left_latitude"], z["lower_left_longitude"]],
                [z["upper_right_latitude"], z["upper_right_longitude"]],
            ],
        }
    return _zone_info


def build_network() -> Dict[str, Any]:
    """Descarga el GTFS de la zona y extrae rutas, trazados y paraderos."""
    res = client.session.get(f"{client.BASE_URL}/{ZONE_ID}/gtfs/download/3", timeout=60)
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
    routes: Dict[str, Dict[str, Any]] = {}
    for r in route_rows:
        if r.get("mode") != "3":
            continue
        key = f"{r['route_name']}_{r['direction']}"
        if key in routes:
            routes[key]["schedules"][r["day_type"]] = r["schedule"]
            continue
        points = sorted(shapes.get(r["shape_id"], []))
        routes[key] = {
            "key": key,
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
            "lat": float(s["stop_lat"]),
            "lon": float(s["stop_lon"]),
            "routes": [x for x in s["routes"].split("|") if x],
        }
        for s in stop_rows
        if s.get("mode") == "3" and s.get("stop_lat") and s.get("stop_lon")
    ]

    return {
        "zone": load_zone_info(),
        "routes": sorted(routes.values(), key=lambda x: (x["route"], x["direction"])),
        "stops": stops,
    }


def get_network() -> Dict[str, Any]:
    global _network
    with _network_lock:
        if _network is None or time.time() - _network[0] > NETWORK_TTL:
            _network = (time.time(), build_network())
        return _network[1]


# ---------------------------------------------------------------------------
# Telemetría en vivo
# ---------------------------------------------------------------------------
class FleetPoller:
    """Consulta synoptic/machines por ruta+sentido en un hilo de fondo.

    La API solo filtra por ruta, así que cada ciclo implica una petición por
    ruta+sentido. Para reducir carga, las rutas que en su última revisión no
    tenían buses solo se vuelven a consultar cada IDLE_SWEEP_EVERY ciclos.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._by_route: Dict[str, List[Dict[str, Any]]] = {}
        self._snapshot: Dict[str, Any] = {"vehicles": [], "fetchedAt": None, "errors": [], "stats": {}}
        self._snapshot_at = 0.0
        self._last_request = 0.0
        self._cycle = 0
        threading.Thread(target=self._run, daemon=True).start()

    def snapshot(self) -> Dict[str, Any]:
        self._last_request = time.time()
        self._wake.set()
        with self._lock:
            # Tras una pausa por inactividad la foto quedó vieja: se informa como
            # "sin datos" para que el panel reintente en vez de mostrarla.
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
        routes = get_network()["routes"]
        full_sweep = self._cycle % IDLE_SWEEP_EVERY == 0
        self._cycle += 1
        due = [r for r in routes if full_sweep or self._by_route.get(r["key"])]

        def fetch(route: Dict[str, Any]):
            try:
                data = client.get_synoptic_machines(route["route"], route["direction"])
                return route, data.get("machines", []), None
            except Exception as exc:  # una ruta caída no debe tumbar el panel
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
                vid = m.get("machineId") or m.get("licensePlate")
                if not vid or vid in vehicles:
                    continue
                vehicles[vid] = {
                    "id": vid,
                    "plate": m.get("licensePlate") or "Sin patente",
                    "lat": m.get("latitude"),
                    "lon": m.get("longitude"),
                    "bearing": m.get("bearing"),
                    "timestamp": m.get("timestamp"),
                    "route": route["route"],
                    "direction": route["direction"],
                    "routeKey": route["key"],
                    "headsign": route["headsign"],
                }
        return list(vehicles.values())


poller = FleetPoller()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/api/network")
def api_network():
    return jsonify(get_network())


@app.get("/api/vehicles")
def api_vehicles():
    return jsonify(poller.snapshot())


@app.get("/api/stops/<stop_code>")
def api_stop(stop_code: str):
    data = client.get_stop_info(stop_code)
    return jsonify({
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
    })


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/<path:path>")
def static_files(path: str):
    return send_from_directory(STATIC_DIR, path)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print(f"[*] Panel {load_zone_info()['name']} en http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
