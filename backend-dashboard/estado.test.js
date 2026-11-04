const test = require("node:test");
const assert = require("node:assert");
const { calcularEstado } = require("./estado");

const T0 = Date.parse("2026-11-04T12:00:00Z");
const ev = (tipo, datos, ms = 0) => ({ tipo, recibido: new Date(T0 + ms).toISOString(), datos });
const pendiente = { req_id: "r1", uid: "A1B2C3D4", nombre: "Carlos", puerta: "puerta_servidores", estado: "ACCESO_PENDIENTE", expira_en: 45 };

test("solicitud pendiente: vence a los expira_en segundos del ts del broker", () => {
  const eventos = [ev("pendiente", { ...pendiente, ts: T0 }, 2000)];
  const [p] = calcularEstado(eventos, T0 + 10_000).pendientes;
  assert.equal(p.estado, "pendiente");
  assert.equal(p.vence, new Date(T0 + 45_000).toISOString());
  assert.equal(p.nombre, "Carlos");
  assert.equal(calcularEstado(eventos, T0 + 45_000).pendientes[0].estado, "vencida");
});

test("sin ts ni expira_en usa la hora de recepción y 45 s", () => {
  const { expira_en, ...sinExpira } = pendiente;
  const [p] = calcularEstado([ev("pendiente", sinExpira, 1000)], T0).pendientes;
  assert.equal(p.vence, new Date(T0 + 46_000).toISOString());
});

test("la respuesta via_admin resuelve la solicitud, aunque haya vencido", () => {
  const eventos = [
    ev("pendiente", pendiente),
    ev("pendiente", { req_id: "r1", estado: "ACCESO_CONCEDIDO", via_admin: true }, 50_000),
    ev("pendiente", { ...pendiente, req_id: "r2" }, 60_000),
  ];
  const { pendientes } = calcularEstado(eventos, T0 + 61_000);
  // La más nueva primero
  assert.deepEqual(pendientes.map((p) => [p.req_id, p.estado, p.resultado]), [
    ["r2", "pendiente", undefined],
    ["r1", "resuelta", "ACCESO_CONCEDIDO"],
  ]);
  assert.equal(pendientes[1].uid, "A1B2C3D4");
});

test("si la resolución llega antes que el pendiente (reintento del broker), igual queda resuelta", () => {
  const eventos = [
    ev("pendiente", { req_id: "r1", estado: "ACCESO_DENEGADO", via_admin: true }, 5000),
    ev("pendiente", pendiente, 6000),
  ];
  const [p] = calcularEstado(eventos, T0 + 7000).pendientes;
  assert.equal(p.estado, "resuelta");
  assert.equal(p.resultado, "ACCESO_DENEGADO");
  assert.equal(p.nombre, "Carlos");
});

test("dispositivos: gana el evento con ts más nuevo, aunque llegue desordenado", () => {
  const conexion = (event, clientid, ts, extra) => ev("evento", { event, clientid, ts, ...extra });
  const eventos = [
    conexion("client.connected", "puerta_hall", 100),
    conexion("client.connected", "puerta_servidores", 100),
    conexion("client.disconnected", "puerta_servidores", 300, { reason: "keepalive_timeout" }),
    // Llega tarde desde el buffer de EMQX: es viejo y no pisa la desconexión
    conexion("client.connected", "puerta_servidores", 200),
    ev("evento", { event: "message.publish", clientid: "x" }),
  ];
  assert.deepEqual(calcularEstado(eventos).dispositivos, [
    { clientid: "puerta_hall", online: true, desde: new Date(100).toISOString(), motivo: undefined },
    { clientid: "puerta_servidores", online: false, desde: new Date(300).toISOString(), motivo: "keepalive_timeout" },
  ]);
});

test("alertas: la más nueva primero", () => {
  const eventos = [ev("alerta", { clientid: "a", result: "deny" }), ev("alerta", { clientid: "b", result: "deny" }, 1000)];
  assert.deepEqual(calcularEstado(eventos).alertas.map((a) => a.clientid), ["b", "a"]);
});
