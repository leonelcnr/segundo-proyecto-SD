// Avisos que manda EMQX por HTTP. Cada uno se guarda como una línea JSON: {tipo, recibido, datos}
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { iguales } = require("./auth");

// EMQX reintenta si no le respondemos a tiempo, así que el mismo aviso puede llegar dos veces: se reconoce por su contenido exacto.
const clave = (tipo, datos) => `${tipo}|${JSON.stringify(datos)}`;

// Si el proceso murió a mitad de escribir, la última línea queda cortada: se descarta para poder arrancar igual.
function leerLog(archivo) {
  if (!fs.existsSync(archivo)) return [];
  const contenido = fs.readFileSync(archivo, "utf8");
  // Así el próximo aviso no se pega a la línea cortada
  if (contenido && !contenido.endsWith("\n")) fs.appendFileSync(archivo, "\n");

  const eventos = [];
  for (const linea of contenido.split("\n")) {
    if (!linea) continue;
    try {
      eventos.push(JSON.parse(linea));
    } catch {
      console.warn(`Línea ilegible en ${archivo}, se descarta: ${linea.slice(0, 80)}`);
    }
  }
  return eventos;
}

// alGuardar se llama después de guardar cada aviso nuevo
function crearWebhooks({ token, dataDir, alGuardar }) {
  if (!token) throw new Error("Falta WEBHOOK_TOKEN");

  fs.mkdirSync(dataDir, { recursive: true });
  const archivo = path.join(dataDir, "eventos.jsonl");
  const eventos = leerLog(archivo);
  // shortcut: el log y las claves viven enteros en memoria y en un solo archivo; rotar si pasa de unos pocos MB.
  const vistos = new Set(eventos.map((e) => clave(e.tipo, e.datos)));

  // Header que configura el conector HTTP de EMQX (protocolo, sección 7)
  const autorizado = (req) => iguales(req.get("x-token") || "", token);

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
  const texto = (v) => typeof v === "string" && v !== "";
  // Webhook directo: conexiones y desconexiones. El dashboard agrupa por clientid: sin él, el aviso no sirve
  router.post("/conexiones", recibir("conexion", (d) => texto(d.clientid)));
  // Regla: la ACL negó algo
  router.post("/seguridad", recibir("alerta", () => true));
  // Regla: evento con tipo = 'alarma' en acceso/+/eventos
  router.post("/alarmas", recibir("alarma", (d) => texto(d.puerta)));
  // Regla: la sala de servidores pasó los 27 °C (sala/+/servidores/telemetria). El topic dice de qué sala es
  router.post("/ambiente", recibir("ambiente", (d) => typeof d.temp === "number" && texto(d.topic)));
  return { router, eventos };
}

module.exports = { crearWebhooks };
