# 🚌 Red Regional / TransApp API — Documentación no oficial

Documentación no oficial y especificación de endpoints de la API REST utilizada por la aplicación **Red Regional** (TransApp / DTPR) para el monitoreo de transporte público mayor en regiones de Chile (Talca, Temuco, Concepción, Chillán, Punta Arenas, etc.).

---

## 📌 Headers obligatorios

El backend valida estrictamente la plataforma y versión del cliente. Todos los requests deben incluir las siguientes cabeceras:

| Header | Valor |
| :--- | :--- |
| `Os-type` | `Android` |
| `App-Version` | `2.5.1` |
| `Accept` | `application/json` |

> **Nota:** Parámetros como `phoneId` deben tener formato UUID v4 válido (por ejemplo: `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`).

---

## 🌐 Base URL

```text
https://phone.dtpr.transapp.cl/v7/phone
```

---

## 🗺️ 1. Zonas y ciudades (`public_id`)

Permite obtener el listado de ciudades compatibles y sus respectivos identificadores `public_id` (UUID).

- **Endpoint:** `GET /v7/phone/zones`
- **Ejemplo cURL:**

```bash
curl -s -H "Os-type: Android" -H "App-Version: 2.5.1" -H "Accept: application/json" \
  "https://phone.dtpr.transapp.cl/v7/phone/zones" | jq .
```

- **Detección por coordenadas:** `GET /v7/phone/zones/search?latitude={LAT}&longitude={LON}`

**UUIDs conocidos:**

| Ciudad | `public_id` |
| :--- | :--- |
| Talca | `50cde66c-2b67-4702-afa8-1f190249d9b8` |
| Temuco | `c28e2682-b083-41ba-8827-5caac8b86181` |

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

---

## ⏱️ 3. Tiempo real y paraderos

### Estimación de llegada a paradero (`stopInfo`)

Devuelve los servicios próximos al paradero, minutos estimados de arribo, distancia y eventos reportados.

- **Endpoint:** `GET /{public_id}/stopInfo?stopCode={CODIGO}&mode=3&phoneId={UUID}`

```bash
curl -s -H "Os-type: Android" -H "App-Version: 2.5.1" -H "Accept: application/json" \
  "https://phone.dtpr.transapp.cl/v7/phone/50cde66c-2b67-4702-afa8-1f190249d9b8/stopInfo?stopCode=PA151&mode=3&phoneId=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" | jq .
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

---

## 💳 4. Puntos de recarga

- **Puntos de pago / tótems:** `GET /{public_id}/payment-points/`
- **Hash de validación de caché:** `GET /{public_id}/payment-points/hash`

---

## ⚖️ Licencia y responsabilidad

Este documento tiene fines educativos y de investigación sobre interoperabilidad de datos abiertos de transporte. Los datos y servicios pertenecen a sus respectivos operadores (DTPR / TransApp).
