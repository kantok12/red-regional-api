import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";

import { api, type Stop, type StopArrivals } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import BusMap from "../../components/BusMap";
import {
  ageSeconds, byRouteName, cardinal, DEFAULT_STYLE, directionLabel, filterVehicles, formatAge, isMetro, isStale,
  serviceKey, serviceLabel,
} from "../../fleet";
import { colors } from "../../theme";
import { useZone } from "../../useZone";

type StopPanel = { stop: Stop; data: StopArrivals | null; error: string | null };

export default function ZoneScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { user } = useAuth();
  const { network, fleet, styles, error, motion } = useZone(id);
  const { width } = useWindowDimensions();
  const compact = width < 700;

  const [focusRoute, setFocusRoute] = useState<string | null>(null);
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const [lineLoadingLabel, setLineLoadingLabel] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stopPanel, setStopPanel] = useState<StopPanel | null>(null);
  const [routeOpacity, setRouteOpacity] = useState(1);
  const [vehicleOpacity, setVehicleOpacity] = useState(1);
  const [, setNow] = useState(0);
  const lineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refresca las antigüedades ("hace 20 s") entre actualizaciones.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => {
    if (lineTimer.current) clearTimeout(lineTimer.current);
  }, []);

  // El trazado y los vehículos entran de forma gradual al cambiar la línea.
  useEffect(() => {
    let step = 0;
    setRouteOpacity(0);
    setVehicleOpacity(0);
    const animation = setInterval(() => {
      step += 1;
      const opacity = step / 10;
      setRouteOpacity(opacity);
      setVehicleOpacity(opacity);
      if (step === 10) clearInterval(animation);
    }, 45);
    return () => clearInterval(animation);
  }, [focusRoute]);

  const allVehicles = useMemo(() => fleet?.vehicles ?? [], [fleet]);
  // La búsqueda solo reduce las opciones de línea; nunca filtra por patente.
  const vehicles = useMemo(() => filterVehicles(allVehicles, focusRoute, ""), [allVehicles, focusRoute]);
  const selected = allVehicles.find((v) => v.id === selectedId) ?? null;

  // Solo líneas con buses en servicio: la red completa puede superar las 280.
  const selectableRoutes = useMemo(() => {
    const counts = new Map<string, { mode: string; route: string; count: number }>();
    for (const v of allVehicles) {
      const key = serviceKey(v.mode, v.route);
      const current = counts.get(key);
      counts.set(key, { mode: v.mode, route: v.route, count: (current?.count ?? 0) + 1 });
    }
    for (const route of network?.routes ?? []) {
      const key = serviceKey(route.mode, route.route);
      if (route.mode === "2" && !counts.has(key)) counts.set(key, { mode: route.mode, route: route.route, count: 0 });
    }
    const query = search.trim().toLowerCase();
    return [...counts]
      .filter(([, service]) => !query || service.route.toLowerCase().includes(query) || (isMetro(service.mode) && "metro".includes(query)))
      .sort(([, a], [, b]) => byRouteName(a.route, b.route));
  }, [allVehicles, network, search]);

  const focusedService = useMemo(() => focusRoute
    ? selectableRoutes.find(([key]) => key === focusRoute)?.[1] ?? null
    : null, [focusRoute, selectableRoutes]);

  const routeVehicles = useMemo(() => {
    const list = focusRoute ? vehicles : [];
    return [...list].sort((a, b) => byRouteName(a.route, b.route) || a.plate.localeCompare(b.plate, "es"));
  }, [allVehicles, focusRoute, vehicles]);

  const shapes = useMemo(() => (network?.routes ?? []).filter((r) =>
    selected ? r.key === selected.routeKey : serviceKey(r.mode, r.route) === focusRoute), [network, selected, focusRoute]);

  const openStop = async (stop: Stop) => {
    if (!user) return;
    setSelectedId(null);
    setStopPanel({ stop, data: null, error: null });
    try {
      const data = await api.stop(user, id, stop.code, stop.mode);
      setStopPanel((p) => (p?.stop.code === stop.code ? { ...p, data } : p));
    } catch (e) {
      setStopPanel((p) => (p?.stop.code === stop.code ? { ...p, error: (e as Error).message } : p));
    }
  };

  const selectVehicle = (vid: string) => {
    setStopPanel(null);
    if (selectedId === vid) {
      setSelectedId(null);
      return;
    }
    // Un toque en el mapa también lleva el selector a la línea del vehículo.
    const vehicle = allVehicles.find((v) => v.id === vid);
    if (vehicle) setFocusRoute(serviceKey(vehicle.mode, vehicle.route));
    setSelectedId(vid);
  };

  const selectRoute = (route: string | null) => {
    if (lineLoadingLabel) return;
    setRoutePickerOpen(false);
    const selectedService = route ? selectableRoutes.find(([key]) => key === route)?.[1] : null;
    const serviceName = selectedService ? serviceLabel(selectedService.mode, selectedService.route) : "todos los servicios";
    setLineLoadingLabel(serviceName);
    lineTimer.current = setTimeout(() => {
      setStopPanel(null);
      setSelectedId(null);
      setFocusRoute(route);
      setLineLoadingLabel(null);
      lineTimer.current = null;
    }, 1500);
  };

  const title = network?.zone.name ?? name ?? "";
  const status = error
    ? error
    : !network ? "Descargando red de transporte…"
    : !fleet?.fetchedAt ? "Consultando buses en servicio…"
    : `${vehicles.length} de ${allVehicles.length} buses · actualizado hace ${formatAge(ageSeconds(fleet.fetchedAt))}`;

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title }} />

      <View style={s.mapWrap}>
        {network
          ? <BusMap zone={network.zone} shapes={shapes} stops={network.stops} vehicles={vehicles}
              motion={motion} styles={styles} routeOpacity={routeOpacity} vehicleOpacity={vehicleOpacity} focusRoute={focusRoute}
              selectedId={selectedId} onVehiclePress={selectVehicle} onStopPress={openStop} />
          : <ActivityIndicator style={{ flex: 1 }} color={colors.accent} />}
      </View>

      <View style={[s.sidebar, compact && s.sidebarCompact]}>
        <View style={s.sidebarHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.sidebarTitle}>Seguir transporte</Text>
            <Text style={s.sidebarSubtitle}>Elige una línea y luego un vehículo</Text>
          </View>
          <Text style={s.vehicleCount}>{vehicles.length}</Text>
        </View>
        <Text style={s.sectionLabel}>Líneas en servicio</Text>
        <Pressable style={({ pressed }) => [s.routeSelect, pressed && { opacity: 0.75 }]}
          onPress={() => setRoutePickerOpen(true)} accessibilityRole="button" accessibilityLabel="Elegir línea">
          <View style={[s.dot, { backgroundColor: focusRoute ? (styles.get(focusRoute) ?? DEFAULT_STYLE).bg : colors.accent }]} />
          <Text style={s.routeSelectText}>{focusedService ? serviceLabel(focusedService.mode, focusedService.route) : "Todos los servicios"}</Text>
          <Text style={s.routeSelectChevron}>⌄</Text>
        </Pressable>
        <View style={s.listHeading}>
          <Text style={s.sectionLabel}>{focusRoute ? "Vehículos del servicio" : "Vehículos disponibles"}</Text>
          <Text style={s.muted}>{routeVehicles.length}</Text>
        </View>
        <ScrollView style={s.vehicleList} contentContainerStyle={s.vehicleListContent} showsVerticalScrollIndicator={false}>
          {!routeVehicles.length && <Text style={s.empty}>{focusRoute ? "No hay vehículos activos en este servicio." : "Selecciona una línea o Metro para ver sus vehículos."}</Text>}
          {routeVehicles.map((vehicle) => {
            const routeStyle = styles.get(serviceKey(vehicle.mode, vehicle.route)) ?? DEFAULT_STYLE;
            const active = vehicle.id === selectedId;
            return (
              <Pressable key={vehicle.id} onPress={() => selectVehicle(vehicle.id)}
                style={({ pressed }) => [s.vehicleRow, active && [s.vehicleRowSelected, { borderLeftColor: routeStyle.bg }], pressed && { opacity: 0.72 }]}
                accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[s.routeBadge, { backgroundColor: routeStyle.bg, color: routeStyle.fg }]}>{vehicle.route}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.vehiclePlate}>{vehicle.plate}</Text>
                  <Text style={s.vehicleDestination} numberOfLines={1}>{directionLabel(vehicle.direction)} → {vehicle.headsign}</Text>
                </View>
                <Text style={s.vehicleAge}>{formatAge(ageSeconds(vehicle.timestamp))}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={[s.detailOverlay, compact && s.detailOverlayCompact]}>
        <Text style={[s.status, error && { color: colors.danger }]} numberOfLines={2}>{status}</Text>

        {selected && (
          <View style={s.panel}>
            <Text style={s.panelTitle}>{serviceLabel(selected.mode, selected.route)} → {selected.headsign}</Text>
            <Text style={s.panelLine}>Patente {selected.plate} · {directionLabel(selected.direction)}</Text>
            <Text style={s.panelLine}>
              Rumbo {cardinal(selected.bearing)} · GPS hace {formatAge(ageSeconds(selected.timestamp))}
              {isStale(selected) ? " (desactualizado)" : ""}
            </Text>
          </View>
        )}

        {stopPanel && (
          <View style={s.panel}>
            <View style={s.panelHeader}>
              <Text style={[s.panelTitle, { flex: 1 }]}>{stopPanel.stop.name} ({stopPanel.stop.code})</Text>
              <Pressable onPress={() => setStopPanel(null)} hitSlop={10}><Text style={s.close}>✕</Text></Pressable>
            </View>
            {stopPanel.error && <Text style={{ color: colors.danger }}>{stopPanel.error}</Text>}
            {!stopPanel.data && !stopPanel.error && <ActivityIndicator color={colors.accent} />}
            {stopPanel.data?.events.map((e) => <Text key={e} style={s.event}>⚠ {e}</Text>)}
            {stopPanel.data && stopPanel.data.predictions.length === 0 && (
              <Text style={s.panelLine}>Sin buses próximos.</Text>
            )}
            {stopPanel.data?.predictions.map((p, i) => {
              const st = styles.get(serviceKey(stopPanel.stop.mode, p.route)) ?? DEFAULT_STYLE;
              return (
                <View key={i} style={s.prediction}>
                  <Text style={[s.routeBadge, { backgroundColor: st.bg, color: st.fg }]}>{p.route}</Text>
                  <Text style={[s.panelLine, { flex: 1 }]}>{p.timeLabel} · {p.distanceLabel}</Text>
                  <Text style={s.muted}>{p.plate ?? ""}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <Modal visible={routePickerOpen} transparent animationType="fade" onRequestClose={() => setRoutePickerOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setRoutePickerOpen(false)}>
          <Pressable style={s.routeModal} onPress={(event) => event.stopPropagation()}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Selecciona una línea</Text>
              <Pressable onPress={() => setRoutePickerOpen(false)} hitSlop={10}><Text style={s.close}>×</Text></Pressable>
            </View>
            <Text style={s.modalHint}>Mostrando {selectableRoutes.length} líneas y servicios</Text>
            <TextInput
              style={s.routeSearch}
              placeholder="Buscar línea o Metro"
              placeholderTextColor={colors.muted}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="characters"
              autoFocus
            />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.routeOptions}>
              <RouteOption label="Todos los servicios" count={allVehicles.length} active={!focusRoute} onPress={() => selectRoute(null)} />
              {selectableRoutes.map(([key, service]) => {
                const routeStyle = styles.get(key) ?? DEFAULT_STYLE;
                return <RouteOption key={key} label={serviceLabel(service.mode, service.route)} count={service.count} color={routeStyle.bg}
                  active={focusRoute === key} onPress={() => selectRoute(key)} />;
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={lineLoadingLabel !== null} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={s.loadingBackdrop} accessibilityViewIsModal>
          <View style={s.loadingCard}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={s.loadingTitle}>Cargando {lineLoadingLabel}</Text>
            <Text style={s.loadingText}>Actualizando el mapa y los vehículos…</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function RouteOption({ label, count, color, active, onPress }: {
  label: string; count: number; color?: string; active: boolean; onPress: () => void;
}) {
  return <Pressable onPress={onPress} style={({ pressed }) => [s.routeOption, active && s.routeOptionActive, pressed && { opacity: 0.72 }]}
    accessibilityRole="button" accessibilityState={{ selected: active }}>
    <View style={[s.dot, { backgroundColor: color ?? colors.accent }]} />
    <Text style={[s.routeOptionText, active && { color: colors.accent }]}>{label}</Text>
    <Text style={s.muted}>{count} activos</Text>
  </Pressable>;
}

function Chip({ label, active, onPress, color, textColor }: {
  label: string; active: boolean; onPress: () => void; color?: string; textColor?: string;
}) {
  return (
    <Pressable onPress={onPress} style={[s.chip, color && active ? { backgroundColor: color, borderColor: color }
      : active ? { backgroundColor: colors.accent, borderColor: colors.accent } : null]}>
      {color && !active && <View style={[s.dot, { backgroundColor: color }]} />}
      <Text style={[s.chipText, active && { color: textColor ?? "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  mapWrap: { flex: 1 },
  sidebar: {
    position: "absolute", top: 12, bottom: 12, left: 12, width: 348, padding: 14, gap: 10, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowColor: "#000", shadowOpacity: 0.16,
    shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  sidebarCompact: { top: undefined, bottom: 8, left: 8, right: 8, width: undefined, maxHeight: "53%", borderRadius: 14 },
  sidebarHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sidebarTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  sidebarSubtitle: { marginTop: 2, fontSize: 12, color: colors.muted },
  vehicleCount: { minWidth: 28, textAlign: "center", fontSize: 13, fontWeight: "700", color: colors.accent },
  search: {
    height: 42, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, maxWidth: 420,
    backgroundColor: colors.surface, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  chips: { gap: 6, paddingRight: 12 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 32, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.text },
  dot: { width: 10, height: 10, borderRadius: 5 },
  routeSelect: { height: 42, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  routeSelectText: { flex: 1, color: colors.text, fontWeight: "600", fontSize: 14 },
  routeSelectChevron: { color: colors.muted, fontSize: 20, lineHeight: 20 },
  vehicleList: { flexGrow: 1, flexShrink: 1, marginHorizontal: -4 },
  vehicleListContent: { gap: 6, paddingHorizontal: 4, paddingBottom: 2 },
  listHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 },
  vehicleRow: { flexDirection: "row", alignItems: "center", gap: 9, padding: 9, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: "transparent" },
  vehicleRowSelected: { backgroundColor: colors.bg },
  vehiclePlate: { fontSize: 14, fontWeight: "700", color: colors.text },
  vehicleDestination: { marginTop: 1, fontSize: 12, color: colors.muted },
  vehicleAge: { fontSize: 12, color: colors.muted },
  empty: { paddingVertical: 12, fontSize: 13, color: colors.muted, textAlign: "center" },
  detailOverlay: {
    position: "absolute", right: 12, bottom: 12, width: 340, gap: 10, padding: 12, borderRadius: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  detailOverlayCompact: { top: 8, bottom: undefined, left: 8, right: 8, width: undefined, maxHeight: "30%" },
  modalBackdrop: { flex: 1, padding: 20, justifyContent: "center", backgroundColor: "rgba(0, 0, 0, 0.45)" },
  routeModal: { width: "100%", maxWidth: 460, maxHeight: "75%", alignSelf: "center", padding: 16, gap: 10, borderRadius: 16, backgroundColor: colors.surface },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  modalHint: { color: colors.muted, fontSize: 13 },
  routeSearch: { height: 42, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, backgroundColor: colors.bg, color: colors.text, borderWidth: 1, borderColor: colors.border },
  routeOptions: { gap: 5, paddingBottom: 4 },
  routeOption: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: 10 },
  routeOptionActive: { backgroundColor: colors.bg },
  routeOptionText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "600" },
  loadingBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "rgba(0, 0, 0, 0.45)" },
  loadingCard: { width: "100%", maxWidth: 320, alignItems: "center", gap: 10, padding: 24, borderRadius: 16, backgroundColor: colors.surface },
  loadingTitle: { color: colors.text, fontSize: 17, fontWeight: "700", textAlign: "center" },
  loadingText: { color: colors.muted, fontSize: 13, textAlign: "center" },
  status: { fontSize: 13, color: colors.muted },
  panel: { gap: 6 },
  panelHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  panelTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  panelLine: { fontSize: 14, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  close: { fontSize: 18, color: colors.muted },
  event: { color: colors.danger, fontSize: 13 },
  prediction: { flexDirection: "row", alignItems: "center", gap: 10 },
  routeBadge: {
    minWidth: 40, textAlign: "center", fontWeight: "700", fontSize: 13, paddingVertical: 3,
    paddingHorizontal: 6, borderRadius: 6, overflow: "hidden",
  },
});
