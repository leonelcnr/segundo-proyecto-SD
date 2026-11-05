// Cliente MQTT del dashboard: se suscribe a lo que muestra y publica los pedidos del admin.
// No conoce ningún formato: entrega el texto tal cual llegó y publica el objeto que le pasen.
const fs = require("node:fs");
const mqtt = require("mqtt");


// alMensaje(topic, texto) se llama con cada mensaje de las suscripciones
function conectar({ url, usuario, clave, ca, suscripciones, alMensaje }) {

  const cliente = mqtt.connect(url, {
    username: usuario,
    password: clave,
    // El client ID es el usuario: la ACL es por usuario y la sesión persistente queda atada a él
    clientId: usuario,
    clean: false,
    // Con mqtts:// valida el certificado del broker contra la CA del proyecto
    ca: ca ? fs.readFileSync(ca) : undefined,
  });

  // Suscribirse en cada connect: si el broker perdió la sesión, al reconectar se vuelve a pedir
  cliente.on("connect", () => {
    console.log(`MQTT conectado a ${url}`);
    cliente.subscribe(suscripciones, { qos: 1 }, (err) => {
      if (err) console.error(`MQTT: no se pudo suscribir: ${err.message}`);
    });
  });

  cliente.on("close", () => console.warn("MQTT desconectado, reintentando..."));
  cliente.on("error", (err) => console.error(`MQTT: ${err.message}`));
  cliente.on("message", (topic, payload) => alMensaje(topic, payload.toString()));


  // Si no hay conexión falla en el momento: el admin ve el error en vez de quedar esperando
  async function publicar(topic, mensaje) {

    if (!cliente.connected) throw new Error("MQTT desconectado");
    await cliente.publishAsync(topic, JSON.stringify(mensaje), { qos: 1 });
  }

  return { publicar };
}


module.exports = { conectar };
