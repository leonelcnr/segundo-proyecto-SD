const test = require("node:test");
const assert = require("node:assert");
const { calcularEstado } = require("./estado");

const T0 = Date.parse("2026-11-04T12:00:00Z");
const ev = (tipo, datos, ms = 0) => ({ tipo, recibido: new Date(T0 + ms).toISOString(), datos });


test("dispositivos: gana el evento con timestamp más nuevo, aunque llegue desordenado", () => {

  const conexion = (event, clientid, timestamp, extra) => ev("conexion", { event, clientid, timestamp, ...extra });
  const eventos = [
    conexion("client.connected", "puerta-hall", 100),
    conexion("client.connected", "puerta-servidores", 100),
    conexion("client.disconnected", "puerta-servidores", 300, { reason: "keepalive_timeout" }),
    // Llega tarde desde el buffer de EMQX: es viejo y no pisa la desconexión
    conexion("client.connected", "puerta-servidores", 200),
    ev("conexion", { event: "message.publish", clientid: "x" }),
  ];
  assert.deepEqual(calcularEstado(eventos).dispositivos, [
    { clientid: "puerta-hall", online: true, desde: new Date(100).toISOString(), motivo: undefined },
    { clientid: "puerta-servidores", online: false, desde: new Date(300).toISOString(), motivo: "keepalive_timeout" },
  ]);
});


test("alertas y alarmas: la más nueva primero", () => {

  const eventos = [
    ev("alerta", { clientid: "a", result: "deny" }),
    ev("alarma", { puerta: "puerta-hall" }),
    ev("alerta", { clientid: "b", result: "deny" }, 1000),
    ev("alarma", { puerta: "puerta-servidores" }, 1000),
  ];
  const { alertas, alarmasWebhook } = calcularEstado(eventos);
  assert.deepEqual(alertas.map((a) => a.clientid), ["b", "a"]);
  assert.deepEqual(alarmasWebhook.map((a) => a.puerta), ["puerta-servidores", "puerta-hall"]);
});
