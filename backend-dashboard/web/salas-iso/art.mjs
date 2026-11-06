// Geometría isométrica de las dos salas (Hall y Sala de Servidores).
// Unidades del mundo: ~1 unidad = 17 mm. x e y en el piso, z hacia arriba.
// Servidores a la izquierda (x < 0), Hall a la derecha (x > 0); el tabique x = 0 está cortado a 44.
import * as k from "./kit/iso-kit.mjs";
import * as G from "./kit/lathe.mjs";

export const WIDTH = 760;
export const HEIGHT = 540;
export const H = 128; // alto de los muros del fondo
export const PART_H = 44; // tabique cortado (vista de corte)
export const RF = 8; // piso técnico de la sala de servidores

const PLATE = { x: -240, y: -128, w: 478, d: 266, r: 10 };
const PLATE_H = 12;
const FOOT_H = 5;

export const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-230, -120, H], [230, -120, H], [-230, 120, H]],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: 45 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const poly = (pts) => k.pathOf(pts.map(at), true);
const slab = (plan, z, h, steps = 2, bevel = 0) => k.slabOf({ r: 0, ...plan }, z, h, P, steps, bevel);
const byDepth = (items) => [...items].sort((a, b) => k.depthOf(a.c, P) - k.depthOf(b.c, P));
// Paths on a vertical face: plane y = const ("Y") or x = const ("X").
const onY = (y, pts, closed = true) => k.pathOf(pts.map(([x, z]) => at([x, y, z])), closed);
const onX = (x, pts, closed = true) => k.pathOf(pts.map(([y, z]) => at([x, y, z])), closed);
const rectY = (y, x0, x1, z0, z1) => onY(y, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
const rectX = (x, y0, y1, z0, z1) => onX(x, [[y0, z0], [y1, z0], [y1, z1], [y0, z1]]);
const circleOn = (cx, cy, r, z, steps = 48) => k.pathOf(k.circleRing(cx, cy, r, steps).map(([x, y]) => at([x, y, z])), true);
const fmt = (n) => Math.round(n * 10) / 10;


let airId = 0;
// Línea de aire: trazo con guiones que corren y un degradé que la desvanece en las dos puntas.
function airPath(pts) {
  const id = `sl-air-${airId++}`;
  const a = pts[0], b = pts[pts.length - 1];
  const stops = [[0, 0], [0.22, 0.95], [0.7, 0.8], [1, 0]].map(([o, a]) => `<stop offset="${o}" stop-color="currentColor" stop-opacity="${a}"/>`).join("");
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}">${stops}</linearGradient><path class="air" stroke="url(#${id})" d="${k.pathOf(pts)}" style="--d:${((airId * 0.37) % 1.25).toFixed(2)}s"/>`;
}

// ---------- base ----------
function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of k.corners(PLATE, 24).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P))) {
    out.push(S(k.cylinder(x, y, 8, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 6, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.4), { tone: "mid" }));
  // borde frontal: regla y placa de rótulo
  const strip = { x: -150, y: 124, w: 300, d: 8, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2.4, 4.4], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 4, 0.6]), at([strip.x + strip.w - 2, strip.y + 4, 0.6])], { size: 0.45 }));
  const label = { x: 168, y: 123, w: 56, d: 10, r: 1.2 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3, 0.3), { tone: "mid", crease: "none" }));
  out.push(k.faceTextSvg(k.topMatrix([label.x + 4, label.y + 6.6], 0.8, P, "x"), "EDIFICIO 1", { size: 3.4, tone: "lo" }));
  out.push(D(k.corners(label, 1.8).map(([x, y]) => at([x, y, 0.8])), { size: 0.4 }));
  return out.join("");
}

// ---------- Sala de servidores ----------
export const RACKS = [0, 1, 2, 3].map((i) => ({ x: -186 + i * 34, y: -106, w: 32, d: 44 }));
const RACK_TOP = RF + 88;
export const TILES_PERF = [-174, -126, -78].map((x) => ({ x, y: -60, w: 24, d: 24 }));
export const CRAC = { x: -220, y: -44, w: 30, d: 58 };
const CRAC_TOP = RF + 104;

