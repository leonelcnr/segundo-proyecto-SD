
// ===================== servicio de salas (simulado en la página) =====================
// Es lo que correría como un cliente MQTT más ("servicio-salas"): dueño del estado de cada sala,
// aplica las reglas y responde a cada pedido del celular. Los tiempos de las reglas anti-abuso son reales;
// la dinámica térmica corre SIM veces más rápido.
const SIM = 30;
// ?vivo: la muestra el dashboard con los datos reales del broker. Sin eso, es la demo que simula todo.
const VIVO = new URLSearchParams(location.search).has("vivo");
const REGLAS = {
  luzVentana: 30, luzMax: 4, luzBloqueo: 20, luzRebote: 1.2,
  cortinaVentana: 15, cortinaMax: 3, cortinaBloqueo: 15, cortinaVel: 11,
  climaVentana: 30, climaDeltaMax: 3, climaBloqueo: 30, compresorEspera: 180, hallSp: [17, 26],
  srvSp: [18, 27], srvPaso: 1, srvCada: 300, srvAlarma: 27, srvLuzMin: 30,
  hallVence: 15 * 60, srvVence: 10 * 60, aprobacion: 2.6,
};
const T_EXT = 29; // tarde de noviembre
const now = () => performance.now() / 1000;
const S = {
  rol: "empleado",
  acceso: { hall: 0, servidores: 0, esperando: 0 },
  hall: { luz: true, nivel: 80, cortina: 35, objetivo: 35, clima: true, modo: "frio", sp: 23, t: 26.4, compresorDesde: -1e9, apagadoEn: -1e9 },
  srv: { luz: "normal", sp: 22, t: 22.6, ultimoSp: -1e9, falla: false, alarma: false, kw: 4.2 },
  lock: { luz: 0, cortina: 0, clima: 0, crac: 0, sluz: 0 },
  hist: { luz: [], cortina: [], clima: [] },
  puerta: { hall: 0, servidores: 0 }, // instante hasta el que la puerta queda abierta
  ultimaLuz: -1e9,
};
let reqN = 0;
const reqId = () => "celular-1-" + (++reqN).toString(16).padStart(4, "0");
const fmt1 = (n) => n.toFixed(1);
const sitio = "edificio1";

function pedir(sala, disp, accion, valor) {
  const id = reqId();
  const msg = { req_id: id, sala, disp, accion };
  if (valor !== undefined) msg.valor = valor;
  bus("→", `usuario/celular-1/control`, JSON.stringify(msg));
  const r = reglas(sala, disp, accion, valor);
  if (r.ok) {
    bus("←", `usuario/celular-1/respuesta`, `{"req_id":"${id}","ok":true}`, "ok");
    bus("·", `sala/${sitio}/${sala}/estado`, "retenido · " + r.estado);
  } else {
    bus("←", `usuario/celular-1/respuesta`, `{"req_id":"${id}","ok":false,"motivo":"${r.motivo}"}`, "no");
    if (r.evento) bus("!", `acceso/${sitio}/eventos`, `{"tipo":"sala_rechazo","sala":"${sala}","detalle":"${r.evento}"}`, "rule");
  }
  toast(r.ok ? (r.aviso ? "ok" : "") : "no", r.titulo || (r.ok ? "Listo" : "Rechazado"), r.ok ? r.aviso || r.estado : r.texto);
  render();
  return r;
}

const dentro = (sala) => S.acceso[sala] > now();
const restan = (t) => Math.max(0, Math.ceil(t - now()));
const ventana = (lista, segs) => lista.filter((t) => now() - t < segs);

