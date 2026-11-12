# Servicio de salas

Cliente MQTT que es el **único dueño del ambiente** de las dos salas: simula luz, cortina, aire acondicionado, temperatura, aire de precisión (CRAC) y energía; recibe los pedidos de los celulares, aplica las reglas y publica cómo queda cada sala. No publica puertos: sólo sale hacia el broker.

El celular **pide**; este servicio **decide**. Quién está dentro de cada sala no se le cree al celular: lo publica el servicio central en `acceso/{sitio}/sala/{sala}/ocupantes`.

## Topics

| Dirección | Topic | QoS | Retenido |
|---|---|---|---|
| lee | `usuario/+/control` (pedidos de los celulares) | 1 | — |
| lee | `acceso/+/sala/+/ocupantes` (quién está dentro, del servicio central) | 1 | sí |
| publica | `usuario/{celular}/respuesta` → `{"req_id", "ok", "motivo"?, "espera_s"?}` | 1 | no |
| publica | `sala/{sitio}/{sala}/estado` (sólo cuando cambia) | 1 | sí |
| publica | `sala/{sitio}/{sala}/telemetria` (cada `TELEMETRIA_CADA_S`) | 0 | no |
| publica | `sala/{sitio}/{sala}/eventos` (rechazos importantes, alarma de temperatura) | 1 | no |
| publica | `servicio-salas/presencia` (`online` / `offline` por Last Will) | 1 | sí |

Pedido de un celular:

```json
{"req_id": "c1-8f2a", "sala": "hall", "disp": "cortina", "accion": "bajar", "valor": null, "ts": "2026-11-11T19:13:01-03:00"}
```

## Reglas

| Sala | Dispositivo | Regla |
|---|---|---|
| Hall | Luz | Más de 4 cambios en 30 s → bloqueada 20 s. Rebote de 1,2 s. Intensidad 10–100 % |
| Hall | Cortina | Más de 3 órdenes en 15 s → se detiene y queda bloqueada 15 s (protege el motor) |
| Hall | Aire | Consigna 17–26 °C; más de 3 °C de cambio en 30 s → bloqueo 30 s. El compresor no rearranca antes de 3 min |
| Servidores | Refrigeración | No se puede apagar (`prohibido`, genera evento) |
| Servidores | Luz | Normal o ahorro; apagarla con gente dentro se rechaza |
| Servidores | CRAC | Sólo rol `admin`; 18–27 °C, de a 1 °C, como mucho cada 5 min |

Además: pedidos con `req_id` repetido reciben la misma respuesta sin volver a aplicarse (idempotencia frente a QoS 1), pedidos con más de `MAX_ANTIGUEDAD_S` se rechazan como `vencido`, y quien manda más de 20 pedidos en 10 s es ignorado y se publica un evento `sala_abuso`.

## Despliegue paso a paso

Requisitos: Docker con Compose, y que el servidor llegue al broker (por Tailscale o por la red del laboratorio).

1. Copiar esta carpeta al servidor:
   ```bash
   scp -r servidor4-servicio-salas <usuario>@<servidor>:~/servicio-salas
   ssh <usuario>@<servidor>
   cd ~/servicio-salas
   ```
2. Poner el certificado **público** de la CA del broker:
   ```bash
   cp /ruta/a/ca.crt certs/ca.crt
   ```
3. Poner la clave MQTT del usuario `servicio-salas` (no va en `.env` ni en variables de entorno; Compose la monta como *secret*):
   ```bash
   printf '%s' '<clave>' > secretos/mqtt_clave.txt
   chmod 600 secretos/mqtt_clave.txt
   ```
4. Configurar:
   ```bash
   cp .env.ejemplo .env
   nano .env        # BROKER_HOST tiene que ser un nombre que figure en el certificado del broker
   ```
5. Levantar:
   ```bash
   docker compose up -d --build
   docker compose logs -f
   ```
   Tiene que decir `conectado a … como servicio-salas` y `suscripto a …` para los dos topics. `docker compose ps` lo muestra `healthy` cuando está conectado.

Si el nombre del broker no resuelve dentro del contenedor, agregar en `compose.yaml` un `extra_hosts` con su IP.

### En el broker

El usuario `servicio-salas` (con client ID igual al usuario) y sus reglas del ACL (están en [`docs/acl.conf`](../docs/acl.conf), bloque "Servicio de salas") tienen que estar cargados en EMQX. Las suscripciones con comodines están autorizadas con `{eq, …}`, así que el servicio se suscribe exactamente a esos filtros y filtra el sitio al recibir.

