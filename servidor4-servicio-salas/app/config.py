from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo


class ErrorConfig(Exception):
    pass


def _bool(nombre: str, defecto: bool) -> bool:
    v = os.environ.get(nombre)
    if v is None or v.strip() == "":
        return defecto
    return v.strip().lower() in ("1", "true", "si", "sí", "yes", "on")


def _num(nombre: str, defecto: float, minimo: float, maximo: float) -> float:
    v = os.environ.get(nombre, "").strip()
    try:
        n = float(v) if v else defecto
    except ValueError:
        raise ErrorConfig(f"{nombre} tiene que ser un número, no {v!r}")
    if not minimo <= n <= maximo:
        raise ErrorConfig(f"{nombre} tiene que estar entre {minimo:g} y {maximo:g}")
    return n


SEGMENTO = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@dataclass(frozen=True)
class Config:
    host: str
    puerto: int
    tls: bool
    ca: str
    usuario: str
    clave: str = field(repr=False)
    sitio: str
    zona: ZoneInfo
    sim: float
    telemetria_s: float
    max_antiguedad_s: float
    estado_archivo: str
    salud_archivo: str
    ocupantes_desde_avisos: bool
    log_nivel: str

    def resumen(self) -> str:
        return (f"broker={self.host}:{self.puerto} tls={'sí' if self.tls else 'NO'} usuario={self.usuario} "
                f"clave={'***' if self.clave else '(sin clave)'} sitio={self.sitio} sim=x{self.sim:g} "
                f"ocupantes_desde_avisos={self.ocupantes_desde_avisos}")

    @staticmethod
    def desde_entorno() -> "Config":
        e = os.environ
        host = e.get("BROKER_HOST", "").strip()
        if not host:
            raise ErrorConfig("Falta BROKER_HOST")
        tls = _bool("TLS", True)
        if not tls and not _bool("PERMITIR_SIN_TLS", False):
            raise ErrorConfig("TLS está apagado. Sólo se permite en pruebas locales con PERMITIR_SIN_TLS=1")
        ca = e.get("CA_ARCHIVO", "/certs/ca.crt")
        if tls and not os.path.isfile(ca):
            raise ErrorConfig(f"No encuentro la CA del broker en {ca} (montá certs/ca.crt)")
        usuario = e.get("MQTT_USUARIO", "servicio-salas").strip()
        if not SEGMENTO.match(usuario):
            raise ErrorConfig("MQTT_USUARIO sólo admite letras, números, - y _")
        clave = ""
        ruta_clave = e.get("MQTT_CLAVE_ARCHIVO", "/run/secrets/mqtt_clave")
        if os.path.isfile(ruta_clave):
            with open(ruta_clave) as f:
                clave = f.read().strip()
        elif e.get("MQTT_CLAVE"):
            clave = e["MQTT_CLAVE"]
        if tls and not clave and not _bool("PERMITIR_SIN_CLAVE", False):
            raise ErrorConfig(f"Falta la clave MQTT (archivo {ruta_clave})")
        sitio = e.get("SITIO", "edificio1").strip()
        if not SEGMENTO.match(sitio):
            raise ErrorConfig("SITIO sólo admite letras, números, - y _")
        try:
            zona = ZoneInfo(e.get("ZONA_HORARIA", "America/Argentina/Buenos_Aires"))
        except Exception:
            raise ErrorConfig("ZONA_HORARIA desconocida")
        return Config(
            host=host,
            puerto=int(_num("BROKER_PUERTO", 8883 if tls else 1883, 1, 65535)),
            tls=tls,
            ca=ca,
            usuario=usuario,
            clave=clave,
            sitio=sitio,
            zona=zona,
            sim=_num("SIMULACION_ACELERACION", 30, 1, 600),
            telemetria_s=_num("TELEMETRIA_CADA_S", 5, 1, 300),
            max_antiguedad_s=_num("MAX_ANTIGUEDAD_S", 10, 1, 120),
            estado_archivo=e.get("ESTADO_ARCHIVO", "/datos/estado.json"),
            salud_archivo=e.get("SALUD_ARCHIVO", "/tmp/salud.json"),
            ocupantes_desde_avisos=_bool("OCUPANTES_DESDE_AVISOS", False),
            log_nivel=e.get("LOG_NIVEL", "INFO").upper(),
        )
