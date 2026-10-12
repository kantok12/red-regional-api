// Web: Leaflet + OpenStreetMap.
import L from "leaflet";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl,
} from "react-leaflet";

import type { Vehicle } from "../api";
import { DEFAULT_STYLE, isStale, serviceKey, type RouteStyle } from "../fleet";
import { busPosition } from "../motion";
import { STOPS_MIN_ZOOM, type BusMapProps } from "./BusMap.types";

const FRAME_MS = 66; // ~15 cuadros por segundo para la animación de los buses

// Metro no resuelve las imágenes relativas de leaflet.css; se carga la hoja
// de la misma versión desde la CDN.
const LEAFLET_CSS = `https://unpkg.com/leaflet@${L.version}/dist/leaflet.css`;
if (typeof document !== "undefined" && !document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = LEAFLET_CSS;
  document.head.appendChild(link);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]!));

function busIcon(v: Vehicle, bearing: number | null, st: RouteStyle, stale: boolean, selected: boolean, opacity: number) {
  const arrow = bearing == null ? "" : arrowHtml(bearing, st.bg);
  return L.divIcon({
    className: "",
    iconSize: [38, 30],
    iconAnchor: [19, 15],
    html: `<div style="position:relative;width:38px;height:30px">
      ${arrow}<div style="position:absolute;left:2px;top:3px;width:34px;height:24px;border-radius:7px;
      display:flex;align-items:center;justify-content:center;font:700 10px system-ui,sans-serif;
      background:${esc(st.bg)};color:${esc(st.fg)};opacity:${(stale ? 0.45 : 1) * opacity};transition:opacity 180ms ease-out;
      border:2px solid ${selected ? "#111" : "#fff"};box-shadow:inset 0 5px 0 rgba(255,255,255,.22),0 1px 3px rgba(0,0,0,.4)">
      ${esc(v.route)}</div><span style="position:absolute;left:6px;bottom:0;width:7px;height:4px;border-radius:3px;background:#222"></span>
      <span style="position:absolute;right:6px;bottom:0;width:7px;height:4px;border-radius:3px;background:#222"></span></div>`,
  });
}

function arrowPosition(bearing: number) {
  const radians = (bearing - 90) * Math.PI / 180;
  return { left: 19 + Math.cos(radians) * 25 - 6, top: 15 + Math.sin(radians) * 25 - 9 };
}

function arrowHtml(bearing: number, color: string) {
  const pos = arrowPosition(bearing);
  return `<div data-arrow style="position:absolute;left:${pos.left}px;top:${pos.top}px;width:12px;height:18px;
    color:${esc(color)};font:700 18px/18px system-ui,sans-serif;z-index:2;text-shadow:0 1px 2px #fff;
    transform:rotate(${Math.round(bearing - 90)}deg)">➤</div>`;
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  return null;
}

/** Centra el mapa en el trazado cuando el usuario filtra una línea. */
function RouteFocus({ shapes, focusRoute }: Pick<BusMapProps, "shapes" | "focusRoute">) {
  const map = useMap();
  useEffect(() => {
    const points = shapes.flatMap((route) => route.shape);
    if (!focusRoute || points.length < 2) return;
    map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [390, 30], paddingBottomRight: [40, 30], maxZoom: 15, animate: true,
    });
  }, [map, shapes, focusRoute]);
  return null;
}

/** Acerca la cámara a la micro elegida y la mantiene centrada mientras avanza. */
function VehicleFocus({ vehicles, motion, selectedId }: Pick<BusMapProps, "vehicles" | "motion" | "selectedId">) {
  const map = useMap();
  useEffect(() => {
    const vehicle = vehicles.find((item) => item.id === selectedId);
    if (!vehicle) return;
    const moveCamera = (initial = false) => {
      const point = busPosition(vehicle, motion);
      const target: L.LatLngExpression = [point.lat, point.lon];
      if (initial) map.flyTo(target, Math.max(map.getZoom(), 17), { duration: 0.6 });
      else map.panTo(target, { animate: true, duration: 0.35 });
    };
    moveCamera(true);
    const timer = setInterval(() => moveCamera(), 400);
    return () => clearInterval(timer);
  }, [map, vehicles, motion, selectedId]);
  return null;
}

