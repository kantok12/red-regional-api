// Android/iOS: react-native-maps (Google Maps en Android, Apple Maps en iOS).
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, type Region } from "react-native-maps";

import { DEFAULT_STYLE, isStale, serviceKey } from "../fleet";
import { busPosition } from "../motion";
import { STOPS_MIN_ZOOM, type BusMapProps } from "./BusMap.types";

// Delta de latitud aproximado que corresponde a un zoom de Leaflet.
const deltaForZoom = (z: number) => 360 / 2 ** z;
const MAX_STOPS = 300; // react-native-maps se pone lento con miles de marcadores
// Cada cuadro cruza el puente hacia el mapa nativo por cada bus: se usa una
// cadencia menor que en la web, suficiente para que el avance se vea continuo.
const FRAME_MS = 250;

type BusLayerProps = Pick<BusMapProps, "vehicles" | "motion" | "styles" | "vehicleOpacity" | "selectedId" | "onVehiclePress">;

/**
 * Marcadores de los buses. Va en un componente aparte para que la animación
 * solo re-renderice los buses, no los trazados ni los paraderos.
 */
function BusLayer({ vehicles, motion, styles, vehicleOpacity, selectedId, onVehiclePress }: BusLayerProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!motion) return;
    const t = setInterval(() => motion.size && setNow(Date.now()), FRAME_MS);
    return () => clearInterval(t);
  }, [motion]);

  return vehicles.map((v) => {
    const st = styles.get(serviceKey(v.mode, v.route)) ?? DEFAULT_STYLE;
    const selected = v.id === selectedId;
    const stale = isStale(v);
    const pt = busPosition(v, motion, now);
    return (
      <Marker
        // La vista del marcador se congela (tracksViewChanges=false) por
        // rendimiento; la key fuerza a redibujarla si cambia su aspecto.
        key={`${v.id}|${v.route}|${stale}|${selected}|${Math.round(pt.bearing ?? -1)}`}
        coordinate={{ latitude: pt.lat, longitude: pt.lon }}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={false}
        zIndex={selected ? 1000 : 1}
        onPress={() => onVehiclePress(v.id)}
      >
        <View style={styles_.busMarker}>
          {pt.bearing != null && <Text style={[styles_.arrow, {
            ...arrowPosition(pt.bearing), color: st.bg, opacity: (stale ? 0.45 : 1) * vehicleOpacity,
            transform: [{ rotate: `${Math.round(pt.bearing - 90)}deg` }],
          }]}>➤</Text>}
          <View style={[styles_.wheel, styles_.wheelLeft]} />
          <View style={[styles_.wheel, styles_.wheelRight]} />
          <View style={[styles_.bus, { backgroundColor: st.bg, opacity: (stale ? 0.45 : 1) * vehicleOpacity,
            borderColor: selected ? "#111" : "#fff" }]}>
            <Text style={[styles_.busText, { color: st.fg }]} numberOfLines={1}>{v.route}</Text>
          </View>
        </View>
      </Marker>
    );
  });
}

function BusMap({
  zone, shapes, stops, vehicles, motion, styles, routeOpacity, vehicleOpacity, focusRoute, selectedId, onVehiclePress, onStopPress,
}: BusMapProps) {
  const mapRef = useRef<MapView>(null);
  const initialRegion = useMemo<Region>(() => ({
    latitude: zone.center[0],
    longitude: zone.center[1],
    latitudeDelta: deltaForZoom(13),
    longitudeDelta: deltaForZoom(13),
  }), [zone]);
  const [region, setRegion] = useState<Region>(initialRegion);

  const visibleStops = useMemo(() => {
    if (region.latitudeDelta > deltaForZoom(STOPS_MIN_ZOOM)) return [];
    const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
    return stops.filter((s) =>
      Math.abs(s.lat - latitude) < latitudeDelta / 2 &&
      Math.abs(s.lon - longitude) < longitudeDelta / 2).slice(0, MAX_STOPS);
  }, [stops, region]);

  useEffect(() => {
    const coordinates = shapes.flatMap((route) => route.shape.map(([latitude, longitude]) => ({ latitude, longitude })));
    if (!focusRoute || coordinates.length < 2) return;
    mapRef.current?.fitToCoordinates(coordinates, {
      edgePadding: { top: 60, right: 40, bottom: 320, left: 40 }, animated: true,
    });
  }, [shapes, focusRoute]);

  // Al elegir una micro, se acerca el mapa y se actualiza el centro mientras
  // el marcador avanza entre posiciones GPS.
  useEffect(() => {
    const vehicle = vehicles.find((item) => item.id === selectedId);
    if (!vehicle) return;
    const moveCamera = (initial = false) => {
      const point = busPosition(vehicle, motion);
      mapRef.current?.animateCamera({
        center: { latitude: point.lat, longitude: point.lon },
        ...(initial ? { zoom: 17 } : {}),
      }, { duration: initial ? 600 : 350 });
    };
    moveCamera(true);
    const timer = setInterval(() => moveCamera(), 400);
    return () => clearInterval(timer);
  }, [vehicles, motion, selectedId]);

  return (
    <MapView
      key={zone.id}
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={initialRegion}
      onRegionChangeComplete={setRegion}
      showsUserLocation={false}
      toolbarEnabled={false}
    >
      {shapes.map((r) => r.shape.length >= 2 && (
        <Polyline key={r.key}
          coordinates={r.shape.map(([latitude, longitude]) => ({ latitude, longitude }))}
          strokeColor={withOpacity(styles.get(serviceKey(r.mode, r.route))?.bg ?? r.color, routeOpacity)}
          strokeWidth={5} />
      ))}

      {visibleStops.map((s) => (
        <Marker key={s.code} coordinate={{ latitude: s.lat, longitude: s.lon }}
          anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
          title={s.name} onPress={() => onStopPress(s)}>
          <View style={styles_.stop} />
        </Marker>
      ))}

      <BusLayer vehicles={vehicles} motion={motion} styles={styles} vehicleOpacity={vehicleOpacity}
        selectedId={selectedId} onVehiclePress={onVehiclePress} />
    </MapView>
  );
}

function withOpacity(color: string, opacity: number) {
  const hex = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return color;
  const value = parseInt(hex, 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

function arrowPosition(bearing: number) {
  const radians = (bearing - 90) * Math.PI / 180;
  return { left: 19 + Math.cos(radians) * 25 - 6, top: 15 + Math.sin(radians) * 25 - 9 };
}

const styles_ = StyleSheet.create({
  stop: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: "#555", backgroundColor: "#fff" },
  bus: {
    position: "absolute", left: 2, top: 3, width: 34, height: 24, paddingHorizontal: 3, borderRadius: 7, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  busMarker: { width: 38, height: 30, overflow: "visible" },
  arrow: { position: "absolute", width: 12, height: 18, zIndex: 2, fontSize: 18, fontWeight: "700", lineHeight: 18, textAlign: "center", textShadowColor: "#fff", textShadowRadius: 2 },
  wheel: { position: "absolute", bottom: 0, width: 7, height: 4, borderRadius: 3, backgroundColor: "#222" },
  wheelLeft: { left: 6 }, wheelRight: { right: 6 },
  busText: { fontSize: 10, fontWeight: "700" },
});

export default memo(BusMap);
