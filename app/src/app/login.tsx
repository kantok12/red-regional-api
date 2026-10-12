import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { colors } from "../theme";

export default function Login() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPress = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      setError((e as Error).message || "No se pudo iniciar sesión");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.screen}>
      <View style={s.card}>
        <Text style={s.logo}>🚌</Text>
        <Text style={s.title}>Red Regional en vivo</Text>
        <Text style={s.subtitle}>Buses en tiempo real de todas las ciudades con Red Regional.</Text>
        <Pressable style={({ pressed }) => [s.button, pressed && { opacity: 0.85 }]} onPress={onPress} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Entrar con Google</Text>}
        </Pressable>
        {error && <Text style={s.error}>{error}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 16 },
  card: {
    width: "100%", maxWidth: 380, backgroundColor: colors.surface, borderRadius: 16, padding: 28,
    alignItems: "center", gap: 12, borderWidth: 1, borderColor: colors.border,
  },
  logo: { fontSize: 44 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: "center", marginBottom: 8 },
  button: {
    alignSelf: "stretch", height: 48, borderRadius: 10, backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: colors.danger, textAlign: "center" },
});
