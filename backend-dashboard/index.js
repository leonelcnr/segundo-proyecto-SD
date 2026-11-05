const path = require("node:path");
const express = require("express");
const { crearWebhooks } = require("./routes/webhooks");
const { crearDashboard } = require("./routes/dashboard");
const { crearAuth } = require("./routes/auth");


function crearApp({ token, dataDir, admin, publicar }) {

  const auth = crearAuth(admin);
  // Cada aviso nuevo que llega por webhook se reenvía a los navegadores conectados.
  // dashboard se crea en la línea de abajo; alGuardar recién se llama cuando llega un aviso.
  const webhooks = crearWebhooks({ token, dataDir, alGuardar: () => dashboard.avisarCambio() });
  const dashboard = crearDashboard({ eventos: webhooks.eventos, verificarToken: auth.verificarToken, publicar });

  const app = express();

  app.use(express.json({ limit: "64kb" }));
  app.use("/webhook", webhooks.router);
  app.use("/", auth.router);
  app.use("/", dashboard.router);
  // La página del admin (React compilado con `npm run build` en web/)
  app.use(express.static(path.join(__dirname, "web", "dist")));

  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido" });
    next(err);
  });

  return { app, eventos: webhooks.eventos };
}


module.exports = { crearApp };


if (require.main === module) {

  const { app } = crearApp({
    token: process.env.WEBHOOK_TOKEN,
    dataDir: path.join(__dirname, "data"),
    admin: { usuario: process.env.ADMIN_USER, clave: process.env.ADMIN_PASSWORD, secreto: process.env.JWT_SECRET },
    // TODO: cliente MQTT real (broker/conexion.js). Hasta entonces la decisión responde 503.
    publicar: async () => {
      throw new Error("MQTT todavía no está conectado");
    },
  });

  app.listen(3000, () => console.log("Receptor escuchando en :3000"));
}
