const path = require("node:path");
const express = require("express");
const { crearWebhooks } = require("./routes/webhooks");
const { crearDashboard } = require("./routes/dashboard");

function crearApp({ token, dataDir }) {
  // Cada aviso nuevo que llega por webhook se reenvía a los navegadores conectados
  const webhooks = crearWebhooks({ token, dataDir, alGuardar: () => dashboard.avisarCambio() });
  const dashboard = crearDashboard({ eventos: webhooks.eventos });

  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use("/webhook", webhooks.router);
  app.use("/", dashboard.router);

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
    dataDir: process.env.DATA_DIR || path.join(__dirname, "data"),
  });
  const puerto = Number(process.env.PORT) || 3000;
  app.listen(puerto, () => console.log(`Receptor escuchando en :${puerto}`));
}
