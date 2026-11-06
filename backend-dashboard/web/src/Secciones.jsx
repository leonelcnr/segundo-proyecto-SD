// Pantallas del menú, además del Panel: cada una muestra en detalle una parte del estado que llega por /stream
import { useEffect, useRef, useState } from "react";
import { hora, fechaHora } from "./formato.js";

// [id del hash, nombre en el menú, título, bajada]
export const SECCIONES = [
  ["panel", "Panel", "Panel del admin", "Solicitudes de acceso que necesitan tu decisión, en vivo."],
  ["dispositivos", "Dispositivos", "Dispositivos", "Servicios, puertas y conexiones al broker."],
  ["alertas", "Alertas", "Alertas", "Lo que avisaron las reglas de EMQX: ACL, alarmas de puertas y temperatura."],
  ["actividad", "Actividad", "Actividad", "Todo lo que pasó en el sistema, lo más nuevo primero."],
  ["salas", "Salas", "Salas", "Hall y sala de servidores: quién está dentro y cómo están los equipos."],
  ["arquitectura", "Arquitectura", "Arquitectura", "Cómo se conectan las partes del sistema."],
];

const Estado = ({ online }) => <span className={`pildora ${online ? "bien" : "mal"}`}>{online ? "Online" : "Offline"}</span>;

const Vacio = ({ children }) => <p className="tenue">{children}</p>;


// Eventos del servicio y de las salas + conexiones, alertas y avisos, lo más nuevo primero
export function itemsActividad(estado) {

  return [
    ...estado.eventos.map((e) => ({
      t: e.ts,
      texto: `${e.tipo}: ${e.persona ?? e.puerta ?? ""}${e.sala ? ` en ${e.sala}` : ""} ${e.detalle ? `(${e.detalle})` : ""}`,
    })),
    ...estado.dispositivos.map((d) => ({
      t: d.desde,
      texto: d.online ? `${d.clientid} se conectó` : `${d.clientid} se desconectó (${d.motivo ?? "sin motivo"})`,
    })),
    ...estado.alertas.map((a) => ({ t: a.timestamp ?? a.recibido, texto: `Alerta: ${a.clientid} bloqueado en ${a.topic}` })),
    ...estado.alertasAmbiente.map((a) => ({ t: a.ultima, texto: `Temperatura: ${a.sala} a ${a.temp} °C` })),
    ...estado.avisos.map((a) => ({ t: a.recibido, texto: a.tipo === "ya_resuelta" ? `${a.req_id} ya la había resuelto ${a.por}` : a.tipo })),
  ]
    .filter((it) => it.t)
    .sort((a, b) => new Date(b.t) - new Date(a.t));
}