function reglas(sala, disp, accion, valor) {
  const t = now();
  if (!dentro(sala)) return { ok: false, motivo: "sin_acceso", titulo: "Sin acceso", texto: "Primero tenés que entrar a la sala." };
  if (sala === "hall") {
    if (disp === "luz") {
      if (S.lock.luz > t) return { ok: false, motivo: "bloqueado", titulo: `Luz bloqueada · ${restan(S.lock.luz)} s`, texto: `Demasiados cambios seguidos.` };
      if (accion === "toggle") {
        if (t - S.ultimaLuz < REGLAS.luzRebote) return { ok: false, motivo: "rebote", titulo: "Muy rápido", texto: `Esperá ${REGLAS.luzRebote} s entre encendidos: cuida el relé.` };
        S.hist.luz = ventana(S.hist.luz, REGLAS.luzVentana);
        if (S.hist.luz.length >= REGLAS.luzMax) {
          S.lock.luz = t + REGLAS.luzBloqueo;
          S.hist.luz = [];
          return { ok: false, motivo: "limite", titulo: `Luz bloqueada ${REGLAS.luzBloqueo} s`, texto: `Más de ${REGLAS.luzMax} cambios en ${REGLAS.luzVentana} s. El servicio avisa al dashboard.`, evento: `${REGLAS.luzMax + 1} cambios de luz en ${REGLAS.luzVentana} s` };
        }
        S.hist.luz.push(t);
        S.ultimaLuz = t;
        S.hall.luz = !S.hall.luz;
        return { ok: true, estado: `luz ${S.hall.luz ? "encendida" : "apagada"}`, aviso: `Te quedan ${REGLAS.luzMax - S.hist.luz.length} cambios en esta ventana de ${REGLAS.luzVentana} s.` };
      }
      if (accion === "nivel") {
        S.hall.nivel = valor;
        if (!S.hall.luz) { S.hall.luz = true; S.ultimaLuz = t; }
        return { ok: true, estado: `luz al ${valor} %` };
      }
    }
    if (disp === "cortina") {
      if (S.lock.cortina > t) return { ok: false, motivo: "bloqueado", titulo: `Cortina bloqueada · ${restan(S.lock.cortina)} s`, texto: "El motor está enfriándose." };
      S.hist.cortina = ventana(S.hist.cortina, REGLAS.cortinaVentana);
      if (S.hist.cortina.length >= REGLAS.cortinaMax && accion !== "parar") {
        S.lock.cortina = t + REGLAS.cortinaBloqueo;
        S.hist.cortina = [];
        S.hall.objetivo = S.hall.cortina;
        return { ok: false, motivo: "limite", titulo: `Cortina bloqueada ${REGLAS.cortinaBloqueo} s`, texto: `Más de ${REGLAS.cortinaMax} órdenes en ${REGLAS.cortinaVentana} s: protección térmica del motor.`, evento: `cortina: ${REGLAS.cortinaMax + 1} órdenes en ${REGLAS.cortinaVentana} s` };
      }
      if (accion !== "parar") S.hist.cortina.push(t);
      S.hall.objetivo = accion === "subir" ? 0 : accion === "bajar" ? 100 : S.hall.cortina;
      return { ok: true, estado: accion === "parar" ? `cortina detenida en ${Math.round(S.hall.cortina)} %` : `cortina ${accion === "subir" ? "subiendo" : "bajando"}` };
    }
    if (disp === "clima") {
      if (S.lock.clima > t) return { ok: false, motivo: "bloqueado", titulo: `Aire bloqueado · ${restan(S.lock.clima)} s`, texto: "Cambiaste demasiado la temperatura." };
      if (accion === "toggle") {
        if (!S.hall.clima) {
          const espera = S.hall.apagadoEn + REGLAS.compresorEspera / SIM - t;
          if (espera > 0) return { ok: false, motivo: "compresor", titulo: "Protección del compresor", texto: `Recién se apagó: puede volver a arrancar en ${Math.ceil(espera * SIM)} s (3 min reales, acá ×${SIM}).` };
          S.hall.clima = true;
        } else {
          S.hall.clima = false;
          S.hall.apagadoEn = t;
        }
        return { ok: true, estado: `aire ${S.hall.clima ? "encendido" : "apagado"}` };
      }
      if (accion === "modo") { S.hall.modo = valor; return { ok: true, estado: `modo ${valor}` }; }
      if (accion === "sp") {
        const nuevo = Math.min(REGLAS.hallSp[1], Math.max(REGLAS.hallSp[0], S.hall.sp + valor));
        if (nuevo === S.hall.sp) return { ok: false, motivo: "rango", titulo: "Fuera de rango", texto: `El hall admite entre ${REGLAS.hallSp[0]} y ${REGLAS.hallSp[1]} °C.` };
        S.hist.clima = ventana(S.hist.clima, REGLAS.climaVentana);
        const suma = S.hist.clima.reduce((a, h) => a + h.d, 0) + Math.abs(valor);
        if (suma > REGLAS.climaDeltaMax) {
          S.lock.clima = t + REGLAS.climaBloqueo;
          S.hist.clima = [];
          return { ok: false, motivo: "limite", titulo: `Aire bloqueado ${REGLAS.climaBloqueo} s`, texto: `Moviste más de ${REGLAS.climaDeltaMax} °C en ${REGLAS.climaVentana} s.`, evento: `consigna del hall: más de ${REGLAS.climaDeltaMax} °C en ${REGLAS.climaVentana} s` };
        }
        S.hist.clima.push({ t, d: Math.abs(valor), valueOf() { return this.t; } });
        S.hist.clima = S.hist.clima.filter((h) => t - h.t < REGLAS.climaVentana);
        S.hall.sp = nuevo;
        return { ok: true, estado: `consigna ${fmt1(nuevo)} °C` };
      }
    }
  }
  if (sala === "servidores") {
    if (disp === "vent") return { ok: false, motivo: "prohibido", titulo: "No se puede apagar", texto: "La refrigeración de la sala de servidores no se apaga desde la app: los equipos se recalientan en minutos.", evento: "intento de apagar la refrigeración" };
    if (disp === "sluz") {
      if (accion === "apagar") return { ok: false, motivo: "personal_dentro", titulo: "No se apaga", texto: `Con personal dentro la luz no baja de ahorro (${REGLAS.srvLuzMin} %).`, evento: "intento de apagar la luz de servidores" };
      if (S.lock.sluz > t) return { ok: false, motivo: "bloqueado", titulo: `Espera · ${restan(S.lock.sluz)} s`, texto: "Un cambio cada 5 s." };
      S.lock.sluz = t + 5;
      S.srv.luz = accion;
      return { ok: true, estado: `luz ${accion}` };
    }
    if (disp === "crac") {
      if (S.rol !== "admin") return { ok: false, motivo: "rol", titulo: "Sólo admin", texto: "Un empleado puede ver la sala; cambiar la consigna lo hace un admin.", evento: "consigna pedida por un empleado" };
      const espera = S.srv.ultimoSp + REGLAS.srvCada / SIM - t;
      if (espera > 0) return { ok: false, motivo: "ritmo", titulo: "Un cambio cada 5 min", texto: `El aire de precisión cambia de a ${REGLAS.srvPaso} °C. Próximo cambio en ${Math.ceil(espera * SIM)} s (×${SIM}).` };
      const nuevo = Math.min(REGLAS.srvSp[1], Math.max(REGLAS.srvSp[0], S.srv.sp + valor));
      if (nuevo === S.srv.sp) return { ok: false, motivo: "rango", titulo: "Fuera de rango", texto: `ASHRAE recomienda ${REGLAS.srvSp[0]} a ${REGLAS.srvSp[1]} °C a la entrada de los racks.` };
      S.srv.sp = nuevo;
      S.srv.ultimoSp = t;
      S.lock.crac = t + REGLAS.srvCada / SIM;
      return { ok: true, estado: `consigna CRAC ${fmt1(nuevo)} °C` };
    }
  }
  return { ok: false, motivo: "desconocido", texto: "Pedido desconocido." };
}

