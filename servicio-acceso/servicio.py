import json
import os
import sqlite3
import time
import paho.mqtt.client as mqtt

# 1. Configuración de conexión (Docker u otro entorno)
BROKER = os.getenv("BROKER_HOST", "localhost")
PUERTO = int(os.getenv("BROKER_PORT", 1883))

# Mapeo: convierte el nombre de la puerta (del topic) a la columna de permisos en datos.db
MAPEO_PUERTAS = {
    "puerta-hall": "permiso_hall",
    "puerta-servidores": "permiso_servidores",
}

# 2. Estado global en memoria del sitio para alimentar al Dashboard
ESTADO_SITIO = {
    "puertas": {},      # ej: {"puerta-hall": "online", "puerta-servidores": "offline"}
    "solicitudes": {},  # Solicitudes en espera de aprobación manual por un admin
    "alarma": {"activa": False},
}


def obtener_ultimos_eventos(limite=20):
    """Obtiene los últimos N eventos guardados en el historial de datos.db"""
    try:
        conexion = sqlite3.connect("datos.db")
        cursor = conexion.cursor()
        # Usamos rowid para ordenar por los registros más recientes
        cursor.execute(
            "SELECT rowid, puerta, uid_nfc, resultado FROM historial ORDER BY rowid DESC LIMIT ?",
            (limite,),
        )
        filas = cursor.fetchall()
        conexion.close()

        eventos = []
        for fila in filas:
            eventos.append({
                "id": fila[0],
                "puerta": fila[1],
                "uid": fila[2],
                "resultado": fila[3],
            })
        return eventos
    except Exception as e:
        print(f"Error leyendo historial: {e}")
        return []

def publicar_estado(client, sitio):
    """Publica la foto completa del estado del sitio (Retenido para el Dashboard)"""
    payload_estado = {
        "puertas": ESTADO_SITIO["puertas"],
        "solicitudes": ESTADO_SITIO["solicitudes"],
        "alarma": ESTADO_SITIO["alarma"],
        "eventos": obtener_ultimos_eventos(20),
    }
    topico_estado = f"acceso/{sitio}/estado"
    client.publish(topico_estado, json.dumps(payload_estado), qos=1, retain=True)

def publicar_evento(client, sitio, tipo, detalle):
    """Publica un evento en tiempo real en el canal de eventos del Dashboard (No retenido)"""
    payload_evento = {
        "tipo": tipo,
        "timestamp": int(time.time()),
        "detalle": detalle,
    }
    topico_eventos = f"acceso/{sitio}/eventos"
    client.publish(topico_eventos, json.dumps(payload_evento), qos=1)

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
        # Notifica presencia del servicio (retenido)
        client.publish("servicio/presencia", "online", qos=1, retain=True)

        # Suscripciones principales
        client.subscribe("acceso/+/puerta/+/lectura", qos=1)
        client.subscribe("acceso/+/puerta/+/presencia", qos=1)
        client.subscribe("usuario/+/pedido", qos=1)
    else:
        print(f" Fallo al conectar. Código de retorno: {rc}")

def on_message(client, userdata, msg):
    try:
        topic = msg.topic
        partes = topic.split("/")

        # 1. Manejo de presencia de puertas: acceso/{sitio}/puerta/{puerta}/presencia
        if len(partes) == 5 and partes[0] == "acceso" and partes[2] == "puerta" and partes[4] == "presencia":
            sitio = partes[1]
            puerta = partes[3]
            estado_puerta = msg.payload.decode("utf-8").strip()

            ESTADO_SITIO["puertas"][puerta] = estado_puerta
            print(f" Puerta '{puerta}' en '{sitio}' cambió a estado: {estado_puerta}")

            if estado_puerta == "offline":
                publicar_evento(client, sitio, "puerta_caida", f"La puerta {puerta} se desconectó.")

            publicar_estado(client, sitio)
            return

        # 2. Manejo de lecturas de tarjeta: acceso/{sitio}/puerta/{puerta}/lectura
        if len(partes) == 5 and partes[0] == "acceso" and partes[2] == "puerta" and partes[4] == "lectura":
            sitio = partes[1]
            puerta = partes[3]

            datos = json.loads(msg.payload.decode("utf-8"))
            req_id = datos.get("req_id")
            uid = datos.get("uid")

            if not req_id or not uid:
                return

            autorizado, mensaje = validar_acceso(uid, puerta)

            respuesta = {
                "req_id": req_id,
                "accion": "abrir" if autorizado else "denegar",
                "mensaje": mensaje,
            }

            # Responder a la puerta
            topico_orden = f"acceso/{sitio}/puerta/{puerta}/orden"
            client.publish(topico_orden, json.dumps(respuesta), qos=1)

            # Notificar al Dashboard (Evento + Actualizar foto del Estado)
            tipo_evento = "acceso" if autorizado else "denegado"
            publicar_evento(client, sitio, tipo_evento, f"UID '{uid}' en '{puerta}': {respuesta['accion'].upper()}")
            publicar_estado(client, sitio)

            print(f" Solicitud {req_id} para UID '{uid}' en '{puerta}': {respuesta['accion'].upper()}")
            return

        # 3. Manejo de comandos enviados por el Administrador: usuario/{admin}/pedido
        if len(partes) == 3 and partes[0] == "usuario" and partes[2] == "pedido":
            admin = partes[1]
            datos = json.loads(msg.payload.decode("utf-8"))
            tipo_pedido = datos.get("tipo")
            sitio = datos.get("sitio", "edificio1")

            if tipo_pedido == "reconocer_alarma":
                ESTADO_SITIO["alarma"]["activa"] = False
                publicar_evento(client, sitio, "alarma_reconocida", f"Alarma silenciada por admin '{admin}'")
                publicar_estado(client, sitio)
                print(f" Alarma desactivada por admin '{admin}'")
            return

    except Exception as e:
        print(f" Error procesando mensaje: {e}")

# Client ID exigido por las ACLs del broker: "servicio"
cliente = mqtt.Client(client_id="servicio", clean_session=False)

# Configura Last Will &amp; Testament (LWT)
cliente.will_set("servicio/presencia", payload="offline", qos=1, retain=True)

cliente.on_connect = on_connect
cliente.on_message = on_message

print(" Iniciando Servicio Central (con soporte de Dashboard)...")
cliente.connect(BROKER, PUERTO, keepalive=10)
cliente.loop_forever()