function serverRoom() {
  const out = [];
  // muros del fondo (corte superior en tono más fuerte, como en un plano de corte)
  out.push(S(slab({ x: -230, y: -120, w: 226, d: 8 }, 0, H), { tone: "mid" }));
  out.push(S(slab({ x: -230, y: -112, w: 8, d: 232 }, 0, H), { tone: "mid" }));
  // piso técnico
  out.push(S(slab({ x: -222, y: -112, w: 218, d: 232 }, 0, RF, 2, 0.5), { tone: "mid" }));
  const grid = [];
  for (let x = -198; x < -4; x += 24) grid.push(k.lineOnTop([x, -112], [x, 120], RF, P));
  for (let y = -88; y < 120; y += 24) grid.push(k.lineOnTop([-222, y], [-4, y], RF, P));
  out.push(L(grid.join(""), { tone: "faint" }));
  out.push(L(k.sideTicks(-222, -4, 24, 1, 120, RF, [RF, RF], P).minor + k.sideTicks(-222, -4, 24, 1, 120, RF, [RF, RF], P).major, { tone: "faint" }));
  // baldosas perforadas del pasillo frío
  for (const t of TILES_PERF) {
    out.push(`<path class="sv-cold" d="${poly([[t.x, t.y, RF], [t.x + t.w, t.y, RF], [t.x + t.w, t.y + t.d, RF], [t.x, t.y + t.d, RF]])}"/>`);
    out.push(L(k.planOutline(k.insetPlan({ ...t, r: 0 }, 2), RF, P, 2), { tone: "lo" }));
    out.push(D(k.dotGrid(t.x + 4, t.y + 4, 6, 6, 3.2, RF, P), { size: 0.38, tone: "mid" }));
  }
  // luminaria LED lineal en el muro del fondo
  out.push(S(slab({ x: -180, y: -112, w: 124, d: 4, r: 1 }, 114, 4, 2, 0.3), { tone: "mid", className: "sv-lamp" }));
  out.push(L(k.segment([-180, -108, 115], [-56, -108, 115], P), { tone: "lo", className: "sv-lamp-line" }));
  out.push(D([at([-176, -108, 117]), at([-60, -108, 117])], { size: 0.4 }));
  // sensor de temperatura (DHT11) en el muro
  out.push(S(slab({ x: -36, y: -112, w: 9, d: 3, r: 0.8 }, 64, 12, 2, 0.3), { tone: "mid" }));
  out.push(D([72, 69].flatMap((z) => [-34, -31.5, -29].map((x) => at([x, -109, z]))), { size: 0.4, tone: "lo" }));
  out.push(`<circle class="sv-dht" cx="${fmt(at([-31.5, -109, 66.5])[0])}" cy="${fmt(at([-31.5, -109, 66.5])[1])}" r="0.9"/>`);
  out.push(k.wireSvg(at([-31.5, -111, 64]), at([-31.5, -111, RF]), { tone: "lo", size: 0.7 }));

  // flujo de aire frío que sube de las baldosas (detrás de los racks no: delante)
  const items = [];
  // racks
  RACKS.forEach((r, i) => items.push({ c: [r.x + r.w / 2, r.y + r.d / 2, 0], svg: rack(r, i) }));
  // equipo de aire de precisión (CRAC)
  items.push({ c: [CRAC.x + CRAC.w / 2, CRAC.y + CRAC.d / 2, 0], svg: crac() });
  // UPS y banco de baterías
  items.push({ c: [-205, 62, 0], svg: ups() });
  // matafuego
  items.push({ c: [-212, 30, 0], svg: extinguisher() });
  for (const item of byDepth(items)) out.push(item.svg);
  out.push(cableTray());
  out.push(serverAir());
  return out.join("");
}

function rack(r, i) {
  const out = [];
  out.push(S(slab(r, RF, 88, 2, 0.5), { tone: "mid", inner: L(k.sideSeam({ ...r, r: 0 }, RF + 4, P, 2), { tone: "lo" }) }));
  const fy = r.y + r.d; // cara frontal (mira a +y)
  const x0 = r.x + 3, x1 = r.x + r.w - 3, z0 = RF + 6, z1 = RACK_TOP - 4;
  out.push(L(rectY(fy, x0, x1, z0, z1), { tone: "lo" }));
  // unidades de rack: líneas que terminan en el marco
  const units = [];
  for (let z = z0 + 6; z < z1 - 1; z += 6) units.push(onY(fy, [[x0, z], [x1, z]], false));
  out.push(L(units.join(""), { tone: "faint" }));
  // LEDs de cada servidor
  const leds = [];
  for (let z = z0 + 3, n = 0; z < z1 - 2; z += 6, n++) leds.push({ p: at([x1 - 2.6, fy, z]), n });
  out.push(`<g class="sv-leds" data-rack="${i}">${leds.map(({ p, n }) => `<circle cx="${fmt(p[0])}" cy="${fmt(p[1])}" r="0.75" style="--d:${((i * 7 + n * 13) % 17) * 0.19}s"/>`).join("")}</g>`);
  out.push(D([[x0 + 2.4, z1 - 3], [x0 + 2.4, z0 + 3]].map(([x, z]) => at([x, fy, z])), { size: 0.4, tone: "mid" }));
  // manija
  out.push(L(onY(fy, [[x0 + 5, z0 + 34], [x0 + 5, z0 + 46]], false), { tone: "mid" }));
  out.push(D([at([x0 + 5, fy, z0 + 34]), at([x0 + 5, fy, z0 + 46])], { size: 0.55, tone: "hi" }));
  // rejilla superior (ranuras cerradas)
  const top = RACK_TOP;
  const slots = [];
  for (let y = r.y + 8; y < r.y + r.d - 8; y += 4) slots.push(k.onTop([[r.x + 6, y], [r.x + r.w - 6, y], [r.x + r.w - 6, y + 1.4], [r.x + 6, y + 1.4]], top, P, true));
  out.push(L(slots.join(""), { tone: "faint" }));
  // placa de identificación
  out.push(L(rectY(fy, r.x + r.w / 2 - 5, r.x + r.w / 2 + 5, z1 + 1, z1 + 3.2), { tone: "lo" }));
  return out.join("");
}

