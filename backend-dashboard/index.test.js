const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { crearApp } = require("./index");

const TOKEN = "secreto-de-prueba";
const ADMIN = { usuario: "admin", clave: "clave-de-prueba", secreto: "firma-de-prueba" };

// publicar: reemplaza al cliente MQTT. Por defecto anota lo publicado en `publicados`.
async function levantar(dataDir, publicar) {
  const publicados = [];
  publicar ??= async (topic, mensaje) => publicados.push({ topic, mensaje });
  const { app, eventos } = crearApp({ token: TOKEN, dataDir, admin: ADMIN, publicar });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (ruta, body, token = TOKEN) =>
    fetch(base + ruta, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
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
  return { base, post, login, eventos, publicados, cerrar };
}

test("receptor de webhooks", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receptor-"));
  const r = await levantar(dir);
  t.after(r.cerrar);

  const conexion = { event: "client.connected", clientid: "puerta_hall", timestamp: 1 };
  const pendiente = { req_id: "puerta_hall-1-1", estado: "ACCESO_PENDIENTE", uid: "A1B2C3D4" };

  await t.test("sin token o con token incorrecto responde 401", async () => {
    assert.equal((await r.post("/webhook/eventos", conexion, null)).status, 401);
    assert.equal((await r.post("/webhook/eventos", conexion, "otro")).status, 401);
    assert.equal(r.eventos.length, 0);
  });

  await t.test("payload inválido responde 400", async () => {
    assert.equal((await r.post("/webhook/eventos", "{no es json")).status, 400);
    assert.equal((await r.post("/webhook/reglas/pendientes", { estado: "ACCESO_PENDIENTE" })).status, 400);
    // Sin clientid (o no es texto) el dashboard no puede ubicar el dispositivo
    assert.equal((await r.post("/webhook/eventos", { event: "client.connected" })).status, 400);
    assert.equal((await r.post("/webhook/eventos", { event: "client.connected", clientid: 5 })).status, 400);
  });

  await t.test("guarda cada aviso una sola vez", async () => {
    assert.equal((await r.post("/webhook/eventos", conexion)).status, 200);
    assert.equal((await r.post("/webhook/reglas/pendientes", pendiente)).status, 200);
    // Reintento del broker y re-publicación QoS 1 con otro timestamp: no se duplican
    assert.deepEqual(await (await r.post("/webhook/eventos", conexion)).json(), { ok: true, duplicado: true });
    assert.equal((await r.post("/webhook/reglas/pendientes", { ...pendiente, ts: 99 })).status, 200);
    // La resolución de la misma solicitud sí se guarda
    await r.post("/webhook/reglas/pendientes", { ...pendiente, estado: "ACCESO_CONCEDIDO", via_admin: true });
    await r.post("/webhook/reglas/alertas", { clientid: "intruso", result: "deny" });
    assert.deepEqual(r.eventos.map((e) => e.tipo), ["evento", "pendiente", "pendiente", "alerta"]);
  });

  await t.test("al reiniciar recarga el log y sigue deduplicando", async () => {
    r.cerrar();
    const r2 = await levantar(dir);
    t.after(r2.cerrar);
    assert.equal(r2.eventos.length, 4);
    assert.equal((await (await r2.post("/webhook/eventos", conexion)).json()).duplicado, true);
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
  await r.post("/webhook/reglas/alertas", { clientid: "b" });
  r.cerrar();
  const r2 = await levantar(dir);
  t.after(r2.cerrar);
  assert.deepEqual(r2.eventos.map((e) => e.datos.clientid), ["a", "b"]);
});

test("stream: manda el estado al conectarse y otra vez con cada aviso nuevo", async (t) => {
  const r = await levantar(fs.mkdtempSync(path.join(os.tmpdir(), "receptor-")));
  t.after(r.cerrar);

  assert.equal((await fetch(r.base + "/stream")).status, 401);
  const { cookie } = await r.login();
  const res = await fetch(r.base + "/stream", { headers: { cookie } });
  assert.match(res.headers.get("content-type"), /^text\/event-stream/);
  const lector = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const siguiente = async () => JSON.parse((await lector.read()).value.replace(/^data: /, ""));

  assert.deepEqual(await siguiente(), { pendientes: [], dispositivos: [], alertas: [] });

  await r.post("/webhook/reglas/pendientes", { req_id: "r1", estado: "ACCESO_PENDIENTE", nombre: "Carlos" });
  const estado = await siguiente();
  assert.equal(estado.pendientes[0].nombre, "Carlos");
  assert.equal(estado.pendientes[0].estado, "pendiente");

  // Un duplicado no se vuelve a mandar
  await r.post("/webhook/reglas/pendientes", { req_id: "r1", estado: "ACCESO_PENDIENTE", nombre: "Carlos" });
  await r.post("/webhook/reglas/alertas", { clientid: "intruso" });
  assert.equal((await siguiente()).alertas[0].clientid, "intruso");
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

test("decisión del admin", async (t) => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "receptor-"));
  const r = await levantar(dir());
  t.after(r.cerrar);
  const { cookie } = await r.login();
  const decidir = (body, c = cookie) =>
    fetch(r.base + "/api/decision", {
      method: "POST",
      headers: { "content-type": "application/json", ...(c && { cookie: c }) },
      body: JSON.stringify(body),
    });

  await r.post("/webhook/reglas/pendientes", { req_id: "r1", estado: "ACCESO_PENDIENTE", ts: Date.now() });
  await r.post("/webhook/reglas/pendientes", { req_id: "viejo", estado: "ACCESO_PENDIENTE", ts: Date.now() - 60_000 });

  assert.equal((await decidir({ req_id: "r1", decision: "ACEPTAR" }, null)).status, 401);
  assert.equal((await decidir({ req_id: "r1", decision: "TAL VEZ" })).status, 400);
  assert.equal((await decidir({ req_id: "no-existe", decision: "ACEPTAR" })).status, 404);
  assert.equal((await decidir({ req_id: "viejo", decision: "ACEPTAR" })).status, 409); // vencida

  assert.equal((await decidir({ req_id: "r1", decision: "ACEPTAR" })).status, 200);
  assert.deepEqual(r.publicados, [
    { topic: "admin/decision", mensaje: { req_id: "r1", decision: "ACEPTAR", admin: "admin" } },
  ]);
  // Doble clic o segunda pestaña: no se manda otra decisión
  assert.equal((await decidir({ req_id: "r1", decision: "RECHAZAR" })).status, 409);
  assert.equal(r.publicados.length, 1);

  await t.test("si el broker falla responde 503 y se puede reintentar", async () => {
    let falla = true;
    const r2 = await levantar(dir(), async () => {
      if (falla) throw new Error("sin conexión");
    });
    t.after(r2.cerrar);
    const c2 = (await r2.login()).cookie;
    await r2.post("/webhook/reglas/pendientes", { req_id: "r2", estado: "ACCESO_PENDIENTE", ts: Date.now() });
    const intentar = () =>
      fetch(r2.base + "/api/decision", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: c2 },
        body: JSON.stringify({ req_id: "r2", decision: "RECHAZAR" }),
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
