#!/bin/bash
# Uso: sudo ./instalar.sh <host del broker en Tailscale> [puerto]
set -euo pipefail

NOMBRE=relay-puertas

if [ "$(id -u)" -ne 0 ]; then
  echo "Correrlo con sudo: sudo ./instalar.sh <host del broker> [puerto]"
  exit 1
fi
BROKER="${1:?Uso: sudo ./instalar.sh <host del broker> [puerto]}"
BROKER_PUERTO="${2:-8883}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "== Paquetes"
apt-get update -qq
apt-get install -y -qq socat mosquitto-clients python3-paho-mqtt avahi-daemon tcpdump

echo "== Nombre en la red: $NOMBRE.local"
hostnamectl set-hostname "$NOMBRE"
if grep -q '^127\.0\.1\.1' /etc/hosts; then
  sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$NOMBRE/" /etc/hosts
else
  printf '127.0.1.1\t%s\n' "$NOMBRE" >> /etc/hosts
fi
# Sólo por Wi-Fi: con cable en la misma red, avahi se renombra a relay-puertas-2.local
if grep -qE '^#?allow-interfaces=' /etc/avahi/avahi-daemon.conf; then
  sed -i -E 's/^#?allow-interfaces=.*/allow-interfaces=wlan0/' /etc/avahi/avahi-daemon.conf
else
  sed -i '/^\[server\]/a allow-interfaces=wlan0' /etc/avahi/avahi-daemon.conf
fi
systemctl restart avahi-daemon

echo "== Wi-Fi sin ahorro de energia"
# Con ahorro de energía la Raspberry deja de contestar ARP y las puertas no le llegan
mkdir -p /etc/NetworkManager/conf.d
printf '[connection]\nwifi.powersave = 2\n' > /etc/NetworkManager/conf.d/relay-sin-ahorro-wifi.conf
iw dev wlan0 set power_save off 2>/dev/null || true

echo "== Relay: puerto 8883 de la Raspberry -> $BROKER:$BROKER_PUERTO"
printf 'BROKER=%s\nBROKER_PUERTO=%s\n' "$BROKER" "$BROKER_PUERTO" > /etc/default/relay-mqtt
install -m 644 "$DIR/relay-mqtt.service" /etc/systemd/system/relay-mqtt.service
systemctl daemon-reload
systemctl enable relay-mqtt
systemctl restart relay-mqtt

# Para probar desde la Raspberry con el mismo nombre que verifica el ESP32
if ! grep -qE '^127\.0\.0\.1[[:space:]].*\bbroker\.puertas\b' /etc/hosts; then
  printf '127.0.0.1\tbroker.puertas\n' >> /etc/hosts
fi

echo
systemctl --no-pager --lines=0 status relay-mqtt | head -3
if ! tailscale status >/dev/null 2>&1; then
  echo "OJO: Tailscale no esta conectado. Instalarlo y conectarlo (ver README)."
fi
if ! timeout 5 bash -c "</dev/tcp/$BROKER/$BROKER_PUERTO" 2>/dev/null; then
  echo "OJO: no llego a $BROKER:$BROKER_PUERTO (Tailscale, nombre o puerto)."
fi
echo "Destino del relay: $(tr '\n' ' ' < /etc/default/relay-mqtt)"
echo "Listo. Para ver las puertas que se conectan: journalctl -u relay-mqtt -f"