function crac() {
  const c = CRAC;
  const out = [];
  out.push(S(slab(c, RF, 104, 2, 0.6), { tone: "mid", inner: L(k.sideSeam({ ...c, r: 0 }, RF + 70, P, 2), { tone: "lo" }) }));
  const fx = c.x + c.w; // cara frontal mira a +x
  // rejilla de retorno (ranuras verticales cerradas)
  const slots = [];
  for (let y = c.y + 6; y < c.y + c.d - 6; y += 3.4) slots.push(onX(fx, [[y, RF + 74], [y + 1.4, RF + 74], [y + 1.4, CRAC_TOP - 6], [y, CRAC_TOP - 6]]));
  out.push(L(slots.join(""), { tone: "faint" }));
  // puertas frontales con bisagras
  out.push(L(rectX(fx, c.y + 3, c.y + c.d / 2 - 0.6, RF + 4, RF + 66) + rectX(fx, c.y + c.d / 2 + 0.6, c.y + c.d - 3, RF + 4, RF + 66), { tone: "lo" }));
  out.push(L(onX(fx, [[c.y + c.d / 2 - 3, RF + 30], [c.y + c.d / 2 - 3, RF + 40]], false) + onX(fx, [[c.y + c.d / 2 + 3, RF + 30], [c.y + c.d / 2 + 3, RF + 40]], false), { tone: "mid" }));
  out.push(D([-3, 3].flatMap((dy) => [RF + 30, RF + 40].map((z) => at([fx, c.y + c.d / 2 + dy, z]))), { size: 0.55, tone: "hi" }));
  // pantalla del equipo
  const sy0 = c.y + 8, sy1 = c.y + 30, sz0 = RF + 48, sz1 = RF + 60;
  out.push(`<path class="crt-screen" data-part="crac-screen" d="${rectX(fx, sy0, sy1, sz0, sz1)}"/>`);
  out.push(L(rectX(fx, sy0, sy1, sz0, sz1), { tone: "mid" }));
  const m = k.sideMatrix([fx, sy0 + 2], sz1 - 2, P, "right");
  out.push(`<g transform="${m}"><text class="screen-text" data-part="crac-text" x="${-(sy1 - sy0 - 4)}" y="6.6" font-size="6.2">22.0°</text><text class="screen-sub" data-part="crac-sub" x="${-(sy1 - sy0 - 4)}" y="9.8" font-size="2.4">SP 22.0 · AUTO</text></g>`);
  out.push(`<circle class="sv-ok" data-part="crac-led" cx="${fmt(at([fx, sy1 + 4, sz1 - 2])[0])}" cy="${fmt(at([fx, sy1 + 4, sz1 - 2])[1])}" r="1"/>`);
  out.push(D([at([fx, c.y + 3, RF + 70]), at([fx, c.y + c.d - 3, RF + 70])], { size: 0.45 }));
  // rejilla superior
  out.push(L(k.planOutline({ x: c.x + 4, y: c.y + 6, w: c.w - 8, d: c.d - 12, r: 1 }, CRAC_TOP, P, 2), { tone: "lo" }));
  const fan = c.y + c.d / 2;
  out.push(L(k.ring(c.x + c.w / 2, fan, 10, CRAC_TOP, P, 40) + k.ring(c.x + c.w / 2, fan, 3, CRAC_TOP, P, 20), { tone: "lo" }));
  out.push(`<g data-part="crac-fan">${L(fanBlades(c.x + c.w / 2, fan, CRAC_TOP, 0), { tone: "mid" })}</g>`);
  return out.join("");
}

export function fanBlades(cx, cy, z, a) {
  const d = [];
  for (let i = 0; i < 5; i++) {
    const t = a + (i * Math.PI * 2) / 5;
    d.push(k.lineOnTop([cx + Math.cos(t) * 3, cy + Math.sin(t) * 3], [cx + Math.cos(t + 0.5) * 10, cy + Math.sin(t + 0.5) * 10], z, P));
  }
  return d.join("");
}
export const CRAC_FAN = [CRAC.x + CRAC.w / 2, CRAC.y + CRAC.d / 2, CRAC_TOP];

function ups() {
  const out = [];
  const u = { x: -220, y: 40, w: 30, d: 44 };
  out.push(S(slab(u, RF, 62, 2, 0.5), { tone: "mid" }));
  const fx = u.x + u.w;
  out.push(L(rectX(fx, u.y + 4, u.y + u.d - 4, RF + 4, RF + 40), { tone: "lo" }));
  const vents = [];
  for (let z = RF + 8; z < RF + 37; z += 3.2) vents.push(onX(fx, [[u.y + 8, z], [u.y + u.d - 8, z], [u.y + u.d - 8, z + 1.2], [u.y + 8, z + 1.2]]));
  out.push(L(vents.join(""), { tone: "faint" }));
  const sy0 = u.y + 6, sy1 = u.y + 26, sz0 = RF + 46, sz1 = RF + 56;
  out.push(`<path class="crt-screen" d="${rectX(fx, sy0, sy1, sz0, sz1)}"/>`);
  out.push(L(rectX(fx, sy0, sy1, sz0, sz1), { tone: "mid" }));
  const m = k.sideMatrix([fx, sy0 + 2], sz1 - 2, P, "right");
  out.push(`<g transform="${m}"><text class="screen-text" data-part="ups-text" x="${-(sy1 - sy0 - 4)}" y="5.4" font-size="4.4">4.2 kW</text><text class="screen-sub" x="${-(sy1 - sy0 - 4)}" y="8" font-size="2.2">UPS 100%</text></g>`);
  for (const [i, y] of [[0, u.y + 32], [1, u.y + 36]]) out.push(`<circle class="${i ? "sv-ok" : "sv-ok"}" cx="${fmt(at([fx, y, RF + 51])[0])}" cy="${fmt(at([fx, y, RF + 51])[1])}" r="0.9"/>`);
  // banco de baterías
  const b = { x: -220, y: 88, w: 30, d: 28 };
  out.push(S(slab(b, RF, 48, 2, 0.5), { tone: "mid" }));
  out.push(L(rectX(b.x + b.w, b.y + 3, b.y + b.d - 3, RF + 4, RF + 44), { tone: "lo" }));
  out.push(L(onX(b.x + b.w, [[b.y + 3, RF + 24], [b.y + b.d - 3, RF + 24]], false), { tone: "faint" }));
  out.push(D([at([b.x + b.w, b.y + 6, RF + 40]), at([b.x + b.w, b.y + b.d - 6, RF + 40])], { size: 0.45 }));
  return out.join("");
}

