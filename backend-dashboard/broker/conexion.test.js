const test = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");
const { jwtMqtt } = require("./conexion");


test("jwtMqtt firma el usuario con vencimiento, y con otro secreto no verifica", () => {

  const token = jwtMqtt("admin-1", "secreto");
  const datos = jwt.verify(token, "secreto", { algorithms: ["HS256"] });
  assert.equal(datos.username, "admin-1");
  assert.ok(datos.exp > Date.now() / 1000);
  assert.throws(() => jwt.verify(token, "otro"));
});
