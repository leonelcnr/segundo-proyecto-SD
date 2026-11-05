// Hace de servicio, de puertas y de EMQX para probar el dashboard sin el resto del sistema.
// Publica por MQTT lo que mandaría el servicio (protocolo, sección 6) y manda al receptor los webhooks de EMQX.
// Uso: node --env-file=.env simulador.js   (MQTT_URL apunta al broker de prueba; opcional: URL=http://<ip>:3000)
const mqtt = require("mqtt");

const URL_BASE = process.env.URL || "http://localhost:3000";
const TOKEN = process.env.WEBHOOK_TOKEN;
const SITIO = "edificio1";
const PAUSA = 2000; // ms entre paso y paso, para verlos llegar de a uno

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// Hora local sin zona, como las fechas del protocolo
const local = (ms = Date.now()) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);


async function webhook(ruta, datos) {

  const res = await fetch(URL_BASE + ruta, {
    method: "POST",
    headers: { "content-type": "application/json", "x-token": TOKEN },
    body: JSON.stringify(datos),
  });
  console.log(`${res.status} ${ruta}`);
  if (!res.ok) throw new Error(`El receptor respondió ${res.status}: ${await res.text()}`);
}


async function main() {

  if (!TOKEN) throw new Error("Falta WEBHOOK_TOKEN (el mismo del .env del receptor)");
  if (!process.env.MQTT_URL) throw new Error("Falta MQTT_URL (el broker de prueba, por ejemplo mqtt://localhost:1883)");

  // Sin usuario: el broker de prueba no tiene ACL
  const cliente = await mqtt.connectAsync(process.env.MQTT_URL, { clientId: `simulador-${Date.now()}` });
  const publicar = async (topic, msg, retain = false) => {
    await cliente.publishAsync(topic, typeof msg === "string" ? msg : JSON.stringify(msg), { qos: 1, retain });
    console.log(`MQTT ${topic}${retain ? " (retenido)" : ""}`);
    await esperar(PAUSA);
  };
  const puerta = (p) => `acceso/${SITIO}/puerta/${p}`;
  const evento = (datos) => publicar(`acceso/${SITIO}/eventos`, { ts: local(), ...datos });
  const estado = (pendientes) => publicar(`acceso/${SITIO}/estado`, { puertas: {}, pendientes, alarma: { activa: false }, historial: [] }, true);

  // Arranca todo: servicio y puertas online (lo que el broker avisa también por webhook)
  await publicar("servicio/presencia", "online", true);
  for (const p of ["puerta-hall", "puerta-servidores"]) {
    await publicar(`${puerta(p)}/presencia`, "online", true);
    await webhook("/webhook/conexiones", { event: "client.connected", clientid: p, username: p, timestamp: Date.now() });
  }
  await publicar(`${puerta("puerta-hall")}/telemetria`, { rssi: -53, uptime_s: 330, heap_libre: 241336, lector_ok: true });

  // Acceso común de Ana (6.1)
  await evento({ tipo: "acceso", puerta: "puerta-hall", persona: "Ana", uid: "31A7506E", detalle: "directo" });

  // Beto pide entrar a servidores: queda pendiente 30 s y se puede decidir desde el dashboard (6.2)
  const req_id = `puerta-servidores-${Math.random().toString(16).slice(2, 10)}`;
  await evento({ tipo: "solicitud", puerta: "puerta-servidores", persona: "Beto", uid: "04A1B2C3", detalle: "vence en 30 s" });
  await estado([{ req_id, puerta: "puerta-servidores", persona: "Beto", vence: local(Date.now() + 30_000) }]);

  // Una puerta intenta publicar una orden y la ACL la bloquea (regla de seguridad)
  await webhook("/webhook/seguridad", {
    clientid: "puerta-hall", username: "puerta-hall", topic: `${puerta("puerta-servidores")}/orden`,
    action: "publish", result: "deny", peerhost: "100.64.0.7", timestamp: Date.now(),
  });

  // Tarjeta desconocida: alarma retenida del sitio y la regla de alarmas llama al receptor (6.3)
  const alarma = { activa: true, puerta: "puerta-servidores", motivo: "tarjeta desconocida", desde: local() };
  await publicar(`acceso/${SITIO}/alarma`, alarma, true);
  await evento({ tipo: "alarma", puerta: "puerta-servidores", uid: "DEADBEEF", detalle: "tarjeta desconocida" });
  await webhook("/webhook/alarmas", { puerta: "puerta-servidores", persona: null, detalle: "tarjeta desconocida", timestamp: Date.now() });

  // Se cae la puerta del hall: Last Will (retenido) + webhook de desconexión (6.4)
  await publicar(`${puerta("puerta-hall")}/presencia`, "offline", true);
  await webhook("/webhook/conexiones", { event: "client.disconnected", clientid: "puerta-hall", reason: "keepalive_timeout", timestamp: Date.now() });

  // El simulador no hace de servicio de verdad: muestra los pedidos del admin pero no los resuelve
  await cliente.subscribeAsync("usuario/+/pedido", { qos: 1 });
  cliente.on("message", (topic, payload) => console.log(`Pedido recibido en ${topic}: ${payload}`));
  console.log("Listo. Decidí o reconocé la alarma desde el dashboard y mirá el pedido acá (Ctrl+C para salir).");
}


main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
