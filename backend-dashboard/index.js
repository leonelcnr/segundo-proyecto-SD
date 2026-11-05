const path = require("node:path");
const express = require("express");
const { crearWebhooks } = require("./routes/webhooks");
const { crearDashboard } = require("./routes/dashboard");
const { crearAuth } = require("./routes/auth");
const { conectar } = require("./broker/conexion");
const { SUSCRIPCIONES, pedido, aviso, crearMemoria, aplicar } = require("./broker/topics");


function crearApp({ token, dataDir, admin, publicar }) {

  const auth = crearAuth(admin);
  // Lo último que llegó por MQTT (estado, alarma, presencia, telemetría, eventos, avisos)
  const memoria = crearMemoria();
  // Cada aviso nuevo que llega por webhook se reenvía a los navegadores conectados.
  // dashboard se crea en la línea de abajo; alGuardar recién se llama cuando llega un aviso.
  const webhooks = crearWebhooks({ token, dataDir, alGuardar: () => dashboard.avisarCambio() });
  const dashboard = crearDashboard({ eventos: webhooks.eventos, memoria, verificarToken: auth.verificarToken, publicar });

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

  return { app, eventos: webhooks.eventos, memoria, avisarCambio: dashboard.avisarCambio };
}


module.exports = { crearApp };


if (require.main === module) {

  const env = process.env;
  let mqtt = null;

  const { app, memoria, avisarCambio } = crearApp({
    token: env.WEBHOOK_TOKEN,
    dataDir: path.join(__dirname, "data"),
    admin: { usuario: env.ADMIN_USER, clave: env.ADMIN_PASSWORD, secreto: env.JWT_SECRET },
    // {admin} del topic es el usuario MQTT del dashboard (admin-1): la ACL solo lo deja publicar en su propio topic
    publicar: async (mensaje) => {
      if (!mqtt) throw new Error("MQTT no está configurado (falta MQTT_URL)");
      await mqtt.publicar(pedido(env.MQTT_USER), mensaje);
    },
  });

  // Sin MQTT_URL el dashboard solo muestra los webhooks: no ve solicitudes ni puede decidir
  if (env.MQTT_URL) {
    mqtt = conectar({
      url: env.MQTT_URL,
      usuario: env.MQTT_USER,
      clave: env.MQTT_PASSWORD,
      ca: env.MQTT_CA,
      suscripciones: [...SUSCRIPCIONES, aviso(env.MQTT_USER)],
      alMensaje: (topic, texto) => aplicar(memoria, topic, texto) && avisarCambio(),
    });
  }

  app.listen(3000, () => console.log("Receptor escuchando en :3000"));
}