// entrada por las puertas (lo decide el servicio central, como en el resto del sistema)
function entrar(sala) {
  if (sala === "hall") {
    bus("→", `acceso/${sitio}/puerta/puerta-hall/lectura`, `{"req_id":"puerta-hall-${hex()}","uid":"CEL-A1B2C3D4"}`);
    bus("←", `acceso/${sitio}/puerta/puerta-hall/orden`, `{"accion":"abrir","mensaje":"Hola Ana"}`, "ok");
    bus("←", `usuario/celular-1/aviso`, `{"tipo":"uso_credencial","puerta":"puerta-hall","resultado":"acceso"}`, "ok");
    S.acceso.hall = now() + REGLAS.hallVence;
    S.puerta.hall = now() + 4;
    bus("·", `acceso/${sitio}/sala/hall/ocupantes`, `retenido · [{"celular":"celular-1","vence":"+15 min"}]`);
    toast("ok", "Entraste al hall", "La app ya puede controlar luz, cortina y aire durante 15 min.");
    tab("hall");
  } else {
    if (S.acceso.esperando > now()) return;
    bus("→", `acceso/${sitio}/puerta/puerta-servidores/lectura`, `{"req_id":"puerta-servidores-${hex()}","uid":"31A7506E"}`);
    if (S.rol === "empleado") {
      bus("←", `acceso/${sitio}/puerta/puerta-servidores/orden`, `{"accion":"esperar","mensaje":"Espere al admin"}`, "rule");
      S.acceso.esperando = now() + REGLAS.aprobacion;
      toast("", "Esperando al admin", "La puerta muestra «Espere al admin» y el dashboard recibe la solicitud.");
      setTimeout(() => {
        bus("→", `usuario/admin-1/pedido`, `{"tipo":"decision","aprobar":true}`);
        concederServidores();
      }, REGLAS.aprobacion * 1000);
    } else concederServidores();
  }
  render();
}
function concederServidores() {
  bus("←", `acceso/${sitio}/puerta/puerta-servidores/orden`, `{"accion":"abrir","mensaje":"Acceso permitido"}`, "ok");
  S.acceso.servidores = now() + REGLAS.srvVence;
  S.acceso.esperando = 0;
  S.puerta.servidores = now() + 4.5;
  bus("·", `acceso/${sitio}/sala/servidores/ocupantes`, `retenido · [{"celular":"celular-1","rol":"${S.rol}"}]`);
  toast("ok", "Entraste a Servidores", "Podés ver la sala; la refrigeración y la energía tienen controles estrictos.");
  tab("servidores");
  render();
}
const hex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");

// ===================== dinámica térmica =====================
let alarmaEnviada = false;
function simular(dt) {
  const ds = dt * SIM;
  const h = S.hall;
  const sol = (1 - h.cortina / 100) * 0.0018;
  let aire = 0;
  if (h.clima) {
    const err = h.t - h.sp;
    aire = h.modo === "frio" ? (err > -0.2 ? -Math.min(0.0075, 0.004 + err * 0.004) : 0) : err < 0.2 ? Math.min(0.0075, 0.004 - err * 0.004) : 0;
  }
  h.t += ((T_EXT - h.t) / 2400 + sol + aire) * ds;
  // cortina: motor a velocidad constante
  if (h.cortina !== h.objetivo) {
    const paso = REGLAS.cortinaVel * dt;
    h.cortina = Math.abs(h.objetivo - h.cortina) <= paso ? h.objetivo : h.cortina + Math.sign(h.objetivo - h.cortina) * paso;
  }
  const s = S.srv;
  const carga = 0.011 * (s.kw / 4.2);
  const frio = s.falla ? 0 : Math.max(0, Math.min(0.03, carga + (s.t - s.sp) * 0.02));
  s.t += (carga - frio + (24 - s.t) / 6000) * ds;
  if (!s.alarma && s.t > REGLAS.srvAlarma) {
    s.alarma = true;
    bus("!", `sala/${sitio}/servidores/telemetria`, `{"temp":${fmt1(s.t)}} → regla EMQX: temp > ${REGLAS.srvAlarma}`, "rule");
    bus("!", `webhook → receptor`, `{"tipo":"alarma_ambiente","sala":"servidores","temp":${fmt1(s.t)}}`, "no");
    toast("no", "Alarma de temperatura", `La sala pasó los ${REGLAS.srvAlarma} °C. La regla del broker disparó el webhook al receptor.`);
  }
  if (s.alarma && s.t < REGLAS.srvAlarma - 1) {
    s.alarma = false;
    bus("·", `acceso/${sitio}/eventos`, `{"tipo":"alarma_ambiente_fin","sala":"servidores"}`, "ok");
  }
}

