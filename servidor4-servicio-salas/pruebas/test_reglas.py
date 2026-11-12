import json
import os
import sys
import tempfile
import unittest
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import mensajes, simulacion  # noqa: E402
from app.apoyo import Rafagas, Respuestas, cargar_json, guardar_json  # noqa: E402
from app.modelo import Salas  # noqa: E402
from app.ocupantes import Ocupantes  # noqa: E402

ZONA = ZoneInfo("America/Argentina/Buenos_Aires")


class Reloj:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t

    def pasar(self, s):
        self.t += s


class TestHall(unittest.TestCase):
    def setUp(self):
        self.r = Reloj()
        self.s = Salas(self.r)

    def test_quinta_luz_bloquea_20s_con_evento(self):
        for _ in range(4):
            self.assertTrue(self.s.aplicar("empleado", "hall", "luz", "toggle").ok)
            self.r.pasar(1.5)
        r = self.s.aplicar("empleado", "hall", "luz", "toggle")
        self.assertEqual((r.ok, r.motivo, r.espera_s), (False, "limite", 20))
        self.assertIsNotNone(r.evento)
        self.assertEqual(self.s.bloqueados("hall"), {"luz": 20})
        self.r.pasar(5)
        self.assertEqual(self.s.aplicar("empleado", "hall", "luz", "toggle").motivo, "bloqueado")
        self.r.pasar(16)
        self.assertTrue(self.s.aplicar("empleado", "hall", "luz", "toggle").ok)

    def test_rebote_de_la_luz(self):
        self.assertTrue(self.s.aplicar("empleado", "hall", "luz", "toggle").ok)
        self.r.pasar(0.5)
        self.assertEqual(self.s.aplicar("empleado", "hall", "luz", "toggle").motivo, "rebote")

    def test_compresor(self):
        self.assertTrue(self.s.aplicar("empleado", "hall", "clima", "toggle").ok)
        r = self.s.aplicar("empleado", "hall", "clima", "toggle")
        self.assertEqual((r.motivo, r.espera_s), ("compresor", 180))
        self.r.pasar(181)
        self.assertTrue(self.s.aplicar("empleado", "hall", "clima", "toggle").ok)

    def test_consigna_mas_de_3_grados_en_30s(self):
        for _ in range(6):
            self.assertTrue(self.s.aplicar("empleado", "hall", "clima", "sp", -0.5).ok)
        r = self.s.aplicar("empleado", "hall", "clima", "sp", -0.5)
        self.assertEqual((r.motivo, r.espera_s), ("limite", 30))
        self.assertEqual(self.s.e["hall"]["sp"], 20.0)

    def test_rango_de_la_consigna(self):
        self.s.e["hall"]["sp"] = 26.0
        self.assertEqual(self.s.aplicar("empleado", "hall", "clima", "sp", 0.5).motivo, "rango")
        self.assertEqual(self.s.aplicar("empleado", "hall", "clima", "sp", 40).motivo, "rango")

    def test_cortina_cuarta_orden_bloquea(self):
        for a in ("bajar", "subir", "bajar"):
            self.assertTrue(self.s.aplicar("empleado", "hall", "cortina", a).ok)
        self.assertTrue(self.s.aplicar("empleado", "hall", "cortina", "parar").ok)
        r = self.s.aplicar("empleado", "hall", "cortina", "subir")
        self.assertEqual((r.motivo, r.espera_s), ("limite", 15))

    def test_valores_raros_no_rompen(self):
        self.assertEqual(self.s.aplicar("empleado", "hall", "luz", "nivel", "mucho").motivo, "invalido")
        self.assertEqual(self.s.aplicar("empleado", "hall", "clima", "modo", "turbo").motivo, "invalido")
        self.assertEqual(self.s.aplicar("empleado", "hall", "clima", "sp", float("nan")).motivo, "rango")
        self.assertEqual(self.s.aplicar("empleado", "hall", "puerta", "abrir").motivo, "desconocido")


class TestServidores(unittest.TestCase):
    def setUp(self):
        self.r = Reloj()
        self.s = Salas(self.r)

    def test_ventilacion_nunca(self):
        for rol in ("empleado", "admin"):
            r = self.s.aplicar(rol, "servidores", "vent", "apagar")
            self.assertEqual(r.motivo, "prohibido")
            self.assertIsNotNone(r.evento)

    def test_luz_no_se_apaga_y_un_cambio_cada_5s(self):
        self.assertEqual(self.s.aplicar("admin", "servidores", "sluz", "apagar").motivo, "personal_dentro")
        self.assertTrue(self.s.aplicar("empleado", "servidores", "sluz", "ahorro").ok)
        self.assertEqual(self.s.aplicar("empleado", "servidores", "sluz", "normal").motivo, "bloqueado")
        self.r.pasar(5.1)
        self.assertTrue(self.s.aplicar("empleado", "servidores", "sluz", "normal").ok)

    def test_consigna_solo_admin_de_a_1_cada_5_min(self):
        self.assertEqual(self.s.aplicar("empleado", "servidores", "crac", "sp", 1).motivo, "rol")
        self.assertTrue(self.s.aplicar("admin", "servidores", "crac", "sp", 5).ok)
        self.assertEqual(self.s.e["servidores"]["sp"], 23.0)
        self.assertEqual(self.s.aplicar("admin", "servidores", "crac", "sp", 1).motivo, "ritmo")
        self.r.pasar(301)
        self.assertTrue(self.s.aplicar("admin", "servidores", "crac", "sp", -1).ok)


