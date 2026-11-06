// Rutas que usa la página del admin
const express = require("express");
const { calcularEstado } = require("../estado");
const { vista } = require("../broker/topics");


// publicar(mensaje) manda un pedido del admin al servicio y devuelve una promesa.
// memoria: lo último que llegó por MQTT (broker/topics.js).
function crearDashboard({ eventos, memoria, verificarToken, publicar }) {

  const estado = () => ({ ...calcularEstado(eventos), ...vista(memoria) });

  // Navegadores conectados a /stream
  const clientes = new Set();
  // shortcut: manda el estado entero en cada aviso; mandar solo el cambio si crece mucho.
  const enviarEstado = (destinos) => {
    const mensaje = `data: ${JSON.stringify(estado())}\n\n`;
    for (const res of destinos) res.write(mensaje);
  };

  const router = express.Router();

  // Avisos en vivo (SSE): al conectarse recibe el estado completo, y otro cada vez que llega algo
  router.get("/stream", verificarToken, (req, res) => {
    res.set({ "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.flushHeaders();
    enviarEstado([res]);
    clientes.add(res);
    req.on("close", () => clientes.delete(res));
  });

  // Publica el pedido; si el broker falla responde 503
  const enviar = async (res, mensaje, descripcion) => {
    try {
      await publicar(mensaje);
    } catch (err) {
      console.error(`No se pudo publicar ${descripcion}: ${err.message}`);
      res.status(503).json({ error: "No se pudo enviar el pedido al broker" });
      return false;
    }
    console.log(`[pedido] ${descripcion}`);
    res.json({ ok: true });
    return true;
  };

  // Solicitudes que el admin ya decidió desde acá, aunque el estado nuevo del servicio todavía no llegó.
  // Evita mandar dos decisiones distintas por un doble clic o dos pestañas abiertas.
  // Se pierde al reiniciar, y está bien: con dos decisiones gana la primera y el servicio avisa ya_resuelta.
  const decididas = new Set();

  // El admin aprueba o rechaza una solicitud pendiente. Decide el servicio: esto solo le manda la decisión.
  router.post("/api/decision", verificarToken, async (req, res) => {

    const { req_id, aprobar } = req.body || {};
    if (typeof req_id !== "string" || typeof aprobar !== "boolean") {
      return res.status(400).json({ error: "Faltan req_id o aprobar (true o false)" });
    }
    const solicitud = vista(memoria).pendientes.find((s) => s.req_id === req_id);
    if (!solicitud) return res.status(404).json({ error: "No existe esa solicitud o ya se resolvió" });
    if (decididas.has(req_id)) return res.status(409).json({ error: "La solicitud ya está decidida" });
    if (Date.parse(solicitud.vence) <= Date.now()) return res.status(409).json({ error: "La solicitud ya venció" });

    decididas.add(req_id);
    const ok = await enviar(res, { tipo: "decision", req_id, aprobar }, `${req_id} ${aprobar ? "aprobada" : "rechazada"} por ${req.username}`);
    if (!ok) decididas.delete(req_id); // no salió: que se pueda reintentar
  });

  // El admin reconoce la alarma de un sitio; el servicio la apaga
  router.post("/api/alarma/reconocer", verificarToken, async (req, res) => {

    const { sitio } = req.body || {};
    if (typeof sitio !== "string") return res.status(400).json({ error: "Falta sitio" });
    if (!memoria.alarmas[sitio]?.activa) return res.status(409).json({ error: "No hay alarma activa en ese sitio" });
    await enviar(res, { tipo: "reconocer_alarma", sitio }, `alarma de ${sitio} reconocida por ${req.username}`);
  });

  return { router, avisarCambio: () => enviarEstado(clientes) };
}


module.exports = { crearDashboard };