export function PantallaDispositivos({ estado }) {

  const servicios = estado.presencia.filter((p) => !p.sitio);
  const puertas = estado.presencia.filter((p) => p.sitio);
  const telemetria = (p) => estado.telemetria.find((t) => t.puerta === p.nombre && t.sitio === p.sitio) ?? {};

  return (
    <div className="pila">
      <section className="card bloque">
        <h2>Servicios</h2>
        {servicios.length === 0 && <Vacio>Todavía no anunció su presencia ningún servicio.</Vacio>}
        {servicios.map((s) => (
          <div key={s.nombre} className="renglon">
            <div>
              <div className="medio">{s.nombre}</div>
              <div className="tenue chico">{s.online ? "en línea" : "caído"} desde {fechaHora(s.desde)}</div>
            </div>
            <Estado online={s.online} />
          </div>
        ))}
      </section>

      <section className="card bloque">
        <h2>Puertas</h2>
        {puertas.length === 0 ? (
          <Vacio>Todavía no llegó la presencia de ninguna puerta.</Vacio>
        ) : (
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr><th>Puerta</th><th>Sitio</th><th>Estado</th><th>Desde</th><th>Señal</th><th>Encendida hace</th><th>Memoria libre</th><th>Lector</th><th>Telemetría</th></tr>
              </thead>
              <tbody>
                {puertas.map((p) => {
                  const t = telemetria(p);
                  return (
                    <tr key={`${p.sitio}/${p.nombre}`}>
                      <td className="medio">{p.nombre}</td>
                      <td>{p.sitio}</td>
                      <td><Estado online={p.online} /></td>
                      <td>{fechaHora(p.desde)}</td>
                      <td>{t.rssi != null ? `${t.rssi} dBm` : "—"}</td>
                      <td>{t.uptime_s != null ? `${Math.round(t.uptime_s / 60)} min` : "—"}</td>
                      <td>{t.heap_libre != null ? `${Math.round(t.heap_libre / 1024)} KB` : "—"}</td>
                      <td>{t.lector_ok == null ? "—" : t.lector_ok ? <span className="pildora bien">OK</span> : <span className="pildora mal">Falla</span>}</td>
                      <td className="tenue">{t.recibida ? hora(t.recibida) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card bloque">
        <h2>Conexiones al broker <span className="tenue chico">webhook de EMQX</span></h2>
        {estado.dispositivos.length === 0 ? (
          <Vacio>Todavía no llegó ningún aviso de conexión.</Vacio>
        ) : (
          <div className="tabla-scroll">
            <table className="tabla">
              <thead><tr><th>Cliente</th><th>Estado</th><th>Desde</th><th>Motivo</th></tr></thead>
              <tbody>
                {estado.dispositivos.map((d) => (
                  <tr key={d.clientid}>
                    <td className="medio">{d.clientid}</td>
                    <td><Estado online={d.online} /></td>
                    <td>{fechaHora(d.desde)}</td>
                    <td className="tenue">{d.motivo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}


export function PantallaAlertas({ estado }) {

  return (
    <div className="pila">
      <section className="card bloque">
        <h2>Bloqueos de la ACL {estado.alertas.length > 0 && <span className="contador">{estado.alertas.length}</span>}</h2>
        {estado.alertas.length === 0 ? (
          <Vacio>Nadie intentó publicar ni suscribirse donde no debía.</Vacio>
        ) : (
          <div className="tabla-scroll">
            <table className="tabla">
              <thead><tr><th>Cuándo</th><th>Cliente</th><th>Usuario</th><th>Intentó</th><th>Topic</th><th>IP</th></tr></thead>
              <tbody>
                {estado.alertas.map((a, i) => (
                  <tr key={i}>
                    <td>{fechaHora(a.timestamp ?? a.ts ?? a.recibido)}</td>
                    <td className="medio">{a.clientid}</td>
                    <td>{a.username ?? "—"}</td>
                    <td>{a.action === "publish" ? "publicar" : a.action === "subscribe" ? "suscribirse" : a.action ?? "—"}</td>
                    <td><code>{a.topic}</code></td>
                    <td className="tenue">{a.peerhost ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card bloque">
        <h2>Alarmas de puertas {estado.alarmasWebhook.length > 0 && <span className="contador">{estado.alarmasWebhook.length}</span>}</h2>
        {estado.alarmasWebhook.length === 0 ? (
          <Vacio>Sin alarmas.</Vacio>
        ) : (
          <div className="tabla-scroll">
            <table className="tabla">
              <thead><tr><th>Cuándo</th><th>Puerta</th><th>Persona</th><th>Detalle</th></tr></thead>
              <tbody>
                {estado.alarmasWebhook.map((a, i) => (
                  <tr key={i}>
                    <td>{fechaHora(a.timestamp ?? a.recibido)}</td>
                    <td className="medio">{a.puerta}</td>
                    <td>{a.persona ?? "desconocida"}</td>
                    <td className="tenue">{a.detalle ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card bloque">
        <h2>Temperatura de las salas</h2>
        {estado.alertasAmbiente.length === 0 ? (
          <Vacio>Ninguna sala pasó los 27 °C.</Vacio>
        ) : (
          estado.alertasAmbiente.map((a) => (
            <div key={`${a.sitio}/${a.sala}`} className="renglon">
              <div>
                <div className="medio">{a.sala} <span className="tenue chico">· {a.sitio}</span></div>
                <div className="tenue chico">Pasó los 27 °C a las {fechaHora(a.desde)} · último aviso {hora(a.ultima)}</div>
              </div>
              <span className="pildora mal">{a.temp} °C</span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}


export function PantallaActividad({ estado }) {

  const items = itemsActividad(estado);

  return (
    <section className="card bloque">
      {items.length === 0 && <Vacio>Sin actividad todavía.</Vacio>}
      <ol className="actividad">
        {items.map((it, i) => (
          <li key={i}>
            <b>{fechaHora(it.t)}</b> · {it.texto}
          </li>
        ))}
      </ol>
    </section>
  );
}


// La maqueta isométrica (salas.html) va en un iframe: en vivo le pasa el estado por postMessage; en demo simula sola
export function PantallaSalas({ estado }) {

  const [vivo, setVivo] = useState(true);
  const [alto, setAlto] = useState(900);
  const marco = useRef(null);
  const datos = { salas: estado.salas, eventos: estado.eventos };

  const enviar = () => marco.current?.contentWindow?.postMessage(datos, location.origin);
  // Cada estado nuevo se le pasa a la maqueta; y apenas carga, avisa que está lista para recibir el primero
  useEffect(enviar, [estado.salas, estado.eventos, vivo]);
  useEffect(() => {
    const listo = (e) => {
      if (e.origin !== location.origin || e.source !== marco.current?.contentWindow) return;
      if (e.data?.listo) enviar();
      if (e.data?.alto) setAlto(e.data.alto);
    };
    addEventListener("message", listo);
    return () => removeEventListener("message", listo);
  });

  const servicio = estado.presencia.find((p) => p.nombre === "servicio-salas");

  return (
    <div className="pila">
      <section className="card maqueta">
        <div className="maqueta-cabeza">
          <h2>
            Maqueta{" "}
            {servicio && <span className={`pildora ${servicio.online ? "bien" : "mal"}`}>Servicio de salas {servicio.online ? "conectado" : "desconectado"}</span>}
          </h2>
          <div className="segmentado" role="group" aria-label="Origen de los datos">
            <button type="button" aria-pressed={vivo} onClick={() => setVivo(true)}>En vivo</button>
            <button type="button" aria-pressed={!vivo} onClick={() => setVivo(false)}>Demo</button>
          </div>
        </div>
        <iframe ref={marco} key={vivo} src={vivo ? "/salas.html?vivo" : "/salas.html"} title="Maqueta isométrica de las salas" style={{ height: alto }} />
      </section>
      <ListaSalas estado={estado} />
    </div>
  );
}


function ListaSalas({ estado }) {

  const caliente = (s) => estado.alertasAmbiente.find((a) => a.sitio === s.sitio && a.sala === s.sala);

  return (
    <section className="card bloque">
      <h2>Detalle</h2>
      {estado.salas.length === 0 && <Vacio>Todavía no llegó nada de las salas.</Vacio>}
      {estado.salas.map((s) => {
        const e = s.estado ?? {};
        const alerta = caliente(s);
        const temp = s.temp?.valor ?? e.temp;
        // El webhook queda en el log aunque la sala ya se haya enfriado: si hay estado, manda el estado
        const alta = s.estado ? e.alarma : Boolean(alerta);
        return (
          <div key={`${s.sitio}/${s.sala}`} className="renglon">
            <div>
              <div className="medio">{s.sala} <span className="tenue chico">· {s.sitio}</span></div>
              <div className="tenue chico">
                {temp != null && `${temp} °C`}
                {e.consigna != null && ` · consigna ${e.consigna} °C`}
                {typeof e.luz === "boolean" ? ` · luz ${e.luz ? `${e.nivel ?? ""} %` : "apagada"}` : e.luz && ` · luz ${e.luz}`}
                {e.cortina != null && ` · cortina ${e.cortina} %`}
                {e.kw != null && ` · ${e.kw} kW`}
                {e.ts && ` · estado de las ${hora(e.ts)}`}
              </div>
              <div className="tenue chico">
                {s.ocupantes.length === 0
                  ? "Vacía"
                  : `Dentro: ${s.ocupantes.map((o) => `${o.persona}${o.rol ? ` (${o.rol})` : ""}${o.vence ? ` hasta ${hora(o.vence)}` : ""}`).join(", ")}`}
              </div>
            </div>
            {alta ? (
              <span className="pildora mal">{alerta ? `Pasó los 27 °C a las ${hora(alerta.desde)}` : "Temperatura alta"}</span>
            ) : e.falla_crac ? (
              <span className="pildora mal">Falla del aire</span>
            ) : (
              <span className="pildora bien">Normal</span>
            )}
          </div>
        );
      })}
    </section>
  );
}


export function PantallaArquitectura() {

  return (
    <section className="card maqueta">
      <iframe src="/arquitectura.html" title="Diagrama de la arquitectura del sistema" className="alto" />
    </section>
  );
}
