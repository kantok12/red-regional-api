import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { api, type Zone } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { colors } from "../theme";

const LAST_ZONE_KEY = "lastZoneId";

export default function ZonePicker() {
  const { user, signOut } = useAuth();
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [lastZone, setLastZone] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openingZone, setOpeningZone] = useState<Zone | null>(null);

  useEffect(() => {
    if (!user) return;
    api.zones(user).then(setZones).catch((e) => setError(`No se pudo cargar las ciudades: ${e.message}`));
    AsyncStorage.getItem(LAST_ZONE_KEY).then(setLastZone).catch(() => {});
  }, [user]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (zones ?? []).filter((z) =>
      !q || z.name.toLowerCase().includes(q) || (z.region ?? "").toLowerCase().includes(q));
    // La última ciudad visitada va primero.
    return filtered.sort((a, b) => Number(b.id === lastZone) - Number(a.id === lastZone));
  }, [zones, query, lastZone]);

  const open = (z: Zone) => {
    if (openingZone) return;
    AsyncStorage.setItem(LAST_ZONE_KEY, z.id).catch(() => {});
    setLastZone(z.id);
    setOpeningZone(z);
    // La red y la primera foto de la flota pueden tardar; damos una transición
    // consistente antes de entrar al mapa.
    setTimeout(() => {
      // La pantalla anterior sigue montada dentro del Stack. Si el modal queda
      // abierto, tapa el mapa de la zona aun cuando la navegación sí funcionó.
      setOpeningZone(null);
      router.push({ pathname: "/zone/[id]", params: { id: z.id, name: z.name } });
    }, 1500);
  };

  return (
    <View style={s.screen}>
      <Stack.Screen options={{
        headerRight: () => (
          <Pressable onPress={signOut} hitSlop={8} accessibilityRole="button">
            <Text style={s.signOut}>Salir</Text>
          </Pressable>
        ),
      }} />
      <Text style={s.hello}>Hola, {user?.displayName ?? user?.email}</Text>
      <TextInput
        style={s.search}
        placeholder="Buscar ciudad o región"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
      />
      {error && <Text style={s.error}>{error}</Text>}
      {!zones && !error && <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} />}
      <FlatList
        data={list}
        keyExtractor={(z) => z.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <Pressable style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]} onPress={() => open(item)}>
            <View style={{ flex: 1 }}>
              <Text style={s.zoneName}>{item.name}</Text>
              {item.region && <Text style={s.region}>{item.region}</Text>}
            </View>
            {item.id === lastZone && <Text style={s.badge}>Última</Text>}
            <Text style={s.chevron}>›</Text>
          </Pressable>
        )}
      />
      <Modal visible={!!openingZone} transparent animationType="fade">
        <View style={s.loadingBackdrop} accessibilityViewIsModal>
          <View style={s.loadingCard}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={s.loadingTitle}>Cargando {openingZone?.name}</Text>
            <Text style={s.loadingText}>Preparando la red de transporte…</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, paddingTop: 12 },
  hello: { color: colors.muted, marginBottom: 10 },
  search: {
    height: 44, flexShrink: 0, borderRadius: 10, paddingHorizontal: 12, marginBottom: 12, fontSize: 16,
    backgroundColor: colors.surface, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: 8, padding: 14, marginBottom: 8, borderRadius: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  zoneName: { fontSize: 16, fontWeight: "600", color: colors.text },
  region: { fontSize: 13, color: colors.muted, marginTop: 2 },
  badge: { fontSize: 12, color: colors.accent, fontWeight: "600" },
  chevron: { fontSize: 22, color: colors.muted },
  signOut: { color: colors.accent, fontWeight: "600", paddingHorizontal: 8 },
  error: { color: colors.danger, marginBottom: 8 },
  loadingBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "rgba(0, 0, 0, 0.42)" },
  loadingCard: { width: "100%", maxWidth: 320, alignItems: "center", gap: 10, padding: 24, borderRadius: 16, backgroundColor: colors.surface },
  loadingTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  loadingText: { color: colors.muted, fontSize: 13, textAlign: "center" },
});
