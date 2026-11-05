import { useState } from "react";

export default function Login({ alEntrar }) {
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const entrar = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    setEnviando(true);
    setError("");
    try {
      const r = await fetch("/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      const datos = await r.json();
      if (r.ok) alEntrar(datos.username);
      else setError(datos.error);
    } catch {
      setError("No se pudo conectar con el servidor");
    }
    setEnviando(false);
  };

  return (
    <main className="login">
      <form className="card login-card" onSubmit={entrar}>
        <Marca />
        <h1>Panel del admin</h1>
        <label>
          Usuario
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          Contraseña
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="boton primario" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}

export function Marca() {
  return (
    <div className="marca">
      <div className="marca-icono">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 8a4 4 0 0 1 6 0" />
        </svg>
      </div>
      Acceso NFC
    </div>
  );
}
