"""Simula una puerta: manda una lectura y muestra la orden que devuelve el servicio.
Uso: python probar.py <uid> [puerta]     (ej: python probar.py A1B2C3D4 puerta-servidores)
Variables: BROKER_HOST, BROKER_PORT, MQTT_USER, MQTT_PASSWORD, MQTT_CA (broker de prueba sin ACL: no hace falta usuario)
"""
import json
import os
import sys
import time
import uuid

import paho.mqtt.client as mqtt

uid = sys.argv[1] if len(sys.argv) > 1 else "A1B2C3D4"
puerta = sys.argv[2] if len(sys.argv) > 2 else "puerta-hall"
sitio = "edificio1"
req_id = f"{puerta}-{uuid.uuid4().hex[:8]}"

c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"prueba-{puerta}")
if os.getenv("MQTT_PASSWORD"):
    c.username_pw_set(os.getenv("MQTT_USER", puerta), os.getenv("MQTT_PASSWORD"))
if os.getenv("MQTT_CA"):
    c.tls_set(ca_certs=os.getenv("MQTT_CA"))
c.on_message = lambda cl, u, m: print("ORDEN:", m.payload.decode())
c.connect(os.getenv("BROKER_HOST", "localhost"), int(os.getenv("BROKER_PORT", 1883)))
c.subscribe(f"acceso/{sitio}/puerta/{puerta}/orden", qos=1)
c.loop_start()
c.publish(f"acceso/{sitio}/puerta/{puerta}/lectura", json.dumps({"req_id": req_id, "uid": uid}), qos=1)
print(f"Lectura enviada: {req_id} uid={uid}. Esperando orden (hasta 40 s)...")
time.sleep(40)
