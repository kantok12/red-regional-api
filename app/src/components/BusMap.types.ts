import type { Route, Stop, Vehicle, Zone } from "../api";
import type { RouteStyle } from "../fleet";
import type { BusMotion } from "../motion";

/** Interfaz común de BusMap (web: Leaflet, móvil: react-native-maps). */
export type BusMapProps = {
  zone: Zone;
  shapes: Route[];          // trazados a dibujar (línea filtrada o bus seleccionado)
  stops: Stop[];            // se muestran solo con zoom cercano
  vehicles: Vehicle[];
  motion: BusMotion | null; // mueve los buses por su trazado entre actualizaciones
  styles: Map<string, RouteStyle>;
  routeOpacity: number;
  vehicleOpacity: number;
  focusRoute: string | null;
  selectedId: string | null;
  onVehiclePress: (id: string) => void;
  onStopPress: (stop: Stop) => void;
};

export const STOPS_MIN_ZOOM = 15;
