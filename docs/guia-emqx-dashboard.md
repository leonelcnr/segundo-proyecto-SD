# Guía: configurar EMQX para el dashboard y los webhooks

> **Para quién:** quien configura el broker EMQX (Server A).
> **Qué:** lo que tiene que quedar en EMQX para que el dashboard del admin se conecte por MQTT con TLS y para que lleguen los tres webhooks al receptor (requerimiento 6).
> **Probado:** cada paso se probó el 05/11/2026 contra EMQX 6.3.2, que es la imagen `emqx/emqx:latest` del compose. Los nombres de los menús del panel pueden cambiar un poco según la versión.
> **Contrato:** sigue el documento "Protocolo MQTT del sistema de puertas" (secciones 3, 7 y 8).

## Resumen

| # | Paso | Para qué |
|---|---|---|
| 1 | Certificado firmado por la CA del grupo, **con el nombre de Tailscale del server** | Que el dashboard pueda verificar el broker |
| 2 | Listener TLS (8883) con ese certificado y sin 1883 hacia afuera | MQTT cifrado |
| 3 | Autenticación: JWT para el dashboard, usuario y clave para el resto | Nadie entra sin identificarse |
| 4 | ACL del admin | `admin-1` solo publica su pedido y lee lo que muestra el panel |
| 5 | Conector HTTP al receptor, con el header `X-Token` | Que los webhooks lleguen y el receptor los acepte |
| 6 | Webhook directo y dos reglas | Conexiones, bloqueos de la ACL y alarmas |
| 7 | Clave del panel de EMQX | Que no quede `admin` / `public` |
| 8 | Intercambio de datos | Lo que nos pasamos entre los dos |

## Red del laboratorio

`sd-2026` es la única máquina con Tailscale. Reenvía **un puerto por compu**, con el número de la compu, al puerto `18083` de esa compu: `18107` → panel de alumno07, `18106` → dashboard en alumno06 (y `221NN` → SSH). El reenvío llega a la compu por un túnel, a `127.0.0.1`: lo que se publique ahí tiene que escuchar también en localhost (en el dashboard, `IP_LAN=0.0.0.0`). El MQTT no pasa por ahí: el broker y el dashboard se hablan directo por la red del laboratorio.

| Compu | IP en el laboratorio | Rol |
|---|---|---|
| alumno07 | `10.51.2.162` | Broker EMQX (`emqx-lab`), panel por `sd-2026.tailb9d8eb.ts.net:18107` |
| alumno06 | `10.51.2.183` | Dashboard: recibe los webhooks y el navegador del admin entra por `sd-2026.tailb9d8eb.ts.net:18106` |

Probado desde alumno06: `nc -vz 10.51.2.162 8883` conecta, y `openssl s_client -connect 10.51.2.162:8883 -servername broker.puertas -verify_hostname broker.puertas -CAfile ca.crt` da `Verify return code: 0 (ok)`.

> El `18108` de `sd-2026` es el EMQX de **alumno08**: no es el nuestro.

---

## 1. Certificado del broker

Las puertas y el dashboard verifican el nombre `broker.puertas`, y Node rechaza la conexión si ese nombre no figura en el certificado (error `ERR_TLS_CERT_ALTNAME_INVALID`). El dashboard lo resuelve con `extra_hosts` en su compose (`broker.puertas` → `10.51.2.162`). `sd-2026.tailb9d8eb.ts.net` queda en el SAN por si algún día se publica el MQTT por Tailscale.

Si ya existe un `broker.crt` que solo dice `broker.puertas`, hay que volver a firmarlo. La CA (`ca.key` / `ca.crt`) se puede reutilizar, así que a las puertas no hay que cambiarles nada.

```bash
# Solo si todavía no existe la CA del grupo
openssl genrsa -out ca.key 4096
openssl req -x509 -new -key ca.key -sha256 -days 365 -subj "/CN=CA Proyecto Puertas" -out ca.crt

# Certificado del broker con los dos nombres
openssl genrsa -out broker.key 2048
openssl req -new -key broker.key -subj "/CN=broker.puertas" -out broker.csr
printf "subjectAltName=DNS:broker.puertas,DNS:sd-2026.tailb9d8eb.ts.net\nextendedKeyUsage=serverAuth\n" > san.ext
openssl x509 -req -in broker.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 365 -sha256 -extfile san.ext -out broker.crt

# Verificar: tienen que aparecer los dos nombres
openssl x509 -in broker.crt -noout -ext subjectAltName
```

- `ca.key` y `broker.key` **no van al repo** (agregarlos al `.gitignore`). `ca.crt` sí puede ir: es público.
- El container de EMQX corre con el usuario 1000, que tiene que poder leer `broker.key`: `chmod 644 broker.key`, o `chown 1000 broker.key`.

## 2. Listener TLS en el compose

En `compose-servidor-emqx.yaml`, servicio `emqx`:

