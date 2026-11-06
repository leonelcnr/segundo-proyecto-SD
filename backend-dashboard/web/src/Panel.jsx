import { useEffect, useState } from "react";
import { Marca } from "./Login.jsx";
import { hora } from "./formato.js";
import { SECCIONES, PantallaDispositivos, PantallaAlertas, PantallaActividad, PantallaSalas, PantallaArquitectura, itemsActividad } from "./Secciones.jsx";

// La sección sale del hash (#salas), así el botón Atrás y los enlaces funcionan
const seccionDelHash = () => {
  const s = location.hash.slice(1);
  return SECCIONES.some(([id]) => id === s) ? s : "panel";
};

const iniciales = (nombre = "") => nombre.split(/[ -]/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

const VACIO = { pendientes: [], eventos: [], alarmas: [], presencia: [], telemetria: [], avisos: [], dispositivos: [], alertas: [], alarmasWebhook: [], salas: [], alertasAmbiente: [] };

// POST a la API del dashboard. Devuelve "" si salió bien, o el texto del error.
async function pedir(ruta, body, alPerderSesion) {

  try {
    const r = await fetch(ruta, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 401) return alPerderSesion(), "";
    return r.ok ? "" : (await r.json()).error;
  } catch {
    return "No se pudo conectar con el servidor";
  }
}

export default function Panel({ usuario, alSalir, alPerderSesion }) {
  const [estado, setEstado] = useState(VACIO);
  const [conectado, setConectado] = useState(false);
  const [ahora, setAhora] = useState(Date.now());
  const [seccion, setSeccion] = useState(seccionDelHash);

  useEffect(() => {
    const cambio = () => setSeccion(seccionDelHash());
    addEventListener("hashchange", cambio);
    return () => removeEventListener("hashchange", cambio);
  }, []);

  // Estado completo en vivo: el servidor lo manda al conectarse y cada vez que llega un aviso
  useEffect(() => {
    const stream = new EventSource("/stream");
    stream.onopen = () => setConectado(true);
    stream.onmessage = (e) => setEstado(JSON.parse(e.data));
    stream.onerror = () => {
      setConectado(false);
      // CLOSED = el servidor respondió con error (ej. 401): ver si la sesión venció. Si no, EventSource reintenta solo.
      if (stream.readyState === EventSource.CLOSED) alPerderSesion();
    };
    return () => stream.close();
  }, []);

  // Reloj para las cuentas regresivas
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Una pendiente cuyo tiempo pasó ya no se puede decidir, aunque el servicio todavía no haya mandado el estado nuevo
  const pendientes = estado.pendientes.filter((s) => Date.parse(s.vence) > ahora);
  const resueltas = estado.eventos.filter((e) => e.tipo === "acceso" || e.tipo === "denegado").slice(0, 5);
  const alarmas = estado.alarmas.filter((a) => a.activa);
  // La presencia por MQTT (Last Will) manda; si todavía no llegó, se usa el webhook de conexión
  const servicio =
    estado.presencia.find((p) => p.nombre === "servicio") ??
    estado.dispositivos.find((d) => d.clientid === "servicio");

  const [, , titulo, bajada] =SECCIONES.find(([id]) => id === seccion);

  return (
    <div className="app">
      <nav className="lateral" aria-label="Secciones">
        <Marca />
        {SECCIONES.map(([id, nombre]) => (
          <a key={id} href={`#${id}`} className={`item ${seccion === id ? "activo" : ""}`} aria-current={seccion === id ? "page" : undefined}>
            {nombre} {id === "panel" && pendientes.length > 0 && <span className="contador">{pendientes.length}</span>}
          </a>
        ))}
        <div className="usuario">
          <div className="avatar chico" aria-hidden="true">{iniciales(usuario)}</div>
          <span>{usuario}</span>
          <button className="boton texto" onClick={alSalir}>Salir</button>
        </div>
      </nav>

      <main className="contenido">
        <header className="encabezado">
          <div>
            <h1>{titulo}</h1>
            <p className="tenue">{bajada}</p>
          </div>
          {!conectado ? (
            <span className="pildora mal">Reconectando con el servidor…</span>
          ) : servicio?.online ? (
            <span className="pildora bien"><span className="punto" />Servicio de acceso conectado</span>
          ) : (
            <span className="pildora mal">Servicio de acceso desconectado</span>
          )}
        </header>

        {alarmas.map((a) => <Alarma key={a.sitio} alarma={a} alPerderSesion={alPerderSesion} />)}

        {seccion === "dispositivos" && <PantallaDispositivos estado={estado} />}
        {seccion === "alertas" && <PantallaAlertas estado={estado} />}
        {seccion === "actividad" && <PantallaActividad estado={estado} />}
        {seccion === "salas" && <PantallaSalas estado={estado} />}
        {seccion === "arquitectura" && <PantallaArquitectura estado={estado} />}

        {seccion === "panel" && <>
        <div className="fila-principal">
          <section id="pendientes" className="columna">
            <h2>
              Esperan tu decisión {pendientes.length > 0 && <span className="contador">{pendientes.length}</span>}
            </h2>
            {pendientes.length === 0 && (
              <div className="card vacia">Nadie está esperando en una puerta.</div>
            )}
            {pendientes.map((s) => (
              <Solicitud key={s.req_id} solicitud={s} ahora={ahora} alPerderSesion={alPerderSesion} />
            ))}
          </section>

          <aside className="columna">
            <h2>Estado del sistema <a href="#dispositivos" className="tenue chico ver-todo">Ver todo</a></h2>
            <div className="card estado">
              <Alertas alertas={estado.alertas} />
              <Dispositivos estado={estado} />
            </div>
          </aside>
        </div>

        <div className="fila-inferior">
          <section className="card bloque">
            <h2>Últimos accesos</h2>
            {resueltas.length === 0 && <p className="tenue">Todavía ninguno.</p>}
            {resueltas.map((e, i) => (
              <div key={i} className="renglon">
                <span>
                  <b>{e.persona ?? e.uid}</b>{" "}
                  <span className="tenue">· {e.puerta} · {e.detalle} · {hora(e.ts)}</span>
                </span>
                <span className={`pildora ${e.tipo === "acceso" ? "bien" : "mal"}`}>{e.tipo === "acceso" ? "Entró" : "Denegado"}</span>
              </div>
            ))}
          </section>
          <Actividad estado={estado} />
        </div>
        </>}
      </main>
    </div>
  );
}

function Solicitud({ solicitud: s, ahora, alPerderSesion }) {

  const [enviada, setEnviada] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const nombre = s.persona ?? s.req_id;
  const total = Date.parse(s.vence) - Date.parse(s.creada);
  const restante = Math.max(0, Date.parse(s.vence) - ahora);
  const segundos = Math.ceil(restante / 1000);

  const decidir = async (aprobar) => {
    setEnviando(true);
    const err = await pedir("/api/decision", { req_id: s.req_id, aprobar }, alPerderSesion);
    setError(err);
    setEnviada(!err);
    setEnviando(false);
  };

  return (
    <article className="card solicitud">
      <div className="solicitud-cabeza">
        <div className="persona">
          <div className="avatar" aria-hidden="true">{iniciales(nombre)}</div>
          <div>
            <div className="nombre">{nombre}</div>
            <div className="tenue">
              quiere entrar a <b>{s.puerta}</b>
            </div>
          </div>
        </div>
        <div className="reloj">
          <div className="segundos">{Math.floor(segundos / 60)}:{String(segundos % 60).padStart(2, "0")}</div>
          <div className="tenue chico">para decidir</div>
        </div>
      </div>

      <div className="barra" role="progressbar" aria-label="Tiempo restante" aria-valuenow={segundos} aria-valuemin={0} aria-valuemax={Math.round(total / 1000)}>
        <div style={{ width: `${(restante / total) * 100}%` }} />
      </div>

      <dl className="datos">
        <div><dt>Puerta</dt><dd>{s.puerta}</dd></div>
        <div><dt>Sitio</dt><dd>{s.sitio}</dd></div>
        <div><dt>Vence</dt><dd>{hora(s.vence)}</dd></div>
      </dl>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="acciones">
        {enviada ? (
          <span className="tenue">Decisión enviada. Esperando la respuesta del servicio…</span>
        ) : (
          <>
            <button className="boton" disabled={enviando} onClick={() => decidir(false)}>Rechazar</button>
            <button className="boton primario" disabled={enviando} onClick={() => decidir(true)}>Aceptar y abrir</button>
          </>
        )}
      </div>
    </article>
  );
}

// Alarma del sitio (retenida): suena en todas las puertas hasta que un admin la reconoce
function Alarma({ alarma: a, alPerderSesion }) {

  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const reconocer = async () => {
    setEnviando(true);
    setError(await pedir("/api/alarma/reconocer", { sitio: a.sitio }, alPerderSesion));
    setEnviando(false);
  };

  return (
    <section className="card alarma" role="alert">
      <div>
        <h2>Alarma en {a.sitio}</h2>
        <p>{a.motivo ?? "Sin motivo"}{a.puerta && ` · ${a.puerta}`}{a.desde && ` · desde ${hora(a.desde)}`}</p>
        {error && <p className="error">{error}</p>}
      </div>
      <button className="boton primario" disabled={enviando} onClick={reconocer}>Reconocer alarma</button>
    </section>
  );
}


function Alertas({ alertas }) {
  const ultima = alertas[0];
  if (!ultima) {
    return (
      <section className="tramo">
        <h3>Alertas de seguridad</h3>
        <p className="tenue">Sin alertas.</p>
      </section>
    );
  }
  return (
    <section className="tramo alerta">
      <h3>{alertas.length === 1 ? "1 alerta de seguridad" : `${alertas.length} alertas de seguridad`}</h3>
      <div>
        {ultima.clientid} intentó {ultima.action === "publish" ? "publicar" : "suscribirse"} en <b>{ultima.topic}</b>
      </div>
      <div className="tenue chico">
        Bloqueado por la ACL · {ultima.peerhost} · {hora(ultima.timestamp ?? ultima.recibido)}
      </div>
    </section>
  );
}

function Dispositivos({ estado }) {

  // Los servicios no tienen sitio: sólo las puertas
  const puertas = estado.presencia.filter((p) => p.sitio);
  const enLinea = puertas.filter((p) => p.online).length;
  const telemetria = (p) => estado.telemetria.find((t) => t.puerta === p.nombre && t.sitio === p.sitio);

  return (
    <section className="tramo crece">
      <h3>
        Puertas <span>{enLinea} de {puertas.length} en línea</span>
      </h3>
      {puertas.length === 0 && <p className="tenue">Todavía no llegó la presencia de ninguna puerta.</p>}
      {puertas.map((p) => {
        const t = telemetria(p);
        return (
          <div key={`${p.sitio}/${p.nombre}`} className="renglon">
            <div>
              <div className="medio">{p.nombre}</div>
              <div className="tenue chico">
                {p.sitio} · desde {hora(p.desde)}
                {t?.rssi != null && ` · señal ${t.rssi} dBm`}
              </div>
            </div>
            {t?.lector_ok === false ? (
              <span className="pildora mal">Falla del lector</span>
            ) : (
              <span className={`pildora ${p.online ? "bien" : "mal"}`}>{p.online ? "Online" : "Offline"}</span>
            )}
          </div>
        );
      })}

      {estado.dispositivos.length > 0 && <h3 className="subtitulo">Conexiones (webhook)</h3>}
      {estado.dispositivos.map((d) => (
        <div key={d.clientid} className="renglon">
          <div>
            <div className="medio">{d.clientid}</div>
            <div className="tenue chico">{d.online ? `desde ${hora(d.desde)}` : `${d.motivo ?? "desconectado"} · ${hora(d.desde)}`}</div>
          </div>
          <span className={`pildora ${d.online ? "bien" : "mal"}`}>{d.online ? "Online" : "Offline"}</span>
        </div>
      ))}
    </section>
  );
}

// Resumen: lo último de la actividad; la lista completa está en la sección Actividad
function Actividad({ estado }) {

  const items = itemsActividad(estado).slice(0, 8);

  return (
    <section className="card bloque gris">
      <h2>Actividad reciente <a href="#actividad" className="tenue chico ver-todo">Ver todo</a></h2>
      {items.length === 0 && <p className="tenue">Sin actividad todavía.</p>}
      <ol className="actividad">
        {items.map((it, i) => (
          <li key={i}>
            <b>{hora(it.t)}</b> · {it.texto}
          </li>
        ))}
      </ol>
    </section>
  );
}
