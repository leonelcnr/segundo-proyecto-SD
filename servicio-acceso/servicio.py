import json
import os
import sqlite3
import paho.mqtt.client as mqtt

# 1. Configuración de conexión (Docker u otro entorno)
BROKER = os.getenv("BROKER_HOST", "localhost")
PUERTO = int(os.getenv("BROKER_PORT", 1883))

# Mapeo: convierte el nombre de la puerta (del topic) a la columna de permisos en datos.db
MAPEO_PUERTAS = {
    "puerta-hall": "permiso_hall",
    "puerta-servidores": "permiso_servidores",
}

def validar_acceso(uid, puerta):
    columna_permiso = MAPEO_PUERTAS.get(puerta)

    if not columna_permiso:
        return False, "Puerta desc."

    conexion = sqlite3.connect("datos.db")
    cursor = conexion.cursor()

    cursor.execute(
        f"SELECT nombre, {columna_permiso} FROM usuarios WHERE uid_nfc = ?",
        (uid,),
    )
    resultado = cursor.fetchone()

    if resultado:
        nombre, tiene_permiso = resultado
        if tiene_permiso == 1:
            cursor.execute(
                "INSERT INTO historial (puerta, uid_nfc, resultado) VALUES (?, ?, ?)",
                (puerta, uid, "PERMITIDO"),
            )
            conexion.commit()
            conexion.close()
            # Mensaje corto para la pantalla de la puerta (máx. 16 caracteres)
            return True, f"Hola {nombre}"[:16]

    cursor.execute(
        "INSERT INTO historial (puerta, uid_nfc, resultado) VALUES (?, ?, ?)",
        (puerta, uid, "DENEGADO"),
    )
    conexion.commit()
    conexion.close()

    return False, "Denegado"

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(" Conectado al Broker MQTT exitosamente.")
        # Notifica que el servicio está online (retenido)
        client.publish("servicio/presencia", "online", qos=1, retain=True)
        # Suscripción al tópico general de lecturas: acceso/{sitio}/puerta/{puerta}/lectura
        client.subscribe("acceso/+/puerta/+/lectura", qos=1)
    else:
        print(f" Fallo al conectar. Código de retorno: {rc}")

def on_message(client, userdata, msg):
    try:
        # Extrae sitio y puerta del topic: acceso/{sitio}/puerta/{puerta}/lectura
        partes_topic = msg.topic.split("/")
        sitio = partes_topic[1]
        puerta = partes_topic[3]

        datos = json.loads(msg.payload.decode("utf-8"))
        req_id = datos.get("req_id")
        uid = datos.get("uid")

        if not req_id or not uid:
            return

        autorizado, mensaje = validar_acceso(uid, puerta)

        # JSON de respuesta según la sección 4.2 del protocolo MQTT
        respuesta = {
            "req_id": req_id,
            "accion": "abrir" if autorizado else "denegar",
            "mensaje": mensaje,
        }

        topico_orden = f"acceso/{sitio}/puerta/{puerta}/orden"
        client.publish(topico_orden, json.dumps(respuesta), qos=1)

        print(
            f" Solicitud {req_id} para UID '{uid}' en '{puerta}': {respuesta['accion'].upper()}"
        )

    except Exception as e:
        print(f" Error procesando lectura: {e}")

# Client ID exigido por las ACLs del broker: "servicio"
cliente = mqtt.Client(client_id="servicio", clean_session=False)

# Configura Last Will &amp; Testament (LWT) para notificar si se cae el servicio
cliente.will_set("servicio/presencia", payload="offline", qos=1, retain=True)

cliente.on_connect = on_connect
cliente.on_message = on_message

print(" Iniciando Servicio Central...")
cliente.connect(BROKER, PUERTO, keepalive=10)
cliente.loop_forever()
