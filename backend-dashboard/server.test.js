const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { crearApp } = require("./server");

const TOKEN = "secreto-de-prueba";

async function levantar(dataDir) {
  const { app, eventos } = crearApp({ token: TOKEN, dataDir });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (ruta, body, token = TOKEN) =>
    fetch(base + ruta, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { post, eventos, cerrar: () => server.close() };
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

test("no arranca sin token", () => {
  assert.throws(() => crearApp({ token: "", dataDir: os.tmpdir() }), /WEBHOOK_TOKEN/);
});
