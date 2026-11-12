const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { jwtMqtt } = require("./conexion");

const par = () => crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

test("jwtMqtt firma con RS256: verifica con la clave pública, y con otra no", () => {
  const { privateKey, publicKey } = par();
  const token = jwtMqtt("admin-1", privateKey);
  const datos = jwt.verify(token, publicKey, { algorithms: ["RS256"] });
  assert.equal(datos.username, "admin-1");
  assert.ok(datos.exp > Date.now() / 1000);
  assert.throws(() => jwt.verify(token, par().publicKey, { algorithms: ["RS256"] }));
});