// ===================== dibujo =====================
const svg = document.querySelector(".sl-stage svg");
const q = (sel) => svg.querySelector(sel);
const part = (name) => q(`[data-part="${name}"]`);
const rooms = { hall: q('[data-room="hall"]'), servidores: q('[data-room="servidores"]') };
const el = {
  sun: part("sun"), poolA: part("pool-a"), poolB: part("pool-b"), glowA: part("glow-a"),
  blind: part("blind"), slats: part("blind-slats"), bar: part("blind-bar"), blindLed: part("blind-led"),
  acAir: part("ac-air"), acLed: part("ac-led"), acText: part("ac-text"), flap: part("ac-flap"),
  thermo: part("thermo-text"), hallLeaf: part("hall-leaf"), srvLeaf: part("srv-leaf"),
  lcd1: part("lcd-1"), lcd2: part("lcd-2"), crac: part("crac-text"), cracSub: part("crac-sub"), fan: part("crac-fan"),
  cold: part("sv-cold-air"), hot: part("sv-hot-air"),
  hallLed: { g: part("hall-led-g"), y: part("hall-led-y"), r: part("hall-led-r") },
  srvLed: { g: part("srv-led-g"), y: part("srv-led-y"), r: part("srv-led-r") },
};
const lamps = [...rooms.hall.querySelectorAll(".lamp-head")];
const svLamp = q(".sv-lamp");
const acRoot = el.acText.closest("g").parentNode;
const at3 = (p) => iso(p, P);
const face = (y, pts) => pathOf(pts.map(([x, z]) => at3([x, y, z])), true);
let anim = { hallLeaf: 0, srvLeaf: 0, fan: 0, nivel: 0.8 };
const lastWrite = new Map();
const set = (node, key, value) => { if (lastWrite.get(node + key) === value) return; lastWrite.set(node + key, value); node.setAttribute(key, value); };
const setStyle = (node, prop, value) => { const id = prop; if (node["_" + id] === value) return; node["_" + id] = value; node.style[prop] = value; };

