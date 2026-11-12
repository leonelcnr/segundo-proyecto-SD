// Cliente MQTT del dashboard: se suscribe a lo que muestra y publica los pedidos del admin.
// No conoce ningún formato: entrega el texto tal cual llegó y publica el objeto que le pasen.
const fs = require("node:fs");
const mqtt = require("mqtt");
const jwt = require("jsonwebtoken");

// Cuánto vale el JWT con el que el dashboard entra a EMQX. Corto: si alguien lo roba, sirve poco tiempo.
const DURACION_JWT = 60 * 60; // segundos


// JWT para el autenticador JWT de EMQX, firmado con RS256: el dashboard tiene la clave privada y EMQX solo
// la pública, así que el broker puede verificar tokens pero no fabricarlos. EMQX verifica la firma,
// que no esté vencido y que el claim username coincida con el usuario de la conexión.
const jwtMqtt = (usuario, clavePrivada) =>
  jwt.sign({ username: usuario }, clavePrivada, { algorithm: "RS256", expiresIn: DURACION_JWT });


// alMensaje(topic, texto) se llama con cada mensaje de las suscripciones.
// clave puede ser un texto o una función que la genera (un JWT nuevo en cada conexión).
function conectar({ url, usuario, clave, ca, suscripciones, alMensaje }) {

  const generar = typeof clave === "function" ? clave : () => clave;
  const cliente = mqtt.connect(url, {
    username: usuario,
    password: generar(),
    // El client ID es el usuario: la ACL es por usuario y la sesión persistente queda atada a él
    clientId: usuario,
    clean: false,
    // Si EMQX rechaza el usuario (por ejemplo, mientras se configura el autenticador) sigue reintentando cada 5 s
    reconnectOnConnackError: true,
    reconnectPeriod: 5000,
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
  // El JWT anterior puede haber vencido: cada reintento se presenta con uno nuevo
  cliente.on("reconnect", () => (cliente.options.password = generar()));
  cliente.on("error", (err) => console.error(`MQTT: ${err.message}`));
  cliente.on("message", (topic, payload) => alMensaje(topic, payload.toString()));


  // Si no hay conexión falla en el momento: el admin ve el error en vez de quedar esperando
  async function publicar(topic, mensaje) {

    if (!cliente.connected) throw new Error("MQTT desconectado");
    await cliente.publishAsync(topic, JSON.stringify(mensaje), { qos: 1 });
  }

  return { publicar };
}


module.exports = { conectar, jwtMqtt };