function BusMap({
  zone, shapes, stops, vehicles, motion, styles, routeOpacity, vehicleOpacity, focusRoute, selectedId, onVehiclePress, onStopPress,
}: BusMapProps) {
  const [zoom, setZoom] = useState(13);
  const [map, setMap] = useState<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const bounds = useMemo(() => L.latLngBounds(zone.bounds), [zone]);

  // Entre consultas cada bus avanza por su trazado. Se mueve el marcador de
  // Leaflet directamente: re-renderizar React 15 veces por segundo sería caro.
  useEffect(() => {
    if (!motion || !map) return;
    let raf = 0, last = 0;
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      if (ts - last < FRAME_MS || document.hidden || !motion.size) return;
      last = ts;
      const view = map.getBounds().pad(0.2);
      const now = Date.now();
      for (const [id, marker] of markers.current) {
        const pt = motion.pointOf(id, now);
        if (!pt || !view.contains([pt.lat, pt.lon])) continue;
        marker.setLatLng([pt.lat, pt.lon]);
        const arrow = marker.getElement()?.querySelector<HTMLElement>("[data-arrow]");
        if (arrow && pt.bearing != null) {
          const pos = arrowPosition(pt.bearing);
          arrow.style.left = `${pos.left}px`;
          arrow.style.top = `${pos.top}px`;
          arrow.style.transform = `rotate(${Math.round(pt.bearing - 90)}deg)`;
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [motion, map]);

  return (
    <MapContainer
      key={zone.id}
      ref={setMap}
      center={zone.center}
      zoom={13}
      maxBounds={bounds.pad(0.5)}
      preferCanvas
      zoomControl={false}
      style={{ width: "100%", height: "100%" }}
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      {/* Arriba a la izquierda queda tapado por el buscador. */}
      <ZoomControl position="bottomright" />
      <ZoomWatcher onZoom={setZoom} />
      <RouteFocus shapes={shapes} focusRoute={focusRoute} />
      <VehicleFocus vehicles={vehicles} motion={motion} selectedId={selectedId} />

      {shapes.map((r) => r.shape.length >= 2 && (
        <Polyline key={r.key} positions={r.shape}
          pathOptions={{ color: styles.get(serviceKey(r.mode, r.route))?.bg ?? r.color, weight: 5, opacity: 0.75 * routeOpacity }} />
      ))}

      {zoom >= STOPS_MIN_ZOOM && stops.map((s) => (
        <CircleMarker key={s.code} center={[s.lat, s.lon]} radius={4}
          pathOptions={{ weight: 2, color: "#555", fillColor: "#fff", fillOpacity: 1 }}
          eventHandlers={{ click: () => onStopPress(s) }}>
          <Tooltip>{s.name}</Tooltip>
        </CircleMarker>
      ))}

      {vehicles.map((v) => {
        const selected = v.id === selectedId;
        // Al re-renderizar se parte de la posición animada, no de la del GPS,
        // para que el bus no salte hacia atrás.
        const pt = busPosition(v, motion);
        return (
          <Marker key={v.id} position={[pt.lat, pt.lon]}
            ref={(m) => {
              if (!m) return;
              markers.current.set(v.id, m);
              return () => { markers.current.delete(v.id); };
            }}
            icon={busIcon(v, pt.bearing, styles.get(serviceKey(v.mode, v.route)) ?? DEFAULT_STYLE, isStale(v), selected, vehicleOpacity)}
            zIndexOffset={selected ? 1000 : 0}
            eventHandlers={{ click: () => onVehiclePress(v.id) }}>
            <Tooltip direction="top" offset={[0, -14]}>{`${v.plate} · ${v.route} → ${v.headsign}`}</Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}

export default memo(BusMap);
