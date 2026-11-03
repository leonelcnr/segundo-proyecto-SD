const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

// Cada aviso del broker se guarda como una línea JSON: {tipo, recibido, datos}
function crearApp({ token, dataDir }) {
  if (!token) throw new Error("Falta WEBHOOK_TOKEN");

  fs.mkdirSync(dataDir, { recursive: true });
  const archivo = path.join(dataDir, "eventos.jsonl");
  const eventos = fs.existsSync(archivo)
    ? fs.readFileSync(archivo, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

  // EMQX reintenta si no le respondemos a tiempo, así que el mismo aviso puede llegar dos veces.
  // Una solicitud pendiente se identifica por req_id + estado (QoS 1 puede re-publicarla con otro timestamp);
  // el resto de los avisos, por su contenido exacto.
  const clave = (tipo, datos) =>
    tipo === "pendiente" ? `${tipo}|${datos.req_id}|${datos.estado}` : `${tipo}|${JSON.stringify(datos)}`;
  // shortcut: el log y las claves viven enteros en memoria y en un solo archivo; rotar si pasa de unos pocos MB.
  const vistos = new Set(eventos.map((e) => clave(e.tipo, e.datos)));

  const esperado = Buffer.from(`Bearer ${token}`);
  const autorizado = (req) => {
    const recibido = Buffer.from(req.get("authorization") || "");
    return recibido.length === esperado.length && crypto.timingSafeEqual(recibido, esperado);
  };

  const app = express();
  app.use(express.json({ limit: "64kb" }));

  const recibir = (tipo, validar) => (req, res) => {
    if (!autorizado(req)) return res.status(401).json({ error: "token inválido" });
    const datos = req.body;
    if (!datos || typeof datos !== "object" || Array.isArray(datos) || !validar(datos)) {
      return res.status(400).json({ error: "payload inválido" });
    }
    const k = clave(tipo, datos);
    // Al duplicado le respondemos 200 igual: si respondiéramos error, EMQX lo seguiría reintentando.
    if (vistos.has(k)) return res.json({ ok: true, duplicado: true });

    const evento = { tipo, recibido: new Date().toISOString(), datos };
    fs.appendFileSync(archivo, JSON.stringify(evento) + "\n");
    vistos.add(k);
    eventos.push(evento);
    console.log(`[${tipo}] ${JSON.stringify(datos)}`);
    res.json({ ok: true });
  };

  app.post("/webhook/eventos", recibir("evento", () => true));
  app.post("/webhook/reglas/pendientes", recibir("pendiente", (d) => typeof d.req_id === "string" && d.req_id !== ""));
  app.post("/webhook/reglas/alertas", recibir("alerta", () => true));

  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido" });
    next(err);
  });

  return { app, eventos };
}

module.exports = { crearApp };

if (require.main === module) {
  const { app } = crearApp({
    token: process.env.WEBHOOK_TOKEN,
    dataDir: process.env.DATA_DIR || path.join(__dirname, "data"),
  });
  const puerto = Number(process.env.PORT) || 3000;
  app.listen(puerto, () => console.log(`Receptor escuchando en :${puerto}`));
}
