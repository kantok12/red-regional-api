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
├── backend/                 # API multi-zona con login Google (Firebase) para la app
│   ├── server.py            # Endpoints Flask /api/...
│   ├── zones.py             # GTFS + poller de buses, uno por zona
│   └── auth.py              # Verificación del ID token de Firebase
├── app/                     # App Expo: Android, iOS y Web con un solo código
├── dashboard/               # Panel web con mapa de buses en tiempo real
│   ├── server.py            # Servidor Flask (proxy + API del panel)
│   └── static/              # Frontend (Leaflet)
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

Requiere Python 3.8+. Dependencias: `requests`, y para el panel/backend `flask`, `flask-cors` y `firebase-admin`.

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

## 🖥️ Panel en vivo (`dashboard/`)

Panel web con mapa que muestra todos los buses de **Gran Valparaíso** en tiempo real (se actualiza cada 10 s). Permite filtrar por línea, buscar por patente, ver rumbo y última señal de cada bus, y consultar las llegadas de un paradero al hacer clic en él (zoom ≥ 15). Entre actualizaciones, cada bus se anima avanzando por el trazado de su línea a la velocidad estimada con sus últimas posiciones GPS.

```bash
python dashboard/server.py
# abrir http://127.0.0.1:5000
```

El servidor Flask hace de proxy hacia la API (que exige cabeceras propias y no admite CORS): descarga el GTFS de la zona para conocer rutas, trazados y paraderos, y un hilo en segundo plano consulta `synoptic/machines` para cada ruta y sentido en paralelo. Las rutas sin buses se revisan solo 1 de cada 4 ciclos, y el hilo se pausa si nadie tiene el panel abierto.

---

## 📱 App móvil y web (`app/` + `backend/`)

App Expo (Android, iOS y Web con el mismo código) que muestra los buses en vivo de **todas las zonas** de Red Regional (22 ciudades) con la misma vista: selector de ciudad, mapa con buses, filtro por línea, búsqueda por patente y llegadas al tocar un paradero. **Todo requiere iniciar sesión con Google** (Firebase Auth).

```text
App Expo ──Bearer idToken──▶ backend/server.py ──▶ phone.dtpr.transapp.cl
    └── Firebase Auth (Google)     └── firebase-admin verifica el token
```

### Endpoints del backend (todos exigen `Authorization: Bearer <ID token de Firebase>`)

| Endpoint | Descripción |
| :--- | :--- |
| `GET /api/zones` | Ciudades disponibles (id, nombre, región, centro, bounds). |
| `GET /api/zones/{id}/network` | Rutas, trazados y paraderos (GTFS, cacheado 6 h). |
| `GET /api/zones/{id}/vehicles` | Foto de la flota en vivo (se actualiza cada 10 s). |
| `GET /api/zones/{id}/stops/{code}` | Llegadas estimadas a un paradero. |
| `GET /api/me` | Usuario de la sesión. |

Cada zona tiene su propio poller, que se crea al primer pedido y se pausa tras 60 s sin visitas: solo se consulta TransApp por las ciudades que alguien está mirando.

### 1. Configurar Firebase (una vez)

1. Crear un proyecto en [console.firebase.google.com](https://console.firebase.google.com) y en **Authentication → Sign-in method** activar **Google**.
2. **Configuración del proyecto → Tus apps**: registrar una app **Web** (da `apiKey`, `authDomain`, `projectId`, `appId`), una **Android** (package `cl.redregional.app` + huella SHA-1 del keystore) y una **iOS** (bundle `cl.redregional.app`).
3. En Google Cloud Console → **Credenciales**, copiar el *client ID* OAuth de tipo **Web** (lo creó Firebase) → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; y el de iOS → `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` y su forma invertida → `GOOGLE_IOS_URL_SCHEME`.
4. En **Authentication → Settings → Authorized domains** agregar el dominio donde se publique la web.
5. Para el mapa en Android, crear una API key de **Maps SDK for Android** → `GOOGLE_MAPS_ANDROID_API_KEY`.

### 2. Backend

```bash
pip install -r requirements.txt
export FIREBASE_PROJECT_ID=<id-del-proyecto>
export CORS_ORIGINS=http://localhost:8081          # orígenes de la web, separados por coma
# opcional: export ALLOWED_DOMAIN=midominio.cl  o  ALLOWED_EMAILS=a@x.cl,b@y.cl
python backend/server.py                            # http://127.0.0.1:5000
```

En producción usar **un solo proceso** (un poller por zona): `gunicorn -w 1 --threads 16 -b 0.0.0.0:$PORT backend.server:app`.

### 3. App

```bash
cd app
npm install
cp .env.example .env.local     # completar con los datos de Firebase/Google
npx expo start --web           # web en http://localhost:8081
npx expo run:android           # development build (Google Sign-In nativo no corre en Expo Go)
```

- Web: `npx expo export -p web` genera `dist/`, publicable en cualquier hosting estático (p.ej. Firebase Hosting).
- Móvil: `npx eas-cli@latest build -p android|ios`.

**Atajo desde la raíz:** `npm install && npm run setup` una vez, luego `npm run dev` levanta backend (puerto 5001) + web (8081) sin login, y `npm run dev:google` lo mismo con login real (requiere `app/.env.local`).

**Desarrollo sin Firebase:** `AUTH_DISABLED=1 python backend/server.py` y `EXPO_PUBLIC_DEV_NO_AUTH=1 npx expo start --web` entran sin login (solo funciona en modo desarrollo).

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
