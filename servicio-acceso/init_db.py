import sqlite3

# 1. Conectar/Crear el archivo de base de datos
conexion = sqlite3.connect("datos.db")
cursor = conexion.cursor()

# 2. Crear la tabla de usuarios autorizados
cursor.execute("""
CREATE TABLE IF NOT EXISTS usuarios (
    uid_nfc TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL,
    permiso_hall INTEGER NOT NULL,       -- 1 = Permitido, 0 = Denegado
    permiso_servidores INTEGER NOT NULL, -- 1 = Permitido, 0 = Denegado
    celular TEXT                         -- usuario MQTT del celular del dueño (celular-1…), o NULL
);
""")

# Bases creadas antes de la columna celular
if "celular" not in [c[1] for c in cursor.execute("PRAGMA table_info(usuarios)")]:
    cursor.execute("ALTER TABLE usuarios ADD COLUMN celular TEXT")

# 3. Crear la tabla para guardar el historial de accesos
cursor.execute("""
CREATE TABLE IF NOT EXISTS historial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    puerta TEXT NOT NULL,
    uid_nfc TEXT NOT NULL,
    resultado TEXT NOT NULL
);
""")

# 4. Insertar usuarios de prueba
usuarios_prueba = [
    # (UID NFC, Nombre, Rol, Permiso Hall, Permiso Servidores, Celular)
    ("A1B2C3D4", "Carlos Pérez (Empleado)", "empleado", 1, 0, None),
    ("F9E8D7C6", "Ana Gómez (Admin)", "admin", 1, 1, None),
    ("11223344", "Juan López (Inactivo)", "visitante", 0, 0, None),
    # Tarjetas reales del grupo
    ("31A7506E", "Alan Viera", "admin", 1, 1, None),
    ("BD6173E7", "Nehuen García", "admin", 1, 1, "celular-1"),
    ("3C2F69E7", "Francisco Cavieres", "empleado", 1, 0, None),
    ("8D3F2AF4", "Leonel Canario", "empleado", 1, 0, None),
    # Celulares con la app (la puerta Hall manda "CEL-" + el código que muestra la app)
    ("CEL-BD6173E7", "Nehuen García (celular)", "admin", 1, 1, "celular-1"),
]

cursor.executemany(
    """
INSERT OR REPLACE INTO usuarios (uid_nfc, nombre, rol, permiso_hall, permiso_servidores, celular)
VALUES (?, ?, ?, ?, ?, ?);
""",
    usuarios_prueba,
)

conexion.commit()
conexion.close()

print("✅ Base de datos 'datos.db' creada correctamente con usuarios de prueba.")
