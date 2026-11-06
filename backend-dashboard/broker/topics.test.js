const test = require("node:test");
const assert = require("node:assert");
const { crearMemoria, aplicar, vista } = require("./topics");

const AHORA = "2026-11-04T23:00:00.000Z";
const recibir = (m, topic, datos) => aplicar(m, topic, typeof datos === "string" ? datos : JSON.stringify(datos), AHORA);
// Las fechas del protocolo son hora local sin zona
const local = (texto) => new Date(texto).toISOString();


test("presencia: texto plano de una puerta y del servicio", () => {

  const m = crearMemoria();
  assert.equal(recibir(m, "acceso/edificio1/puerta/puerta-hall/presencia", "online"), true);
  assert.equal(recibir(m, "servicio/presencia", "offline"), true);
  assert.deepEqual(vista(m).presencia, [
    { nombre: "puerta-hall", sitio: "edificio1", online: true, desde: AHORA },
    { nombre: "servicio", sitio: null, online: false, desde: AHORA },
  ]);
  // Ni JSON ni otro texto
  assert.equal(recibir(m, "servicio/presencia", "caida"), false);
});


test("ignora topics desconocidos y payloads que no son un objeto JSON", () => {

  const m = crearMemoria();
  assert.equal(recibir(m, "acceso/edificio1/puerta/puerta-hall/lectura", { uid: "x" }), false);
  assert.equal(recibir(m, "acceso/edificio1/estado", "no es json"), false);
  assert.equal(recibir(m, "acceso/edificio1/estado", "[1,2]"), false);
  // Retenido borrado (payload vacío)
  assert.equal(recibir(m, "acceso/edificio1/alarma", ""), false);
  assert.deepEqual(vista(m).pendientes, []);
});


test("pendientes salen del estado retenido, con vence en ISO y creada 30 s antes", () => {

  const m = crearMemoria();
  recibir(m, "acceso/edificio1/estado", {
    puertas: {},
    pendientes: [{ req_id: "puerta-servidores-9c1e0b7a", puerta: "puerta-servidores", persona: "Beto", vence: "2026-11-04T20:32:10" }],
  });
  const [s] = vista(m).pendientes;
  assert.equal(s.sitio, "edificio1");
  assert.equal(s.persona, "Beto");
  assert.equal(s.vence, local("2026-11-04T20:32:10"));
  assert.equal(Date.parse(s.vence) - Date.parse(s.creada), 30_000);

  // El estado siguiente ya no la trae: se resolvió
  recibir(m, "acceso/edificio1/estado", { pendientes: [] });
  assert.deepEqual(vista(m).pendientes, []);
});


test("eventos en vivo y del historial, sin repetir y el más nuevo primero", () => {

  const m = crearMemoria();
  const acceso = { tipo: "acceso", puerta: "puerta-hall", persona: "Ana", uid: "31A7506E", ts: "2026-11-04T20:31:05", detalle: "directo" };
  const viejo = { ...acceso, ts: "2026-11-04T20:00:00" };
  recibir(m, "acceso/edificio1/estado", { historial: [acceso, viejo, "…"] });
  recibir(m, "acceso/edificio1/eventos", acceso);
  const nuevo = { tipo: "alarma", puerta: "puerta-servidores", ts: "2026-11-04T20:40:00", detalle: "tarjeta desconocida" };
  recibir(m, "acceso/edificio1/eventos", nuevo);
  assert.deepEqual(vista(m).eventos.map((e) => [e.tipo, e.ts]), [
    ["alarma", local(nuevo.ts)],
    ["acceso", local(acceso.ts)],
    ["acceso", local(viejo.ts)],
  ]);
});


test("alarma, telemetría y avisos", () => {

  const m = crearMemoria();
  recibir(m, "acceso/edificio1/alarma", { activa: true, puerta: "puerta-servidores", motivo: "tarjeta desconocida", desde: "2026-11-04T20:31:05" });
  recibir(m, "acceso/edificio1/puerta/puerta-hall/telemetria", { rssi: -53, lector_ok: false });
  recibir(m, "usuario/admin-1/aviso", { tipo: "ya_resuelta", req_id: "r1", por: "admin-2" });
  const v = vista(m);
  assert.deepEqual(v.alarmas, [{ activa: true, puerta: "puerta-servidores", motivo: "tarjeta desconocida", desde: local("2026-11-04T20:31:05"), sitio: "edificio1" }]);
  assert.deepEqual(v.telemetria, [{ rssi: -53, lector_ok: false, puerta: "puerta-hall", sitio: "edificio1", recibida: AHORA }]);
  assert.equal(v.avisos[0].por, "admin-2");

  // Apagada: también llega retenida y reemplaza a la anterior
  recibir(m, "acceso/edificio1/alarma", { activa: false });
  assert.equal(vista(m).alarmas[0].activa, false);
});


test("salas: ocupantes, estado y telemetría se juntan por sala", () => {

  const m = crearMemoria();
  const ana = { persona: "Ana", usuario: "celular-1", rol: "empleado", desde: "2026-11-06T14:32:10", vence: "2026-11-06T14:47:10" };
  assert.equal(recibir(m, "acceso/edificio1/sala/hall/ocupantes", [ana, "…"]), true);
  assert.equal(recibir(m, "sala/edificio1/hall/estado", { luz: true, nivel: 80, ts: "2026-11-06T14:32:40" }), true);
  assert.equal(recibir(m, "sala/edificio1/servidores/telemetria", { temp: 27.4, ts: "2026-11-06T14:40:10" }), true);
  // ocupantes tiene que ser una lista y la telemetría traer temp numérica
  assert.equal(recibir(m, "acceso/edificio1/sala/hall/ocupantes", { persona: "Ana" }), false);
  assert.equal(recibir(m, "sala/edificio1/servidores/telemetria", { temp: "27" }), false);

  assert.deepEqual(vista(m).salas, [
    { sitio: "edificio1", sala: "hall", estado: { luz: true, nivel: 80, ts: local("2026-11-06T14:32:40") }, temp: null,
      ocupantes: [{ ...ana, desde: local(ana.desde), vence: local(ana.vence) }] },
    { sitio: "edificio1", sala: "servidores", estado: null, ocupantes: [], temp: { valor: 27.4, recibida: AHORA } },
  ]);

  // Sala vacía: lista vacía
  recibir(m, "acceso/edificio1/sala/hall/ocupantes", []);
  assert.deepEqual(vista(m).salas[0].ocupantes, []);
});


test("salas: los eventos van con los de las puertas y el servicio de salas tiene presencia", () => {

  const m = crearMemoria();
  recibir(m, "acceso/edificio1/eventos", { tipo: "acceso", puerta: "puerta-hall", persona: "Ana", ts: "2026-11-06T14:32:10" });
  recibir(m, "sala/edificio1/hall/eventos", { tipo: "sala_accion", persona: "Ana", disp: "cortina", ts: "2026-11-06T14:33:12", detalle: "cortina 35 % → 100 %" });
  assert.deepEqual(vista(m).eventos.map((e) => [e.tipo, e.sala]), [["sala_accion", "hall"], ["acceso", undefined]]);

  assert.equal(recibir(m, "servicio-salas/presencia", "online"), true);
  assert.deepEqual(vista(m).presencia, [{ nombre: "servicio-salas", sitio: null, online: true, desde: AHORA }]);
});
