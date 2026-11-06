// Topics y formatos del protocolo MQTT (docs: "Protocolo MQTT del sistema de puertas").
// Si cambia un nombre o un campo, se cambia solo acá.
// + = cualquier sitio o cualquier puerta. Nadie usa #: la ACL no lo deja.


const SUSCRIPCIONES = [
  "acceso/+/estado",
  "acceso/+/eventos",
  "acceso/+/alarma",
  "acceso/+/puerta/+/presencia",
  "acceso/+/puerta/+/telemetria",
  "servicio/presencia",
  // Salas (docs/protocolo-salas.md)
  "acceso/+/sala/+/ocupantes",
  "sala/+/+/estado",
  "sala/+/+/telemetria",
  "sala/+/+/eventos",
  "servicio-salas/presencia",
];

// Servicios que anuncian su presencia con texto plano (online / offline)
const SERVICIOS = { "servicio/presencia": "servicio", "servicio-salas/presencia": "servicio-salas" };

// El admin le pide algo al servicio (decisión, reconocer la alarma) y el servicio le contesta en aviso
const pedido = (admin) => `usuario/${admin}/pedido`;
const aviso = (admin) => `usuario/${admin}/aviso`;

// El servicio vence una solicitud a los 30 s (protocolo, sección 5)
const VENCE_SOLICITUD_S = 30;
const MAX_EVENTOS = 50;

// Las fechas del protocolo son hora local sin zona. Se pasan a ISO con zona para que el navegador no dependa de la suya.
// shortcut: el server tiene que tener la misma zona que el servicio (TZ en compose.yaml).
const fecha = (texto) => {

  const ms = Date.parse(texto);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};


// Lo último que llegó de cada topic. No se guarda en disco: casi todo es retenido y el broker lo reenvía al reconectar.
const crearMemoria = () => ({ estados: {}, alarmas: {}, presencia: {}, telemetria: {}, eventos: [], avisos: [], salas: {} });

// La sala se arma con lo que llega de tres topics distintos (ocupantes, estado y telemetría)
const sala = (m, sitio, nombre) => (m.salas[`${sitio}/${nombre}`] ??= { sitio, sala: nombre, estado: null, ocupantes: [], temp: null });


// Eventos de puertas y de salas en la misma lista, cortada en MAX_EVENTOS
const agregarEvento = (m, evento) => {

  m.eventos.unshift(evento);
  m.eventos.length = Math.min(m.eventos.length, MAX_EVENTOS);
};


// Guarda un mensaje en la memoria. Devuelve false si el topic no es conocido o el mensaje no se puede leer.
function aplicar(m, topic, texto, ahora = new Date().toISOString()) {

  const p = topic.split("/");
  const dePuerta = p.length === 5 && p[0] === "acceso" && p[2] === "puerta";
  const deSala = p.length === 4 && p[0] === "sala";

  // presencia es texto plano, no JSON
  if (SERVICIOS[topic] || (dePuerta && p[4] === "presencia")) {
    if (texto !== "online" && texto !== "offline") return false;
    m.presencia[topic] = { nombre: dePuerta ? p[3] : SERVICIOS[topic], sitio: dePuerta ? p[1] : null, online: texto === "online", desde: ahora };
    return true;
  }

  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    return false;
  }

  // ocupantes es la única lista del protocolo: la lista completa de quién está dentro
  if (p.length === 5 && p[0] === "acceso" && p[2] === "sala" && p[4] === "ocupantes") {
    if (!Array.isArray(datos)) return false;
    sala(m, p[1], p[3]).ocupantes = datos.filter((o) => o && typeof o === "object");
    return true;
  }
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) return false;

  if (deSala && p[3] === "estado") {
    sala(m, p[1], p[2]).estado = datos;
    return true;
  }
  if (deSala && p[3] === "telemetria") {
    if (typeof datos.temp !== "number") return false;
    sala(m, p[1], p[2]).temp = { valor: datos.temp, recibida: ahora };
    return true;
  }
  if (deSala && p[3] === "eventos") {
    agregarEvento(m, { ...datos, sitio: p[1], sala: p[2] });
    return true;
  }

  if (dePuerta && p[4] === "telemetria") {
    m.telemetria[topic] = { ...datos, puerta: p[3], sitio: p[1], recibida: ahora };
  } else if (p.length === 3 && p[0] === "acceso" && p[2] === "estado") {
    m.estados[p[1]] = datos;
  } else if (p.length === 3 && p[0] === "acceso" && p[2] === "alarma") {
    m.alarmas[p[1]] = { ...datos, sitio: p[1] };
  } else if (p.length === 3 && p[0] === "acceso" && p[2] === "eventos") {
    agregarEvento(m, { ...datos, sitio: p[1] });
  } else if (p.length === 3 && p[0] === "usuario" && p[2] === "aviso") {
    m.avisos.unshift({ ...datos, recibido: ahora });
    m.avisos.length = Math.min(m.avisos.length, MAX_EVENTOS);
  } else {
    return false;
  }
  return true;
}


// Lo que se le manda al navegador
function vista(m) {

  const pendientes = Object.entries(m.estados).flatMap(([sitio, e]) =>
    (Array.isArray(e.pendientes) ? e.pendientes : []).map((s) => {
      const vence = fecha(s.vence);
      const creada = vence && new Date(Date.parse(vence) - VENCE_SOLICITUD_S * 1000).toISOString();
      return { ...s, sitio, vence, creada };
    }),
  );

  // Eventos en vivo + el historial que trae cada estado. El mismo evento puede estar en los dos lados.
  const historial = Object.entries(m.estados).flatMap(([sitio, e]) =>
    (Array.isArray(e.historial) ? e.historial : []).filter((x) => x && typeof x === "object").map((x) => ({ ...x, sitio })),
  );
  const vistos = new Set();
  const eventos = [...m.eventos, ...historial]
    .filter((x) => {
      const k = [x.sitio, x.sala, x.ts, x.tipo, x.puerta, x.uid, x.detalle].join("|");
      return !vistos.has(k) && vistos.add(k);
    })
    .map((x) => ({ ...x, ts: fecha(x.ts) }))
    .sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""))
    .slice(0, MAX_EVENTOS);

  return {
    pendientes,
    eventos,
    alarmas: Object.values(m.alarmas).map((a) => ({ ...a, desde: fecha(a.desde) })),
    presencia: Object.values(m.presencia),
    telemetria: Object.values(m.telemetria),
    avisos: m.avisos,
    salas: Object.values(m.salas).map((s) => ({
      ...s,
      estado: s.estado && { ...s.estado, ts: fecha(s.estado.ts) },
      ocupantes: s.ocupantes.map((o) => ({ ...o, desde: fecha(o.desde), vence: fecha(o.vence) })),
    })),
  };
}


module.exports = { SUSCRIPCIONES, pedido, aviso, crearMemoria, aplicar, vista };
