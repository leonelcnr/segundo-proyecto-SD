# Protocolo MQTT de las salas (propuesta)

> **Qué es:** la parte del protocolo que falta para las salas (Hall y Servidores): qué publica cada uno, en qué topic y con qué formato. Sale de la maqueta `salas-iso` y de "Arquitectura del sistema" (secciones 3 y 7).
> **Para quién:** quien hace el servicio de salas, el servicio central (publica quién está dentro), la app y el dashboard.
> **Estado:** implementado por el servicio central, el servicio de salas y la app. Nació como propuesta el 06/11/2026; el ACL vigente está en [acl.conf](acl.conf).
> **Convenciones:** las mismas del protocolo: JSON, fechas en hora local sin zona (`2026-11-06T20:31:05`), QoS 1 salvo la telemetría, client ID = usuario MQTT.

---

## 1. Quién es dueño de qué

| Dato | Dueño (el único que lo publica) | Por qué |
|---|---|---|
| Quién está dentro de cada sala y hasta cuándo | **Servicio central** | Es el que abre las puertas. El servicio de salas no le cree al celular |
| Estado de cada sala (luz, cortina, aire, temperatura) | **Servicio de salas** | Es el gemelo digital: aplica las reglas y decide |
| Qué hizo cada persona dentro de la sala | **Servicio de salas** | Es el que recibe y resuelve los pedidos |

El dashboard y la vista de salas **sólo leen**. La app **sólo pide**.

---

## 2. Topics

