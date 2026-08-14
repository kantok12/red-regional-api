# 🚌 Red Regional / TransApp API — Documentación no oficial

Documentación no oficial, SDK en Python y especificación de endpoints de la API REST utilizada por la aplicación **Red Regional** (TransApp / DTPR) para el monitoreo de transporte público mayor en regiones de Chile (Talca, Temuco, Concepción, Chillán, Punta Arenas, etc.).

---

## 📂 Estructura del repositorio

```text
red-regional-api/
├── README.md               # Esta documentación
├── requirements.txt        # Dependencias del SDK
├── client/                 # Wrapper ligero / SDK en Python
│   └── transapp.py         # Clase TransAppClient
├── examples/                # Scripts de ejemplo listos para correr
│   ├── get_stop_arrivals.py # Llegadas en vivo a un paradero
│   └── monitor_buses.py     # Telemetría GPS en vivo de buses
└── gtfs/                    # Guía de descarga y parseo de datos estáticos
    └── import_gtfs_sqlite.py # Importa el ZIP GTFS a una base SQLite
```

---

## ⚙️ Instalación

```bash
git clone <este-repo>
cd red-regional-api
pip install -r requirements.txt
```

Requiere Python 3.8+. Dependencias: `requests`.

---

## 📌 Headers obligatorios

El backend valida estrictamente la plataforma y versión del cliente. Todos los requests deben incluir las siguientes cabeceras (el SDK las agrega automáticamente):

| Header | Valor |
| :--- | :--- |
| `Os-type` | `Android` |
| `App-Version` | `2.5.1` |
| `Accept` | `application/json` |

> **Nota:** Parámetros como `phoneId` deben tener formato UUID v4 válido (por ejemplo: `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`). El SDK genera uno automáticamente si no se especifica.

---

## 🌐 Base URL

```text
https://phone.dtpr.transapp.cl/v7/phone
```

---

## 🧩 Uso rápido del SDK (`client/transapp.py`)

```python
from client import TransAppClient

# Por defecto usa la zona de Talca
client = TransAppClient()

# O especificando zona / phoneId propios
client = TransAppClient(
    zone_uuid="50cde66c-2b67-4702-afa8-1f190249d9b8",
    phone_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
)
```

### `TransAppClient` — métodos disponibles

| Método | Descripción |
| :--- | :--- |
| `get_available_zones()` | Lista las ciudades/zonas soportadas. |
| `get_gtfs_version()` | Consulta versión y metadatos del paquete GTFS de la zona. |
| `download_gtfs(output_path="gtfs.zip")` | Descarga el ZIP de datos estáticos GTFS. |
| `get_stop_info(stop_code, mode=3)` | Estimaciones de arribo y alertas para un paradero. |
| `get_synoptic_machines(route, direction="I", stop_code=None)` | Telemetría GPS en vivo de los buses en servicio. |
| `get_payment_points()` | Centros y tótems de recarga de tarjeta. |

**UUIDs de zona conocidos:**

| Ciudad | `public_id` |
| :--- | :--- |
| Talca | `50cde66c-2b67-4702-afa8-1f190249d9b8` |
| Temuco | `c28e2682-b083-41ba-8827-5caac8b86181` |

---

## 🗺️ 1. Zonas y ciudades

- **Endpoint:** `GET /v7/phone/zones`
- **Detección por coordenadas:** `GET /v7/phone/zones/search?latitude={LAT}&longitude={LON}`

```bash
curl -s -H "Os-type: Android" -H "App-Version: 2.5.1" -H "Accept: application/json" \
  "https://phone.dtpr.transapp.cl/v7/phone/zones" | jq .
```

```python
client = TransAppClient()
zones = client.get_available_zones()
```

---

## 📁 2. Datos estáticos GTFS (offline)

Descarga los paquetes de datos estáticos con paraderos, trazados vectoriales, servicios y frecuencias (`stop.csv`, `route.csv`, `shape.csv`, `calendar.csv`).

- **Consultar versión:** `GET /{public_id}/gtfs/version/3`
- **Descargar ZIP:** `GET /{public_id}/gtfs/download/3`

```bash
curl -s -H "Os-type: Android" -H "App-Version: 2.5.1" \
  "https://phone.dtpr.transapp.cl/v7/phone/50cde66c-2b67-4702-afa8-1f190249d9b8/gtfs/download/3" \
  -o gtfs_talca.zip
```

```python
client = TransAppClient()
client.download_gtfs("gtfs_talca.zip")
```

### Importar a SQLite

`gtfs/import_gtfs_sqlite.py` toma el ZIP descargado (`gtfs_talca.zip`) y carga las tablas `stops` y `routes` en una base `transporte_regional.db`:

```bash
python gtfs/import_gtfs_sqlite.py
```

---

## ⏱️ 3. Tiempo real y paraderos

### Estimación de llegada a paradero (`stopInfo`)

Devuelve los servicios próximos al paradero, minutos estimados de arribo, distancia y eventos reportados.

- **Endpoint:** `GET /{public_id}/stopInfo?stopCode={CODIGO}&mode=3&phoneId={UUID}`

```bash
curl -s -H "Os-type: Android" -H "App-Version: 2.5.1" -H "Accept: application/json" \
  "https://phone.dtpr.transapp.cl/v7/phone/50cde66c-2b67-4702-afa8-1f190249d9b8/stopInfo?stopCode=PA151&mode=3&phoneId=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" | jq .
```

Script de ejemplo: `examples/get_stop_arrivals.py`

```bash
python examples/get_stop_arrivals.py
```

### Telemetría GPS en vivo de buses (`synoptic/machines`)

Devuelve la posición en tiempo real de los buses en operación para una ruta específica.

- **Endpoint:** `GET /{public_id}/synoptic/machines?route={RUTA}&direction={SENTIDO}&stopCode={CODIGO}`
- **Parámetros:**
  - `direction`: `I` (Ida) o `R` (Retorno).

```bash
curl -s -H "Os-type: Android" -H "App-Version: 2.5.1" -H "Accept: application/json" \
  "https://phone.dtpr.transapp.cl/v7/phone/50cde66c-2b67-4702-afa8-1f190249d9b8/synoptic/machines?route=3A&direction=I&stopCode=PA151" | jq .
```

Script de ejemplo: `examples/monitor_buses.py`

```bash
python examples/monitor_buses.py
```

---

## 💳 4. Puntos de recarga

- **Puntos de pago / tótems:** `GET /{public_id}/payment-points/`
- **Hash de validación de caché:** `GET /{public_id}/payment-points/hash`

```python
client = TransAppClient()
points = client.get_payment_points()
```

---

## ⚖️ Licencia y responsabilidad

Este documento y el SDK tienen fines educativos y de investigación sobre interoperabilidad de datos abiertos de transporte. Los datos y servicios pertenecen a sus respectivos operadores (DTPR / TransApp).

---

## 📬 Contacto

- Instagram: [@sumosacerdote](https://www.instagram.com/sumosacerdote/)
