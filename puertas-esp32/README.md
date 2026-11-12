# Puertas (ESP32)

Firmware PlatformIO de las dos puertas. La puerta **no decide** quién entra: lee la credencial, publica una lectura, espera la orden del servicio central y obedece con LEDs, buzzer y LCD. Si no hay servicio, red o respuesta, **no abre**.

| Entorno | Placa | Puerta | Programa |
|---|---|---|---|
| `puerta-servidores` | ESP32-WROOM-32 (DevKit de 38 pines) | Sala de Servidores: RC522 + LCD 16x2 I²C | Firmware |
| `puerta-hall` | ESP32-S3-DevKitC-1 N16R8 | Hall: PN532 (tarjetas y celulares con la app) | Firmware |
| `prueba-clasica` / `prueba-s3` | las mismas | — | Prueba del hardware y de la red, con menú por el monitor serie |

```text
include/pines.h             pines de cada placa
include/salidas.h           LEDs y buzzer
include/lector.h            RC522 o PN532 (el PN532 además le pide su código a la app del celular)
include/red.h               Wi-Fi, búsqueda del relay por mDNS y conexión TCP/TLS con diagnóstico
include/secretos.ejemplo.h  plantilla de secretos.h (Wi-Fi, claves MQTT y CA), que no va al repositorio
src/puerta/main.cpp         firmware de la puerta
src/pruebas/pruebas.cpp     programa de prueba
```

## MQTT

| Topic | Dirección | QoS | Retenido |
|---|---|---|---|
| `acceso/{sitio}/puerta/{puerta}/lectura` → `{"req_id", "uid"}` | publica | 1 | no |
| `acceso/{sitio}/puerta/{puerta}/orden` → `{"req_id", "accion", "mensaje"}` | lee | 1 | — |
| `acceso/{sitio}/puerta/{puerta}/presencia` → `online` / `offline` (Last Will) | publica | 1 | sí |
| `acceso/{sitio}/puerta/{puerta}/telemetria` → `{"rssi", "uptime_s", "heap_libre", "lector_ok"}` cada 30 s | publica | 0 | no |
| `acceso/{sitio}/alarma` | lee | 1 | sí |
| `servicio/presencia` | lee | 1 | sí |

- Client ID = usuario = `PUERTA_ID`. Sesión **limpia** a propósito: una orden de abrir que llega tarde no se tiene que ejecutar; al reconectar, los retenidos devuelven la alarma y el estado del servicio.
- Keepalive de 10 s: si la placa se desenchufa, el broker publica `offline` por ella.
- Sólo obedece la orden cuyo `req_id` es el de la lectura en curso; las repetidas o tardías se descartan.
- Acciones: `abrir` (verde 5 s), `denegar` y `alarma` (rojo 2 s), `esperar` (amarillo y "Espere al admin" hasta 40 s).

| Situación | LED | Buzzer | LCD |
|---|---|---|---|
| Reposo | apagados | — | `Acerque su tarjeta` |
| Consultando / esperando al admin | amarillo | — | `Consultando...` / `Espere al admin` |
| Acceso permitido | verde 5 s | pitido corto | `Acceso permitido` + nombre |
| Acceso denegado | rojo 2 s | pitido largo | `Acceso denegado` + motivo |
| Alarma | rojo parpadeando | sirena 10 s | `!! ALARMA !!` |
| Servicio caído | amarillo parpadeando | — | `Fuera de servicio` |
| Sin Wi-Fi o sin broker | rojo parpadeando | — | `Sin conexion` |
| Lector sin responder | rojo fijo | — | `Falla del lector` |

## Cómo llega al broker

Los ESP32 no pueden correr Tailscale. Se conectan por Wi-Fi a la Raspberry (`relay-puertas.local:8883`), que reenvía los bytes al broker por Tailscale (ver [`../relay-raspberry`](../relay-raspberry)). El TLS es de punta a punta: la placa abre la conexión TCP contra la IP del relay pero verifica que el certificado del broker esté firmado por la CA cargada en `CA_CERT` y tenga el nombre `broker.puertas`. El relay no puede leer ni modificar nada.

## Instalar y grabar

1. Instalar VS Code con la extensión **PlatformIO IDE** (o `pip install platformio`).
2. Crear los secretos:
   ```bash
   cp include/secretos.ejemplo.h include/secretos.h
   ```
   Completar el Wi-Fi (2,4 GHz), las claves MQTT de `puerta-hall` y `puerta-servidores`, y pegar el contenido de `ca.crt` en `CA_CERT`. Es un solo archivo para las dos puertas: cada una toma su clave según `platformio.ini`.
3. Grabar y abrir el monitor serie:
   ```bash
   pio run -e puerta-servidores -t upload
   pio device monitor -e puerta-servidores
   ```
   Al arrancar muestra el broker, si usa TLS y la versión del lector.

