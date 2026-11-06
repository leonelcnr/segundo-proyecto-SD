import { useEffect, useState } from "react";
import Login from "./Login.jsx";
import Panel from "./Panel.jsx";

// Decide qué mostrar: login o panel, según si la cookie de sesión sigue valiendo
export default function App() {
  // undefined = todavía no sabemos, null = sin sesión
  const [usuario, setUsuario] = useState(undefined);

  const revisarSesion = () =>
    fetch("/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((datos) => setUsuario(datos?.username ?? null))
      .catch(() => setUsuario(null));

  useEffect(() => {
    revisarSesion();
  }, []);

  const salir = async () => {
    await fetch("/logout", { method: "POST" });
    setUsuario(null);
  };

  if (usuario === undefined) return null;
  if (!usuario) return <Login alEntrar={setUsuario} />;
  return <Panel usuario={usuario} alSalir={salir} alPerderSesion={revisarSesion} />;
}
