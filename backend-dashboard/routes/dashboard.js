// Rutas que usa la página del admin
const express = require("express");
const { calcularEstado } = require("../estado");

function crearDashboard({ eventos }) {
  // Navegadores conectados a /stream
  const clientes = new Set();
  // shortcut: manda el estado entero en cada aviso; mandar solo el cambio si el log crece mucho.
  const enviarEstado = (destinos) => {
    const mensaje = `data: ${JSON.stringify(calcularEstado(eventos))}\n\n`;
    for (const res of destinos) res.write(mensaje);
  };

  const router = express.Router();

  // Avisos en vivo (SSE): al conectarse recibe el estado completo, y otro cada vez que llega un aviso
  // TODO paso 3: pedir login
  router.get("/stream", (req, res) => {
    res.set({ "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.flushHeaders();
    enviarEstado([res]);
    clientes.add(res);
    req.on("close", () => clientes.delete(res));
  });

  return { router, avisarCambio: () => enviarEstado(clientes) };
}

module.exports = { crearDashboard };
