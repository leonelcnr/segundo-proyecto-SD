// Tarjeta de la figura: la usan build.mjs (página estática) y web.mjs (página que se arma al cargar).
import * as k from "./kit/iso-kit.mjs";

export function plate(svg, PHONE) {
  const stage = `<div class="sl-body">
  <div class="iso-stage sl-stage" tabindex="0" aria-label="Maqueta de las salas. Se controla desde el celular de la derecha.">${svg}</div>
  <div class="sl-side">${PHONE}</div>
</div>
<div class="sl-bus" aria-live="polite"><div class="sl-bus-head"><span>Broker MQTT · lo que viaja</span><span class="sl-demo"><button type="button" data-demo="falla">Simular falla del aire de precisión</button><button type="button" data-demo="tour" aria-pressed="true">Demo automática</button></span></div><ol data-bus></ol></div>`;

return k.plateHtml({
  fig: "Fig 1",
  title: "Salas · control desde la app",
  hint: "Tocá los botones del celular, o mirá la demo",
  readout: "Hall 26.4° · luz 80% · cortina 35% · Servidores 22.6°",
  keys: [
    { mark: "lit", label: "Lector de la puerta privilegiada: sin acceso concedido, la sala no se controla" },
    { mark: "raised", label: "Equipos simulados por el servicio de salas: luz, cortina, aire, CRAC, UPS" },
    { mark: "dotted", label: "Flujo de aire: frío en azul, caliente en coral" },
  ],
  caption:
    "El celular sólo controla una sala después de que el servicio central le concede la entrada por esa puerta. El servicio de salas aplica las reglas: en el hall, más de 4 cambios de luz en 30 s bloquean la luz 20 s, más de 3 órdenes a la cortina en 15 s la bloquean 15 s, y el compresor no arranca hasta 3 min después de apagarse; en servidores la refrigeración no se apaga, la luz no baja de ahorro y el punto de consigna (18 a 27 °C, rango recomendado por ASHRAE) cambia como mucho 1 °C cada 5 min y sólo con rol admin. La dinámica térmica corre 30 veces más rápido que el reloj.",
  body: stage,
});

}
