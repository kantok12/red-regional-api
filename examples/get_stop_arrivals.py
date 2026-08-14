from client import TransAppClient

def main():
    client = TransAppClient()
    stop_code = "PA151"
    print(f"[*] Consultando información en vivo para el paradero: {stop_code}...")
    
    data = client.get_stop_info(stop_code)
    services = data.get("services", [])
    
    if not services:
        print("[-] No hay servicios próximos reportados en este momento.")
        return

    print(f"\n[+] Servicios aproximándose ({len(services)} encontrados):")
    for svc in services:
        name = svc.get("name")
        arrival = svc.get("arrival_time", "N/A")
        distance = svc.get("distance", "N/A")
        print(f"  - Línea {name}: LLegada estimada en {arrival} mins ({distance} mts de distancia)")

if __name__ == "__main__":
    main()
