// Entrada para el artefacto publicado: arma la página en el navegador (mucho más liviana que el SVG ya dibujado).
// npx esbuild web-entry.mjs --bundle --minify --format=esm --loader:.css=text --loader:.html=text --outfile=web.lines.js
// (salas-pub.html es esa salida dentro de una página: 93 KB, lista para publicar como artefacto)
import * as k from "./kit/iso-kit.mjs";
import { figure, P, WINDOW, HALL_DOOR, CRAC_FAN } from "./art.mjs";
import { plate } from "./plate.mjs";
import CSS from "./salas.web.css?raw";
import PHONE from "./phone.html?raw";

const PAGE_CSS = `*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:var(--anatomy-page);color:var(--anatomy-text);font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}.iso-page{width:min(1180px,100% - 32px);margin:64px auto 96px}`;
const style = document.createElement("style");
style.textContent = k.ISO_CSS + PAGE_CSS + CSS;
document.head.append(style);
document.body.className = "iso";
document.body.dataset.theme = "light";
document.body.innerHTML = `<main class="iso-page">${plate(figure(), PHONE)}</main>`;
Object.assign(globalThis, { iso: k.iso, pathOf: k.pathOf, translateAlong: k.translateAlong, lineOnTop: k.lineOnTop, P, WINDOW, HALL_DOOR, CRAC_FAN });
