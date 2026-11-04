// Avisos que manda EMQX por HTTP. Cada uno se guarda como una línea JSON: {tipo, recibido, datos}
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

// EMQX reintenta si no le respondemos a tiempo, así que el mismo aviso puede llegar dos veces.
// Una solicitud pendiente se identifica por req_id + estado (QoS 1 puede re-publicarla con otro timestamp);
// el resto de los avisos, por su contenido exacto.
const clave = (tipo, datos) =>
  tipo === "pendiente" ? `${tipo}|${datos.req_id}|${datos.estado}` : `${tipo}|${JSON.stringify(datos)}`;

// alGuardar se llama después de guardar cada aviso nuevo
function crearWebhooks({ token, dataDir, alGuardar }) {
  if (!token) throw new Error("Falta WEBHOOK_TOKEN");

  fs.mkdirSync(dataDir, { recursive: true });
  const archivo = path.join(dataDir, "eventos.jsonl");
  const eventos = fs.existsSync(archivo)
    ? fs.readFileSync(archivo, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  // shortcut: el log y las claves viven enteros en memoria y en un solo archivo; rotar si pasa de unos pocos MB.
  const vistos = new Set(eventos.map((e) => clave(e.tipo, e.datos)));

  const esperado = Buffer.from(`Bearer ${token}`);
  const autorizado = (req) => {
    const recibido = Buffer.from(req.get("authorization") || "");
    return recibido.length === esperado.length && crypto.timingSafeEqual(recibido, esperado);
  };

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
    alGuardar();
    res.json({ ok: true });
  };

  const router = express.Router();
  router.post("/eventos", recibir("evento", () => true));
  router.post("/reglas/pendientes", recibir("pendiente", (d) => typeof d.req_id === "string" && d.req_id !== ""));
  router.post("/reglas/alertas", recibir("alerta", () => true));
  return { router, eventos };
}

module.exports = { crearWebhooks };
