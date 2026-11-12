# Control de acceso por MQTT: Segundo Proyecto de Sistemas Distribuidos (U.N.P.S.J.B)

Sistema de control de acceso a un edificio con dos puertas (Hall y Sala de servidores). Todos los componentes se
comunican **solo a través de un broker MQTT (EMQX)**; ninguno le habla directamente a otro. El broker, además, avisa
por webhooks a un receptor HTTP.

| Componente | Carpeta | Dónde corre | Usuario MQTT |
|---|---|---|---|
| Broker EMQX + MySQL (usuarios MQTT) | `compose-servidor-emqx.yaml` | alumno07 (`10.51.2.162`) | – |
| Servicio central (Python + SQLite) | `servicio-acceso/` | alumno04 | `servicio-central` |
| Dashboard y receptor de webhooks (Node + React) | `backend-dashboard/` | alumno06 (`10.51.2.183`) | `admin-1` |
| Servicio de salas (Python) | `servidor4-servicio-salas/` | alumno08 (`10.51.2.92`) | `servicio-salas` |
| Puertas (ESP32 con lector NFC) | `puertas-esp32/` | En el edificio, por Wi-Fi | `puerta-hall`, `puerta-servidores` |
| Relay de las puertas (`socat`) | `relay-raspberry/` | Raspberry Pi, en el Wi-Fi de las puertas y en Tailscale | – |
| App del celular (Android) | `app-android/` | Teléfono de cada usuario, con Tailscale | `celular-N` |

Documentación: [guía de configuración de EMQX](docs/guia-emqx-dashboard.md) · [ACL](docs/acl.conf) ·
[protocolo de las salas](docs/protocolo-salas.md). Cada carpeta de cliente tiene su propio README con la instalación
completa: [puertas](puertas-esp32/README.md) · [relay](relay-raspberry/README.md) ·
[servicio de salas](servidor4-servicio-salas/README.md) · [app](app-android/README.md).

Las claves, los `.env` y las claves privadas (`*.key`) **no están en el repo**. `ca.crt` sí: es pública.

---

## 1. Lado servidor

Requisitos en cada servidor: Docker con el plugin `compose`. Se levanta cada parte con `docker compose up -d`.

### 1.1 Broker (alumno07)

1. Generar la CA y el certificado del broker, con los nombres `broker.puertas` y el de Tailscale en el SAN. Los comandos
   exactos están en el [paso 1 de la guía](docs/guia-emqx-dashboard.md). Dejar `broker.crt`, `broker.key` y `ca.crt` en `./certs`.
2. Configurar el listener TLS (8883) con ese certificado y dejar el 1883 solo local ([paso 2 de la guía](docs/guia-emqx-dashboard.md)).
3. Levantar:

   ```bash
   docker compose -f compose-servidor-emqx.yaml up -d
   ```

   Levanta `emqx-lab` (broker), `mysql-lab` (MySQL 5.7, usuarios MQTT) y `phpmyadmin`. Todo con `restart: unless-stopped` y
   volúmenes (`emqx_data`, `mysql_data`), así que sobrevive a un reinicio.
4. Configurar EMQX desde el panel (`http://<servidor>:18083`). **Cambiar la clave del panel**, que viene con una por defecto:

   ```bash
   docker exec emqx-lab emqx ctl admins passwd admin '<clave-nueva-larga>'
   ```

   Después, según la [guía](docs/guia-emqx-dashboard.md):
   - **Autenticación:** primero JWT (para `admin-1`), segundo MySQL (resto de los usuarios, tabla `mqtt_user`, con la query que ata el client ID al usuario).
   - **Autorización:** backend File con el contenido de [docs/acl.conf](docs/acl.conf) y "sin coincidencia" en `deny`.
   - **Integración:** conector HTTP `receptor` (con el header `X-Token`), el webhook directo de conexiones y las reglas `seguridad`, `alarmas` y `temperatura`.

> <completar: confirmar con Alan si `compose-servidor-emqx.yaml` es el mismo archivo que corre en alumno07 (certificados, 1883 solo local) y cómo se crea la tabla `mqtt_user`.>

### 1.2 Servicio central (alumno04)

Traer el código al servidor con `git clone <url-del-repo>`, o copiar solo la carpeta con
`scp -r servicio-acceso alumno@<alumno04>:~/` (así está hoy en alumno04, sin `.git`; para actualizar hay que volver a copiar
los archivos cambiados, sin pisar `.env` ni `datos.db`).

```bash
cd servicio-acceso
cp .env.example .env        # completar: IP_BROKER=10.51.2.162, MQTT_USER=servicio-central, MQTT_PASSWORD=<clave>
python3 init_db.py          # solo si no existe datos.db: crea las tablas y los usuarios de prueba
docker compose up -d --build
docker logs -f servicio-acceso-lab    # debe decir "Conectado al broker MQTT."
```

El servicio se conecta a `broker.puertas:8883` con TLS (la IP se resuelve con `extra_hosts`) y verifica el certificado con `certs/ca.crt`.
La base `datos.db` se monta desde afuera del container: sobrevive a recrearlo. Para ver o cambiar las tarjetas y los permisos,
editar `usuarios` en `init_db.py` o directamente la base.

### 1.3 Dashboard y receptor de webhooks (alumno06)

```bash
cd backend-dashboard
cp .env.example .env
```

Completar `.env`. Los valores de abajo se generan con `openssl rand -hex 32` y se acuerdan con quien configura el broker:

