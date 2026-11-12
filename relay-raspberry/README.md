# Relay en la Raspberry Pi

Los ESP32 no pueden correr Tailscale. La Raspberry está en el mismo Wi-Fi que las puertas y además en Tailscale, así que les hace de puente: escucha en el puerto **8883** y reenvía cada conexión, byte por byte, al broker.

```text
ESP32 ──Wi-Fi──► Raspberry :8883 ──Tailscale──► sd-2026.tailb9d8eb.ts.net:18107 ──► sslh ──► EMQX :8883
                 socat: reenvía bytes,
                 no abre el TLS
```

- El **TLS es de punta a punta** entre la puerta y EMQX: la Raspberry no tiene ninguna clave y sólo ve tráfico cifrado. Si alguien la manipulara para redirigir el tráfico, la puerta rechazaría el certificado.
- Las puertas encuentran la Raspberry por mDNS como `relay-puertas.local`, aunque el hotspot le cambie la IP.
- El servicio arranca solo con la Raspberry y systemd lo reinicia si se cae.

| Archivo | Qué es |
|---|---|
| `instalar.sh` | Deja la Raspberry lista. Se puede volver a correr (por ejemplo, para cambiar el broker) |
| `relay-mqtt.service` | Servicio de systemd con `socat`; el destino lo lee de `/etc/default/relay-mqtt` |
| `puerta_prueba.py` | Se comporta como un ESP32: para probar todo el camino desde la Raspberry, sin firmware |

## Instalación paso a paso

### 1. Sistema operativo

Con **Raspberry Pi Imager**: *Raspberry Pi 4* → **Raspberry Pi OS Lite (64-bit)**. En **Editar ajustes**:

- Hostname: `relay-puertas`
- Usuario y clave a elección
- Wi-Fi: la red de **2,4 GHz** que van a usar las puertas, país `AR`
- Servicios: habilitar **SSH**

Poner la tarjeta, prender la Raspberry y esperar unos 2 minutos.

### 2. Entrar por SSH

Desde una computadora en la misma red:

```bash
ssh <usuario>@relay-puertas.local
```

Si `.local` no resuelve, buscar la IP en la lista de dispositivos del router o del hotspot. Para que recuerde una segunda red: `sudo nmcli dev wifi connect "<red>" password "<clave>"`.

### 3. Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=relay-puertas      # abrir el link y entrar con la cuenta que ve al broker
tailscale ping sd-2026.tailb9d8eb.ts.net        # tiene que contestar
```

En la consola de Tailscale, **Machines → relay-puertas → Disable key expiry**, para que no se desconecte sola a los días.

### 4. Instalar el relay

Desde la computadora:

```bash
scp -r relay-raspberry ca.crt <usuario>@relay-puertas.local:~/
```

En la Raspberry:

```bash
cd ~/relay-raspberry
sudo ./instalar.sh sd-2026.tailb9d8eb.ts.net 18107
```

El script:

1. Instala `socat`, `mosquitto-clients`, `python3-paho-mqtt`, `avahi-daemon` y `tcpdump`.
2. Fija el nombre `relay-puertas` y lo publica por mDNS sólo en `wlan0` (con cable en la misma red, avahi se renombraría a `relay-puertas-2.local`).
3. Apaga el ahorro de energía del Wi-Fi: con el ahorro prendido la Raspberry deja de contestar ARP y las puertas no le llegan.
4. Escribe el destino en `/etc/default/relay-mqtt`, instala `relay-mqtt.service`, lo habilita y lo arranca.
5. Agrega `127.0.0.1 broker.puertas` a `/etc/hosts`, para probar desde la Raspberry con el mismo nombre que verifica el ESP32.

### 5. Verificar

```bash
systemctl status relay-mqtt
openssl s_client -connect localhost:8883 -servername broker.puertas -verify_hostname broker.puertas \
  -CAfile ~/ca.crt </dev/null 2>/dev/null | grep "Verify return code"      # 0 (ok)
python3 ~/relay-raspberry/puerta_prueba.py --ca ~/ca.crt                     # pide la clave de puerta-hall
```

`puerta_prueba.py` se conecta como `puerta-hall` por el relay, publica `online` y queda esperando: escribir un UID y Enter simula una tarjeta y muestra la orden que devuelve el servicio central. `t` publica telemetría y `ajena` intenta publicar como la otra puerta (la ACL lo tiene que impedir). Si todo esto funciona, funcionan el relay, Tailscale, sslh, EMQX, el certificado, la autenticación, la ACL y el servicio central.

`nc -zv` no sirve para probar el broker de `sd-2026`: la redirección de puertos acepta siempre el TCP. La prueba real es el `openssl` de arriba.

### 6. Captura de tráfico

```bash
journalctl -u relay-mqtt -f                              # cada puerta que se conecta
sudo tcpdump -i wlan0 -w con_tls.pcap port 8883          # lo que viaja por el Wi-Fi: sólo TLS
```

## Problemas comunes

| Síntoma | Causa | Solución |
|---|---|---|
| La puerta dice `NO lo encuentro` | La Raspberry está en otra red o el hotspot bloquea mDNS | `hostname -I` en la Raspberry y poner esa IP en `BROKER_HOST` |
| `nadie contesta en …:8883` | El relay no corre | `systemctl status relay-mqtt` |
| `el relay atendio pero corto` | La Raspberry no llega al broker | `tailscale status`, `tailscale ping …`, `cat /etc/default/relay-mqtt`, `journalctl -u relay-mqtt` |
| `el certificado del broker no es de nuestra CA…` | CA equivocada o certificado sin `broker.puertas` | Revisar con el `openssl s_client` del paso 5 |
| Se desconecta de Tailscale a los días | Venció la clave del nodo | *Disable key expiry* |

## Opcional: la Raspberry como access point

Con cable de red con internet, la Raspberry puede armar la red Wi-Fi de las puertas:

```bash
sudo nmcli dev wifi hotspot ifname wlan0 con-name puertas-wifi ssid puertas-wifi band bg password "<clave>"
sudo nmcli con modify puertas-wifi connection.autoconnect yes
```

Las puertas se conectan a `puertas-wifi` y la Raspberry queda en `10.42.0.1`, que también sirve como `BROKER_HOST`.
