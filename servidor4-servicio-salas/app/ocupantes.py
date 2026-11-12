from __future__ import annotations

import logging
from datetime import tzinfo

from .mensajes import RE_USUARIO, instante

ROLES = {"visitante", "empleado", "admin"}
MAX_OCUPANTES = 500
log = logging.getLogger("ocupantes")


class Ocupantes:
    def __init__(self, zona: tzinfo):
        self.zona = zona
        self._salas: dict[str, dict[str, tuple[str, float]]] = {}

    def actualizar(self, sala: str, datos) -> int:
        lista = datos.get("ocupantes") if isinstance(datos, dict) else datos
        if not isinstance(lista, list):
            raise ValueError("ocupantes: se esperaba una lista")
        nuevos: dict[str, tuple[str, float]] = {}
        for o in lista[:MAX_OCUPANTES]:
            if not isinstance(o, dict):
                continue
            usuario = o.get("usuario", o.get("celular"))
            rol = o.get("rol", "empleado")
            hasta = instante(o["hasta"], self.zona) if isinstance(o.get("hasta"), str) else None
            if not isinstance(usuario, str) or not RE_USUARIO.match(usuario) or rol not in ROLES or hasta is None:
                log.warning("ocupante descartado en %s: %r", sala, o)
                continue
            nuevos[usuario] = (rol, hasta)
        self._salas[sala] = nuevos
        return len(nuevos)

    def agregar(self, sala: str, usuario: str, rol: str, hasta: float) -> None:
        self._salas.setdefault(sala, {})[usuario] = (rol if rol in ROLES else "empleado", hasta)

    def rol_si_dentro(self, usuario: str, sala: str, ahora: float) -> str | None:
        rol, hasta = self._salas.get(sala, {}).get(usuario, (None, 0.0))
        return rol if hasta > ahora else None

    def resumen(self, ahora: float) -> dict[str, list[str]]:
        return {s: [u for u, (_, h) in m.items() if h > ahora] for s, m in self._salas.items()}
