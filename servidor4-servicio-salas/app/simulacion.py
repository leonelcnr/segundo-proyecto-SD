from __future__ import annotations

import math

from .modelo import Salas

T_EXTERIOR = 29.0
CORTINA_VEL = 11.0
ALARMA_SRV = 27.0
HISTERESIS = 1.0
KW_BASE = 4.2


def avanzar(salas: Salas, dt: float, sim: float) -> list[dict]:
    if dt <= 0:
        return []
    dt = min(dt, 5.0)
    ds = dt * sim
    h = salas.e["hall"]
    s = salas.e["servidores"]

    sol = (1 - h["cortina"] / 100) * 0.0018
    aire = 0.0
    if h["clima"]:
        err = h["t"] - h["sp"]
        if h["modo"] == "frio":
            aire = -min(0.0075, 0.004 + err * 0.004) if err > -0.2 else 0.0
        else:
            aire = min(0.0075, 0.004 - err * 0.004) if err < 0.2 else 0.0
    h["t"] += ((T_EXTERIOR - h["t"]) / 2400 + sol + aire) * ds

    dif = h["objetivo"] - h["cortina"]
    if dif:
        paso = CORTINA_VEL * dt
        h["cortina"] = h["objetivo"] if abs(dif) <= paso else h["cortina"] + math.copysign(paso, dif)

    t_pared = salas.reloj()
    s["kw"] = KW_BASE + 0.35 * (0.5 + 0.5 * math.sin(t_pared / 40))
    carga = 0.011 * (s["kw"] / KW_BASE)
    frio = 0.0 if s["falla"] else max(0.0, min(0.03, carga + (s["t"] - s["sp"]) * 0.02))
    s["t"] += (carga - frio + (24 - s["t"]) / 6000) * ds

    eventos = []
    if not s["alarma"] and s["t"] > ALARMA_SRV:
        s["alarma"] = True
        eventos.append({"tipo": "alarma_ambiente", "sala": "servidores", "temp": round(s["t"], 1),
                        "detalle": f"la sala de servidores pasó los {ALARMA_SRV:g} °C"})
    elif s["alarma"] and s["t"] < ALARMA_SRV - HISTERESIS:
        s["alarma"] = False
        eventos.append({"tipo": "alarma_ambiente_fin", "sala": "servidores", "temp": round(s["t"], 1)})
    return eventos


def telemetria(salas: Salas, sala: str) -> dict:
    if sala == "hall":
        return {"temp": round(salas.e["hall"]["t"], 2)}
    s = salas.e["servidores"]
    return {"temp": round(s["t"], 2), "kw": round(s["kw"], 2), "ups": s["ups"]}