function draw(dt) {
  const h = S.hall, s = S.srv;
  // luz del hall: el nivel sigue al pedido con una rampa (dimmer)
  const objetivo = h.luz ? h.nivel / 100 : 0;
  anim.nivel += (objetivo - anim.nivel) * (1 - Math.exp(-dt / 0.35));
  const luz = anim.nivel;
  const abierta = 1 - h.cortina / 100;
  const brillo = 0.74 + 0.2 * luz + 0.08 * abierta;
  setStyle(rooms.hall, "filter", `brightness(${brillo.toFixed(3)}) saturate(${(0.85 + 0.15 * luz).toFixed(3)})`);
  for (const node of [el.poolA, el.poolB, el.glowA]) setStyle(node, "opacity", luz.toFixed(3));
  lamps.forEach((n) => n.classList.toggle("on", luz > 0.15));
  // cortina en el plano del muro
  const { x0, x1, z0, z1 } = WINDOW;
  const zb = z1 - (z1 - z0) * (h.cortina / 100);
  set(el.blind, "d", h.cortina > 0.5 ? face(-111.6, [[x0, z1], [x1, z1], [x1, zb], [x0, zb]]) : "");
  const slats = [];
  for (let z = z1 - 4; z > zb + 0.5; z -= 4) slats.push(pathOf([at3([x0, -111.6, z]), at3([x1, -111.6, z])]));
  set(el.slats, "d", slats.join(""));
  set(el.bar, "transform", translateAlong(P, [0, 0, zb - z1]));
  el.blindLed.classList.toggle("on", h.cortina !== h.objetivo);
  // sol sobre el piso (rayo inclinado que entra por la parte abierta de la ventana)
  const sun = ([x, z]) => at3([x + 0.32 * z / 0.78, -112 + z / 0.78, 0.2]);
  set(el.sun, "d", zb - z0 > 0.5 ? pathOf([[x0, z0], [x1, z0], [x1, zb], [x0, zb]].map(sun), true) : "");
  setStyle(el.sun, "opacity", (0.55 * Math.min(1, abierta * 1.2)).toFixed(3));
  // aire acondicionado del hall
  const enMarcha = h.clima && Math.abs(h.t - h.sp) > 0.15;
  acRoot.classList.toggle("ac-on", h.clima);
  acRoot.classList.toggle("ac-heat", h.modo === "calor");
  el.acAir.classList.toggle("heat", h.modo === "calor");
  setStyle(el.acAir, "opacity", enMarcha ? "1" : h.clima ? "0.25" : "0");
  el.acLed.classList.toggle("on", h.clima);
  set(el.flap, "transform", translateAlong(P, [0, h.clima ? 1.4 : 0, h.clima ? -1.6 : 0]));
  if (el.acText.textContent !== (h.clima ? String(Math.round(h.sp)) : "--")) el.acText.textContent = h.clima ? String(Math.round(h.sp)) : "--";
  const termo = fmt1(h.t) + "°";
  if (el.thermo.textContent !== termo) el.thermo.textContent = termo;
  // puertas
  const tNow = now();
  const ease = (cur, target, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
  anim.hallLeaf = ease(anim.hallLeaf, S.puerta.hall > tNow ? 1 : 0, 0.32);
  anim.srvLeaf = ease(anim.srvLeaf, S.puerta.servidores > tNow ? 1 : 0, 0.38);
  set(el.hallLeaf, "transform", translateAlong(P, [-(HALL_DOOR.x1 - HALL_DOOR.x0 - 4) * anim.hallLeaf, 0, 0]));
  set(el.srvLeaf, "transform", translateAlong(P, [0, 50 * anim.srvLeaf, 0]));
  const esperando = S.acceso.esperando > tNow;
  el.hallLed.g.classList.toggle("on", S.puerta.hall > tNow);
  el.srvLed.g.classList.toggle("on", S.puerta.servidores > tNow);
  el.srvLed.y.classList.toggle("on", esperando && Math.floor(tNow * 2.4) % 2 === 0);
  el.srvLed.r.classList.toggle("on", s.alarma && Math.floor(tNow * 3) % 2 === 0);
  el.hallLed.r.classList.toggle("on", s.alarma && Math.floor(tNow * 3) % 2 === 0);
  const l1 = esperando ? "Espere al admin" : S.puerta.servidores > tNow ? "Acceso permitido" : s.alarma ? "ALARMA TEMP" : "Acerque tarjeta";
  const l2 = esperando ? "Solicitud enviada" : S.puerta.servidores > tNow ? "Hola Ana" : s.alarma ? fmt1(s.t) + " C" : "Servidores";
  if (el.lcd1.textContent !== l1) el.lcd1.textContent = l1;
  if (el.lcd2.textContent !== l2) el.lcd2.textContent = l2;
  // sala de servidores
  const sl = s.luz === "normal" ? 1 : 0.3;
  setStyle(rooms.servidores, "filter", `brightness(${(0.8 + 0.2 * sl).toFixed(3)})`);
  svLamp.classList.toggle("on", s.luz === "normal");
  rooms.servidores.classList.toggle("sv-warm", s.t > 25 && s.t <= REGLAS.srvAlarma);
  rooms.servidores.classList.toggle("sv-hot", s.t > REGLAS.srvAlarma);
  setStyle(el.cold, "opacity", s.falla ? "0.08" : "1");
  setStyle(el.hot, "opacity", Math.min(1, 0.45 + (s.t - 21) * 0.12).toFixed(2));
  const ct = fmt1(s.t) + "°";
  if (el.crac.textContent !== ct) el.crac.textContent = ct;
  const sub = s.falla ? "FALLA COMPRESOR" : `SP ${fmt1(s.sp)} · AUTO`;
  if (el.cracSub.textContent !== sub) el.cracSub.textContent = sub;
  anim.fan = (anim.fan + dt * (s.falla ? 0.4 : 7)) % (Math.PI * 2);
  set(el.fan.firstElementChild, "d", blades(anim.fan));
}
function blades(a) {
  const [cx, cy, z] = CRAC_FAN;
  const d = [];
  for (let i = 0; i < 5; i++) {
    const t = a + (i * Math.PI * 2) / 5;
    d.push(lineOnTop([cx + Math.cos(t) * 3, cy + Math.sin(t) * 3], [cx + Math.cos(t + 0.5) * 10, cy + Math.sin(t + 0.5) * 10], z, P));
  }
  return d.join("");
}

// ===================== celular =====================
const phone = document.querySelector("[data-phone]");
const $ = (sel) => phone.querySelector(sel);
const $$ = (sel) => [...phone.querySelectorAll(sel)];
const out = (name) => $(`[data-out="${name}"]`);
function tab(name) {
  $$("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
}
function render() {
  const t = now(), h = S.hall, s = S.srv;
  for (const sala of ["hall", "servidores"]) {
    const row = $(`[data-acc="${sala}"]`);
    const st = dentro(sala) ? "dentro" : sala === "servidores" && S.acceso.esperando > t ? "espera" : "fuera";
    row.dataset.st = st;
    const txt = st === "dentro" ? `Dentro · vence en ${Math.ceil((S.acceso[sala] - t) / 60)} min` : st === "espera" ? "Esperando que un admin apruebe…" : sala === "hall" ? "Sin entrada · puerta común" : "Sin entrada · privilegiada";
    $(`[data-acc-txt="${sala}"]`).textContent = txt;
    row.querySelector(".ph-btn").disabled = st !== "fuera";
    $(`[data-panel="${sala}"]`).classList.toggle("open", st === "dentro");
  }
  $('[data-act="luz"]').setAttribute("aria-checked", String(h.luz));
  const rango = $('[data-act="nivel"]');
  if (document.activeElement !== rango) rango.value = h.nivel;
  out("nivel").textContent = h.luz ? `${h.nivel} %` : "apagada";
  out("cortina").textContent = h.cortina === h.objetivo ? `${Math.round(h.cortina)} % cerrada` : `${h.objetivo > h.cortina ? "bajando" : "subiendo"} · ${Math.round(h.cortina)} %`;
  out("cortina-bar").style.width = h.cortina + "%";
  $('[data-act="clima"]').setAttribute("aria-checked", String(h.clima));
  out("t-hall").textContent = fmt1(h.t) + "°";
  out("sp-hall").textContent = fmt1(h.sp) + "°";
  $('[data-act="frio"]').setAttribute("aria-pressed", String(h.modo === "frio"));
  $('[data-act="calor"]').setAttribute("aria-pressed", String(h.modo === "calor"));
  $('[data-card="clima"]').style.setProperty("--c", h.modo === "calor" ? "var(--sl-heat)" : "var(--sl-cool)");
  out("t-srv").textContent = fmt1(s.t) + "°";
  out("sp-srv").textContent = fmt1(s.sp) + "°";
  out("crac-st").textContent = s.falla ? "¡falla!" : s.alarma ? "alarma" : "refrigerando";
  for (const m of ["normal", "ahorro", "apagar"]) $(`[data-act="${m}"]`).setAttribute("aria-pressed", String(s.luz === m));
  out("kw").textContent = fmt1(s.kw);
  for (const [card, key] of [["luz", "luz"], ["cortina", "cortina"], ["clima", "clima"], ["crac", "crac"], ["sluz", "sluz"]]) {
    const left = S.lock[key] - t;
    const c = $(`[data-card="${card}"]`);
    const locked = left > 0 && !(key === "sluz" && left < 4.9 && false);
    c.classList.toggle("is-locked", locked);
    const label = key === "crac" ? `próximo en ${Math.ceil(left * SIM)} s` : `bloqueado ${Math.ceil(left)} s`;
    if (locked) c.querySelector(".ph-lock").textContent = label;
  }
  const rol = $('[data-act="rol"]');
  rol.dataset.rol = S.rol;
  rol.textContent = `celular-1 · ${S.rol}`;
  readout();
}
let toastTimer = 0;
const toastEl = $("[data-toast]");
function toast(kind, title, text) {
  toastEl.dataset.kind = kind;
  toastEl.querySelector("b").textContent = title;
  toastEl.querySelector("span").textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), kind === "no" ? 3600 : 2600);
}
const readoutEl = document.querySelector("[data-readout]");
function readout() {
  const h = S.hall, s = S.srv;
  const txt = `Hall ${fmt1(h.t)}° · luz ${h.luz ? h.nivel + "%" : "off"} · cortina ${Math.round(h.cortina)}% · Servidores ${fmt1(s.t)}°`;
  if (readoutEl.textContent !== txt) readoutEl.textContent = txt;
}

