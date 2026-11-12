from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from collections import OrderedDict, deque

log = logging.getLogger("apoyo")


class Respuestas:
    """Idempotencia: un pedido repetido (QoS 1) recibe la misma respuesta y no se vuelve a aplicar."""

    def __init__(self, maximo: int = 2000, vida_s: float = 300):
        self._d: OrderedDict[tuple[str, str], tuple[float, dict]] = OrderedDict()
        self.maximo, self.vida_s = maximo, vida_s

    def buscar(self, usuario: str, req_id: str) -> dict | None:
        item = self._d.get((usuario, req_id))
        if item is None or time.monotonic() - item[0] > self.vida_s:
            return None
        return item[1]

    def guardar(self, usuario: str, req_id: str, respuesta: dict) -> None:
        self._d[(usuario, req_id)] = (time.monotonic(), respuesta)
        self._d.move_to_end((usuario, req_id))
        while len(self._d) > self.maximo:
            self._d.popitem(last=False)


class Rafagas:

    def __init__(self, maximo: int = 20, ventana_s: float = 10):
        self.maximo, self.ventana_s = maximo, ventana_s
        self._por_usuario: dict[str, deque] = {}

    def permitir(self, usuario: str) -> bool:
        t = time.monotonic()
        q = self._por_usuario.setdefault(usuario, deque())
        while q and t - q[0] > self.ventana_s:
            q.popleft()
        if len(q) >= self.maximo:
            return False
        q.append(t)
        return True


def guardar_json(ruta: str, datos: dict) -> None:
    carpeta = os.path.dirname(ruta) or "."
    fd, tmp = tempfile.mkstemp(dir=carpeta, prefix=".estado-")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(datos, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, ruta)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def cargar_json(ruta: str) -> dict | None:
    try:
        with open(ruta) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else None
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as e:
        log.warning("no pude leer %s (%s): arranco con el estado inicial", ruta, e)
        return None
