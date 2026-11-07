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
    permiso_servidores INTEGER NOT NULL  -- 1 = Permitido, 0 = Denegado
);
""")

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
    # (UID NFC, Nombre, Rol, Permiso Hall, Permiso Servidores)
    ("A1B2C3D4", "Carlos Pérez (Empleado)", "empleado", 1, 0),
    ("F9E8D7C6", "Ana Gómez (Admin)", "admin", 1, 1),
    ("11223344", "Juan López (Inactivo)", "visitante", 0, 0),
    # Tarjetas reales del grupo
    ("31A7506E", "Alan Viera", "admin", 1, 1),
    ("BD6173E7", "Nehuen García", "admin", 1, 1),
    ("3C2F69E7", "Francisco Cavieres", "empleado", 1, 0),
    ("8D3F2AF4", "Leonel Canario", "empleado", 1, 0),
]

cursor.executemany(
    """
INSERT OR REPLACE INTO usuarios (uid_nfc, nombre, rol, permiso_hall, permiso_servidores)
VALUES (?, ?, ?, ?, ?);
""",
    usuarios_prueba,
)

conexion.commit()
conexion.close()

print("✅ Base de datos 'datos.db' creada correctamente con usuarios de prueba.")