function extinguisher() {
  const out = [];
  out.push(S(k.cylinder(-212, 28, 4.4, RF, 24, P, 24), { tone: "mid", className: "fx-red" }));
  out.push(L(k.sideArc(-212, 28, 4.4, RF + 18, P, 16), { tone: "lo" }));
  out.push(S(k.cylinder(-212, 28, 1.6, RF + 24, 3, P, 14), { tone: "mid" }));
  out.push(S(slab({ x: -213, y: 28, w: 2, d: 6, r: 0.6 }, RF + 26, 1.4, 2), { tone: "mid", crease: "none" }));
  return out.join("");
}

function cableTray() {
  const out = [];
  const z = RACK_TOP + 8;
  // soportes sobre cada rack
  for (const r of RACKS) {
    const cx = r.x + r.w / 2;
    for (const y of [-100, -72]) out.push(S(slab({ x: cx - 1, y: y - 1, w: 2, d: 2 }, RACK_TOP, 8, 2), { tone: "mid", crease: "none" }));
  }
  out.push(S(slab({ x: -190, y: -102, w: 144, d: 2.4 }, z, 3, 2), { tone: "mid" }));
  const rungs = [];
  for (let x = -186; x <= -50; x += 8) rungs.push(k.lineOnTop([x, -99.6], [x, -76.4], z + 3, P));
  out.push(L(rungs.join(""), { tone: "lo" }));
  // cables sobre la bandeja: entran y salen por los extremos
  const cables = [];
  for (const y of [-94, -90, -86, -82]) cables.push(k.lineOnTop([-186, y], [-50, y], z + 3, P));
  out.push(L(cables.join(""), { tone: "mid" }));
  out.push(S(slab({ x: -190, y: -76.4, w: 144, d: 2.4 }, z, 3, 2), { tone: "mid" }));
  // bajadas de cable a cada rack
  for (const r of RACKS) out.push(k.wireSvg(at([r.x + 10, -88, z + 3]), at([r.x + 10, -88, RACK_TOP]), { tone: "mid", size: 0.8 }));
  return out.join("");
}

function serverAir() {
  const cold = [];
  // aire frío que sube desde las baldosas perforadas hacia el frente de los racks
  TILES_PERF.forEach((t, i) => {
    for (let j = 0; j < 3; j++) {
      const x = t.x + 6 + j * 6;
      const pts = [];
      for (let s = 0; s <= 10; s++) {
        const z = RF + 2 + s * 6.6;
        const y = t.y + 12 - s * 0.9 - s * s * 0.05;
        pts.push(at([x + Math.sin(s * 0.7 + i + j) * 1.2, y, z]));
      }
      cold.push(airPath(pts));
    }
  });
  const hot = [];
  // aire caliente que sale por arriba de los racks y vuelve al retorno del CRAC
  for (let j = 0; j < 4; j++) {
    const pts = [];
    const x0 = -58 - j * 30;
    for (let s = 0; s <= 14; s++) {
      const u = s / 14;
      pts.push(at([x0 + (CRAC.x + CRAC.w + 4 - x0) * u * u, -98 + j * 4 + u * 34, RACK_TOP + 14 + Math.sin(u * Math.PI) * 10 - u * 8]));
    }
    hot.push(airPath(pts));
  }
  return `<g class="air-group" data-part="sv-cold-air">${cold.join("")}</g><g class="air-group heat" data-part="sv-hot-air">${hot.join("")}</g>`;
}

// ---------- Hall ----------
export const WINDOW = { x0: 22, x1: 104, z0: 44, z1: 104 };
export const HALL_DOOR = { x0: 152, x1: 198, z1: 92 };
export const LEAF = { y0: -30, y1: 22 };
export const KIOSK = { x: 12, y: 30, w: 9, d: 18 };
const KIOSK_Z = 46;

