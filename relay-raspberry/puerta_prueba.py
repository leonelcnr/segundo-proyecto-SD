#!/usr/bin/env python3
"""Simula una puerta (ESP32) desde la Raspberry para probar el relay, el TLS, la ACL y el servicio central."""
import argparse
import getpass
import json
import os
import secrets
import ssl
import sys
import threading
import time

import paho.mqtt.client as mqtt

p = argparse.ArgumentParser(description="Puerta de prueba (simula el ESP32)")
p.add_argument("--host", default="broker.puertas", help="por defecto broker.puertas (→ 127.0.0.1 en /etc/hosts)")
p.add_argument("--puerto", type=int, default=8883, help="8883 = el relay de esta Raspberry")
p.add_argument("--ca", help="ca.crt del broker. Sin --ca, se conecta sin TLS")
p.add_argument("--puerta", default="puerta-hall", choices=["puerta-hall", "puerta-servidores"])
p.add_argument("--sitio", default="edificio1")
p.add_argument("--uid", help="manda una sola lectura con este UID, espera la orden final y termina")
args = p.parse_args()

BASE = f"acceso/{args.sitio}/puerta/{args.puerta}"
T_LECTURA, T_ORDEN, T_PRESENCIA, T_TELEMETRIA = (f"{BASE}/{t}" for t in ("lectura", "orden", "presencia", "telemetria"))
T_ALARMA = f"acceso/{args.sitio}/alarma"
T_SERVICIO = "servicio/presencia"
OTRA = "puerta-servidores" if args.puerta == "puerta-hall" else "puerta-hall"

clave = None
if args.ca:
    clave = os.environ.get("CLAVE_PUERTA") or getpass.getpass(f"Clave MQTT de {args.puerta}: ")

conectada = threading.Event()
fin = threading.Event()
pendiente = {"req_id": None, "desde": 0.0}
resultado = {"accion": None}
inicio = time.monotonic()


def ahora():
    return time.strftime("%H:%M:%S")


def al_conectar(cli, _userdata, _flags, rc, *_):
    codigo = getattr(rc, "value", rc)
    if codigo != 0:
        print(f"[{ahora()}] el broker RECHAZÓ la conexión: {rc}")
        print("   → 'Not authorized' / 'Bad user name or password': clave mal, o el usuario no existe en MySQL.")
        fin.set()
        return
    print(f"[{ahora()}] conectada a {args.host}:{args.puerto} como '{args.puerta}' "
          f"({'TLS verificado con ' + args.ca if args.ca else 'SIN TLS'})")
    cli.subscribe([(T_ORDEN, 1), (T_ALARMA, 1), (T_SERVICIO, 1)])
    cli.publish(T_PRESENCIA, "online", qos=1, retain=True)
    print(f"[{ahora()}] → {T_PRESENCIA} = online (retenido)")
    conectada.set()


def al_suscribir(_cli, _userdata, _mid, codigos, *_):
    for c in codigos:
        valor = getattr(c, "value", c)
        if valor >= 0x80:
            print(f"[{ahora()}] OJO: el broker rechazó una suscripción ({c}). Revisar la ACL de ^puerta-")


def al_desconectar(_cli, _userdata, *resto):
    print(f"[{ahora()}] desconectada ({resto[-2] if len(resto) >= 2 else resto[0]})")
    conectada.clear()


def al_recibir(_cli, _userdata, msg):
    texto = msg.payload.decode(errors="replace")
    if msg.topic == T_SERVICIO:
        estado = "el servicio central está ONLINE" if texto == "online" else "servicio FUERA (la puerta mostraría 'Fuera de servicio')"
        print(f"[{ahora()}] ← servicio/presencia = {texto}  ({estado})")
        return
    try:
        datos = json.loads(texto)
    except ValueError:
        print(f"[{ahora()}] ← {msg.topic}: formato inválido: {texto!r}")
        return
    if msg.topic == T_ALARMA:
        print(f"[{ahora()}] ← ALARMA {'ACTIVA (sirena + rojo)' if datos.get('activa') else 'apagada'}: {datos}"
              f"{'  [retenido]' if msg.retain else ''}")
        return
    if datos.get("req_id") != pendiente["req_id"]:
        print(f"[{ahora()}] ← orden de otro req_id ({datos.get('req_id')}): el ESP32 la ignoraría")
        return
    demora = time.monotonic() - pendiente["desde"]
    accion = datos.get("accion")
    print(f"[{ahora()}] ← ORDEN '{accion}' en {demora:.2f} s  mensaje: {datos.get('mensaje', '')!r}")
    if accion == "esperar":
        print("            (la puerta mostraría 'Espere al admin' y aguanta 40 s: que el admin decida en el dashboard)")
        return
    pendiente["req_id"] = None
    resultado["accion"] = accion
    fin.set()