```yaml
    environment:
      EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__CERTFILE: /opt/emqx/etc/certs/propios/broker.crt
      EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__KEYFILE: /opt/emqx/etc/certs/propios/broker.key
      EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__CACERTFILE: /opt/emqx/etc/certs/propios/ca.crt
    ports:
      - "127.0.0.1:1883:1883"   # sin TLS: solo desde el propio server, para pruebas
      - "8883:8883"             # MQTT con TLS
      - "8084:8084"             # WebSocket con TLS (solo si alguien lo usa)
      - "18083:18083"           # panel
    volumes:
      - emqx_data:/opt/emqx/data
      - ./certs:/opt/emqx/etc/certs/propios:ro
```

- `./certs` es la carpeta con `broker.crt`, `broker.key` y `ca.crt`.
- Si el server publica los puertos con otros números (el panel hoy está en `18107`), **pasanos el puerto que corresponde al 8883**.
- `emqx_data` se mantiene: ahí viven los usuarios, la ACL del panel, el conector y las reglas, y eso hace que sobrevivan si se recrea el container.

## 3. Autenticación: JWT para el dashboard, usuario y clave para el resto

Se crean **dos autenticadores**, y el orden importa: EMQX los prueba de arriba hacia abajo. Si la clave no es un JWT, el primero la ignora y pasa al segundo.

**3.1 JWT (primero).** **Control de acceso → Autenticación → Crear**:

| Campo | Valor |
|---|---|
| Mecanismo | **JWT** |
| JWT From | `password` |
| Algoritmo | **JWT signed using HMAC** (HS256) |
| Secret | el `MQTT_JWT_SECRET` que te pasamos **por privado** (`openssl rand -hex 32`) |
| Secret Base64 encoded | **No** |
| Disconnect After Expire | Sí (default) |
| Verify Claims | `username` = `${username}` |

- **Verify Claims** es lo que ata el token al usuario: sin eso, el JWT de `admin-1` serviría para entrar como cualquiera.
- El dashboard firma un JWT nuevo de 1 hora en cada conexión. Cuando vence, EMQX lo desconecta y el dashboard vuelve a entrar con uno nuevo. Es un corte de un segundo, y la sesión persistente guarda los mensajes QoS 1.
- `admin-1` **no** se crea como usuario: el JWT ya lo identifica.

**3.2 Usuario y clave (segundo).** **Crear** otra vez:
- Mecanismo: **Password-Based**
- Backend: **Built-in Database**
- Tipo de ID: `username`; hash: `sha256`, salt `suffix`.

En **Usuarios** de este autenticador van las puertas, el servicio y, si hace falta, un `admin-2` para probar a mano.

**Probado** contra EMQX 6.3.2 con los dos autenticadores en ese orden:

| Intento | Resultado |
|---|---|
| `admin-1` con un JWT válido | conecta |
| JWT firmado con otro secreto | `Not authorized` |
| `admin-2` usando el JWT de `admin-1` | `Bad username or password` |
| JWT vencido | `Bad username or password` |
| `puerta-hall` con su clave | conecta |
| `puerta-hall` con una clave mala | `Bad username or password` |
| Conexión anónima | `Not authorized` |

> El dashboard se conecta con **client ID = `admin-1`** y sesión persistente. Si otro cliente se conecta con el mismo client ID, EMQX echa al primero (*session takeover*). No usar `admin-1` para probar desde otra herramienta mientras el dashboard está conectado: crear `admin-2` para eso.

## 4. ACL del admin

En **Control de acceso → Autorización → File** (el `acl.conf`), estas dos reglas tienen que estar **antes** de `{deny, all}.`:

```erlang
%% Admins (dashboard): publican solo en su pedido y leen lo que muestra el panel
{allow, {username, {re, "^admin-"}}, publish, ["usuario/${username}/pedido"]}.
{allow, {username, {re, "^admin-"}}, subscribe, ["acceso/+/estado", "acceso/+/eventos", "acceso/+/alarma", "acceso/+/puerta/+/presencia", "acceso/+/puerta/+/telemetria", "servicio/presencia", "usuario/${username}/aviso"]}.
```

- En **Autorización → Configuración**, "sin coincidencia" (`no_match`) tiene que estar en **deny**.
- Se probó que con estas reglas `admin-1` no puede publicar en `usuario/admin-2/pedido`. Ese intento dispara la regla de seguridad del paso 6.

## 5. Conector HTTP al receptor

**Integración → Conectores → Crear → HTTP Server**:

| Campo | Valor |
|---|---|
| Nombre | `receptor` |
| URL | `http://10.51.2.183:18083` (alumno06; el puerto es el `PUERTO` del `.env` del dashboard) |
| Header | `X-Token` = `<WEBHOOK_TOKEN>` (te lo pasamos por privado) |
| Header | `content-type` = `application/json` |