function hallBack() {
  const out = [];
  out.push(S(slab({ x: -4, y: -120, w: 234, d: 8 }, 0, H), { tone: "mid" }));
  // piso del hall: baldosas que corren de borde a borde
  out.push(`<path class="hall-floor" d="${poly([[4, -112, 0.05], [222, -112, 0.05], [222, 120, 0.05], [4, 120, 0.05]])}"/>`);
  const grid = [];
  for (let x = 28; x < 222; x += 24) grid.push(k.lineOnTop([x, -112], [x, 120], 0, P));
  for (let y = -88; y < 120; y += 24) grid.push(k.lineOnTop([4, y], [222, y], 0, P));
  out.push(L(grid.join(""), { tone: "faint" }));
  out.push(L(k.pathOf([at([4, 120, 0]), at([222, 120, 0]), at([222, -112, 0])]), { tone: "lo" }));
  // alfombra
  const rug = { x: 54, y: 10, w: 96, d: 66, r: 2 };
  out.push(`<path class="rug" d="${k.planOutline(rug, 0.2, P, 3)}"/>`);
  out.push(L(k.planOutline(rug, 0.2, P, 3), { tone: "lo" }) + L(k.planOutline(k.insetPlan(rug, 4), 0.2, P, 3), { tone: "faint" }));
  // sol que entra por la ventana y charcos de luz, recortados al piso del hall
  out.push(`<clipPath id="hall-floor-clip"><path d="${poly([[4, -112, 0], [222, -112, 0], [222, 120, 0], [4, 120, 0]])}"/></clipPath>`);
  out.push(`<g clip-path="url(#hall-floor-clip)"><path class="sun" data-part="sun" d=""/>`);
  out.push(`<path class="pool" data-part="pool-a" d="${circleOn(132, -76, 44, 0.3)}"/>`);
  out.push(`<path class="pool" data-part="pool-b" d="${circleOn(164, 98, 50, 0.3)}"/></g>`);
  out.push(windowArt());
  out.push(doorArt());
  out.push(acArt());
  // aplique de pared
  out.push(`<path class="wall-glow" data-part="glow-a" d="${onY(-112, k.circleRing(132, 84, 26, 40).map(([x, z]) => [x, z]))}"/>`);
  out.push(S(slab({ x: 126, y: -112, w: 12, d: 2, r: 0.6 }, 76, 16, 2, 0.3), { tone: "mid" }));
  out.push(S(k.cylinder(132, -105, 5.2, 80, 8, P, 28, 0.4), { tone: "hi", crease: "lo", className: "lamp-head", inner: L(k.sideArc(132, -105, 5.2, 84, P, 16), { tone: "faint" }) }));
  out.push(S(slab({ x: 131, y: -110, w: 2, d: 0.2 + 0.2, r: 0 }, 83, 2, 2), { tone: "mid", crease: "none" }));
  // termostato
  out.push(S(slab({ x: 124, y: -112, w: 16, d: 2, r: 1 }, 44, 16, 3, 0.3), { tone: "mid" }));
  out.push(`<path class="crt-screen" d="${rectY(-110, 125.8, 138.2, 49, 57.5)}"/>`);
  out.push(L(rectY(-110, 125.8, 138.2, 49, 57.5), { tone: "lo" }));
  out.push(`<g transform="${k.sideMatrix([132, -110], 57.5, P, "left")}"><text class="screen-text" data-part="thermo-text" x="0" y="5.9" font-size="3.6" text-anchor="middle">23.0°</text></g>`);
  out.push(D([at([129, -110, 46.6]), at([135, -110, 46.6])], { size: 0.45, tone: "mid" }));
  return out.join("");
}

function windowArt() {
  const { x0, x1, z0, z1 } = WINDOW;
  const out = [];
  const opening = rectY(-112, x0, x1, z0, z1);
  out.push(`<clipPath id="win-clip"><path d="${opening}"/></clipPath>`);
  out.push(`<g clip-path="url(#win-clip)">`);
  out.push(`<path class="sky" d="${rectY(-120, x0, x1 + 20, z0 - 20, z1)}"/>`);
  // edificio lejano visto por la ventana
  out.push(`<path class="sky-far" d="${onY(-120, [[x0 + 30, z0 - 20], [x0 + 30, z0 + 18], [x0 + 44, z0 + 18], [x0 + 44, z0 + 28], [x0 + 60, z0 + 28], [x0 + 60, z0 - 20]])}"/>`);
  // jamba izquierda (mira a +x) y alféizar interior (mira arriba)
  out.push(`<path class="iso-shade" data-shade="2" d="${onX(x0, [[-120, z0], [-112, z0], [-112, z1], [-120, z1]])}"/>`);
  out.push(`<path class="iso-top" d="${poly([[x0, -120, z0], [x1, -120, z0], [x1, -112, z0], [x0, -112, z0]])}"/>`);
  out.push(L(k.segment([x0, -120, z0], [x0, -120, z1], P) + k.segment([x0, -120, z0], [x1, -120, z0], P), { tone: "faint" }));
  out.push(`</g>`);
  out.push(L(opening, { tone: "mid" }));
  // marco y parteluz
  const xm = (x0 + x1) / 2;
  out.push(S(slab({ x: xm - 1, y: -118, w: 2, d: 2 }, z0, z1 - z0, 2), { tone: "mid", crease: "none" }));
  out.push(S(slab({ x: x0, y: -118, w: x1 - x0, d: 2 }, z0 + 28, 2, 2), { tone: "mid", crease: "none" }));
  // cortina enrollable: la tela la dibuja el código en vivo, plano de la cara
  out.push(`<g clip-path="url(#win-clip)"><path class="blind" data-part="blind" d=""/><path class="iso-line" data-tone="faint" data-part="blind-slats" d=""/></g>`);
  out.push(`<g data-part="blind-bar">${S(slab({ x: x0 - 1, y: -112, w: x1 - x0 + 2, d: 3, r: 0.8 }, z1 - 2.4, 2.4, 2), { tone: "mid", crease: "none" })}</g>`);
  // alféizar y caja de la cortina
  out.push(S(slab({ x: x0 - 4, y: -112, w: x1 - x0 + 8, d: 5, r: 0.8 }, z0 - 3, 3, 2, 0.3), { tone: "mid" }));
  out.push(S(slab({ x: x0 - 4, y: -112, w: x1 - x0 + 8, d: 6, r: 1.2 }, z1, 8, 3, 0.4), { tone: "mid" }));
  out.push(D([at([x0 - 1, -106, z1 + 4]), at([x1 + 1, -106, z1 + 4])], { size: 0.45 }));
  out.push(`<circle class="motor-led" data-part="blind-led" cx="${fmt(at([x1 + 2, -106, z1 + 4])[0])}" cy="${fmt(at([x1 + 2, -106, z1 + 4])[1])}" r="0.8"/>`);
  return out.join("");
}