| # | Topic | Publica | Se suscribe | QoS | Retenido | Formato |
|---|---|---|---|---|---|---|
| S1 | `acceso/{sitio}/sala/{sala}/ocupantes` | servicio central | servicio de salas, dashboard | 1 | **sí** | [3.1](#31-ocupantes--servicio-central--servicio-de-salas-dashboard) |
| S2 | `sala/{sitio}/{sala}/estado` | servicio de salas | app, dashboard, vista | 1 | **sí** | [3.2](#32-estado-de-la-sala--servicio-de-salas--todos) |
| S3 | `sala/{sitio}/{sala}/telemetria` | servicio de salas | dashboard, regla de EMQX | **0** | no | [3.3](#33-telemetria--servicio-de-salas--dashboard-y-regla) |
| S4 | `sala/{sitio}/{sala}/eventos` | servicio de salas | dashboard | 1 | no | [3.4](#34-eventos-de-la-sala--servicio-de-salas--dashboard) |
| S5 | `servicio-salas/presencia` | servicio de salas **y el broker** (Last Will) | app, dashboard, vista | 1 | **sí** | texto: `online` / `offline` |
| S6 | `usuario/{celular}/control` | esa app | servicio de salas | 1 | no | [3.5](#35-control-y-respuesta--app--servicio-de-salas) |
| S7 | `usuario/{celular}/respuesta` | servicio de salas | esa app | 1 | no | [3.5](#35-control-y-respuesta--app--servicio-de-salas) |

- `{sala}` = `hall` o `servidores`. `{sitio}` = el mismo de las puertas (`edificio1`).
- **Cambio respecto de la maqueta:** la maqueta publica `sala_rechazo` en `acceso/{sitio}/eventos`. Proponemos un topic propio (S4), así cada servicio publica sólo en lo suyo y la ACL lo puede garantizar. `acceso/{sitio}/eventos` sigue siendo sólo del servicio central.

---

## 3. Mensajes

### 3.1 `ocupantes` · servicio central → servicio de salas, dashboard

Lista completa de quién está dentro. **Retenido:** el servicio de salas sabe a quién obedecer apenas arranca.

```json
[
  {"persona": "Ana", "usuario": "celular-1", "rol": "empleado", "desde": "2026-11-06T14:32:10", "vence": "2026-11-06T14:47:10"}
]
```

- Se publica **completa** cada vez que alguien entra o vence su permanencia (Hall 15 min, Servidores 10 min). Lista vacía `[]` = sala vacía.
- `usuario` es el usuario MQTT del celular de esa persona, o `null` si entró con tarjeta y no tiene app.

### 3.2 `estado` de la sala · servicio de salas → todos

Foto completa de la sala. **Retenido.** Se publica cada vez que algo cambia (y la temperatura, como mucho cada 10 s).

**Hall:**
```json
{"luz": true, "nivel": 80, "cortina": 35, "cortina_objetivo": 35,
 "clima": true, "modo": "frio", "consigna": 23.0, "temp": 25.7,
 "bloqueos": {"luz": "2026-11-06T14:33:00"}, "ts": "2026-11-06T14:32:40"}
```

**Servidores:**
```json
{"luz": "normal", "consigna": 22.0, "temp": 22.6, "kw": 4.2, "falla_crac": false, "alarma": false,
 "bloqueos": {}, "ts": "2026-11-06T14:32:40"}
```

| Campo | Qué es |
|---|---|
| `luz` | Hall: encendida (`true`/`false`). Servidores: `"normal"` o `"ahorro"` |
| `nivel` | Intensidad de la luz del Hall, 0 a 100 |
| `cortina` / `cortina_objetivo` | Porcentaje cerrada ahora / hacia dónde va (si son distintos, se está moviendo) |
| `clima`, `modo`, `consigna` | Aire del Hall: encendido, `"frio"`/`"calor"` y temperatura pedida |
| `temp` | Temperatura actual en °C |
| `kw`, `falla_crac`, `alarma` | Servidores: consumo, si el aire de precisión falla y si está por encima de 27 °C |
| `bloqueos` | Control bloqueado por abuso y hasta cuándo. Vacío si no hay ninguno |

### 3.3 `telemetria` · servicio de salas → dashboard y regla

```json
{"temp": 27.4, "ts": "2026-11-06T14:40:10"}
```

Cada 10 s. **QoS 0**, como la telemetría de las puertas: si se pierde una, llega la siguiente. Es la que mira la **regla de EMQX** de la [sección 5](#5-webhook-temperatura-alta).

### 3.4 `eventos` de la sala · servicio de salas → dashboard

```json
{"tipo": "sala_accion", "persona": "Ana", "usuario": "celular-1", "disp": "cortina", "accion": "bajar", "valor": null,
 "ts": "2026-11-06T14:33:12", "detalle": "cortina 35 % → 100 %"}
```

| `tipo` | Cuándo | `detalle` (ejemplo) |
|---|---|---|
| `sala_accion` | Se hizo lo que pidió alguien de adentro | `"luz 80 % → 45 %"`, `"aire 23 → 21 °C"` |
| `sala_rechazo` | Se rechazó un pedido por una regla | `"5 cambios de luz en 30 s: bloqueada 20 s"`, `"no está dentro"` |
| `alarma_ambiente` | La sala de servidores pasó los 27 °C | `"27.4 °C, falla del aire de precisión"` |
| `alarma_ambiente_fin` | Volvió por debajo de 26 °C | `"25.9 °C"` |

Es lo que muestra el dashboard como "lo que hacen los usuarios dentro de cada sala". Los nombres `tipo`, `persona` y `detalle` coinciden con los de `acceso/{sitio}/eventos`, así el dashboard los muestra igual.

### 3.5 `control` y `respuesta` · app ↔ servicio de salas

```json
{"req_id": "celular-1-0007", "sala": "hall", "disp": "cortina", "accion": "bajar"}
```
```json
{"req_id": "celular-1-0007", "ok": false, "motivo": "bloqueado 18 s"}
```

- `disp`: `luz`, `cortina`, `clima` (Hall) o `luz`, `crac` (Servidores). `accion` y `valor` según el control (`encender`, `nivel` + 45, `bajar`, `consigna` + 21…).
- Idempotente por `req_id`, como el resto del protocolo.
- El dashboard **no** los lee: son de cada persona y la ACL sólo deja leerlos a su dueño.

---

## 4. ACL (agregar antes de `{deny, all}`)

```erlang
%% Servicio de salas
{allow, {username, "servicio-salas"}, subscribe, ["usuario/+/control", "acceso/+/sala/+/ocupantes"]}.
{allow, {username, "servicio-salas"}, publish, ["sala/+/+/estado", "sala/+/+/telemetria", "sala/+/+/eventos", "servicio-salas/presencia", "usuario/+/respuesta"]}.

%% Servicio central: además de lo que ya tiene, publica quién está dentro
{allow, {username, "servicio-central"}, publish, ["acceso/+/sala/+/ocupantes"]}.

%% Admins (dashboard): leen las salas
{allow, {username, {re, "^admin-"}}, subscribe, ["acceso/+/sala/+/ocupantes", "sala/+/+/estado", "sala/+/+/telemetria", "sala/+/+/eventos", "servicio-salas/presencia"]}.

%% Celulares: piden y leen su respuesta y el estado de las salas
{allow, {username, {re, "^celular-"}}, publish, ["usuario/${username}/control"]}.
{allow, {username, {re, "^celular-"}}, subscribe, ["usuario/${username}/respuesta", "sala/+/+/estado", "servicio-salas/presencia"]}.
```

Usuario nuevo en MySQL: `servicio-salas`.

---

## 5. Webhook: temperatura alta

Regla de EMQX (requisito 6, webhook por regla):

```sql
SELECT payload.temp as temp, topic, timestamp FROM "sala/+/servidores/telemetria" WHERE payload.temp > 27
```

Acción HTTP Server con el conector `receptor`, path **`/webhook/ambiente`**, `POST`, body `${.}`.

- Mientras la sala siga caliente, llega un aviso por cada telemetría (cada 10 s). El dashboard los agrupa y muestra una sola alerta por sala, con la última temperatura.
- Es lo que se muestra en la defensa con "simular falla del aire de precisión": la sala se calienta y el aviso llega al receptor sin que ningún componente le hable a otro.

---

## 6. Preguntas abiertas

- ¿La consigna de la sala de servidores la cambia un admin **desde la app** (usuario con rol admin) o **desde el dashboard**? Si es desde el dashboard, hace falta un pedido nuevo en `usuario/{admin}/pedido` (`{"tipo":"consigna_servidores","valor":21}`).
- ¿Los topics de control quedan como `control`/`respuesta` (maqueta) o se unifican con `pedido`/`aviso` del celular (protocolo 4.10 y 4.11)?
- ¿Cada cuánto publica `estado` mientras la cortina se mueve? Proponemos cada 1 s mientras se mueve y al llegar.
