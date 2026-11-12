from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, tzinfo
from typing import Any

MAX_BYTES = 2048
RE_ID = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")
RE_USUARIO = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@dataclass
class Pedido:
    req_id: str
    sala: str
    disp: str
    accion: str
    valor: Any
    ts: str


class Invalido(ValueError):
    pass


class PedidoMalo(Invalido):

    def __init__(self, req_id: str, motivo: str):
        super().__init__(motivo)
        self.req_id = req_id


def leer_json(payload: bytes) -> Any:
    if len(payload) > MAX_BYTES:
        raise Invalido("demasiado grande")
    try:
        return json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as e:
        raise Invalido("no es JSON") from e


def pedido(payload: bytes) -> Pedido:
    d = leer_json(payload)
    if not isinstance(d, dict):
        raise Invalido("no es un objeto")
    req_id = d.get("req_id")
    if not isinstance(req_id, str) or not RE_ID.match(req_id):
        raise Invalido("req_id inválido")
    campos = {}
    for k in ("sala", "disp", "accion"):
        v = d.get(k)
        if not isinstance(v, str) or not 0 < len(v) <= 32:
            raise PedidoMalo(req_id, f"{k} inválido")
        campos[k] = v
    valor = d.get("valor")
    valor_ok = valor is None or (
        isinstance(valor, (int, float)) and not isinstance(valor, bool)
    ) or (isinstance(valor, str) and len(valor) <= 16)
    if not valor_ok:
        raise PedidoMalo(req_id, "valor inválido")
    ts = d.get("ts")
    if not isinstance(ts, str) or len(ts) > 40:
        raise PedidoMalo(req_id, "falta ts")
    return Pedido(req_id, campos["sala"], campos["disp"], campos["accion"], valor, ts)


def instante(texto: str, zona: tzinfo) -> float | None:
    try:
        d = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=zona)
    return d.timestamp()


def ahora_iso(zona: tzinfo) -> str:
    return datetime.now(zona).isoformat(timespec="seconds")
