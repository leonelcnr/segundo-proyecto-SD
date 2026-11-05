const test = require("node:test");
const assert = require("node:assert");
const { leerPresencia } = require("./topics");


test("presencia de una puerta y del servicio", () => {

  assert.deepStrictEqual(leerPresencia("acceso/central/puerta/hall/presencia", "online"), {
    nombre: "hall",
    sitio: "central",
    online: true,
  });
  assert.deepStrictEqual(leerPresencia("servicio/presencia", "offline"), { nombre: "servicio", sitio: null, online: false });
});


test("presencia ignora topics y textos que no son de presencia", () => {

  assert.strictEqual(leerPresencia("acceso/central/puerta/hall/presencia", "caida"), null);
  assert.strictEqual(leerPresencia("acceso/central/puerta/hall/lectura", "online"), null);
  assert.strictEqual(leerPresencia("acceso/central/estado", "online"), null);
});
