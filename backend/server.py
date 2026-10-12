"""API de buses Red Regional en tiempo real, para todas las zonas.

Proxy autenticado hacia la API de TransApp (que exige cabeceras propias y no
admite CORS). La consumen la app Expo (Android/iOS) y su versión web.

    python backend/server.py              # http://127.0.0.1:5000

En producción, un solo proceso para que haya un poller por zona:

    gunicorn -w 1 --threads 16 -b 0.0.0.0:$PORT backend.server:app
"""
import os
import sys

from flask import Flask, g, jsonify, request
from flask_cors import CORS

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.auth import AUTH_DISABLED, require_auth  # noqa: E402
from backend.zones import get_zone, list_zones  # noqa: E402

app = Flask(__name__)

# Orígenes de la app web; los clientes nativos no usan CORS.
_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:8081").split(",") if o.strip()]
CORS(app, resources={r"/api/*": {"origins": _origins}}, allow_headers=["Authorization", "Content-Type"])


def _zone_or_404(zone_id: str):
    service = get_zone(zone_id)
    if service is None:
        return None, (jsonify({"error": "zone_not_found"}), 404)
    return service, None


@app.get("/api/health")
def api_health():
    return jsonify({"ok": True})


@app.get("/api/me")
@require_auth
def api_me():
    return jsonify(g.user)


@app.get("/api/zones")
@require_auth
def api_zones():
    return jsonify(list_zones())


@app.get("/api/zones/<zone_id>/network")
@require_auth
def api_network(zone_id: str):
    service, error = _zone_or_404(zone_id)
    return error or jsonify(service.network())


@app.get("/api/zones/<zone_id>/vehicles")
@require_auth
def api_vehicles(zone_id: str):
    service, error = _zone_or_404(zone_id)
    return error or jsonify(service.vehicles())


@app.get("/api/zones/<zone_id>/stops/<stop_code>")
@require_auth
def api_stop(zone_id: str, stop_code: str):
    service, error = _zone_or_404(zone_id)
    mode = request.args.get("mode", default=3, type=int)
    return error or jsonify(service.stop(stop_code, mode=mode))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    if AUTH_DISABLED:
        print("[!] AUTH_DISABLED=1: la API no exige login (solo desarrollo)")
    print(f"[*] API Red Regional en http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