function doorArt() {
  const { x0, x1, z1 } = HALL_DOOR;
  const out = [];
  // vano oscuro (pasillo exterior) y hoja corrediza que entra en el muro
  const opening = rectY(-112, x0, x1, 0, z1);
  out.push(`<path class="door-void" d="${opening}"/>`);
  out.push(`<path class="iso-shade" data-shade="1" d="${onX(x0, [[-120, 0], [-112, 0], [-112, z1], [-120, z1]])}"/>`);
  out.push(`<clipPath id="door-clip"><path d="${opening}"/></clipPath>`);
  const leaf = [];
  leaf.push(S(slab({ x: x0, y: -114, w: x1 - x0, d: 2 }, 0, z1, 2), { tone: "mid", crease: "none" }));
  leaf.push(L(rectY(-112, x0 + 5, x1 - 5, 8, z1 - 8), { tone: "lo" }));
  leaf.push(L(onY(-112, [[x0 + 5, 50], [x1 - 5, 50]], false), { tone: "faint" }));
  leaf.push(L(onY(-112, [[x1 - 9, 38], [x1 - 9, 56]], false), { tone: "hi" }));
  leaf.push(D([at([x1 - 9, -112, 38]), at([x1 - 9, -112, 56])], { size: 0.6, tone: "hi" }));
  out.push(`<g clip-path="url(#door-clip)"><g data-part="hall-leaf">${leaf.join("")}</g></g>`);
  out.push(L(opening, { tone: "mid" }));
  // marco
  out.push(S(slab({ x: x0 - 4, y: -112, w: 4, d: 2.4 }, 0, z1 + 4, 2), { tone: "mid", crease: "none" }));
  out.push(S(slab({ x: x1, y: -112, w: 4, d: 2.4 }, 0, z1 + 4, 2), { tone: "mid", crease: "none" }));
  out.push(S(slab({ x: x0 - 4, y: -112, w: x1 - x0 + 8, d: 2.4 }, z1, 4, 2), { tone: "mid", crease: "none" }));
  // lector PN532 de la puerta Hall, con sus tres LEDs
  out.push(S(slab({ x: 208, y: -112, w: 9, d: 3, r: 1 }, 42, 16, 3, 0.4), { tone: "hi", crease: "lo" }));
  out.push(L(rectY(-109, 209.6, 215.4, 46, 52), { tone: "lo" }));
  [["g", 210], ["y", 212.5], ["r", 215]].forEach(([c, x]) => {
    const p = at([x, -109, 55]);
    out.push(`<circle class="led led-${c}" data-part="hall-led-${c}" cx="${fmt(p[0])}" cy="${fmt(p[1])}" r="0.85"/>`);
  });
  return out.join("");
}

function acArt() {
  const out = [];
  const a = { x: 146, y: -112, w: 58, d: 10, r: 2.4 };
  out.push(L(k.segment([200, -112, 104], [200, -112, 99], P), { tone: "lo" }));
  out.push(S(k.slabOf(a, 104, 16, P, 4, 0.6), { tone: "hi", crease: "lo", inner: L(k.sideSeam(a, 109, P, 4), { tone: "faint" }) }));
  // aleta que se abre cuando el equipo está encendido
  out.push(`<g data-part="ac-flap">${S(slab({ x: 150, y: -102.4, w: 50, d: 1.4, r: 0.4 }, 104.4, 2.2, 2), { tone: "mid", crease: "none" })}</g>`);
  out.push(`<circle class="ac-led" data-part="ac-led" cx="${fmt(at([196, -102, 114])[0])}" cy="${fmt(at([196, -102, 114])[1])}" r="0.85"/>`);
  out.push(`<g transform="${k.sideMatrix([178, -102], 117, P, "left")}"><text class="ac-text" data-part="ac-text" x="0" y="3" font-size="3" text-anchor="middle">23</text></g>`);
  // aire que sale de la aleta
  const flows = [];
  for (let j = 0; j < 5; j++) {
    const pts = [];
    const x = 154 + j * 10;
    for (let s = 0; s <= 12; s++) {
      const u = s / 12;
      pts.push(at([x + 4 + Math.sin(u * 3 + j) * 2, -100 + u * 46, 103 - u * u * 38]));
    }
    flows.push(airPath(pts));
  }
  out.push(`<g class="air-group" data-part="ac-air">${flows.join("")}</g>`);
  return out.join("");
}

