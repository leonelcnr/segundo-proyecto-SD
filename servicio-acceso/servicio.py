"""Servicio central de control de acceso.

Habla solo con el broker MQTT. Es el único que decide si una puerta se abre y el único
que publica el estado del sistema (lo que muestra el dashboard).

Topics:
  escucha   acceso/+/puerta/+/lectura       (puerta: {req_id, uid})
            acceso/+/puerta/+/presencia     (puerta: online/offline, Last Will)
            usuario/+/pedido                (admin: decision / reconocer_alarma)
  publica   acceso/{sitio}/puerta/{p}/orden (abrir / denegar)       QoS 1
            acceso/{sitio}/estado           (foto completa)         QoS 1, retenido
            acceso/{sitio}/alarma           (alarma del sitio)      QoS 1, retenido
            acceso/{sitio}/eventos          (hechos en vivo)        QoS 1
            usuario/{admin}/aviso           (respuesta al admin)    QoS 1
            servicio/presencia              (online/offline, LWT)   QoS 1, retenido
"""
import json
import os
import sqlite3
import threading
import unicodedata
from collections import OrderedDict, deque
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

# --- Configuración (variables de entorno) ---
BROKER = os.getenv("BROKER_HOST", "localhost")
PUERTO = int(os.getenv("BROKER_PORT", 1883))
USUARIO = os.getenv("MQTT_USER", "servicio")  # tiene que coincidir con el client ID: lo exige la ACL
CLAVE = os.getenv("MQTT_PASSWORD")
CA = os.getenv("MQTT_CA")  # ruta a ca.crt; si está, la conexión va por TLS
DB = os.getenv("DB_PATH", "datos.db")
VENCE_S = int(os.getenv("VENCE_SOLICITUD_S", 30))  # tiempo que el admin tiene para decidir
MAX_HISTORIAL = 20

# Nombre de la puerta (del topic) -> columna de permisos en datos.db
MAPEO_PUERTAS = {
    "puerta-hall": "permiso_hall",
    "puerta-servidores": "permiso_servidores",
}

# Puerta -> sala que protege (nombre de la sala en el topic de ocupantes)
SALA_POR_PUERTA = {
    "puerta-hall": "hall",
    "puerta-servidores": "servidores",
}
# Cuánto tiempo se considera que alguien sigue dentro de cada sala (protocolo de salas, 3.1)
PERMANENCIA_S = {"hall": 15 * 60, "servidores": 10 * 60}
SITIO_INICIAL = os.getenv("SITIO", "edificio1")  # sitio al que se le limpian los ocupantes al arrancar

# Cómo se muestra en el dashboard cada resultado guardado en la tabla historial
TIPO_POR_RESULTADO = {
    "PERMITIDO": "acceso",
    "APROBADO": "acceso",
    "DENEGADO": "denegado",
    "RECHAZADO": "denegado",
    "VENCIDO": "denegado",
    "DESCONOCIDO": "alarma",
}

lock = threading.RLock()  # paho y los Timer corren en hilos distintos
SITIOS = {}  # sitio -> estado en memoria
YA_RESPONDIDAS = OrderedDict()  # req_id -> orden ya enviada, para repetirla si el mensaje llega duplicado


def ahora():
    """Hora local sin zona, como las fechas del protocolo."""
    return datetime.now().isoformat(timespec="seconds")


def corto(texto):
    """Mensaje para el LCD de la puerta: máx. 16 caracteres y sin tildes ni ñ (protocolo 4.2)."""
    limpio = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return limpio[:16]


def primer_nombre(nombre):
    return nombre.split()[0] if nombre else ""


def sitio_estado(sitio):
    if sitio not in SITIOS:
        SITIOS[sitio] = {
            "puertas": {},
            "pendientes": {},  # req_id -> {req_id, puerta, uid, persona, vence, timer}
            "alarma": {"activa": False},
            "historial": deque(cargar_historial(), maxlen=MAX_HISTORIAL),
            "ocupantes": {sala: {} for sala in PERMANENCIA_S},  # sala -> {uid: {..., timer}}
        }
    return SITIOS[sitio]


