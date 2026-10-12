import uuid
import requests
from typing import Optional, Dict, Any, List


class TransAppClient:
    BASE_URL = "https://phone.dtpr.transapp.cl/v7/phone"
    
    # UUIDs comunes de zonas
    ZONES = {
        "arica": "23d78cd5-58c2-4606-904a-9d9bee4d9025",
        "talca": "50cde66c-2b67-4702-afa8-1f190249d9b8",
        "temuco": "c28e2682-b083-41ba-8827-5caac8b86181",
        "valparaiso": "e944e47c-a4f6-4be2-a8b4-3ed1968062cb"
    }

    HEADERS = {
        "Os-type": "Android",
        "App-Version": "2.5.1",
        "Accept": "application/json"
    }

    def __init__(
        self,
        zone_uuid: Optional[str] = None,
        phone_id: Optional[str] = None,
        session: Optional[requests.Session] = None,
        timeout: float = 20,
    ):
        self.zone_uuid = zone_uuid or self.ZONES["talca"]
        self.phone_id = phone_id or str(uuid.uuid4())
        self.timeout = timeout
        # Se puede compartir una sesión entre varios clientes (uno por zona).
        self.session = session or requests.Session()
        self.session.headers.update(self.HEADERS)

    def get_available_zones(self) -> List[Dict[str, Any]]:
        """Obtiene todas las zonas / ciudades soportadas."""
        url = f"{self.BASE_URL}/zones"
        res = self.session.get(url, timeout=self.timeout)
        res.raise_for_status()
        return res.json()

    def get_gtfs_version(self) -> Dict[str, Any]:
        """Obtiene la versión y metadatos del paquete GTFS de la zona."""
        url = f"{self.BASE_URL}/{self.zone_uuid}/gtfs/version/3"
        res = self.session.get(url, timeout=self.timeout)
        res.raise_for_status()
        return res.json()

    def download_gtfs(self, output_path: str = "gtfs.zip") -> str:
        """Descarga el paquete ZIP de datos GTFS."""
        url = f"{self.BASE_URL}/{self.zone_uuid}/gtfs/download/3"
        res = self.session.get(url, stream=True, timeout=self.timeout)
        res.raise_for_status()
        with open(output_path, "wb") as f:
            for chunk in res.iter_content(chunk_size=8192):
                f.write(chunk)
        return output_path

    def get_stop_info(self, stop_code: str, mode: int = 3) -> Dict[str, Any]:
        """Consulta estimaciones de arribo y alertas para un paradero."""
        url = f"{self.BASE_URL}/{self.zone_uuid}/stopInfo"
        params = {
            "stopCode": stop_code,
            "mode": mode,
            "phoneId": self.phone_id
        }
        res = self.session.get(url, params=params, timeout=self.timeout)
        res.raise_for_status()
        return res.json()

    def get_synoptic_machines(
        self,
        route: str,
        direction: str = "I",
        stop_code: Optional[str] = None,
        mode: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Obtiene telemetría GPS en tiempo real de los buses en servicio."""
        url = f"{self.BASE_URL}/{self.zone_uuid}/synoptic/machines"
        params = {
            "route": route,
            "direction": direction
        }
        if stop_code:
            params["stopCode"] = stop_code
        if mode is not None:
            params["mode"] = mode
            
        res = self.session.get(url, params=params, timeout=self.timeout)
        res.raise_for_status()
        return res.json()

    def get_payment_points(self) -> List[Dict[str, Any]]:
        """Obtiene los centros y tótems de recarga de tarjeta."""
        url = f"{self.BASE_URL}/{self.zone_uuid}/payment-points/"
        res = self.session.get(url, timeout=self.timeout)
        res.raise_for_status()
        return res.json()
