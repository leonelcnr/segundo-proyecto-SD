// Topics del sistema, según la tabla general de topics. Si cambia un nombre, se cambia solo acá.
// + = cualquier sitio o cualquier puerta.


const PRESENCIA_PUERTAS = "acceso/+/puerta/+/presencia";
const PRESENCIA_SERVICIO = "servicio/presencia";

// Lo que el dashboard escucha por MQTT. Faltan alarma, estado, eventos, telemetría y aviso: esperan sus formatos (sección 4).
const SUSCRIPCIONES = [PRESENCIA_PUERTAS, PRESENCIA_SERVICIO];

// El admin le pide algo al servicio (aceptar, rechazar, reconocer alarma)
const pedido = (admin) => `usuario/${admin}/pedido`;


// Presencia: texto "online" u "offline", retenido. Devuelve null si el topic o el texto no son de presencia.
// "acceso/central/puerta/hall/presencia" → { nombre: "hall", sitio: "central", online: true }
function leerPresencia(topic, texto) {

  if (texto !== "online" && texto !== "offline") return null;
  const online = texto === "online";

  if (topic === PRESENCIA_SERVICIO) return { nombre: "servicio", sitio: null, online };

  const partes = topic.split("/");
  const esPuerta = partes.length === 5 && partes[0] === "acceso" && partes[2] === "puerta" && partes[4] === "presencia";
  if (!esPuerta) return null;

  return { nombre: partes[3], sitio: partes[1], online };
}


module.exports = { SUSCRIPCIONES, pedido, leerPresencia };