- Si al grabar dice `Timed out waiting for packet header`, mantener **BOOT** mientras aparece `Connecting...`. En la S3: BOOT apretado, tocar RST y soltar BOOT.
- La S3 tiene dos USB-C: usar el que dice **UART** o **COM**.

## Programa de prueba

`pio run -e prueba-clasica -t upload` (o `prueba-s3`), abrir el monitor y elegir:

| Opción | Prueba | Resultado esperado |
|---|---|---|
| `0` | Todas | Resumen con `OK` / `FALLA` por componente |
| `1` | LEDs | Verde, amarillo y rojo, 1 s cada uno |
| `2` | Buzzer | 3 pitidos |
| `3` | Lector | Versión (`RC522 0x92`, `PN532 v1.6`) y el UID de cada tarjeta |
| `4` | Bus I²C | LCD en `0x27` o `0x3F` |
| `5` | LCD (Servidores) | Escribe un texto |
| `6` | Wi-Fi | Redes visibles, conexión, IP y señal |
| `7` | Broker | Encuentra el relay, abre TCP y TLS, hace login MQTT y dice si el servicio central está en línea. Cada paso que falla dice qué revisar |
| `8` | Placa | Chip, flash y PSRAM (la N16R8 tiene que decir 16 MB y 8 MB) |

Las opciones 6 y 7 aparecen cuando existe `include/secretos.h`. Si la prueba 7 llega al final, la puerta usa exactamente el mismo camino.

## Cableado: puerta Servidores (ESP32 + RC522 + LCD)

El RC522 va a **3,3 V**; el único que va a 5 V es el VCC del LCD. Todo se conecta con la placa desenchufada.

| Componente | Conexiones |
|---|---|
| Rieles | `3V3` → riel + · `GND` → riel − |
| LEDs (con 220 Ω en serie) | Verde **25** · amarillo **26** · rojo **27** · pata corta a GND |
| Buzzer activo | `+` → **33** · `−` → GND |
| RC522 | SDA → **5** · SCK → **18** · MOSI → **23** · MISO → **19** · RST → **4** · 3.3V → riel + · GND → riel − · IRQ sin conectar |
| LCD I²C | SDA → **21** · SCL → **22** · VCC → pin **5V** · GND → riel − |

Buzzer que suena al revés: `BUZZER_ACTIVO_EN_BAJO 1`; buzzer pasivo: `BUZZER_PASIVO 1`; LCD en `0x3F`: `LCD_DIRECCION` (todo en `include/pines.h`).

## Cableado: puerta Hall (ESP32-S3 N16R8 + PN532)

En la N16R8 no se usan los GPIO 26 a 37 (flash y PSRAM octal), ni 0, 3, 45, 46, 19 y 20.

| Componente | Conexiones |
|---|---|
| LEDs (con 220 Ω) | Verde **4** · amarillo **5** · rojo **6** |
| Buzzer activo | `+` → **7** · `−` → GND |
| PN532 (modo **SPI**: llave 1 OFF, llave 2 ON) | SCK → **12** · MISO → **13** · MOSI → **11** · SS → **10** · VCC → 3,3 V · GND · IRQ y RSTO sin conectar |

### Celular como credencial

Un celular inventa un UID nuevo (que empieza con `08`) cada vez que se acerca, así que no identifica a nadie. Cuando el PN532 detecta algo que habla ISO 14443-4, le manda `SELECT AID F0 50 55 45 52 54 41` (`F0` + "PUERTA"); la app contesta su código y la puerta publica una lectura normal con `"uid": "CEL-<código>"`. Un UID aleatorio sin la app no se manda al servicio: la puerta muestra `Use tarjeta o app`. El RC522 no habla ISO 14443-4, así que la puerta Servidores sólo lee tarjetas.

## Problemas comunes

| Síntoma | Solución |
|---|---|
| No aparece el puerto serie | Otro cable (algunos sólo cargan); en Linux, agregar el usuario al grupo `dialout` o `uucp` |
| `Unable to verify flash chip connection` | Ya se graba a 115200 en la placa clásica; probar otro cable |
| La S3 no muestra nada | Usar el USB UART/COM |
| `RC522 / PN532 NO responde` | Revisar cables; el PN532, llaves en SPI con el módulo desenchufado |
| Prueba 6: no ve la red | La red tiene que ser de 2,4 GHz |
| Prueba 7: `NO lo encuentro` | La Raspberry está apagada o en otra red; se puede poner su IP en `BROKER_HOST` |
| Prueba 7: `el relay atendio pero corto` | La Raspberry no llega al broker por Tailscale |
| Prueba 7: `el certificado del broker no es de nuestra CA…` | `CA_CERT` mal pegado o el certificado del broker sin `broker.puertas` |
| Prueba 7: `rechazado … codigo 4/5` | Usuario o clave mal, o client ID distinto del usuario |
