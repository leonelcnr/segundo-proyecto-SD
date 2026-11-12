# App Android: Puerta NFC

App para Android 8 o más nuevo, con NFC. Hace tres cosas:

| Parte | Qué hace |
|---|---|
| **Credencial NFC (HCE)** | El teléfono responde al lector PN532 de la puerta Hall como si fuera una tarjeta. La puerta lo publica como `CEL-<código>`, una credencial más para el servicio central |
| **Avisos de uso** | Cliente MQTT en primer plano. Cada vez que se usa una credencial de su dueño (el teléfono o la tarjeta física), el servicio central le avisa. Si no fue este teléfono en los últimos 90 s, aparece **"¿Fuiste vos?"** con *Fui yo*, *No fui yo* y *Escribir al admin*; el reporte termina como evento `uso_indebido` en el dashboard |
| **Salas** | Una pestaña por sala. Se desbloquea cuando el servicio central confirma la entrada por la puerta y se vuelve a bloquear al vencer o al tocar **Salir**. La app **sólo pide**: las reglas las aplica el servicio de salas y lo que se dibuja es el estado que él publica |

Android no deja que una app elija el UID NFC del teléfono (inventa uno distinto en cada lectura), por eso la identidad viaja en la respuesta al `SELECT` del AID `F0 50 55 45 52 54 41`:

```text
Puerta → teléfono   00 A4 04 00 07 F0 50 55 45 52 54 41 00     SELECT AID F0 + "PUERTA"
Teléfono → puerta   <código ASCII> 90 00
Puerta → servicio   {"req_id": "...", "uid": "CEL-<código>"}
```

El código se genera al instalar (8 caracteres hexadecimales) y se puede cambiar en Ajustes. Es un código fijo: sirve para demostrar el flujo, no es una credencial resistente a la clonación.

## MQTT

Una sola conexión, con client ID = usuario (`celular-N`), **sesión persistente** (los avisos que llegan con el teléfono desconectado se entregan al volver) y TLS con la CA del broker.

| Topic | Dirección | QoS |
|---|---|---|
| `usuario/{celular}/aviso` | lee: `uso_credencial` (acceso, denegado, solicitud, salida), confirmación de `salida` | 1 |
| `usuario/{celular}/pedido` | publica: `no_fui_yo`, `salir` | 1 |
| `usuario/{celular}/control` | publica: pedidos a las salas `{"req_id", "sala", "disp", "accion", "valor", "ts"}` | 1 |
| `usuario/{celular}/respuesta` | lee: `{"req_id", "ok", "motivo", "espera_s"}` | 1 |
| `sala/+/+/estado` | lee (retenido) | 1 |
| `servicio-salas/presencia` | lee (retenido): si está `offline`, los controles se desactivan | 1 |

- Los reportes (`no_fui_yo`, `salir`) se guardan y se mandan cuando hay conexión. Los pedidos de control **no**: si no hay conexión fallan en el acto, porque una orden de "prender la luz" que llega tarde no se tiene que ejecutar.
- Un aviso repetido (QoS 1) se reconoce por su `req_id` y no se muestra dos veces.
- La clave MQTT se guarda cifrada con el Keystore de Android y nunca se vuelve a mostrar.
- El certificado se verifica contra el nombre configurado (`broker.puertas`), no contra la dirección: lo mismo que hace el ESP32 a través del relay. La conexión TLS no manda ALPN, así sslh la deriva al listener MQTT de EMQX.

## Compilar

Requisitos: JDK 17 o 21 y el SDK de Android (plataforma 35).

```bash
export JAVA_HOME=/ruta/al/jdk ANDROID_HOME=/ruta/al/Android/Sdk
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

También se puede abrir la carpeta con Android Studio.

## Instalar

- Por cable: activar *Depuración USB* en el teléfono y `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
- Sin cable: pasar el `.apk` al teléfono y abrirlo (Android pide permitir apps de origen desconocido).

## Configurar

1. Instalar **Tailscale** en el teléfono, entrar con la cuenta que ve al broker y prenderlo (con MagicDNS).
2. En la app, **Ajustes → Conexión**, elegir un perfil:

   | Perfil | Broker | Cuándo |
   |---|---|---|
   | **Tailscale** | `sd-2026.tailb9d8eb.ts.net:18107`, TLS | Desde cualquier red, con Tailscale prendido |
   | **Wi-Fi del edificio** | `relay-puertas.local:8883`, TLS | En el Wi-Fi de la Raspberry, por el relay |
   | **Prueba** | un broker local, sin TLS | Pruebas |
   | **Manual** | a mano | — |

3. **Elegir ca.crt** (el certificado de la CA del broker), usuario `celular-N` y su clave.
4. En la pantalla principal, activar **Avisos de uso y salas**. Debe decir `Conectado a …`.
5. Anotar el UID que muestra la tarjeta (`CEL-…`) y registrarlo en el servicio central asociado al usuario `celular-N`.

Si Tailscale está apagado, la app no intenta conectar y lo avisa. Conviene dejar Tailscale y esta app fuera del ahorro de batería.

## Usar

- **Puerta Hall:** con NFC prendido y la pantalla encendida, apoyar el teléfono en el lector. Vibra y la tarjeta en pantalla late cuando la puerta lo lee. La puerta Servidores (RC522) no puede leer teléfonos: ahí se usa la tarjeta.
- **Salas:** después de entrar, la pestaña de esa sala se habilita con su tiempo restante. Hall: luz e intensidad, cortina y aire acondicionado. Servidores: luz normal/ahorro, consigna del aire de precisión (sólo admin) y energía en sólo lectura. Los rechazos muestran el motivo y, si corresponde, la cuenta regresiva.
- **"¿Fuiste vos?":** *No fui yo* o *Escribir al admin* publican el reporte; el dashboard lo muestra.