def leer(cli, uid):
    if pendiente["req_id"]:
        print("Ya hay una lectura esperando respuesta (el ESP32 tampoco manda otra)")
        return
    req_id = f"{args.puerta}-{secrets.token_hex(4)}"
    pendiente.update(req_id=req_id, desde=time.monotonic())
    cli.publish(T_LECTURA, json.dumps({"req_id": req_id, "uid": uid}), qos=1)
    print(f"[{ahora()}] → lectura {uid} (req_id {req_id}). Esperando la orden…")


def telemetria(cli):
    datos = {"rssi": -55, "uptime_s": int(time.monotonic() - inicio), "heap_libre": 200000, "lector_ok": True}
    cli.publish(T_TELEMETRIA, json.dumps(datos), qos=0)
    print(f"[{ahora()}] → telemetría {datos}")


try:
    cli = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=args.puerta, clean_session=True)
except AttributeError:
    cli = mqtt.Client(client_id=args.puerta, clean_session=True)
cli.will_set(T_PRESENCIA, "offline", qos=1, retain=True)
if args.ca:
    cli.tls_set(ca_certs=args.ca, cert_reqs=ssl.CERT_REQUIRED)
    cli.username_pw_set(args.puerta, clave)
cli.on_connect = al_conectar
cli.on_subscribe = al_suscribir
cli.on_disconnect = al_desconectar
cli.on_message = al_recibir
try:
    cli.connect(args.host, args.puerto, keepalive=10)
except ssl.SSLCertVerificationError as e:
    sys.exit(f"El certificado del broker NO se pudo verificar: {e.verify_message}\n"
             "   → ¿--ca es la CA del broker? ¿--host es 'broker.puertas' (con 127.0.0.1 en /etc/hosts)?")
except (ssl.SSLError, ConnectionError, OSError) as e:
    sys.exit(f"No pude conectar a {args.host}:{args.puerto}: {e}\n"
             "   → ¿corre el relay? systemctl status relay-mqtt · journalctl -u relay-mqtt -n 20")
cli.loop_start()

if not conectada.wait(timeout=10):
    print("No se conectó en 10 s: ver los mensajes de arriba y journalctl -u relay-mqtt -n 20")
    cli.loop_stop()
    sys.exit(1)

try:
    if args.uid:
        time.sleep(0.5)
        leer(cli, args.uid.upper())
        if not fin.wait(timeout=45):
            print("Sin orden final en 45 s: ¿está conectado el servicio central? (ver Clients en el panel)")
        codigo = 0 if resultado["accion"] else 2
    else:
        print("Escribí un UID y Enter para simular una tarjeta · t = telemetría · ajena = probar la ACL · salir")
        for linea in sys.stdin:
            comando = linea.strip()
            if comando.lower() == "salir":
                break
            if comando.lower() == "t":
                telemetria(cli)
            elif comando.lower() == "ajena":
                topic = f"acceso/{args.sitio}/puerta/{OTRA}/lectura"
                cli.publish(topic, json.dumps({"req_id": f"{OTRA}-falsa", "uid": "FALSA"}), qos=1)
                print(f"[{ahora()}] → intento publicar en {topic}. Si la ACL anda, el servicio NO lo recibe "
                      "(y EMQX puede cortar esta conexión: se reconecta sola)")
            elif comando:
                leer(cli, comando.upper())
        codigo = 0
except KeyboardInterrupt:
    codigo = 0
cli.publish(T_PRESENCIA, "offline", qos=1, retain=True).wait_for_publish(timeout=2)
cli.disconnect()
cli.loop_stop()
sys.exit(codigo)