function partition() {
  const out = [];
  // tabique cortado entre las salas, con el vano de la puerta privilegiada
  out.push(S(slab({ x: -4, y: -112, w: 8, d: 74 }, 0, PART_H), { tone: "mid" }));
  out.push(S(slab({ x: -5, y: -38, w: 10, d: 8 }, 0, 100, 2, 0.3), { tone: "mid" }));
  out.push(S(slab({ x: -5, y: 22, w: 10, d: 8 }, 0, 100, 2, 0.3), { tone: "mid" }));
  out.push(S(slab({ x: -5, y: -38, w: 10, d: 68 }, 92, 8, 2, 0.3), { tone: "mid" }));
  out.push(S(slab({ x: -4, y: 30, w: 8, d: 90 }, 0, PART_H), { tone: "mid" }));
  // poste que sostiene el riel de la puerta corrediza
  out.push(S(slab({ x: -1.5, y: 78, w: 3, d: 3 }, PART_H, 54, 2), { tone: "mid", crease: "none" }));
  // riel
  out.push(S(slab({ x: 5, y: -34, w: 2.2, d: 116, r: 0.6 }, 95, 2.6, 2), { tone: "mid", crease: "none" }));
  out.push(S(slab({ x: 1.5, y: 78.5, w: 3.5, d: 2, r: 0 }, 95, 2.6, 2), { tone: "mid", crease: "none" }));
  out.push(D([at([7.2, -30, 96.3]), at([7.2, 26, 96.3]), at([7.2, 80, 96.3])], { size: 0.45 }));
  return out.join("");
}

function leaf() {
  const { y0, y1 } = LEAF;
  const out = [];
  // hoja de vidrio con marco, colgada de dos carros del riel
  out.push(`<path class="glass" d="${rectX(6.2, y0 + 2, y1 - 2, 4, 89)}"/>`);
  out.push(S(slab({ x: 5.2, y: y0, w: 2, d: 2 }, 2, 89, 2), { tone: "mid", crease: "none" }));
  out.push(S(slab({ x: 5.2, y: y1 - 2, w: 2, d: 2 }, 2, 89, 2), { tone: "mid", crease: "none" }));
  out.push(S(slab({ x: 5.2, y: y0, w: 2, d: y1 - y0 }, 89, 2.4, 2), { tone: "mid", crease: "none" }));
  out.push(S(slab({ x: 5.2, y: y0, w: 2, d: y1 - y0 }, 1, 3, 2), { tone: "mid", crease: "none" }));
  for (const y of [y0 + 8, y1 - 8]) out.push(S(slab({ x: 5.4, y: y - 1.5, w: 1.6, d: 3 }, 91.4, 3.6, 2), { tone: "mid", crease: "none" }));
  out.push(S(slab({ x: 7.2, y: y1 - 7, w: 1.4, d: 2, r: 0.4 }, 40, 16, 2), { tone: "hi", crease: "none" }));
  return out.join("");
}

function kiosk() {
  const { x, y, w, d } = KIOSK;
  const out = [];
  const cx = x + w / 2, cy = y + d / 2;
  out.push(S(k.cylinder(cx, cy, 6, 0, 1.6, P, 28), { tone: "lo" }));
  out.push(S(k.cylinder(cx, cy, 1.8, 1.6, KIOSK_Z - 1.6, P, 18), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x, y, w, d, r: 1.2 }, KIOSK_Z, 14, P, 3, 0.4), { tone: "hi", crease: "lo", lit: true }));
  // LCD 16x2 en la cara que mira al hall (+x)
  const fx = x + w, y0 = y + 1.6, y1 = y + d - 1.6, z0 = KIOSK_Z + 6, z1 = KIOSK_Z + 12;
  out.push(`<path class="lcd" data-part="lcd" d="${rectX(fx, y0, y1, z0, z1)}"/>`);
  out.push(L(rectX(fx, y0, y1, z0, z1), { tone: "mid" }));
  const m = k.sideMatrix([fx, y1 - 0.6], z1 - 0.4, P, "right");
  out.push(`<g transform="${m}" clip-path="url(#lcd-clip)"><text class="lcd-text" data-part="lcd-1" x="0.5" y="2.5" font-size="1.62">Acerque tarjeta</text><text class="lcd-text" data-part="lcd-2" x="0.5" y="5" font-size="1.62">Servidores</text></g>`);
  // LEDs y lector (RC522) en la tapa
  [["g", y + 5.5], ["y", y + 9], ["r", y + 12.5]].forEach(([c, yy]) => {
    const p = at([fx, yy, KIOSK_Z + 3]);
    out.push(`<circle class="led led-${c}" data-part="srv-led-${c}" cx="${fmt(p[0])}" cy="${fmt(p[1])}" r="0.7"/>`);
  });
  out.push(L(k.planOutline({ x: x + 1.6, y: y + 2, w: w - 3.2, d: d - 4, r: 1 }, KIOSK_Z + 14, P, 3), { tone: "lo" }));
  out.push(L(k.ring(cx, cy, 2.4, KIOSK_Z + 14, P, 24), { tone: "faint" }));
  return { svg: out.join(""), clip: `<clipPath id="lcd-clip"><rect x="0" y="0" width="${(y1 - y0 - 0.4).toFixed(2)}" height="${(z1 - z0).toFixed(2)}" /></clipPath>` };
}

