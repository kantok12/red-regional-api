import csv
import sqlite3
import zipfile
import os

DB_FILE = "transporte_regional.db"
ZIP_FILE = "gtfs_talca.zip"

def create_schema(cursor):
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS stops (
        stop_id TEXT PRIMARY KEY,
        stop_name TEXT,
        stop_lat REAL,
        stop_lon REAL,
        stop_code TEXT
    )""")
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS routes (
        route_id TEXT PRIMARY KEY,
        route_short_name TEXT,
        route_long_name TEXT,
        route_color TEXT
    )""")

def import_csv_to_sqlite(zip_path: str):
    if not os.path.exists(zip_path):
        print(f"[-] No se encontró {zip_path}. Descárgalo primero con TransAppClient.")
        return

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    create_schema(cursor)

    with zipfile.ZipFile(zip_path, 'r') as z:
        # Importar Paraderos
        if "stop.csv" in z.namelist():
            print("[*] Importando stop.csv...")
            with z.open("stop.csv") as f:
                reader = csv.DictReader(f.read().decode('utf-8-sig').splitlines())
                stops = [(r.get('stop_id'), r.get('stop_name'), float(r.get('stop_lat', 0)), float(r.get('stop_lon', 0)), r.get('stop_code')) for r in reader]
                cursor.executemany("INSERT OR REPLACE INTO stops VALUES (?, ?, ?, ?, ?)", stops)

        # Importar Rutas
        if "route.csv" in z.namelist():
            print("[*] Importando route.csv...")
            with z.open("route.csv") as f:
                reader = csv.DictReader(f.read().decode('utf-8-sig').splitlines())
                routes = [(r.get('route_id'), r.get('route_short_name'), r.get('route_long_name'), r.get('route_color')) for r in reader]
                cursor.executemany("INSERT OR REPLACE INTO routes VALUES (?, ?, ?, ?)", routes)

    conn.commit()
    conn.close()
    print(f"[+] Base de datos {DB_FILE} creada exitosamente.")

if __name__ == "__main__":
    import_csv_to_sqlite(ZIP_FILE)