class TestSimulacion(unittest.TestCase):
    def test_falla_dispara_alarma_y_se_recupera(self):
        r = Reloj()
        s = Salas(r)
        s.e["servidores"]["falla"] = True
        eventos = []
        for _ in range(120):
            r.pasar(1)
            eventos += simulacion.avanzar(s, 1, 30)
        self.assertTrue(s.e["servidores"]["alarma"])
        self.assertEqual(eventos[0]["tipo"], "alarma_ambiente")
        s.e["servidores"]["falla"] = False
        for _ in range(600):
            r.pasar(1)
            eventos += simulacion.avanzar(s, 1, 30)
        self.assertFalse(s.e["servidores"]["alarma"])
        self.assertEqual(eventos[-1]["tipo"], "alarma_ambiente_fin")

    def test_cortina_avanza_a_velocidad_de_motor(self):
        r = Reloj()
        s = Salas(r)
        s.aplicar("empleado", "hall", "cortina", "bajar")
        simulacion.avanzar(s, 1, 30)
        self.assertAlmostEqual(s.e["hall"]["cortina"], 46.0)
        self.assertEqual(s.publico("hall")["cortina_mov"], "bajando")


class TestMensajes(unittest.TestCase):
    def test_pedido_valido(self):
        p = mensajes.pedido(b'{"req_id":"celular-1-0a","sala":"hall","disp":"luz","accion":"toggle","ts":"2026-11-06T18:20:05"}')
        self.assertEqual((p.sala, p.disp, p.valor), ("hall", "luz", None))

    def test_rechaza_basura(self):
        for malo in (b"no json", b"[]", b'{"req_id": "a b"}', b"x" * 5000):
            with self.assertRaises(mensajes.Invalido):
                mensajes.pedido(malo)
        with self.assertRaises(mensajes.PedidoMalo):
            mensajes.pedido(b'{"req_id":"ok-1","sala":"hall","disp":"luz","accion":"toggle"}')
        with self.assertRaises(mensajes.PedidoMalo):
            mensajes.pedido(b'{"req_id":"ok-1","sala":"hall","disp":"luz","accion":"x","valor":{"a":1},"ts":"t"}')

    def test_horas_con_y_sin_zona(self):
        a = mensajes.instante("2026-11-06T18:20:05", ZONA)
        b = mensajes.instante("2026-11-06T18:20:05-03:00", ZONA)
        c = mensajes.instante("2026-11-06T21:20:05Z", ZONA)
        self.assertEqual(a, b)
        self.assertEqual(b, c)
        self.assertIsNone(mensajes.instante("ayer", ZONA))


class TestOcupantes(unittest.TestCase):
    def test_foto_reemplaza_y_vence(self):
        o = Ocupantes(ZONA)
        t = mensajes.instante("2026-11-06T18:00:00-03:00", ZONA)
        o.actualizar("hall", {"ocupantes": [
            {"usuario": "celular-1", "rol": "empleado", "hasta": "2026-11-06T18:15:00-03:00"},
            {"usuario": "celular-2", "rol": "superusuario", "hasta": "2026-11-06T18:15:00-03:00"},
            {"usuario": "celular-3", "rol": "admin"},
        ]})
        self.assertEqual(o.rol_si_dentro("celular-1", "hall", t), "empleado")
        self.assertIsNone(o.rol_si_dentro("celular-2", "hall", t))
        self.assertIsNone(o.rol_si_dentro("celular-3", "hall", t))
        self.assertIsNone(o.rol_si_dentro("celular-1", "hall", t + 16 * 60))
        self.assertIsNone(o.rol_si_dentro("celular-1", "servidores", t))
        o.actualizar("hall", [])
        self.assertIsNone(o.rol_si_dentro("celular-1", "hall", t))


class TestApoyo(unittest.TestCase):
    def test_idempotencia(self):
        r = Respuestas()
        r.guardar("celular-1", "x-1", {"req_id": "x-1", "ok": True})
        self.assertEqual(r.buscar("celular-1", "x-1"), {"req_id": "x-1", "ok": True})
        self.assertIsNone(r.buscar("celular-2", "x-1"))

    def test_rafagas(self):
        f = Rafagas(maximo=3, ventana_s=10)
        self.assertEqual([f.permitir("a") for _ in range(4)], [True, True, True, False])
        self.assertTrue(f.permitir("b"))

    def test_guardar_y_restaurar(self):
        r = Reloj()
        s = Salas(r)
        s.aplicar("empleado", "hall", "clima", "toggle")
        s.e["hall"]["objetivo"] = 100.0
        with tempfile.TemporaryDirectory() as d:
            ruta = os.path.join(d, "estado.json")
            guardar_json(ruta, s.volcar())
            otra = Salas(r, cargar_json(ruta))
        self.assertFalse(otra.e["hall"]["clima"])
        self.assertEqual(otra.aplicar("empleado", "hall", "clima", "toggle").motivo, "compresor")
        self.assertEqual(otra.e["hall"]["objetivo"], otra.e["hall"]["cortina"])

    def test_restaurar_ignora_basura(self):
        s = Salas(Reloj(), {"hall": {"luz": "sí", "nivel": 1e400, "modo": "turbo", "sp": 24.0, "extra": 1},
                            "servidores": {"luz": "apagada"}, "bloqueos": {"hall/luz": "x"}})
        self.assertIs(s.e["hall"]["luz"], True)
        self.assertEqual(s.e["hall"]["nivel"], 80)
        self.assertEqual(s.e["hall"]["modo"], "frio")
        self.assertEqual(s.e["hall"]["sp"], 24.0)
        self.assertEqual(s.e["servidores"]["luz"], "normal")
        self.assertNotIn("extra", s.e["hall"])
        json.dumps(s.volcar())


if __name__ == "__main__":
    unittest.main()
