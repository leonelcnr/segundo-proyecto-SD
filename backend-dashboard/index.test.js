const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { crearApp } = require("./index");
const { aplicar } = require("./broker/topics");

const TOKEN = "secreto-de-prueba";
const ADMIN = { usuario: "admin", clave: "clave-de-prueba", secreto: "firma-de-prueba" };

// publicar: reemplaza al cliente MQTT. Por defecto anota los pedidos publicados en `publicados`.
async function levantar(dataDir, publicar) {

  const publicados = [];
  publicar ??= async (mensaje) => publicados.push(mensaje);
  const { app, eventos, memoria, avisarCambio } = crearApp({ token: TOKEN, dataDir, admin: ADMIN, publicar });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = (ruta, body, token = TOKEN) =>
    fetch(base + ruta, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token && { "x-token": token }) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  const cerrar = () => {
    server.close();
    server.closeAllConnections(); // los streams SSE quedan abiertos si no
  };

  // Inicia sesión y devuelve la cookie con el JWT
  const login = async (username = ADMIN.usuario, password = ADMIN.clave) => {
    const res = await post("/login", { username, password }, null);
    return { status: res.status, cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
  };


    // Simula un mensaje MQTT que llega al dashboard
  const mqtt = (topic, datos) => aplicar(memoria, topic, typeof datos === "string" ? datos : JSON.stringify(datos)) && avisarCambio();

  return { base, post, login, eventos, mqtt, publicados, cerrar };
}


test("receptor de webhooks", async (t) => {

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receptor-"));
  const r = await levantar(dir);
  t.after(r.cerrar);

  const conexion = { event: "client.connected", clientid: "puerta-hall", timestamp: 1 };
  const alarma = { puerta: "puerta-servidores", persona: "Beto", detalle: "tarjeta desconocida", timestamp: 2 };

  await t.test("sin X-Token o con uno incorrecto responde 401", async () => {
    assert.equal((await r.post("/webhook/conexiones", conexion, null)).status, 401);
    assert.equal((await r.post("/webhook/conexiones", conexion, "otro")).status, 401);
    assert.equal(r.eventos.length, 0);
  });

  await t.test("payload inválido responde 400", async () => {
    assert.equal((await r.post("/webhook/conexiones", "{no es json")).status, 400);
    // Sin clientid (o no es texto) el dashboard no puede ubicar el dispositivo
    assert.equal((await r.post("/webhook/conexiones", { event: "client.connected" })).status, 400);
    assert.equal((await r.post("/webhook/conexiones", { event: "client.connected", clientid: 5 })).status, 400);
    assert.equal((await r.post("/webhook/alarmas", { persona: "Beto" })).status, 400);
  });

  await t.test("guarda cada aviso una sola vez", async () => {
    assert.equal((await r.post("/webhook/conexiones", conexion)).status, 200);
    assert.equal((await r.post("/webhook/alarmas", alarma)).status, 200);
    // Reintento del broker: no se duplica
    assert.deepEqual(await (await r.post("/webhook/conexiones", conexion)).json(), { ok: true, duplicado: true });
    await r.post("/webhook/seguridad", { clientid: "intruso", result: "deny" });
    assert.deepEqual(r.eventos.map((e) => e.tipo), ["conexion", "alarma", "alerta"]);
  });

  await t.test("al reiniciar recarga el log y sigue deduplicando", async () => {
    r.cerrar();
    const r2 = await levantar(dir);
    t.after(r2.cerrar);
    assert.equal(r2.eventos.length, 3);
    assert.equal((await (await r2.post("/webhook/conexiones", conexion)).json()).duplicado, true);
  });
});


test("arranca aunque la última línea del log haya quedado cortada", async (t) => {

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receptor-"));
  const sano = { tipo: "alerta", recibido: new Date().toISOString(), datos: { clientid: "a" } };
  fs.writeFileSync(path.join(dir, "eventos.jsonl"), JSON.stringify(sano) + '\n{"tipo":"aler');
  const r = await levantar(dir);
  t.after(r.cerrar);
  assert.equal(r.eventos.length, 1);

  // El aviso siguiente queda en su propia línea y se puede volver a leer
  await r.post("/webhook/seguridad", { clientid: "b" });
  r.cerrar();
  const r2 = await levantar(dir);
  t.after(r2.cerrar);
  assert.deepEqual(r2.eventos.map((e) => e.datos.clientid), ["a", "b"]);

});

test("stream: manda el estado al conectarse y otra vez con cada novedad", async (t) => {

  const r = await levantar(fs.mkdtempSync(path.join(os.tmpdir(), "receptor-")));
  t.after(r.cerrar);

  assert.equal((await fetch(r.base + "/stream")).status, 401);
  const { cookie } = await r.login();
  const res = await fetch(r.base + "/stream", { headers: { cookie } });
  assert.match(res.headers.get("content-type"), /^text\/event-stream/);
  const lector = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const siguiente = async () => JSON.parse((await lector.read()).value.replace(/^data: /, ""));

  assert.deepEqual(await siguiente(), {
    dispositivos: [], alertas: [], alarmasWebhook: [],
    pendientes: [], eventos: [], alarmas: [], presencia: [], telemetria: [], avisos: [],
  });

  // Webhook
  await r.post("/webhook/seguridad", { clientid: "intruso" });
  assert.equal((await siguiente()).alertas[0].clientid, "intruso");
  // Un duplicado no se vuelve a mandar; lo que sigue es lo que llega por MQTT
  await r.post("/webhook/seguridad", { clientid: "intruso" });
  r.mqtt("servicio/presencia", "online");
  assert.equal((await siguiente()).presencia[0].online, true);

  // Mensaje que no es del protocolo: no se manda nada
  r.mqtt("acceso/edificio1/estado", "no es json");
  r.mqtt("acceso/edificio1/alarma", { activa: true, puerta: "puerta-hall" });
  assert.equal((await siguiente()).alarmas[0].activa, true);
  await lector.cancel();

});

test("login del admin", async (t) => {

  const r = await levantar(fs.mkdtempSync(path.join(os.tmpdir(), "receptor-")));
  t.after(r.cerrar);
  const me = (cookie) => fetch(r.base + "/me", { headers: cookie ? { cookie } : {} });

  assert.equal((await r.post("/login", { username: "admin" }, null)).status, 400);
  assert.equal((await r.login("admin", "otra")).status, 401);
  assert.equal((await r.login("otro", ADMIN.clave)).status, 401);
  assert.equal((await me()).status, 401);
  assert.equal((await me("token=inventado")).status, 401);

  const { status, cookie } = await r.login();
  assert.equal(status, 200);
  assert.deepEqual(await (await me(cookie)).json(), { username: "admin" });

  // Un JWT firmado con otra clave no sirve
  const jwt = require("jsonwebtoken");
  assert.equal((await me(`token=${jwt.sign({ username: "admin" }, "otra-firma")}`)).status, 401);

  // logout borra la cookie
  const salida = await fetch(r.base + "/logout", { method: "POST", headers: { cookie } });
  assert.match(salida.headers.get("set-cookie"), /token=;/);
});

test("decisión del admin y alarma", async (t) => {

  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "receptor-"));
  const r = await levantar(dir());
  t.after(r.cerrar);
  const { cookie } = await r.login();
  const pedir = (ruta, body, c = cookie) =>
    fetch(r.base + ruta, {
      method: "POST",
      headers: { "content-type": "application/json", ...(c && { cookie: c }) },
      body: JSON.stringify(body),
    });
  const decidir = (body, c) => pedir("/api/decision", body, c);
  // Hora local sin zona, como la manda el servicio
  const local = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

  r.mqtt("acceso/edificio1/estado", {
    pendientes: [
      { req_id: "r1", puerta: "puerta-servidores", persona: "Beto", vence: local(Date.now() + 20_000) },
      { req_id: "viejo", puerta: "puerta-servidores", persona: "Ana", vence: local(Date.now() - 5_000) },
    ],
  });

  assert.equal((await decidir({ req_id: "r1", aprobar: true }, null)).status, 401);
  assert.equal((await decidir({ req_id: "r1", aprobar: "si" })).status, 400);
  assert.equal((await decidir({ req_id: "no-existe", aprobar: true })).status, 404);
  assert.equal((await decidir({ req_id: "viejo", aprobar: true })).status, 409); // vencida

  assert.equal((await decidir({ req_id: "r1", aprobar: true })).status, 200);
  assert.deepEqual(r.publicados, [{ tipo: "decision", req_id: "r1", aprobar: true }]);
  // Doble clic o segunda pestaña: no se manda otra decisión
  assert.equal((await decidir({ req_id: "r1", aprobar: false })).status, 409);
  assert.equal(r.publicados.length, 1);

  // Alarma: solo se reconoce si está activa
  assert.equal((await pedir("/api/alarma/reconocer", { sitio: "edificio1" })).status, 409);
  r.mqtt("acceso/edificio1/alarma", { activa: true, puerta: "puerta-hall", motivo: "tarjeta desconocida" });
  assert.equal((await pedir("/api/alarma/reconocer", { sitio: "edificio1" })).status, 200);
  assert.deepEqual(r.publicados[1], { tipo: "reconocer_alarma", sitio: "edificio1" });

  await t.test("si el broker falla responde 503 y se puede reintentar", async () => {
    let falla = true;
    const r2 = await levantar(dir(), async () => {
      if (falla) throw new Error("sin conexión");
    });
    t.after(r2.cerrar);
    const c2 = (await r2.login()).cookie;
    r2.mqtt("acceso/edificio1/estado", { pendientes: [{ req_id: "r2", vence: local(Date.now() + 20_000) }] });
    const intentar = () =>
      fetch(r2.base + "/api/decision", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: c2 },
        body: JSON.stringify({ req_id: "r2", aprobar: false }),
      });
    assert.equal((await intentar()).status, 503);
    falla = false;
    assert.equal((await intentar()).status, 200);
  });
});

test("no arranca sin token", () => {
  assert.throws(() => crearApp({ token: "", dataDir: os.tmpdir(), admin: ADMIN }), /WEBHOOK_TOKEN/);
  assert.throws(() => crearApp({ token: TOKEN, dataDir: os.tmpdir(), admin: { ...ADMIN, clave: "" } }), /ADMIN_PASSWORD/);
});
