// Arma lo que muestra el dashboard a partir del log de avisos ({tipo, recibido, datos}).
// shortcut: recorre el log entero en cada llamada; si crece a decenas de miles de líneas, mantenerlo incremental.
const EXPIRA_POR_DEFECTO = 45;

// Hora del aviso según el broker (ms); si no vino, la de recepción.
const hora = (e) => {
  const ts = e.datos.ts ?? e.datos.timestamp;
  return typeof ts === "number" ? ts : Date.parse(e.recibido);
};
const iso = (ms) => new Date(ms).toISOString();

// "vencida" es solo lo que ve el dashboard: el que decide es el servicio, que manda ACCESO_EXPIRADO con via_admin
function estadoDe(solicitud, ahora) {
  if (solicitud.resultado) return "resuelta";
  if (solicitud.vence <= ahora) return "vencida";
  return "pendiente";
}

function calcularEstado(eventos, ahora = Date.now()) {
  const solicitudes = new Map();
  const dispositivos = new Map();
  const alertas = [];

  for (const e of eventos) {
    const d = e.datos;
    const t = hora(e);

    if (e.tipo === "pendiente" && (d.estado === "ACCESO_PENDIENTE" || d.via_admin)) {
      const s = solicitudes.get(d.req_id) ?? { req_id: d.req_id };
      if (d.estado === "ACCESO_PENDIENTE") {
        // La resolución puede haber llegado antes (reintento del broker): completamos los datos sin pisarla
        Object.assign(s, { uid: d.uid, nombre: d.nombre, puerta: d.puerta, detalle: d.detalle });
        s.creada = t;
        s.vence = t + (Number(d.expira_en) || EXPIRA_POR_DEFECTO) * 1000;
      } else {
        s.creada ??= t;
        s.resultado = d.estado;
        s.resuelta = t;
      }
      solicitudes.set(d.req_id, s);
    } else if (e.tipo === "evento" && (d.event === "client.connected" || d.event === "client.disconnected")) {
      // Los reintentos de EMQX pueden llegar desordenados: vale el evento más nuevo según el broker
      const previo = dispositivos.get(d.clientid);
      if (previo && previo.ms > t) continue;
      dispositivos.set(d.clientid, { clientid: d.clientid, ms: t, online: d.event === "client.connected", motivo: d.reason });
    } else if (e.tipo === "alerta") {
      alertas.push({ ...d, recibido: e.recibido });
    }
  }

  const pendientes = [...solicitudes.values()]
    .sort((a, b) => b.creada - a.creada)
    .map((s) => ({
      ...s,
      creada: iso(s.creada),
      vence: s.vence && iso(s.vence),
      resuelta: s.resuelta && iso(s.resuelta),
      estado: estadoDe(s, ahora),
    }));

  const listaDispositivos = [...dispositivos.values()]
    .sort((a, b) => a.clientid.localeCompare(b.clientid))
    .map((x) => ({ clientid: x.clientid, online: x.online, desde: iso(x.ms), motivo: x.motivo }));

  return { pendientes, dispositivos: listaDispositivos, alertas: alertas.reverse() };
}

module.exports = { calcularEstado };
