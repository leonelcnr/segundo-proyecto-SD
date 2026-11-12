from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Any, Callable

# Segundos reales: la simulación térmica se acelera, las reglas no.
REGLAS: dict[str, Any] = dict(
    luz_ventana=30, luz_max=4, luz_bloqueo=20, luz_rebote=1.2,
    cortina_ventana=15, cortina_max=3, cortina_bloqueo=15,
    clima_ventana=30, clima_delta_max=3.0, clima_bloqueo=30, compresor_espera=180, hall_sp=(17.0, 26.0),
    srv_sp=(18.0, 27.0), srv_paso=1.0, srv_cada=300, sluz_cada=5,
)

SALAS = ("hall", "servidores")
DISPOSITIVOS = {
    "hall": {"luz": {"toggle", "nivel"}, "cortina": {"subir", "bajar", "parar"}, "clima": {"toggle", "sp", "modo"}},
    "servidores": {"crac": {"sp"}, "vent": {"apagar", "toggle"}, "sluz": {"normal", "ahorro", "apagar"}},
}
CLAVES_BLOQUEO = ("hall/luz", "hall/cortina", "hall/clima", "servidores/sluz", "servidores/crac")


@dataclass
class Resultado:
    ok: bool
    motivo: str | None = None
    espera_s: int = 0
    evento: str | None = None

    def respuesta(self, req_id: str) -> dict:
        r: dict[str, Any] = {"req_id": req_id, "ok": self.ok}
        if not self.ok:
            r["motivo"] = self.motivo
            if self.espera_s > 0:
                r["espera_s"] = self.espera_s
        return r


def no(motivo: str, espera: float = 0, evento: str | None = None) -> Resultado:
    return Resultado(False, motivo, max(0, math.ceil(espera)), evento)


SI = Resultado(True)


def estado_inicial() -> dict:
    return {
        "hall": {"luz": True, "nivel": 80, "cortina": 35.0, "objetivo": 35.0, "clima": True, "modo": "frio",
                 "sp": 23.0, "t": 26.4, "apagado_en": 0.0},
        "servidores": {"luz": "normal", "sp": 22.0, "t": 22.6, "vent": True, "kw": 4.2, "ups": 100,
                       "red": True, "alarma": False, "falla": False, "ultimo_sp": 0.0},
        "bloqueos": {k: 0.0 for k in CLAVES_BLOQUEO},
        "hist": {"luz": [], "cortina": [], "clima": []},
        "ultima_luz": 0.0,
    }


