// Rutas que usa la página del admin
const express = require("express");
const { calcularEstado } = require("../estado");

const DECISIONES = ["ACEPTAR", "RECHAZAR"];

// publicar(topic, mensaje) devuelve una promesa; al final será el cliente MQTT real
function crearDashboard({ eventos, verificarToken, publicar }) {
  // Navegadores conectados a /stream
  const clientes = new Set();
  // shortcut: manda el estado entero en cada aviso; mandar solo el cambio si el log crece mucho.
  const enviarEstado = (destinos) => {
    const mensaje = `data: ${JSON.stringify(calcularEstado(eventos))}\n\n`;
    for (const res of destinos) res.write(mensaje);
  };

  const router = express.Router();

  // Avisos en vivo (SSE): al conectarse recibe el estado completo, y otro cada vez que llega un aviso
  router.get("/stream", verificarToken, (req, res) => {
    res.set({ "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.flushHeaders();
    enviarEstado([res]);
    clientes.add(res);
    req.on("close", () => clientes.delete(res));
  });

  // Solicitudes que el admin ya decidió desde acá, aunque la respuesta del servicio todavía no llegó.
  // Evita mandar dos decisiones distintas por un doble clic o dos pestañas abiertas.
  // Se pierde al reiniciar, y está bien: el servicio ignora una segunda decisión del mismo req_id.
  const decididas = new Set();

  // El admin acepta o rechaza una solicitud pendiente. Decide el servicio: esto solo le manda la decisión.
  router.post("/api/decision", verificarToken, async (req, res) => {
    const { req_id, decision } = req.body || {};
    if (typeof req_id !== "string" || !DECISIONES.includes(decision)) {
      return res.status(400).json({ error: "Faltan req_id o decision (ACEPTAR o RECHAZAR)" });
    }
    const solicitud = calcularEstado(eventos).pendientes.find((s) => s.req_id === req_id);
    if (!solicitud) return res.status(404).json({ error: "No existe esa solicitud" });
    if (decididas.has(req_id)) return res.status(409).json({ error: "La solicitud ya está decidida" });
    if (solicitud.estado !== "pendiente") return res.status(409).json({ error: `La solicitud ya está ${solicitud.estado}` });

    decididas.add(req_id);
    try {
      await publicar("admin/decision", { req_id, decision, admin: req.username });
    } catch (err) {
      decididas.delete(req_id); // no salió: que se pueda reintentar
      console.error(`No se pudo publicar la decisión de ${req_id}: ${err.message}`);
      return res.status(503).json({ error: "No se pudo enviar la decisión al broker" });
    }
    console.log(`[decision] ${req_id} ${decision} por ${req.username}`);
    res.json({ ok: true });
  });

  return { router, avisarCambio: () => enviarEstado(clientes) };
}

module.exports = { crearDashboard };
