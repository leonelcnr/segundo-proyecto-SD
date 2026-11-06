// Estado que sale de los webhooks guardados en el log. Lo que llega por MQTT lo arma broker/topics.js.

// Hora del aviso según el broker (ms); si no vino, la de recepción.
const hora = (e) => {
  const ts = e.datos.ts ?? e.datos.timestamp;
  return typeof ts === "number" ? ts : Date.parse(e.recibido);
};
const iso = (ms) => new Date(ms).toISOString();


function calcularEstado(eventos) {

  const dispositivos = new Map();
  const alertas = [];
  const alarmas = [];
  // Mientras la sala siga caliente llega un aviso por cada telemetría: queda sólo el último de cada sala
  const ambiente = new Map();

  for (const e of eventos) {
    const d = e.datos;
    const t = hora(e);

    if (e.tipo === "conexion" && (d.event === "client.connected" || d.event === "client.disconnected")) {
      // Los reintentos de EMQX pueden llegar desordenados: vale el evento más nuevo según el broker
      const previo = dispositivos.get(d.clientid);
      if (previo && previo.ms > t) continue;
      dispositivos.set(d.clientid, { clientid: d.clientid, ms: t, online: d.event === "client.connected", motivo: d.reason });
    } else if (e.tipo === "alerta") {
      alertas.push({ ...d, recibido: e.recibido });
    } else if (e.tipo === "alarma") {
      alarmas.push({ ...d, recibido: e.recibido });
    } else if (e.tipo === "ambiente") {
      const [, sitio, sala] = d.topic.split("/");
      const previo = ambiente.get(d.topic);
      if (previo && previo.ms > t) continue;
      ambiente.set(d.topic, { sitio, sala, temp: d.temp, ms: t, desde: previo?.desde ?? iso(t) });
    }
  }

  const listaDispositivos = [...dispositivos.values()]
    .sort((a, b) => a.clientid.localeCompare(b.clientid))
    .map((x) => ({ clientid: x.clientid, online: x.online, desde: iso(x.ms), motivo: x.motivo }));

  const alertasAmbiente = [...ambiente.values()].map(({ ms, ...a }) => ({ ...a, ultima: iso(ms) }));
  return { dispositivos: listaDispositivos, alertas: alertas.reverse(), alarmasWebhook: alarmas.reverse(), alertasAmbiente };
}


module.exports = { calcularEstado };
