// Manda al receptor los mismos avisos que mandaría EMQX, para probar el dashboard sin broker.
// Uso: WEBHOOK_TOKEN=... node simulador.js   (opcional: URL=http://<ip>:3000)
const URL_BASE = process.env.URL || "http://localhost:3000";
const TOKEN = process.env.WEBHOOK_TOKEN;
const PAUSA = 2000; // ms entre aviso y aviso, para verlos llegar de a uno

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function enviar(ruta, datos) {
  const res = await fetch(URL_BASE + ruta, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(datos),
  });
  console.log(`${res.status} ${ruta} ${JSON.stringify(datos)}`);
  if (!res.ok) throw new Error(`El receptor respondió ${res.status}: ${await res.text()}`);
  await esperar(PAUSA);
}

async function main() {
  if (!TOKEN) throw new Error("Falta WEBHOOK_TOKEN (el mismo del .env del receptor)");
  const id = Date.now(); // req_id distintos en cada corrida

  // Se conectan las dos puertas y el servicio
  for (const clientid of ["puerta_hall", "puerta_servidores", "servicio_acceso"]) {
    await enviar("/webhook/eventos", { event: "client.connected", clientid, timestamp: Date.now() });
  }

  // Carlos no tiene permiso en servidores: queda pendiente y se puede decidir desde el dashboard
  await enviar("/webhook/reglas/pendientes", {
    req_id: `puerta_servidores-${id}-1`, uid: "A1B2C3D4", nombre: "Carlos Pérez (Empleado)",
    puerta: "puerta_servidores", estado: "ACCESO_PENDIENTE", expira_en: 45, ts: Date.now(),
  });

  // Juan queda pendiente y enseguida el servicio la resuelve (como si el admin la hubiera rechazado)
  const juan = `puerta_hall-${id}-2`;
  await enviar("/webhook/reglas/pendientes", {
    req_id: juan, uid: "11223344", nombre: "Juan López (Inactivo)",
    puerta: "puerta_hall", estado: "ACCESO_PENDIENTE", expira_en: 45, ts: Date.now(),
  });
  await enviar("/webhook/reglas/pendientes", { req_id: juan, estado: "ACCESO_DENEGADO", via_admin: true, ts: Date.now() });

  // Un cliente intenta publicar en admin/decision y la ACL lo bloquea
  await enviar("/webhook/reglas/alertas", {
    clientid: "puerta_hall", username: "puerta_hall", topic: "admin/decision",
    action: "publish", result: "deny", peerhost: "100.64.0.7", ts: Date.now(),
  });

  // Se cae la puerta del hall
  await enviar("/webhook/eventos", {
    event: "client.disconnected", clientid: "puerta_hall", reason: "keepalive_timeout", timestamp: Date.now(),
  });
  console.log("Listo.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