La regla `temperatura` del motor de reglas (SQL en la [sección 5 del protocolo de las salas](../docs/protocolo-salas.md#5-webhook-temperatura-alta)) dispara un webhook al receptor cuando la sala de servidores pasa los 27 °C.

## Operación

| Qué | Cómo |
|---|---|
| Ver lo que hace | `docker compose logs -f` |
| Simular la falla del aire de precisión (la sala se calienta y salta la alarma) | `docker compose kill -s SIGUSR1 servicio-salas` |
| Repararla | `docker compose kill -s SIGUSR2 servicio-salas` |
| Reiniciar | `docker compose restart` (publica `offline`, guarda el estado y vuelve) |
| Actualizar | `docker compose up -d --build` |

El estado de las salas se guarda en el volumen `datos` cada 15 s y al apagar: sobrevive a `down`/`up` y a borrar el contenedor. `restart: unless-stopped` lo vuelve a levantar si el proceso muere.

El contenedor corre con usuario sin privilegios, disco de sólo lectura, sin *capabilities* y con límites de memoria, CPU y procesos.

## Probarlo en local, sin el broker del grupo

Con un mosquitto descartable y sin TLS:

```bash
docker run -d --rm --name mosquitto-prueba -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
cp .env.ejemplo .env
sed -i 's/^BROKER_HOST=.*/BROKER_HOST=172.17.0.1/; s/^BROKER_PUERTO=.*/BROKER_PUERTO=1883/; s/^TLS=.*/TLS=0/' .env
echo PERMITIR_SIN_TLS=1 >> .env
touch secretos/mqtt_clave.txt certs/ca.crt
docker compose up -d --build
```

`172.17.0.1` es la IP del host en la red de Docker en Linux. Después, hacer de servicio central y de celular:

```bash
HASTA=$(date -d '+10 min' --iso-8601=seconds); TS=$(date --iso-8601=seconds)
docker exec mosquitto-prueba mosquitto_pub -r -q 1 -t acceso/edificio1/sala/hall/ocupantes \
  -m "{\"ocupantes\":[{\"usuario\":\"celular-1\",\"rol\":\"empleado\",\"hasta\":\"$HASTA\"}]}"
docker exec mosquitto-prueba mosquitto_sub -t 'usuario/+/respuesta' -t 'sala/edificio1/hall/estado' -v &
docker exec mosquitto-prueba mosquitto_pub -q 1 -t usuario/celular-1/control \
  -m "{\"req_id\":\"r1\",\"sala\":\"hall\",\"disp\":\"cortina\",\"accion\":\"bajar\",\"ts\":\"$TS\"}"
```

`celular-1` recibe `{"req_id": "r1", "ok": true}` y el estado del hall muestra la cortina bajando. Repetir el mismo `req_id` devuelve la misma respuesta sin volver a aplicarlo; un `celular-2`, que no está dentro, recibe `sin_acceso`.

Para terminar: `docker compose down -v && docker rm -f mosquitto-prueba`.

## Pruebas de las reglas

No necesitan broker ni Docker:

```bash
pip install paho-mqtt==2.1.0
python3 -m unittest discover -s pruebas -v
```

## Variables de `.env`

| Variable | Por defecto | Qué es |
|---|---|---|
| `BROKER_HOST` | — | Nombre del broker; tiene que figurar en su certificado |
| `BROKER_PUERTO` | 8883 | Puerto MQTT/TLS |
| `TLS` | 1 | Sin TLS sólo arranca con `PERMITIR_SIN_TLS=1` |
| `MQTT_USUARIO` | `servicio-salas` | Usuario y client ID |
| `SITIO` | `edificio1` | Segmento `{sitio}` de los topics |
| `ZONA_HORARIA` | `America/Argentina/Buenos_Aires` | Para interpretar fechas sin zona |
| `SIMULACION_ACELERACION` | 30 | Cuántas veces más rápido cambia la temperatura simulada |
| `TELEMETRIA_CADA_S` | 5 | Período de la telemetría |
| `MAX_ANTIGUEDAD_S` | 10 | Antigüedad máxima de un pedido |
| `OCUPANTES_DESDE_AVISOS` | 0 | 1 = deducir ocupantes de `usuario/+/aviso` (pruebas sin servicio central) |
| `LOG_NIVEL` | `INFO` | Nivel de log |
