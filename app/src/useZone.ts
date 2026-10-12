import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { api, type Fleet, type Network } from "./api";
import { useAuth } from "./auth/AuthProvider";
import { REFRESH_MS } from "./config";
import { routeStyles } from "./fleet";
import { BusMotion } from "./motion";

/** Red estática de la zona + flota en vivo, consultada cada REFRESH_MS. */
export function useZone(zoneId: string) {
  const { user } = useAuth();
  const [network, setNetwork] = useState<Network | null>(null);
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setNetwork(null);
    setFleet(null);
    setError(null);
    api.network(user, zoneId)
      .then((n) => !cancelled && setNetwork(n))
      .catch((e) => !cancelled && setError(`No se pudo cargar la red: ${e.message}`));
    return () => { cancelled = true; };
  }, [user, zoneId]);

  // Animación de los buses sobre sus trazados entre una consulta y la siguiente.
  const motion = useMemo(() => (network ? new BusMotion(network.routes) : null), [network]);

  useEffect(() => {
    if (!user || !motion) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waiting = true; // el poller del servidor aún no tiene foto

    const tick = async () => {
      // En segundo plano no se consulta: ahorra batería y carga al backend.
      if (AppState.currentState === "active") {
        try {
          const f = await api.vehicles(user, zoneId);
          if (cancelled) return;
          waiting = f.fetchedAt === null;
          motion.update(f.vehicles);
          setFleet(f);
          setError(null);
        } catch (e) {
          if (!cancelled) setError(`Error al actualizar: ${(e as Error).message}`);
        }
      }
      // Recién iniciado el poller del servidor aún no hay foto: reintento rápido.
      if (!cancelled) timer = setTimeout(tick, waiting ? 2000 : REFRESH_MS);
    };
    tick();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") { clearTimeout(timer); tick(); }
    });
    return () => { cancelled = true; clearTimeout(timer); sub.remove(); };
  }, [user, zoneId, motion]);

  const styles = useMemo(() => routeStyles(network?.routes ?? []), [network]);
  return { network, fleet, styles, error, motion };
}