class Salas:

    def __init__(self, reloj: Callable[[], float] = time.time, datos: dict | None = None):
        self.reloj = reloj
        self.e = estado_inicial()
        if datos:
            self.restaurar(datos)


    def restaurar(self, datos: dict) -> None:
        base = estado_inicial()
        permitidos = {"modo": ("frio", "calor"), "luz_srv": ("normal", "ahorro")}
        for parte in ("hall", "servidores"):
            for k, v in (datos.get(parte) or {}).items():
                if k not in base[parte]:
                    continue
                actual = base[parte][k]
                if isinstance(actual, bool):
                    valido = isinstance(v, bool)
                elif isinstance(actual, (int, float)):
                    valido = isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
                else:
                    clave = "luz_srv" if (parte, k) == ("servidores", "luz") else k
                    valido = isinstance(v, str) and v in permitidos.get(clave, (v,))
                if valido:
                    base[parte][k] = v
        for k, v in (datos.get("bloqueos") or {}).items():
            if k in base["bloqueos"] and isinstance(v, (int, float)):
                base["bloqueos"][k] = float(v)
        for k in base["hist"]:
            v = (datos.get("hist") or {}).get(k)
            if isinstance(v, list):
                base["hist"][k] = [x for x in v if isinstance(x, (int, float, list))][-50:]
        if isinstance(datos.get("ultima_luz"), (int, float)):
            base["ultima_luz"] = float(datos["ultima_luz"])
        base["hall"]["objetivo"] = base["hall"]["cortina"]
        base["servidores"]["falla"] = False
        self.e = base

    def volcar(self) -> dict:
        return self.e


    def bloqueados(self, sala: str) -> dict[str, int]:
        t = self.reloj()
        return {k.split("/", 1)[1]: math.ceil(v - t) for k, v in self.e["bloqueos"].items()
                if k.startswith(sala + "/") and v > t}

    def publico(self, sala: str) -> dict:
        if sala == "hall":
            h = self.e["hall"]
            dif = h["objetivo"] - h["cortina"]
            mov = None if abs(dif) < 0.5 else ("bajando" if dif > 0 else "subiendo")
            return {"luz": h["luz"], "nivel": h["nivel"], "cortina": round(h["cortina"], 1), "cortina_mov": mov,
                    "clima": h["clima"], "modo": h["modo"], "sp": h["sp"], "t": round(h["t"], 1),
                    "bloqueos": self.bloqueados("hall")}
        s = self.e["servidores"]
        return {"luz": s["luz"], "sp": s["sp"], "t": round(s["t"], 1), "vent": s["vent"],
                "crac": "falla" if s["falla"] else "refrigerando", "kw": round(s["kw"], 1), "ups": s["ups"],
                "red": s["red"], "alarma": s["alarma"], "bloqueos": self.bloqueados("servidores")}


    def _ventana(self, lista: list, segs: float) -> list:
        t = self.reloj()
        return [x for x in lista if t - (x[0] if isinstance(x, (list, tuple)) else x) < segs]

    def aplicar(self, rol: str, sala: str, disp: str, accion: str, valor: Any = None) -> Resultado:
        if sala not in DISPOSITIVOS or disp not in DISPOSITIVOS[sala] or accion not in DISPOSITIVOS[sala][disp]:
            return no("desconocido")
        try:
            return self._hall(disp, accion, valor) if sala == "hall" else self._servidores(rol, disp, accion, valor)
        except (TypeError, ValueError):
            return no("invalido")

    def _hall(self, disp: str, accion: str, valor: Any) -> Resultado:
        t = self.reloj()
        h, b, hist, R = self.e["hall"], self.e["bloqueos"], self.e["hist"], REGLAS
        k = "hall/" + disp
        if b[k] > t:
            return no("bloqueado", b[k] - t)
        if disp == "luz":
            if accion == "toggle":
                if t - self.e["ultima_luz"] < R["luz_rebote"]:
                    return no("rebote", R["luz_rebote"] - (t - self.e["ultima_luz"]))
                hist["luz"] = self._ventana(hist["luz"], R["luz_ventana"])
                if len(hist["luz"]) >= R["luz_max"]:
                    b[k] = t + R["luz_bloqueo"]
                    hist["luz"] = []
                    return no("limite", R["luz_bloqueo"], f"{R['luz_max'] + 1} cambios de luz en {R['luz_ventana']} s")
                hist["luz"].append(t)
                self.e["ultima_luz"] = t
                h["luz"] = not h["luz"]
                return SI
            n = int(round(float(valor) / 5) * 5)
            if not 10 <= n <= 100:
                return no("rango")
            h["nivel"] = n
            if not h["luz"]:
                h["luz"] = True
                self.e["ultima_luz"] = t
            return SI
        if disp == "cortina":
            hist["cortina"] = self._ventana(hist["cortina"], R["cortina_ventana"])
            if accion != "parar":
                if len(hist["cortina"]) >= R["cortina_max"]:
                    b[k] = t + R["cortina_bloqueo"]
                    hist["cortina"] = []
                    h["objetivo"] = h["cortina"]
                    return no("limite", R["cortina_bloqueo"],
                              f"cortina: {R['cortina_max'] + 1} órdenes en {R['cortina_ventana']} s")
                hist["cortina"].append(t)
            h["objetivo"] = {"subir": 0.0, "bajar": 100.0}.get(accion, h["cortina"])
            return SI
        if accion == "toggle":
            if not h["clima"]:
                espera = h["apagado_en"] + R["compresor_espera"] - t
                if espera > 0:
                    return no("compresor", espera)
                h["clima"] = True
            else:
                h["clima"] = False
                h["apagado_en"] = t
            return SI
        if accion == "modo":
            if valor not in ("frio", "calor"):
                return no("invalido")
            h["modo"] = valor
            return SI
        paso = float(valor)
        if not math.isfinite(paso) or paso == 0 or abs(paso) > R["clima_delta_max"]:
            return no("rango")
        lo, hi = R["hall_sp"]
        nuevo = min(hi, max(lo, round((h["sp"] + paso) * 2) / 2))
        if nuevo == h["sp"]:
            return no("rango")
        hist["clima"] = self._ventana(hist["clima"], R["clima_ventana"])
        if sum(d for _, d in hist["clima"]) + abs(paso) > R["clima_delta_max"]:
            b[k] = t + R["clima_bloqueo"]
            hist["clima"] = []
            return no("limite", R["clima_bloqueo"],
                      f"consigna del hall: más de {R['clima_delta_max']:g} °C en {R['clima_ventana']} s")
        hist["clima"].append([t, abs(paso)])
        h["sp"] = nuevo
        return SI

    def _servidores(self, rol: str, disp: str, accion: str, valor: Any) -> Resultado:
        t = self.reloj()
        s, b, R = self.e["servidores"], self.e["bloqueos"], REGLAS
        if disp == "vent":
            return no("prohibido", evento="intento de apagar la refrigeración de servidores")
        if disp == "sluz":
            if accion == "apagar":
                return no("personal_dentro", evento="intento de apagar la luz de servidores con personal dentro")
            if b["servidores/sluz"] > t:
                return no("bloqueado", b["servidores/sluz"] - t)
            if s["luz"] != accion:
                s["luz"] = accion
                b["servidores/sluz"] = t + R["sluz_cada"]
            return SI
        if rol != "admin":
            return no("rol", evento="consigna del aire de precisión pedida por alguien que no es admin")
        espera = s["ultimo_sp"] + R["srv_cada"] - t
        if espera > 0:
            return no("ritmo", espera)
        paso = float(valor)
        if not math.isfinite(paso) or paso == 0:
            return no("rango")
        paso = max(-R["srv_paso"], min(R["srv_paso"], paso))
        lo, hi = R["srv_sp"]
        nuevo = min(hi, max(lo, s["sp"] + paso))
        if nuevo == s["sp"]:
            return no("rango")
        s["sp"] = nuevo
        s["ultimo_sp"] = t
        b["servidores/crac"] = t + R["srv_cada"]
        return SI
