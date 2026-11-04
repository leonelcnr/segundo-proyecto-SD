// Login del admin con JWT, como el ejemplo de la cátedra.
// El token va en una cookie httpOnly y no en el header Authorization: el EventSource
// del navegador (/stream) no puede mandar headers, pero sí manda las cookies.
const crypto = require("node:crypto");
const express = require("express");
const jwt = require("jsonwebtoken");

const DURACION = 8 * 60 * 60; // segundos: una jornada
const COOKIE = "token";

// Compara sin cortar en el primer carácter distinto (no filtra la clave por tiempo de respuesta)
const iguales = (a, b) => {
  const hash = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
};

const leerCookie = (req) => {
  const encontrada = (req.get("cookie") || "").split("; ").find((c) => c.startsWith(`${COOKIE}=`));
  return encontrada && encontrada.slice(COOKIE.length + 1);
};

function crearAuth({ usuario, clave, secreto }) {
  if (!usuario || !clave || !secreto) throw new Error("Faltan ADMIN_USER, ADMIN_PASSWORD o JWT_SECRET");

  // Middleware: deja pasar solo si la cookie tiene un JWT válido
  function verificarToken(req, res, next) {
    const token = leerCookie(req);
    if (!token) return res.status(401).json({ error: "Tenés que iniciar sesión" });
    try {
      req.username = jwt.verify(token, secreto).username;
      next();
    } catch {
      return res.status(401).json({ error: "Sesión vencida o inválida" });
    }
  }

  const router = express.Router();

  router.post("/login", (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Faltan usuario y contraseña" });
    // Las dos comparaciones siempre se hacen, para no revelar si falló el usuario o la clave
    const usuarioOk = iguales(username, usuario);
    const claveOk = iguales(password, clave);
    if (!usuarioOk || !claveOk) return res.status(401).json({ error: "Usuario o contraseña incorrectos" });

    const token = jwt.sign({ username }, secreto, { expiresIn: DURACION });
    // shortcut: sin flag secure porque se sirve por HTTP dentro de Tailscale; agregarlo si se pasa a HTTPS.
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: "strict", maxAge: DURACION * 1000 });
    res.json({ username });
  });

  router.post("/logout", (req, res) => {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  // Para que la página sepa si ya hay sesión al cargar
  router.get("/me", verificarToken, (req, res) => res.json({ username: req.username }));

  return { router, verificarToken };
}

module.exports = { crearAuth };
