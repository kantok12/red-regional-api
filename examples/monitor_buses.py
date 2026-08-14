import json
from client import TransAppClient

def main():
    client = TransAppClient()
    route = "3A"
    direction = "I"
    
    print(f"[*] Obteniendo posiciones GPS en vivo para Línea {route} (Sentido {direction})...")
    data = client.get_synoptic_machines(route=route, direction=direction)
    
    machines = data.get("machines", [])
    print(f"[+] Buses activos en ruta: {len(machines)}")
    for m in machines:
        plate = m.get("license_plate") or m.get("plate", "Sin Patente")
        lat = m.get("latitude")
        lon = m.get("longitude")
        speed = m.get("speed", 0)
        print(f"  - Bus [{plate}] -> Lat: {lat}, Lon: {lon} | Velocidad: {speed} km/h")

if __name__ == "__main__":
    main()