const acciones = {
  "entrar-hall": () => entrar("hall"),
  "entrar-servidores": () => entrar("servidores"),
  rol: () => { S.rol = S.rol === "empleado" ? "admin" : "empleado"; toast("", `Rol: ${S.rol}`, S.rol === "admin" ? "Un admin cambia la consigna del aire de precisión y entra directo a Servidores." : "Un empleado necesita aprobación para Servidores y no cambia la consigna."); render(); },
  luz: () => pedir("hall", "luz", "toggle"),
  subir: () => pedir("hall", "cortina", "subir"),
  bajar: () => pedir("hall", "cortina", "bajar"),
  parar: () => pedir("hall", "cortina", "parar"),
  clima: () => pedir("hall", "clima", "toggle"),
  "sp-": () => pedir("hall", "clima", "sp", -0.5),
  "sp+": () => pedir("hall", "clima", "sp", 0.5),
  frio: () => pedir("hall", "clima", "modo", "frio"),
  calor: () => pedir("hall", "clima", "modo", "calor"),
  "ssp-": () => pedir("servidores", "crac", "sp", -REGLAS.srvPaso),
  "ssp+": () => pedir("servidores", "crac", "sp", REGLAS.srvPaso),
  vent: () => pedir("servidores", "vent", "apagar"),
  normal: () => pedir("servidores", "sluz", "normal"),
  ahorro: () => pedir("servidores", "sluz", "ahorro"),
  apagar: () => pedir("servidores", "sluz", "apagar"),
};
phone.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (b && acciones[b.dataset.act] && b.dataset.act !== "nivel") acciones[b.dataset.act]();
  const tb = e.target.closest("[data-tab]");
  if (tb) tab(tb.dataset.tab);
  if (e.isTrusted) pausaTour();
});
const rango = $('[data-act="nivel"]');
rango.addEventListener("input", () => { out("nivel").textContent = rango.value + " %"; });
rango.addEventListener("change", () => { pedir("hall", "luz", "nivel", Number(rango.value)); pausaTour(); });

