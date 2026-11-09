"""Servicio central de control de acceso.

Habla solo con el broker MQTT. Es el único que decide si una puerta se abre y el único
que publica el estado del sistema (lo que muestra el dashboard).

Topics:
  escucha   acceso/+/puerta/+/lectura       (puerta: {req_id, uid})
            acceso/+/puerta/+/presencia     (puerta: online/offline, Last Will)
            usuario/+/pedido                (admin: decision / reconocer_alarma; celular: no_fui_yo / salir)
  publica   acceso/{sitio}/puerta/{p}/orden (abrir / denegar)       QoS 1
            acceso/{sitio}/estado           (foto completa)         QoS 1, retenido
            acceso/{sitio}/alarma           (alarma del sitio)      QoS 1, retenido
            acceso/{sitio}/eventos          (hechos en vivo)        QoS 1
            acceso/{sitio}/sala/{s}/ocupantes (quién está dentro)   QoS 1, retenido
            usuario/{admin}/aviso           (respuesta al admin)    QoS 1
            usuario/{celular}/aviso         (uso de una credencial) QoS 1
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
# Las salas están una dentro de la otra: entrar a servidores te deja también en el hall,
# y salir del hall te saca también de servidores.
SALA_DE_AFUERA = {"servidores": "hall"}
SALE_TAMBIEN = {"hall": ["servidores"]}
PUERTA_POR_SALA = {sala: puerta for puerta, sala in SALA_POR_PUERTA.items()}
# Volver a pasar la credencial estando dentro es salir, pero sólo pasado este tiempo desde que entró:
# antes se toma como una lectura repetida (tarjeta apoyada, doble pasada) y se ignora.
MIN_SALIDA_S = int(os.getenv("MIN_SALIDA_S", 30))
SITIO_INICIAL = os.getenv("SITIO", "edificio1")  # sitio al que se le limpian los ocupantes al arrancar

# Cómo se muestra en el dashboard cada resultado guardado en la tabla historial
TIPO_POR_RESULTADO = {
    "PERMITIDO": "acceso",
    "APROBADO": "acceso",
    "DENEGADO": "denegado",
    "RECHAZADO": "denegado",
    "VENCIDO": "denegado",
    "DESCONOCIDO": "alarma",
    "SALIDA": "salida",
}

lock = threading.RLock()  # paho y los Timer corren en hilos distintos
SITIOS = {}  # sitio -> estado en memoria
YA_RESPONDIDAS = OrderedDict()  # req_id -> orden ya enviada, para repetirla si el mensaje llega duplicado
AVISADOS = OrderedDict()  # req_id -> (sitio, puerta, uid, celular, nombre): para validar los "no fui yo"


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


def buscar_celular(uid):
    """Usuario MQTT del celular del dueño de la credencial (celular-1…), o None si no tiene."""
    con = sqlite3.connect(DB)
    fila = con.execute("SELECT celular FROM usuarios WHERE uid_nfc = ?", (uid,)).fetchone()
    con.close()
    return fila[0] if fila and fila[0] else None


def migrar_db():
    """Agrega la columna celular si la base es de antes (no borra nada)."""
    con = sqlite3.connect(DB)
    columnas = [c[1] for c in con.execute("PRAGMA table_info(usuarios)")]
    if "celular" not in columnas:
        con.execute("ALTER TABLE usuarios ADD COLUMN celular TEXT")
        con.commit()
        print(" Base migrada: columna 'celular' agregada a usuarios")
    con.close()


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


def avisar_celular(client, sitio, puerta, req_id, uid, resultado, nombre=None, dentro=None, salas=None):
    """Le cuenta al celular del dueño que se usó una de sus credenciales (app Android).
    resultado: acceso | denegado | solicitud | salida. Si la persona no tiene celular, no hace nada."""
    celular = buscar_celular(uid)
    if not celular:
        return
    aviso = {"tipo": "uso_credencial", "req_id": req_id, "puerta": puerta, "uid": uid,
             "resultado": resultado, "ts": ahora(), "rol": buscar_rol(uid)}
    if dentro:
        aviso["hasta"] = dentro.get(SALA_POR_PUERTA.get(puerta))  # la sala de esta puerta
        aviso["dentro"] = dentro  # todas: entrar a servidores también te deja en el hall
    if salas:
        aviso["salas"] = salas  # salida: de qué salas salió
    client.publish(f"usuario/{celular}/aviso", json.dumps(aviso), qos=1)
    AVISADOS[req_id] = (sitio, puerta, uid, celular, nombre)
    while len(AVISADOS) > 500:
        AVISADOS.popitem(last=False)


def publicar_ocupantes(client, sitio, sala):
    """Lista completa de quién está dentro de la sala, retenida. [] = sala vacía."""
    lista = [
        {k: v for k, v in o.items() if k != "timer" and not k.startswith("_")}
        for o in sitio_estado(sitio)["ocupantes"][sala].values()
    ]
    client.publish(f"acceso/{sitio}/sala/{sala}/ocupantes", json.dumps(lista), qos=1, retain=True)


def clave_persona(uid):
    """Identidad de la persona en las salas: su celular si tiene (tarjeta y celular = una sola persona), si no la tarjeta."""
    return buscar_celular(uid) or uid


def anotar_en_sala(client, sitio, sala, clave, uid, nombre):
    """Anota (o renueva) a la persona en una sala, con su vencimiento. Devuelve el 'hasta' (ISO, hora local)."""
    dentro = sitio_estado(sitio)["ocupantes"][sala]
    previo = dentro.get(clave)
    if previo:
        previo["timer"].cancel()
    segundos = PERMANENCIA_S[sala]
    ahora_ts = datetime.now().timestamp()
    hasta = datetime.fromtimestamp(ahora_ts + segundos).isoformat(timespec="seconds")
    entrada = {
        "persona": nombre,
        "uid": uid,
        "usuario": buscar_celular(uid),  # el servicio de salas identifica a la persona por su celular
        "rol": buscar_rol(uid),
        "desde": previo["desde"] if previo else ahora(),
        "hasta": hasta,
        "vence": hasta,  # mismo valor, por compatibilidad con lo que ya lo leía así
        "_entro": previo["_entro"] if previo else ahora_ts,  # para no tomar una lectura repetida como salida
    }
    timer = threading.Timer(segundos, vencer_ocupante, args=(client, sitio, sala, clave, entrada))
    timer.daemon = True
    entrada["timer"] = timer
    dentro[clave] = entrada
    timer.start()
    publicar_ocupantes(client, sitio, sala)
    return hasta


def registrar_ocupante(client, sitio, puerta, uid, nombre):
    """Anota que la persona entró a la sala de esa puerta (y a la de afuera, si la hay).
    Devuelve {sala: hasta} con las salas donde quedó, o {} si la puerta no protege una sala."""
    sala = SALA_POR_PUERTA.get(puerta)
    if sala is None:
        return {}
    clave = clave_persona(uid)
    dentro = {sala: anotar_en_sala(client, sitio, sala, clave, uid, nombre)}
    afuera = SALA_DE_AFUERA.get(sala)
    if afuera:  # para llegar a servidores hay que estar en el hall
        dentro[afuera] = anotar_en_sala(client, sitio, afuera, clave, uid, nombre)
    return dentro


def salir(client, sitio, sala, clave):
    """Saca a la persona de la sala (y de las que están adentro de ella). Devuelve de cuáles salió."""
    salidas = []
    for s in [sala] + SALE_TAMBIEN.get(sala, []):
        entrada = sitio_estado(sitio)["ocupantes"][s].pop(clave, None)
        if entrada is not None:
            entrada["timer"].cancel()
            publicar_ocupantes(client, sitio, s)
            salidas.append(s)
    return salidas


def vencer_ocupante(client, sitio, sala, clave, entrada):
    with lock:
        dentro = sitio_estado(sitio)["ocupantes"][sala]
        if dentro.get(clave) is entrada:  # si salió y volvió a entrar, este timer ya no vale
            del dentro[clave]
            publicar_ocupantes(client, sitio, sala)
            print(f" '{clave}' salió de '{sala}' (venció su permanencia)")


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

    if usuario is not None and procesar_salida_por_puerta(client, sitio, puerta, req_id, uid, usuario[0]):
        publicar_estado(client, sitio)
        return

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
        dentro = registrar_ocupante(client, sitio, puerta, uid, nombre)
        publicar_evento(client, sitio, "acceso", puerta, nombre, uid, "directo")
        avisar_celular(client, sitio, puerta, req_id, uid, "acceso", nombre, dentro)

    elif not usuario[2]:
        # Credencial sin permiso en ninguna puerta: se deniega sin molestar al admin
        nombre = usuario[0]
        guardar_historial(puerta, uid, "DENEGADO")
        responder_puerta(client, sitio, puerta, req_id, "denegar", "No autorizado")
        publicar_evento(client, sitio, "denegado", puerta, nombre, uid, "nivel insuficiente")
        avisar_celular(client, sitio, puerta, req_id, uid, "denegado", nombre)

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
        avisar_celular(client, sitio, puerta, req_id, uid, "solicitud", nombre)

    publicar_estado(client, sitio)
    print(f" Lectura {req_id} uid '{uid}' en '{puerta}' procesada")


def procesar_salida_por_puerta(client, sitio, puerta, req_id, uid, nombre):
    """Si la persona ya está en la sala de esa puerta, volver a pasar la credencial es salir.
    No pide permiso ni admin: salir siempre se puede. Devuelve True si la lectura quedó resuelta acá."""
    sala = SALA_POR_PUERTA.get(puerta)
    clave = clave_persona(uid)
    entrada = sitio_estado(sitio)["ocupantes"].get(sala, {}).get(clave)
    if entrada is None:
        return False
    pasaron = datetime.now().timestamp() - entrada["_entro"]
    if pasaron < MIN_SALIDA_S:
        # Lectura repetida (tarjeta apoyada o doble pasada): no se entra de nuevo ni se sale
        responder_puerta(client, sitio, puerta, req_id, "denegar", "Ya ingresaste")
        print(f" Lectura {req_id} de '{uid}' ignorada: entró a '{sala}' hace {pasaron:.0f} s (< {MIN_SALIDA_S} s)")
        return True
    salidas = salir(client, sitio, sala, clave)
    guardar_historial(puerta, uid, "SALIDA")
    responder_puerta(client, sitio, puerta, req_id, "abrir", f"Chau {primer_nombre(nombre)}")
    publicar_evento(client, sitio, "salida", puerta, nombre, uid, "por la puerta: " + ", ".join(salidas))
    avisar_celular(client, sitio, puerta, req_id, uid, "salida", nombre, salas=salidas)
    print(f" '{clave}' salió por '{puerta}' de: {', '.join(salidas)}")
    return True


def salir_desde_app(client, celular, datos):
    """Pedido {"tipo": "salir", "sala": "hall"|"servidores", "req_id"} del celular: deja la sala sin pasar por la puerta."""
    sala, req_id = datos.get("sala"), datos.get("req_id")
    if sala not in PERMANENCIA_S:
        return
    salidas = []
    for sitio in list(SITIOS):
        entrada = SITIOS[sitio]["ocupantes"][sala].get(celular)
        if entrada is None:
            continue
        salidas = salir(client, sitio, sala, celular)
        puerta = PUERTA_POR_SALA[sala]
        guardar_historial(puerta, entrada["uid"], "SALIDA")
        publicar_evento(client, sitio, "salida", puerta, entrada["persona"], entrada["uid"],
                        f"desde la app ({celular}): " + ", ".join(salidas))
        publicar_estado(client, sitio)
    # Se confirma igual aunque ya no estuviera dentro (venció o se reinició el servicio): la app bloquea esas salas
    confirmadas = salidas or [sala] + SALE_TAMBIEN.get(sala, [])
    client.publish(f"usuario/{celular}/aviso",
                   json.dumps({"tipo": "salida", "req_id": req_id, "salas": confirmadas, "ts": ahora()}), qos=1)
    print(f" '{celular}' salió desde la app de: {', '.join(salidas) or '(ya no estaba dentro)'}")


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
    dentro = None
    if aprobada:
        marcar_acceso(sitio, sol["puerta"])
        dentro = registrar_ocupante(client, sitio, sol["puerta"], sol["uid"], sol["persona"])
    publicar_evento(client, sitio, "acceso" if aprobada else "denegado",
                    sol["puerta"], sol["persona"], sol["uid"], detalle)
    avisar_celular(client, sitio, sol["puerta"], req_id, sol["uid"],
                   "acceso" if aprobada else "denegado", sol["persona"], dentro)
    publicar_estado(client, sitio)
    return True


def vencer_solicitud(client, sitio, req_id):
    with lock:
        if cerrar_solicitud(client, sitio, req_id, False, "VENCIDO", "sin respuesta del admin"):
            print(f" Solicitud {req_id} venció")


def procesar_reporte_celular(client, celular, datos):
    """El dueño avisa desde la app que él no usó su credencial: se publica un evento para el dashboard."""
    if datos.get("tipo") != "no_fui_yo":
        return
    req_id = datos.get("req_id")
    avisado = AVISADOS.get(req_id) if isinstance(req_id, str) else None
    if avisado is None or avisado[3] != celular:
        # No le avisamos de ese req_id a este celular (o el servicio se reinició): no se le cree
        print(f" Reporte de '{celular}' ignorado: req_id {req_id!r} no es de una credencial suya")
        return
    sitio, puerta, uid, _, nombre = avisado
    mensaje = str(datos.get("mensaje") or "No fui yo")[:200]
    publicar_evento(client, sitio, "uso_indebido", puerta, nombre, uid, f"{celular}: {mensaje}")
    publicar_estado(client, sitio)
    print(f" !! REPORTE de '{celular}': alguien usó {uid} en '{puerta}' ({req_id}): {mensaje}")


def procesar_pedido(client, admin, datos):
    tipo = datos.get("tipo")
    if admin.startswith("celular-"):
        if tipo == "salir":
            salir_desde_app(client, admin, datos)
        else:
            procesar_reporte_celular(client, admin, datos)
        return
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
    migrar_db()
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