# --- Base de datos ---
def cargar_historial():
    """Reconstruye los últimos eventos desde datos.db, así sobreviven a un reinicio."""
    try:
        con = sqlite3.connect(DB)
        filas = con.execute(
            "SELECT h.fecha, h.puerta, h.uid_nfc, h.resultado, u.nombre "
            "FROM historial h LEFT JOIN usuarios u ON u.uid_nfc = h.uid_nfc "
            "ORDER BY h.id DESC LIMIT ?",
            (MAX_HISTORIAL,),
        ).fetchall()
        con.close()
    except Exception as e:
        print(f"Error leyendo historial: {e}")
        return []
    eventos = []
    for fecha, puerta, uid, resultado, nombre in filas:  # de más nuevo a más viejo
        try:
            # CURRENT_TIMESTAMP de SQLite es UTC: se pasa a hora local
            ts = datetime.strptime(fecha, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            ts = ts.astimezone().replace(tzinfo=None).isoformat(timespec="seconds")
        except Exception:
            ts = fecha
        eventos.append({
            "ts": ts,
            "tipo": TIPO_POR_RESULTADO.get(resultado, "denegado"),
            "puerta": puerta,
            "persona": nombre,
            "uid": uid,
            "detalle": resultado.lower(),
        })
    eventos.reverse()  # el deque guarda de viejo a nuevo
    return eventos


def buscar_usuario(uid, puerta):
    """Devuelve (nombre, permiso_en_esta_puerta, permiso_en_alguna) o None si la tarjeta no existe."""
    columna = MAPEO_PUERTAS[puerta]  # solo claves del diccionario: no viene del usuario
    con = sqlite3.connect(DB)
    fila = con.execute(
        f"SELECT nombre, {columna}, permiso_hall, permiso_servidores FROM usuarios WHERE uid_nfc = ?", (uid,)
    ).fetchone()
    con.close()
    return (fila[0], fila[1] == 1, fila[2] == 1 or fila[3] == 1) if fila else None


def buscar_rol(uid):
    con = sqlite3.connect(DB)
    fila = con.execute("SELECT rol FROM usuarios WHERE uid_nfc = ?", (uid,)).fetchone()
    con.close()
    return fila[0] if fila else None


def guardar_historial(puerta, uid, resultado):
    con = sqlite3.connect(DB)
    con.execute("INSERT INTO historial (puerta, uid_nfc, resultado) VALUES (?, ?, ?)", (puerta, uid, resultado))
    con.commit()
    con.close()


# --- Publicación ---
def publicar_estado(client, sitio):
    """Foto completa del sitio, retenida: un dashboard que entra tarde la recibe sola."""
    e = sitio_estado(sitio)
    pendientes = [
        {k: v for k, v in p.items() if k != "timer"} for p in e["pendientes"].values()
    ]
    payload = {
        "puertas": e["puertas"],  # {puerta: {online, ultimo_acceso}}
        "pendientes": pendientes,
        "alarma": e["alarma"],
        "historial": list(e["historial"])[::-1],  # más nuevo primero
    }
    client.publish(f"acceso/{sitio}/estado", json.dumps(payload), qos=1, retain=True)


def publicar_alarma(client, sitio):
    client.publish(f"acceso/{sitio}/alarma", json.dumps(sitio_estado(sitio)["alarma"]), qos=1, retain=True)


def publicar_evento(client, sitio, tipo, puerta=None, persona=None, uid=None, detalle=""):
    evento = {"ts": ahora(), "tipo": tipo, "puerta": puerta, "persona": persona, "uid": uid, "detalle": detalle}
    sitio_estado(sitio)["historial"].append(evento)
    client.publish(f"acceso/{sitio}/eventos", json.dumps(evento), qos=1)


def publicar_ocupantes(client, sitio, sala):
    """Lista completa de quién está dentro de la sala, retenida. [] = sala vacía."""
    lista = [
        {k: v for k, v in o.items() if k != "timer"}
        for o in sitio_estado(sitio)["ocupantes"][sala].values()
    ]
    client.publish(f"acceso/{sitio}/sala/{sala}/ocupantes", json.dumps(lista), qos=1, retain=True)


def registrar_ocupante(client, sitio, puerta, uid, nombre):
    """Anota que la persona entró a la sala de esa puerta y publica la lista completa."""
    sala = SALA_POR_PUERTA.get(puerta)
    if sala is None:
        return
    dentro = sitio_estado(sitio)["ocupantes"][sala]
    if uid in dentro:  # volvió a pasar la tarjeta: se renueva su permanencia
        dentro[uid]["timer"].cancel()
    segundos = PERMANENCIA_S[sala]
    timer = threading.Timer(segundos, vencer_ocupante, args=(client, sitio, sala, uid))
    timer.daemon = True
    dentro[uid] = {
        "persona": nombre,
        "usuario": None,  # no tenemos de dónde sacar el celular de la persona
        "rol": buscar_rol(uid),
        "desde": ahora(),
        "vence": datetime.fromtimestamp(datetime.now().timestamp() + segundos).isoformat(timespec="seconds"),
        "timer": timer,
    }
    timer.start()
    publicar_ocupantes(client, sitio, sala)


def vencer_ocupante(client, sitio, sala, uid):
    with lock:
        if sitio_estado(sitio)["ocupantes"][sala].pop(uid, None) is not None:
            publicar_ocupantes(client, sitio, sala)
            print(f" '{uid}' salió de '{sala}' (venció su permanencia)")


def responder_puerta(client, sitio, puerta, req_id, accion, mensaje, final=True, por=None):
    """accion: abrir | denegar | esperar | alarma. Las órdenes finales se recuerdan por si la lectura llega repetida."""
    orden = {"req_id": req_id, "accion": accion, "mensaje": corto(mensaje)}
    if final:
        YA_RESPONDIDAS[req_id] = (sitio, puerta, orden, por)
        while len(YA_RESPONDIDAS) > 500:
            YA_RESPONDIDAS.popitem(last=False)
    client.publish(f"acceso/{sitio}/puerta/{puerta}/orden", json.dumps(orden), qos=1)


def marcar_acceso(sitio, puerta):
    info = sitio_estado(sitio)["puertas"].setdefault(puerta, {"online": None, "ultimo_acceso": None})
    info["ultimo_acceso"] = ahora()


# --- Lógica de acceso ---
def procesar_lectura(client, sitio, puerta, datos):
    req_id, uid = datos.get("req_id"), datos.get("uid")
    if not req_id or not uid:
        return
    e = sitio_estado(sitio)

    # QoS 1 puede entregar el mismo mensaje dos veces: no se vuelve a decidir
    if req_id in e["pendientes"]:
        responder_puerta(client, sitio, puerta, req_id, "esperar", "", final=False)
        return
    if req_id in YA_RESPONDIDAS:
        s, p, orden, _ = YA_RESPONDIDAS[req_id]
        client.publish(f"acceso/{s}/puerta/{p}/orden", json.dumps(orden), qos=1)
        return

    if puerta not in MAPEO_PUERTAS:
        responder_puerta(client, sitio, puerta, req_id, "denegar", "Puerta desc.")
        return

    usuario = buscar_usuario(uid, puerta)

    if usuario is None:
        # Tarjeta desconocida: se deniega y se levanta la alarma del sitio
        guardar_historial(puerta, uid, "DESCONOCIDO")
        responder_puerta(client, sitio, puerta, req_id, "alarma", "Desconocida")
        e["alarma"] = {"activa": True, "puerta": puerta, "motivo": "tarjeta desconocida", "desde": ahora()}
        publicar_alarma(client, sitio)
        publicar_evento(client, sitio, "alarma", puerta, None, uid, "tarjeta desconocida")

    elif usuario[1]:
        nombre = usuario[0]
        guardar_historial(puerta, uid, "PERMITIDO")
        responder_puerta(client, sitio, puerta, req_id, "abrir", f"Hola {primer_nombre(nombre)}")
        marcar_acceso(sitio, puerta)
        registrar_ocupante(client, sitio, puerta, uid, nombre)
        publicar_evento(client, sitio, "acceso", puerta, nombre, uid, "directo")

    elif not usuario[2]:
        # Credencial sin permiso en ninguna puerta: se deniega sin molestar al admin
        nombre = usuario[0]
        guardar_historial(puerta, uid, "DENEGADO")
        responder_puerta(client, sitio, puerta, req_id, "denegar", "No autorizado")
        publicar_evento(client, sitio, "denegado", puerta, nombre, uid, "nivel insuficiente")

    else:
        # Usuario conocido sin permiso para esa puerta: decide el admin, con tiempo límite.
        # La puerta recibe "esperar" ya (tiene 5 s para obtener respuesta) y la decisión final después, con el mismo req_id.
        nombre = usuario[0]
        vence = datetime.fromtimestamp(datetime.now().timestamp() + VENCE_S).isoformat(timespec="seconds")
        timer = threading.Timer(VENCE_S, vencer_solicitud, args=(client, sitio, req_id))
        timer.daemon = True
        e["pendientes"][req_id] = {
            "req_id": req_id, "puerta": puerta, "uid": uid, "persona": nombre, "vence": vence, "timer": timer,
        }
        timer.start()
        responder_puerta(client, sitio, puerta, req_id, "esperar", "", final=False)
        publicar_evento(client, sitio, "solicitud", puerta, nombre, uid, f"vence en {VENCE_S} s")

    publicar_estado(client, sitio)
    print(f" Lectura {req_id} uid '{uid}' en '{puerta}' procesada")


def cerrar_solicitud(client, sitio, req_id, aprobada, resultado, detalle, por=None):
    """Resuelve una solicitud pendiente. Devuelve False si ya estaba resuelta."""
    e = sitio_estado(sitio)
    sol = e["pendientes"].pop(req_id, None)
    if sol is None:
        return False
    sol["timer"].cancel()
    guardar_historial(sol["puerta"], sol["uid"], resultado)
    responder_puerta(client, sitio, sol["puerta"], req_id, "abrir" if aprobada else "denegar",
                     f"Hola {primer_nombre(sol['persona'])}" if aprobada else ("Rechazado" if por else "Sin resp. admin"),
                     por=por or "el servicio")
    if aprobada:
        marcar_acceso(sitio, sol["puerta"])
        registrar_ocupante(client, sitio, sol["puerta"], sol["uid"], sol["persona"])
    publicar_evento(client, sitio, "acceso" if aprobada else "denegado",
                    sol["puerta"], sol["persona"], sol["uid"], detalle)
    publicar_estado(client, sitio)
    return True


def vencer_solicitud(client, sitio, req_id):
    with lock:
        if cerrar_solicitud(client, sitio, req_id, False, "VENCIDO", "sin respuesta del admin"):
            print(f" Solicitud {req_id} venció")


def procesar_pedido(client, admin, datos):
    tipo = datos.get("tipo")
    if not admin.startswith("admin-"):  # defensa en profundidad: la ACL ya lo impide
        return

    if tipo == "decision":
        req_id, aprobar = datos.get("req_id"), datos.get("aprobar")
        if not isinstance(req_id, str) or not isinstance(aprobar, bool):
            return
        for sitio in list(SITIOS):
            if req_id in SITIOS[sitio]["pendientes"]:
                cerrar_solicitud(
                    client, sitio, req_id, aprobar,
                    "APROBADO" if aprobar else "RECHAZADO",
                    f"{'aprobado' if aprobar else 'rechazado'} por {admin}",
                    por=admin,
                )
                print(f" Solicitud {req_id} {'aprobada' if aprobar else 'rechazada'} por {admin}")
                return
        # Ya resuelta (otro admin, doble clic o venció): se le avisa a quien pidió
        por = YA_RESPONDIDAS.get(req_id, (None, None, None, "el servicio"))[3]
        client.publish(f"usuario/{admin}/aviso", json.dumps({"tipo": "ya_resuelta", "req_id": req_id, "por": por}), qos=1)

    elif tipo == "reconocer_alarma":
        sitio = datos.get("sitio")
        if sitio not in SITIOS:
            return
        SITIOS[sitio]["alarma"] = {"activa": False}
        publicar_alarma(client, sitio)
        publicar_evento(client, sitio, "alarma_reconocida", detalle=f"por {admin}")
        publicar_estado(client, sitio)
        print(f" Alarma de '{sitio}' reconocida por '{admin}'")


# --- MQTT ---
def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code.is_failure:
        print(f" Fallo al conectar: {reason_code}")
        return
    print(" Conectado al broker MQTT.")
    client.publish("servicio/presencia", "online", qos=1, retain=True)
    # Tras un reinicio no se sabe quién sigue dentro: se limpia lo que haya quedado retenido
    with lock:
        for sala in PERMANENCIA_S:
            if not sitio_estado(SITIO_INICIAL)["ocupantes"][sala]:
                publicar_ocupantes(client, SITIO_INICIAL, sala)
    # Se suscribe en cada conexión: si el broker se reinicia, no se pierden las suscripciones
    client.subscribe([
        ("acceso/+/puerta/+/lectura", 1),
        ("acceso/+/puerta/+/presencia", 1),
        ("usuario/+/pedido", 1),
    ])


def on_message(client, userdata, msg):
    try:
        p = msg.topic.split("/")
        texto = msg.payload.decode("utf-8")
        with lock:
            if len(p) == 5 and p[0] == "acceso" and p[2] == "puerta" and p[4] == "presencia":
                sitio, puerta, estado = p[1], p[3], texto.strip()
                if estado not in ("online", "offline"):
                    return
                info = sitio_estado(sitio)["puertas"].setdefault(puerta, {"online": None, "ultimo_acceso": None})
                info["online"] = estado == "online"
                if estado == "offline":
                    publicar_evento(client, sitio, "puerta_caida", puerta, detalle="posible sabotaje")
                publicar_estado(client, sitio)
                print(f" Puerta '{puerta}' en '{sitio}': {estado}")

            elif len(p) == 5 and p[0] == "acceso" and p[2] == "puerta" and p[4] == "lectura":
                procesar_lectura(client, p[1], p[3], json.loads(texto))

            elif len(p) == 3 and p[0] == "usuario" and p[2] == "pedido":
                procesar_pedido(client, p[1], json.loads(texto))
    except Exception as e:
        print(f" Error procesando mensaje en '{msg.topic}': {e}")


def main():
    cliente = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=USUARIO, clean_session=False)
    if CLAVE:
        cliente.username_pw_set(USUARIO, CLAVE)
    if CA:
        cliente.tls_set(ca_certs=CA)  # verifica que el certificado del broker lo firmó nuestra CA
    cliente.will_set("servicio/presencia", payload="offline", qos=1, retain=True)
    cliente.on_connect = on_connect
    cliente.on_message = on_message
    cliente.reconnect_delay_set(min_delay=1, max_delay=30)

    print(f" Iniciando Servicio Central -> {BROKER}:{PUERTO} {'(TLS)' if CA else '(sin TLS)'}")
    cliente.connect(BROKER, PUERTO, keepalive=10)
    cliente.loop_forever()


if __name__ == "__main__":
    main()