// ===================== bus MQTT =====================
const busEl = document.querySelector("[data-bus]");
function bus(dir, topic, data, kind = "") {
  const li = document.createElement("li");
  li.dataset.k = kind;
  li.innerHTML = `<span>${dir}</span><span class="t"></span><span class="d"></span>`;
  li.children[1].textContent = topic;
  li.children[2].textContent = data;
  busEl.prepend(li);
  while (busEl.children.length > 6) busEl.lastChild.remove();
}

// ===================== demo automática (un dedo toca el celular) =====================
const finger = $("[data-finger]");
const screen = $(".ph-screen");
const tourBtn = document.querySelector('[data-demo="tour"]');
const fallaBtn = document.querySelector('[data-demo="falla"]');
let touring = !VIVO && !matchMedia("(prefers-reduced-motion: reduce)").matches, tourStep = 0, tourTimer = 0, idleTimer = 0;
const wait = (s) => ({ wait: s });
const TOUR = [
  () => reset(), wait(0.6),
  "entrar-hall", wait(2.4),
  "luz", wait(1.6), "luz", wait(1.6),
  { range: 45 }, wait(1.4),
  "bajar", wait(2.6), "parar", wait(1.2), "subir", wait(1.2), "bajar", wait(1.2), "subir", wait(2.2),
  "sp-", wait(0.9), "sp-", wait(0.9), "sp-", wait(1.4),
  "luz", wait(1.3), "luz", wait(1.3), "luz", wait(1.3), "luz", wait(1.3), "luz", wait(2.8),
  "clima", wait(1.4), "clima", wait(2.8),
  "entrar-servidores", wait(4.2),
  "vent", wait(3.4), "apagar", wait(3), "ahorro", wait(1.8), "ssp+", wait(2.8),
  "rol", wait(1.6), "ssp+", wait(1.8), "ssp+", wait(3), "rol", wait(1.2), "normal", wait(1.6),
  "tab:hall", wait(2.4),
];
function reset() {
  Object.assign(S.acceso, { hall: 0, servidores: 0, esperando: 0 });
  Object.assign(S.lock, { luz: 0, cortina: 0, clima: 0, crac: 0, sluz: 0 });
  S.hist = { luz: [], cortina: [], clima: [] };
  Object.assign(S.hall, { luz: true, nivel: 80, objetivo: S.hall.cortina, clima: true, modo: "frio", sp: 23, apagadoEn: -1e9 });
  Object.assign(S.srv, { luz: "normal", sp: 22, ultimoSp: -1e9 });
  S.rol = "empleado";
  S.ultimaLuz = -1e9;
  tab("hall");
  render();
}
function aim(node) {
  const a = screen.getBoundingClientRect(), b = node.getBoundingClientRect();
  finger.style.transform = `translate(${b.left - a.left + b.width / 2}px, ${b.top - a.top + b.height / 2}px)`;
  finger.classList.add("on");
}
function tap(node, then) {
  aim(node);
  tourTimer = setTimeout(() => {
    finger.classList.remove("tap");
    void finger.offsetWidth;
    finger.classList.add("tap");
    node.classList.add("press");
    setTimeout(() => node.classList.remove("press"), 160);
    then();
  }, 780);
}
function nextStep() {
  if (!touring) return;
  const step = TOUR[tourStep % TOUR.length];
  tourStep++;
  if (typeof step === "function") { step(); return nextStep(); }
  if (step.wait) { tourTimer = setTimeout(nextStep, step.wait * 1000); return; }
  if (step.range !== undefined) {
    aim(rango);
    tourTimer = setTimeout(() => { rango.value = step.range; rango.dispatchEvent(new Event("input")); pedir("hall", "luz", "nivel", step.range); nextStep(); }, 800);
    return;
  }
  if (step.startsWith("tab:")) { const name = step.slice(4); return tap($(`[data-tab="${name}"]`), () => { tab(name); nextStep(); }); }
  const node = $(`[data-act="${step}"]`);
  if (!node) return nextStep();
  const panel = node.closest("[data-panel]");
  if (panel && panel.hidden) tab(panel.dataset.panel);
  tap(node, () => { acciones[step](); nextStep(); });
}
function setTour(on) {
  touring = on;
  tourBtn.setAttribute("aria-pressed", String(on));
  clearTimeout(tourTimer);
  if (on) { tourStep = 0; nextStep(); } else finger.classList.remove("on");
}
function pausaTour() {
  if (touring) setTour(false);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setTour(true); }, 20000);
}
tourBtn.addEventListener("click", () => { clearTimeout(idleTimer); setTour(!touring); });
fallaBtn.addEventListener("click", () => {
  S.srv.falla = !S.srv.falla;
  fallaBtn.setAttribute("aria-pressed", String(S.srv.falla));
  fallaBtn.textContent = S.srv.falla ? "Reparar el aire de precisión" : "Simular falla del aire de precisión";
  bus("!", `sala/${sitio}/servidores/telemetria`, S.srv.falla ? `{"crac":"falla","temp":${fmt1(S.srv.t)}}` : `{"crac":"ok"}`, S.srv.falla ? "no" : "ok");
  render();
});

