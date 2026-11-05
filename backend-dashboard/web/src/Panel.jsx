import { useEffect, useState } from "react";
import { Marca } from "./Login.jsx";

const hora = (fecha) => new Date(fecha).toLocaleTimeString("es-AR", { hour12: false });

// "Carlos Pérez (Empleado)" → ["Carlos Pérez", "Empleado"]
const separarNombre = (texto = "") => {
  const m = texto.match(/^(.*?)\s*\((.*)\)$/);
  return m ? [m[1], m[2]] : [texto, ""];
};

const iniciales = (nombre) => nombre.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

const rechazada = (s) => s.resultado?.includes("DENEGADO");

export default function Panel({ usuario, alSalir, alPerderSesion }) {
  const [estado, setEstado] = useState({ pendientes: [], dispositivos: [], alertas: [] });
  const [conectado, setConectado] = useState(false);
  const [ahora, setAhora] = useState(Date.now());

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

  // Una pendiente cuyo tiempo pasó ya no se puede decidir, aunque el servidor no haya mandado otro aviso
  const vigente = (s) => s.estado === "pendiente" && Date.parse(s.vence) > ahora;
  const pendientes = estado.pendientes.filter(vigente);
  const resueltas = estado.pendientes.filter((s) => !vigente(s)).slice(0, 5);
  const servicio = estado.dispositivos.find((d) => d.clientid === "servicio_acceso");

  return (
    <div className="app">
      <nav className="lateral" aria-label="Secciones">
        <Marca />
        <a href="#pendientes" className="item activo">
          Panel {pendientes.length > 0 && <span className="contador">{pendientes.length}</span>}
        </a>
        <a href="#dispositivos" className="item">Dispositivos</a>
        <a href="#alertas" className="item">Alertas</a>
        <a href="#actividad" className="item">Actividad</a>
        <div className="usuario">
          <div className="avatar chico" aria-hidden="true">{iniciales(usuario)}</div>
          <span>{usuario}</span>
          <button className="boton texto" onClick={alSalir}>Salir</button>
        </div>
      </nav>

      <main className="contenido">
        <header className="encabezado">
          <div>
            <h1>Panel del admin</h1>
            <p className="tenue">Solicitudes de acceso que necesitan tu decisión, en vivo.</p>
          </div>
          {!conectado ? (
            <span className="pildora mal">Reconectando con el servidor…</span>
          ) : servicio?.online ? (
            <span className="pildora bien"><span className="punto" />Servicio de acceso conectado</span>
          ) : (
            <span className="pildora mal">Servicio de acceso desconectado</span>
          )}
        </header>

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
            <h2>Estado del sistema</h2>
            <div className="card estado">
              <Alertas alertas={estado.alertas} />
              <Dispositivos dispositivos={estado.dispositivos} />
            </div>
          </aside>
        </div>

        <div className="fila-inferior">
          <section className="card bloque">
            <h2>Resueltas recién</h2>
            {resueltas.length === 0 && <p className="tenue">Todavía ninguna.</p>}
            {resueltas.map((s) => (
              <div key={s.req_id} className="renglon">
                <span>
                  <b>{separarNombre(s.nombre ?? s.req_id)[0]}</b>{" "}
                  <span className="tenue">· {s.puerta} · {hora(s.resuelta ?? s.vence)}</span>
                </span>
                {s.estado === "vencida" || !s.resultado ? (
                  <span className="pildora neutra">Venció</span>
                ) : rechazada(s) ? (
                  <span className="pildora mal">Rechazada</span>
                ) : (
                  <span className="pildora bien">Aceptada</span>
                )}
              </div>
            ))}
          </section>
          <Actividad estado={estado} />
        </div>
      </main>
    </div>
  );
}

function Solicitud({ solicitud: s, ahora, alPerderSesion }) {
  const [enviada, setEnviada] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const [nombre, rol] = separarNombre(s.nombre ?? s.req_id);
  const total = Date.parse(s.vence) - Date.parse(s.creada);
  const restante = Math.max(0, Date.parse(s.vence) - ahora);
  const segundos = Math.ceil(restante / 1000);

  const decidir = async (decision) => {
    setEnviando(true);
    setError("");
    try {
      const r = await fetch("/api/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ req_id: s.req_id, decision }),
      });
      if (r.status === 401) return alPerderSesion();
      if (r.ok) setEnviada(true);
      else setError((await r.json()).error);
    } catch {
      setError("No se pudo conectar con el servidor");
    }
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
              {rol && `${rol} · `}quiere entrar a <b>{s.puerta}</b>
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
        <div><dt>UID</dt><dd>{s.uid}</dd></div>
        <div><dt>Pasó la tarjeta</dt><dd>{hora(s.creada)}</dd></div>
      </dl>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="acciones">
        {enviada ? (
          <span className="tenue">Decisión enviada. Esperando la respuesta del servicio…</span>
        ) : (
          <>
            <button className="boton" disabled={enviando} onClick={() => decidir("RECHAZAR")}>Rechazar</button>
            <button className="boton primario" disabled={enviando} onClick={() => decidir("ACEPTAR")}>Aceptar y abrir</button>
          </>
        )}
      </div>
    </article>
  );
}

function Alertas({ alertas }) {
  const ultima = alertas[0];
  if (!ultima) {
    return (
      <section id="alertas" className="tramo">
        <h3>Alertas de seguridad</h3>
        <p className="tenue">Sin alertas.</p>
      </section>
    );
  }
  return (
    <section id="alertas" className="tramo alerta">
      <h3>{alertas.length === 1 ? "1 alerta de seguridad" : `${alertas.length} alertas de seguridad`}</h3>
      <div>
        {ultima.clientid} intentó {ultima.action === "publish" ? "publicar" : "suscribirse"} en <b>{ultima.topic}</b>
      </div>
      <div className="tenue chico">
        Bloqueado por la ACL · {ultima.peerhost} · {hora(ultima.ts ?? ultima.recibido)}
      </div>
    </section>
  );
}

function Dispositivos({ dispositivos }) {
  const enLinea = dispositivos.filter((d) => d.online).length;
  return (
    <section id="dispositivos" className="tramo crece">
      <h3>
        Dispositivos <span>{enLinea} de {dispositivos.length} en línea</span>
      </h3>
      {dispositivos.map((d) => (
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

// Resumen armado con el estado actual (no es el log crudo: ese está por confirmar)
function Actividad({ estado }) {
  const items = [
    ...estado.pendientes.map((s) => ({ t: s.creada, texto: `${s.nombre ?? s.req_id} pendiente en ${s.puerta}` })),
    ...estado.pendientes
      .filter((s) => s.resuelta)
      .map((s) => ({ t: s.resuelta, texto: `${s.nombre ?? s.req_id}: ${rechazada(s) ? "rechazada" : "aceptada"}` })),
    ...estado.dispositivos.map((d) => ({
      t: d.desde,
      texto: d.online ? `${d.clientid} se conectó` : `${d.clientid} se desconectó (${d.motivo ?? "sin motivo"})`,
    })),
    ...estado.alertas.map((a) => ({ t: a.ts ?? a.recibido, texto: `Alerta: ${a.clientid} bloqueado en ${a.topic}` })),
  ]
    .sort((a, b) => new Date(b.t) - new Date(a.t))
    .slice(0, 8);

  return (
    <section id="actividad" className="card bloque gris">
      <h2>Actividad reciente</h2>
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