El estado del conector tiene que quedar **Conectado**. Si queda en *connecting* o *timeout*, EMQX no llega al puerto 3000: revisar la IP, que el receptor esté corriendo y el firewall de ese server.

## 6. Webhook directo y dos reglas

Las tres usan el conector `receptor`, con método **POST** y body `${.}` (todo lo seleccionado, como JSON).

| Ruta (path de la acción) | Tipo | SQL |
|---|---|---|
| `/webhook/conexiones` | Webhook directo | `SELECT * FROM "$events/client_connected", "$events/client_disconnected"` |
| `/webhook/seguridad` | Regla | `SELECT clientid, username, topic, action, result, peerhost, timestamp FROM "$events/client_check_authz_complete" WHERE result = 'deny'` |
| `/webhook/alarmas` | Regla | `SELECT payload.puerta as puerta, payload.persona as persona, payload.detalle as detalle, timestamp FROM "acceso/+/eventos" WHERE payload.tipo = 'alarma'` |

- **Webhook directo:** se crea desde **Integración → Webhook**, eligiendo como disparadores "cliente conectado" y "cliente desconectado". EMQX arma por dentro la regla de la tabla. Si esa pantalla no está, crear la regla a mano con ese SQL.
- **Reglas:** **Integración → Reglas → Crear**, pegar el SQL y agregar como acción un *HTTP Server* con el conector `receptor` y el path de la tabla.
- Probado: el webhook directo trae el campo `event` (`client.connected` / `client.disconnected`), que el dashboard necesita; un evento de tipo `acceso` **no** dispara la regla de alarmas; la de seguridad salta tanto con una puerta que publica una orden como con un admin que publica en el pedido de otro.

## 7. Clave del panel de EMQX

El README todavía dice `admin` / `public`, y eso no puede quedar así (requerimiento 5).

```bash
docker exec emqx-lab emqx ctl admins passwd admin '<clave-nueva-larga>'
```

Después, borrar esas credenciales del README.

## 8. Intercambio de datos

**Lo que nos tenés que pasar:**

| Dato | Por dónde |
|---|---|
| `ca.crt` | Cualquiera (es público) |

**Lo que te pasamos nosotros:**

| Dato | Por dónde |
|---|---|
| IP o nombre de Tailscale del server del dashboard | Cualquiera |
| `WEBHOOK_TOKEN` (el valor del header `X-Token`) | **Por privado** |
| `MQTT_JWT_SECRET` (el secreto del autenticador JWT) | **Por privado** |

Con eso, nuestro `.env` queda así:

```bash
IP_LAN=10.51.2.183
IP_BROKER=10.51.2.162
MQTT_URL=mqtts://broker.puertas:8883
MQTT_USER=admin-1
MQTT_JWT_SECRET=<el mismo del autenticador JWT>
MQTT_CA=certs/ca.crt
```

## Cómo comprobar que quedó bien

1. **Desde nuestro lado:** al levantar el dashboard tiene que aparecer `MQTT conectado a mqtts://broker.puertas:8883`.
2. **En el panel de EMQX:** en **Clientes**, `admin-1` figura conectado.
3. **En los logs del receptor:** al conectarse cualquier cliente aparece una línea `[conexion] …`.
4. **Regla de seguridad:** con mosquitto, publicar como `admin-2` en `usuario/admin-1/pedido`. En el receptor tiene que aparecer `[alerta] …`, y en el panel de EMQX, la métrica de la regla tiene que subir.

## Errores típicos

| Lo que se ve | Causa | Arreglo |
|---|---|---|
| `Connection refused: Not authorized` | El usuario no existe o la conexión fue anónima | Paso 3 |
| `Connection refused: Bad username or password` | Clave equivocada, o JWT vencido o de otro usuario | Revisar la clave, o que `MQTT_JWT_SECRET` y Verify Claims estén bien |
| `Connection refused: Not authorized` con el dashboard | El secreto del JWT no coincide, o el autenticador JWT no está | Copiar el secreto de nuevo; paso 3.1 |
| `ERR_TLS_CERT_ALTNAME_INVALID` | El dashboard se conectó por IP o con un nombre que no está en el certificado | Usar `broker.puertas` con `IP_BROKER` (sección Red) |
| `SELF_SIGNED_CERT_IN_CHAIN` | El cliente no tiene la `ca.crt` correcta | Pasar `ca.crt` |
| `Invalid header flag bits` | Conexión sin TLS al puerto TLS | Usar `mqtts://` |
| Conector en *timeout* | EMQX no llega al receptor | IP del receptor, que esté corriendo, firewall |
| El receptor responde 401 | `X-Token` distinto de nuestro `WEBHOOK_TOKEN` | Copiar el token de nuevo |
| El dashboard se desconecta y reconecta solo | Otro cliente usa el client ID `admin-1` | Usar otro usuario para probar |