// ===================== bucle =====================
let last = 0, visible = true, renderClock = 0;
function tick(ts) {
  const dt = last ? Math.min((ts - last) / 1000, 1 / 20) : 1 / 60;
  last = ts;
  if (!VIVO) simular(dt);
  draw(dt);
  renderClock += dt;
  if (renderClock > 0.25) { renderClock = 0; render(); }
  if (visible) requestAnimationFrame(tick); else last = 0;
}
new IntersectionObserver((es) => { const v = es[es.length - 1].isIntersecting; if (v && !visible) { visible = true; requestAnimationFrame(tick); } else visible = v; }).observe(document.querySelector(".iso-plate"));
if (!VIVO) {
  bus("·", `servicio-salas/presencia`, "online · retenido (Last Will: offline)", "ok");
  bus("·", `sala/${sitio}/hall/estado`, "retenido · luz 80 %, cortina 35 %, aire 23 °C");
}
render();
draw(1 / 60);
requestAnimationFrame(tick);
if (touring) setTimeout(() => setTour(true), 900); else setTour(false);


// ===================== modo en vivo =====================
// El dashboard le pasa por postMessage lo mismo que recibe por /stream: {salas, eventos}. Nada se simula.
const ocupantesAntes = { hall: 0, servidores: 0 };
const eventosVistos = new Set();

function aplicarVivo({ salas = [], eventos = [] }) {

  const t = now();
  for (const sala of salas) {
    const clave = sala.sala === "hall" ? "hall" : sala.sala === "servidores" ? "servidores" : null;
    if (!clave) continue;
    // Quien está dentro y hasta cuándo; si entró alguien nuevo, la puerta se abre un momento
    const vence = Math.max(0, ...sala.ocupantes.map((o) => Date.parse(o.vence) || 0));
    S.acceso[clave] = vence ? t + (vence - Date.now()) / 1000 : 0;
    if (sala.ocupantes.length > ocupantesAntes[clave]) S.puerta[clave] = t + 4;
    ocupantesAntes[clave] = sala.ocupantes.length;

    const e = sala.estado ?? {};
    const temp = sala.temp?.valor ?? e.temp;
    if (clave === "hall") {
      const h = S.hall;
      if (typeof e.luz === "boolean") h.luz = e.luz;
      if (typeof e.nivel === "number") h.nivel = e.nivel;
      if (typeof e.cortina === "number") h.cortina = e.cortina;
      h.objetivo = typeof e.cortina_objetivo === "number" ? e.cortina_objetivo : h.cortina;
      if (typeof e.clima === "boolean") h.clima = e.clima;
      if (e.modo === "frio" || e.modo === "calor") h.modo = e.modo;
      if (typeof e.consigna === "number") h.sp = e.consigna;
      if (typeof temp === "number") h.t = temp;
    } else {
      const v = S.srv;
      if (e.luz === "normal" || e.luz === "ahorro") v.luz = e.luz;
      if (typeof e.consigna === "number") v.sp = e.consigna;
      if (typeof e.kw === "number") v.kw = e.kw;
      if (typeof temp === "number") v.t = temp;
      v.falla = e.falla_crac === true;
      // Sin estado, la alarma sale de la temperatura (como la regla de EMQX)
      v.alarma = typeof e.alarma === "boolean" ? e.alarma : v.t > REGLAS.srvAlarma;
    }
  }
  // Los eventos de las salas, del más viejo al más nuevo, en la tira del broker
  for (const ev of eventos.filter((x) => x.sala).reverse()) {
    const k = [ev.sala, ev.ts, ev.tipo, ev.detalle].join("|");
    if (eventosVistos.has(k)) continue;
    eventosVistos.add(k);
    const tipo = ev.tipo === "sala_accion" ? "ok" : ev.tipo === "sala_rechazo" || ev.tipo === "alarma_ambiente" ? "no" : "";
    bus("·", `sala/${ev.sitio}/${ev.sala}/eventos`, `${ev.tipo} · ${ev.persona ? ev.persona + " · " : ""}${ev.detalle ?? ""}`, tipo);
  }
  render();
}

if (VIVO) {
  document.body.classList.add("vivo");
  const pista = document.querySelector('[data-corner="hint"]');
  if (pista) pista.textContent = "En vivo · datos del broker";
  // Sólo el dashboard (mismo origen) le puede pasar datos
  addEventListener("message", (e) => { if (e.origin === location.origin && e.data?.salas) aplicarVivo(e.data); });
  parent.postMessage({ listo: true }, location.origin);
}

// Dentro del dashboard: le avisa el alto, así el iframe no tiene barra de scroll propia
if (parent !== window) {
  new ResizeObserver(() => parent.postMessage({ alto: document.documentElement.scrollHeight }, location.origin)).observe(document.body);
}