function desk() {
  const out = [];
  out.push(S(k.cylinder(182, -30, 5, 0, 1.4, P, 20), { tone: "lo" }));
  out.push(S(k.cylinder(182, -30, 1.2, 1.4, 18, P, 14), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(182, -30, 7, 19.4, 3, P, 28, 0.4), { tone: "mid" }));
  const body = { x: 150, y: -22, w: 62, d: 22, r: 1.4 };
  out.push(S(slab(body, 0, 30, 2, 0.4), { tone: "mid", inner: L(k.sideSeam({ ...body, r: 0 }, 4, P, 2), { tone: "lo" }) }));
  const panels = [];
  for (const x of [170.6, 191.3]) panels.push(onY(0, [[x, 4], [x, 30]], false));
  out.push(L(panels.join(""), { tone: "faint" }));
  out.push(S(slab({ x: 148, y: -24, w: 66, d: 26, r: 1.4 }, 30, 2.6, 2, 0.5), { tone: "mid" }));
  // monitor y teclado
  out.push(S(slab({ x: 176, y: -18, w: 10, d: 6, r: 0.8 }, 32.6, 1, 2), { tone: "mid", crease: "none" }));
  out.push(S(slab({ x: 180, y: -16, w: 2, d: 2 }, 33.6, 6, 2), { tone: "mid", crease: "none" }));
  out.push(S(slab({ x: 166, y: -15, w: 30, d: 2, r: 0.6 }, 39.6, 18, 2, 0.3), { tone: "mid" }));
  out.push(`<path class="crt-screen" d="${rectY(-13, 168, 194, 41.6, 55.6)}"/>`);
  out.push(L(rectY(-13, 168, 194, 41.6, 55.6), { tone: "lo" }));
  out.push(S(slab({ x: 170, y: -8, w: 22, d: 6, r: 0.6 }, 32.6, 1, 2), { tone: "mid" }));
  out.push(L(k.lineOnTop([170, -5], [192, -5], 33.6, P), { tone: "faint" }));
  return out.join("");
}

function bench() {
  const out = [];
  const seat = { x: 52, y: 92, w: 78, d: 16 };
  for (const [x, y] of [[56, 95], [124, 95], [56, 104], [124, 104]].sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P)))
    out.push(S(slab({ x: x - 1.4, y: y - 1.4, w: 2.8, d: 2.8 }, 0, 14, 2), { tone: "mid", crease: "none" }));
  out.push(S(slab({ ...seat, r: 1.2 }, 14, 3, 2, 0.4), { tone: "mid" }));
  const slats = [];
  for (const y of [96, 100, 104]) slats.push(k.lineOnTop([seat.x, y], [seat.x + seat.w, y], 17, P));
  out.push(L(slats.join(""), { tone: "faint" }));
  return out.join("");
}

function floorLamp() {
  const out = [];
  const [x, y] = [164, 98];
  out.push(S(k.cylinder(x, y, 7, 0, 1.8, P, 28, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 1, 1.8, 66, P, 12), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(x, y, 9.5, 67.8, 12, P, 36, 0.5), { tone: "hi", crease: "lo", className: "lamp-head", inner: L(k.sideArc(x, y, 9.5, 71, P, 24), { tone: "faint" }) }));
  out.push(L(k.ring(x, y, 7, 79.8, P, 28), { tone: "faint" }));
  return out.join("");
}

function plant() {
  const out = [];
  const [x, y] = [210, 100];
  out.push(S(k.cylinder(x, y, 8, 0, 15, P, 32, 0.5), { tone: "mid", inner: L(k.sideArc(x, y, 8, 11, P, 20), { tone: "faint" }) }));
  out.push(L(k.ring(x, y, 6.6, 15, P, 28), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, 1.2, 15, 12, P, 12), { tone: "mid", crease: "none" }));
  const balls = [[-3, -2, 32, 7.5], [4, -1, 30, 6.5], [0, 3, 36, 7], [-1, -1, 42, 5.5], [3, 3, 27, 5.2]];
  balls.sort((a, b) => k.depthOf([x + a[0], y + a[1], a[2]], P) - k.depthOf([x + b[0], y + b[1], b[2]], P));
  for (const [dx, dy, z, r] of balls) out.push(S(G.sphereOf([x + dx, y + dy, z], r, P), { tone: "lo", className: "leaf" }));
  return out.join("");
}

export function figure() {
  const k1 = kiosk();
  const hallItems = byDepth([
    { c: [182, -12, 0], svg: desk() },
    { c: [90, 100, 0], svg: bench() },
    { c: [164, 98, 0], svg: floorLamp() },
    { c: [210, 100, 0], svg: plant() },
    { c: [KIOSK.x + 4, KIOSK.y + 6, 0], svg: k1.svg },
  ]);
  const body = [
    `<defs>${k1.clip}
      <radialGradient id="sl-pool"><stop offset="0" style="stop-color:var(--sl-pool);stop-opacity:.75"/><stop offset=".55" style="stop-color:var(--sl-pool);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--sl-pool);stop-opacity:0"/></radialGradient>
      <radialGradient id="sl-glow"><stop offset="0" style="stop-color:var(--sl-pool);stop-opacity:.7"/><stop offset="1" style="stop-color:var(--sl-pool);stop-opacity:0"/></radialGradient>
      <linearGradient id="sl-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sl-sky-a)"/><stop offset="1" style="stop-color:var(--sl-sky-b)"/></linearGradient>
    </defs>`,
    base(),
    `<g class="room" data-room="servidores">${serverRoom()}</g>`,
    `<g class="room" data-room="hall">`,
    hallBack(),
    partition(),
    `<g data-part="srv-leaf">${leaf()}</g>`,
    ...hallItems.map((i) => i.svg),
    `</g>`,
  ];
  return k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label:
      "Maqueta isométrica de dos salas. A la izquierda, la sala de servidores sobre piso técnico: cuatro racks con LEDs, bandeja de cables, equipo de aire de precisión con pantalla, UPS y baterías. A la derecha, el hall: ventana con cortina enrollable, aire acondicionado sobre la puerta de entrada con su lector, aplique, lámpara de pie, mostrador y banco. Entre ambas, el tabique cortado con la puerta corrediza de vidrio y el lector con LCD de la puerta privilegiada.",
    body,
  });
}