| Variable | Qué es |
|---|---|
| `WEBHOOK_TOKEN` | Mismo valor que el header `X-Token` del conector HTTP de EMQX |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Login del dashboard |
| `JWT_SECRET` | Firma de la cookie de sesión del dashboard |
| `MQTT_URL` | `mqtts://broker.puertas:8883` |
| `MQTT_USER` | `admin-1` |
| `MQTT_JWT_SECRET` | Mismo secreto que el autenticador JWT de EMQX |
| `IP_LAN`, `PUERTO`, `IP_BROKER` | Ver `.env.example` |

```bash
docker compose up -d --build
docker logs -f receptor-dashboard    # debe decir "MQTT conectado a mqtts://broker.puertas:8883"
```

El dashboard se abre en `http://sd-2026.tailb9d8eb.ts.net:18106` (por Tailscale) con el `ADMIN_USER` / `ADMIN_PASSWORD` del `.env`.

### 1.4 Servicio de salas (alumno08)

Es el único dueño del ambiente de las dos salas: simula luz, cortina, aire, temperatura, aire de precisión y energía,
recibe los pedidos de los celulares, aplica las reglas y publica el estado de cada sala (retenido). El celular sólo pide;
quién está dentro de cada sala no se le cree al celular: lo publica el servicio central en `acceso/{sitio}/sala/{sala}/ocupantes`.

Corre en Docker Compose, no publica puertos (sólo sale hacia el broker) y guarda el estado de las salas en un volumen.
La clave MQTT entra como *secret* de Compose, no por `.env`. Necesita el usuario `servicio-salas` en EMQX y sus reglas,
que ya están en [docs/acl.conf](docs/acl.conf).

Despliegue, variables, reglas de cada dispositivo y cómo probarlo en local: [servidor4-servicio-salas/README.md](servidor4-servicio-salas/README.md).

---

## 2. Clientes

### Puertas (ESP32)

Cada puerta se conecta por TLS al broker con su usuario (`puerta-hall`, `puerta-servidores`) y client ID igual al usuario. Como el ESP32 no corre Tailscale,
sale por una Raspberry que hace de relay TCP (`socat :8883 → broker`), sin descifrar el TLS.

| Puerta | Placa | Lector |
|---|---|---|
| Hall | ESP32-S3-DevKitC-1 N16R8 | PN532: tarjetas y celulares con la app |
| Sala de servidores | ESP32-WROOM-32 + LCD 16x2 | RC522: sólo tarjetas |

La puerta no decide quién entra: publica la lectura, espera la orden del servicio central y obedece con LEDs, buzzer y LCD.
Si no hay servicio, red o respuesta, no abre. Usa sesión limpia: una orden de abrir que llega tarde no se ejecuta.

- Firmware (PlatformIO), cableado, cómo grabarlo y programa de prueba del hardware: [puertas-esp32/README.md](puertas-esp32/README.md).
- Instalación de la Raspberry (Tailscale, `socat`, mDNS como `relay-puertas.local`) y prueba de todo el camino sin ESP32: [relay-raspberry/README.md](relay-raspberry/README.md).

### App del celular (Android)

Hace tres cosas: es una **credencial NFC** (el teléfono responde al PN532 de la puerta Hall y la puerta lo publica como `CEL-<código>`),
recibe los **avisos de uso** de sus credenciales con la opción "No fui yo", y **controla las salas** a las que el usuario entró.
Se conecta por Tailscale (o por el relay, en el Wi-Fi del edificio) con TLS y sesión persistente, así que los avisos que
llegan con el teléfono desconectado se entregan al volver.

Cómo compilarla, instalarla y configurarla: [app-android/README.md](app-android/README.md).

### Sin hardware

Con el broker y el servicio levantados se puede simular una puerta:

```bash
cd servicio-acceso
pip install -r requirements.txt
MQTT_USER=puerta-hall MQTT_PASSWORD=<clave> MQTT_CA=certs/ca.crt BROKER_HOST=<ip-broker> BROKER_PORT=8883 python probar.py A1B2C3D4 puerta-hall
```

Imprime la orden que devuelve el servicio (`abrir`, `denegar`, `esperar` o `alarma`). Tarjetas de prueba: ver `init_db.py`.

Para el dashboard, `npm run simular` (en `backend-dashboard/`, con su `.env`) hace de servicio y de EMQX para ver las pantallas sin el resto del sistema.

---

## 3. Probar que funciona

- Pasar una tarjeta con permiso: el servicio contesta `abrir` y el dashboard muestra el acceso.
- Pasar una tarjeta sin permiso en esa puerta pero sí en otra: la solicitud aparece en el dashboard y el admin tiene 30 s para decidir.
- Pasar una tarjeta desconocida: se levanta la alarma del sitio.
- Cortar una puerta: el broker publica su Last Will (`offline`) y el dashboard la marca caída.
- Entrar por el Hall con el celular: la pestaña de la sala se habilita en la app y sus pedidos (luz, cortina, aire) cambian el estado que muestran la app y el dashboard. Un celular que no entró recibe `sin_acceso`.
- Usar la tarjeta de alguien que tiene la app: a ese celular le llega "¿Fuiste vos?"; *No fui yo* aparece como `uso_indebido` en el dashboard.
- Cortar el servicio de salas: su Last Will (`offline`) desactiva los controles en la app y en el dashboard.
- Tests del dashboard: `cd backend-dashboard && npm ci && npm test`. Las reglas de las salas tienen sus propias pruebas (ver su README).

## 4. Datos para conectarse (docentes)

Usuario `admin-docentes` para el broker y un usuario del dashboard. Las claves se entregan por el aula virtual, no están en el repo.
