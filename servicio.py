import json
import os
import sqlite3
import paho.mqtt.client as mqtt

# 1. Lee la IP enviada por Docker; si no existe, usa "localhost"
BROKER = os.getenv("BROKER_HOST", "localhost")
PUERTO = int(os.getenv("BROKER_PORT", 1883))

# Mapeo: convierte el nombre de la puerta al nombre de la columna en datos.db
MAPEO_PUERTAS = {
    "puerta_hall": "permiso_hall",
    "puerta_servidores": "permiso_servidores",
}

def validar_acceso(uid, puerta):
    # 1. Traducimos la puerta recibida a su columna correspondiente en la BD
    columna_permiso = MAPEO_PUERTAS.get(puerta)

    if not columna_permiso:
        return False, "Puerta desconocida"

    # 2. Nos conectamos a datos.db
    conexion = sqlite3.connect("datos.db")
    cursor = conexion.cursor()

    # 3. Consultamos la tarjeta en la BD usando la columna correcta
    cursor.execute(
        f"SELECT nombre, {columna_permiso} FROM usuarios WHERE uid_nfc = ?",
        (uid,),
    )
    resultado = cursor.fetchone()

    if resultado:
        nombre, tiene_permiso = resultado
        if tiene_permiso == 1:
            # Guardamos el evento de éxito en el historial
            cursor.execute(
                "INSERT INTO historial (puerta, uid_nfc, resultado) VALUES (?, ?, ?)",
                (puerta, uid, "PERMITIDO"),
            )
            conexion.commit()
            conexion.close()
            return True, f"Bienvenido/a {nombre}"

    # Si no tiene permiso o no existe la tarjeta, guardamos el intento fallido
    cursor.execute(
        "INSERT INTO historial (puerta, uid_nfc, resultado) VALUES (?, ?, ?)",
        (puerta, uid, "DENEGADO"),
    )
    conexion.commit()
    conexion.close()

    return False, "Acceso no autorizado"

def on_message(client, userdata, msg):
    try:
        datos = json.loads(msg.payload.decode())
        uid = datos.get("uid")
        puerta = datos.get("puerta")

        autorizado, mensaje = validar_acceso(uid, puerta)

        respuesta = {
            "uid": uid,
            "estado": "ACCESO_CONCEDIDO" if autorizado else "ACCESO_DENEGADO",
            "detalle": mensaje,
        }

        topico_respuesta = f"puertas/{puerta}/respuesta"
        client.publish(topico_respuesta, json.dumps(respuesta), qos=1)

        print(
            f" Solicitud procesada para UID '{uid}' en '{puerta}': {respuesta['estado']} ({mensaje})"
        )

    except Exception as e:
        print(f"Error procesando mensaje: {e}")

cliente = mqtt.Client(client_id="servicio_central")
cliente.on_message = on_message

cliente.connect(BROKER, PUERTO)
cliente.subscribe("puertas/+/solicitud", qos=1)

print("Servicio Central escuchando solicitudes en 'datos.db'...")
cliente.loop_forever()

