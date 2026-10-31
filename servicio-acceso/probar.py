
import json
import paho.mqtt.client as mqtt

# 1. Nos conectamos a "WhatsApp" (al broker)
cliente = mqtt.Client(client_id="simulador")
cliente.connect("localhost", 1883)

# 2. Mandamos el mensaje: "Soy la puerta hall y alguien apoyó la tarjeta A1B2C3D4"
mensaje = {"uid": "A1B2C3D4", "puerta": "puerta_hall"}
cliente.publish("puertas/puerta_hall/solicitud", json.dumps(mensaje))

print(" Mensaje enviado!")
cliente.disconnect()
