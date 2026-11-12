from __future__ import annotations

import json
import logging
import os
import queue
import signal
import ssl
import sys
import time

import paho.mqtt.client as mqtt

from . import mensajes, simulacion
from .apoyo import Rafagas, Respuestas, cargar_json, guardar_json
from .config import Config, ErrorConfig
from .mensajes import RE_USUARIO, Invalido, PedidoMalo
from .modelo import SALAS, Resultado, Salas, no
from .ocupantes import Ocupantes

log = logging.getLogger("servicio-salas")
GUARDAR_CADA_S = 15


class Servicio:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        datos = cargar_json(cfg.estado_archivo)
        self.salas = Salas(datos=datos)
        if datos:
            log.info("estado restaurado de %s", cfg.estado_archivo)
        self.ocupantes = Ocupantes(cfg.zona)
        self.respuestas = Respuestas()
        self.rafagas = Rafagas()
        # El hilo de Paho sólo encola; un único hilo atiende la cola y la simulación (sin candados).
        self.cola: queue.Queue = queue.Queue(maxsize=5000)
        self.conectado = False
        self.parar = False
        self.falla_pedida: bool | None = None
        self.publicado: dict[str, str] = {}
        self.avisado_rafaga: set[str] = set()
        self.temas_pedidos: dict[int, list[str]] = {}
        s = cfg.sitio
        self.t_control = "usuario/+/control"
        # La ACL autoriza este filtro con {eq, ...}: tiene que ir tal cual; el sitio se filtra al recibir.
        self.t_ocupantes = "acceso/+/sala/+/ocupantes"
        self.t_avisos = "usuario/+/aviso"
        self.t_presencia = "servicio-salas/presencia"
        self.cli = self._cliente()


    def _cliente(self) -> mqtt.Client:
        c = self.cfg
        cli = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=c.usuario, clean_session=True,
                          protocol=mqtt.MQTTv311)
        if c.clave:
            cli.username_pw_set(c.usuario, c.clave)
        cli.will_set(self.t_presencia, "offline", qos=1, retain=True)
        if c.tls:
            ctx = ssl.create_default_context(cafile=c.ca)
            ctx.minimum_version = ssl.TLSVersion.TLSv1_2
            cli.tls_set_context(ctx)
        cli.reconnect_delay_set(min_delay=1, max_delay=30)
        cli.on_connect = lambda _c, _u, _f, rc, _p: self.cola.put(("conexion", rc))
        cli.on_disconnect = lambda _c, _u, _f, rc, _p: self.cola.put(("desconexion", rc))
        cli.on_message = lambda _c, _u, msg: self._encolar(msg)
        cli.on_subscribe = lambda _c, _u, mid, rcs, _p: self.cola.put(("suscripcion", mid, rcs))
        return cli

    def _encolar(self, msg: mqtt.MQTTMessage) -> None:
        try:
            self.cola.put_nowait(("mensaje", msg.topic, msg.payload))
        except queue.Full:
            log.warning("cola llena: descarto un mensaje de %s", msg.topic)

    def _publicar(self, tema: str, datos, qos: int = 1, retener: bool = False) -> None:
        if not self.conectado:
            return
        texto = datos if isinstance(datos, str) else json.dumps(datos, ensure_ascii=False)
        self.cli.publish(tema, texto, qos=qos, retain=retener)


    def correr(self) -> None:
        signal.signal(signal.SIGTERM, self._senal_parar)
        signal.signal(signal.SIGINT, self._senal_parar)
        # Demo: docker compose kill -s SIGUSR1 (falla del aire de precisión) / SIGUSR2 (reparación)
        signal.signal(signal.SIGUSR1, lambda *_: setattr(self, "falla_pedida", True))
        signal.signal(signal.SIGUSR2, lambda *_: setattr(self, "falla_pedida", False))

        self.cli.connect_async(self.cfg.host, self.cfg.puerto, keepalive=30)
        self.cli.loop_start()
        ultimo_tick = time.monotonic()
        ultima_tele = ultimo_guardado = 0.0
        while not self.parar:
            try:
                self._atender(self.cola.get(timeout=max(0.0, ultimo_tick + 1 - time.monotonic())))
            except queue.Empty:
                pass
            except Exception:
                log.exception("error atendiendo un evento (sigo)")
            if self.falla_pedida is not None:
                self._atender(("falla", self.falla_pedida))
                self.falla_pedida = None
            ahora = time.monotonic()
            if ahora - ultimo_tick >= 1:
                self._tick(ahora - ultimo_tick, enviar_tele=ahora - ultima_tele >= self.cfg.telemetria_s)
                if ahora - ultima_tele >= self.cfg.telemetria_s:
                    ultima_tele = ahora
                if ahora - ultimo_guardado >= GUARDAR_CADA_S:
                    self._guardar()
                    ultimo_guardado = ahora
                ultimo_tick = ahora
        self._cerrar()

    def _senal_parar(self, *_):
        self.parar = True

    def _atender(self, ev: tuple) -> None:
        tipo = ev[0]
        if tipo == "mensaje":
            self._mensaje(ev[1], ev[2])
        elif tipo == "conexion":
            self._al_conectar(ev[1])
        elif tipo == "suscripcion":
            temas = self.temas_pedidos.get(ev[1], [])
            for i, rc in enumerate(ev[2]):
                tema = temas[i] if i < len(temas) else f"#{i}"
                if rc.is_failure:
                    log.error("el broker rechazó la suscripción a %s (%s): revisar la ACL", tema, rc)
                else:
                    log.info("suscripto a %s", tema)
        elif tipo == "desconexion":
            if self.conectado:
                log.warning("se cortó la conexión con el broker (%s); reintentando…", ev[1])
            self.conectado = False
        elif tipo == "falla":
            self.salas.e["servidores"]["falla"] = ev[1]
            log.warning("falla simulada del aire de precisión: %s", "ON" if ev[1] else "off")
            self._publicar_estado("servidores")

    def _al_conectar(self, rc) -> None:
        if rc.is_failure:
            log.error("el broker rechazó la conexión: %s", rc)
            return
        self.conectado = True
        log.info("conectado a %s:%s como %s", self.cfg.host, self.cfg.puerto, self.cfg.usuario)
        temas = [(self.t_control, 1), (self.t_ocupantes, 1)]
        if self.cfg.ocupantes_desde_avisos:
            temas.append((self.t_avisos, 1))
        _, mid = self.cli.subscribe(temas)
        self.temas_pedidos = {mid: [t for t, _ in temas]}
        self._publicar(self.t_presencia, "online", retener=True)
        for sala in SALAS:
            self._publicar_estado(sala, forzar=True)


    def _mensaje(self, tema: str, payload: bytes) -> None:
        p = tema.split("/")
        if len(p) == 3 and p[0] == "usuario" and p[2] == "control":
            self._pedido(p[1], payload)
        elif len(p) == 5 and p[0] == "acceso" and p[2] == "sala" and p[4] == "ocupantes":
            if p[1] == self.cfg.sitio:
                self._ocupantes(p[3], payload)
        elif len(p) == 3 and p[0] == "usuario" and p[2] == "aviso" and self.cfg.ocupantes_desde_avisos:
            self._aviso_prueba(p[1], payload)

    def _ocupantes(self, sala: str, payload: bytes) -> None:
        if sala not in SALAS:
            return
        try:
            n = self.ocupantes.actualizar(sala, mensajes.leer_json(payload) if payload else [])
            log.info("ocupantes de %s: %d", sala, n)
        except (Invalido, ValueError) as e:
            log.warning("ocupantes de %s inválidos (%s): los ignoro", sala, e)

    def _pedido(self, usuario: str, payload: bytes) -> None:
        if not RE_USUARIO.match(usuario):
            return
        if not self.rafagas.permitir(usuario):
            if usuario not in self.avisado_rafaga:
                self.avisado_rafaga.add(usuario)
                log.warning("%s manda demasiados pedidos: los descarto", usuario)
                self._evento({"tipo": "sala_abuso", "persona": usuario, "detalle": "ráfaga de pedidos descartada"})
            return
        self.avisado_rafaga.discard(usuario)
        try:
            p = mensajes.pedido(payload)
        except PedidoMalo as e:
            self._responder(usuario, {"req_id": e.req_id, "ok": False, "motivo": "invalido"})
            log.warning("[%s] pedido inválido: %s", usuario, e)
            return
        except Invalido as e:
            log.warning("[%s] mensaje descartado: %s", usuario, e)
            return

        previa = self.respuestas.buscar(usuario, p.req_id)
        if previa is not None:
            self._responder(usuario, previa)
            return
        r = self._decidir(usuario, p)
        resp = r.respuesta(p.req_id)
        self.respuestas.guardar(usuario, p.req_id, resp)
        self._responder(usuario, resp)
        log.info("[%s] %s/%s %s %s -> %s", usuario, p.sala, p.disp, p.accion,
                 "" if p.valor is None else p.valor, "ok" if r.ok else f"{r.motivo} {r.espera_s or ''}".strip())
        if r.evento:
            self._evento({"tipo": "sala_rechazo", "persona": usuario, "sala": p.sala, "disp": p.disp,
                          "accion": p.accion, "motivo": r.motivo, "detalle": r.evento})
        if p.sala in SALAS:
            self._publicar_estado(p.sala)

    def _decidir(self, usuario: str, p: mensajes.Pedido) -> Resultado:
        t = time.time()
        cuando = mensajes.instante(p.ts, self.cfg.zona)
        if cuando is None:
            return no("invalido")
        edad = t - cuando
        if edad > self.cfg.max_antiguedad_s:
            return no("vencido")
        if edad < -60:
            return no("reloj")
        if p.sala not in SALAS:
            return no("desconocido")
        rol = self.ocupantes.rol_si_dentro(usuario, p.sala, t)
        if rol is None:
            return no("sin_acceso")
        return self.salas.aplicar(rol, p.sala, p.disp, p.accion, p.valor)

    def _aviso_prueba(self, usuario: str, payload: bytes) -> None:
        try:
            d = mensajes.leer_json(payload)
        except Invalido:
            return
        if not isinstance(d, dict) or d.get("resultado") != "acceso" or not RE_USUARIO.match(usuario):
            return
        puerta = str(d.get("puerta", ""))
        sala = "hall" if "hall" in puerta else "servidores" if "servidor" in puerta else None
        if not sala:
            return
        hasta = mensajes.instante(d["hasta"], self.cfg.zona) if isinstance(d.get("hasta"), str) else None
        hasta = hasta or time.time() + (15 if sala == "hall" else 10) * 60
        self.ocupantes.agregar(sala, usuario, str(d.get("rol", "empleado")), hasta)
        log.info("(prueba) %s está dentro de %s", usuario, sala)

    def _responder(self, usuario: str, resp: dict) -> None:
        self._publicar(f"usuario/{usuario}/respuesta", resp)

    def _evento(self, datos: dict) -> None:
        sala = datos.get("sala") if datos.get("sala") in SALAS else "general"
        datos = {**datos, "origen": "servicio-salas", "ts": mensajes.ahora_iso(self.cfg.zona)}
        self._publicar(f"sala/{self.cfg.sitio}/{sala}/eventos", datos)
        log.info("evento %s: %s", datos["tipo"], datos.get("detalle", ""))


    def _publicar_estado(self, sala: str, forzar: bool = False) -> None:
        if not self.conectado:
            return
        d = self.salas.publico(sala)
        huella = json.dumps({**d, "bloqueos": sorted(d["bloqueos"])}, sort_keys=True)
        if not forzar and self.publicado.get(sala) == huella:
            return
        self.publicado[sala] = huella
        d["ts"] = mensajes.ahora_iso(self.cfg.zona)
        self._publicar(f"sala/{self.cfg.sitio}/{sala}/estado", d, retener=True)

    def _tick(self, dt: float, enviar_tele: bool) -> None:
        for ev in simulacion.avanzar(self.salas, dt, self.cfg.sim):
            self._evento(ev)
        for sala in SALAS:
            self._publicar_estado(sala)
            if enviar_tele:
                tele = {**simulacion.telemetria(self.salas, sala), "ts": mensajes.ahora_iso(self.cfg.zona)}
                self._publicar(f"sala/{self.cfg.sitio}/{sala}/telemetria", tele, qos=0)
        self._salud()

    def _salud(self) -> None:
        try:
            with open(self.cfg.salud_archivo, "w") as f:
                json.dump({"conectado": self.conectado, "ts": time.time()}, f)
        except OSError:
            pass

    def _guardar(self) -> None:
        try:
            guardar_json(self.cfg.estado_archivo, self.salas.volcar())
        except OSError as e:
            log.warning("no pude guardar el estado en %s: %s", self.cfg.estado_archivo, e)

    def _cerrar(self) -> None:
        log.info("cerrando: guardo el estado y aviso que me voy")
        self._guardar()
        if self.conectado:
            info = self.cli.publish(self.t_presencia, "offline", qos=1, retain=True)
            try:
                info.wait_for_publish(timeout=3)
            except (RuntimeError, ValueError):
                pass
        self.cli.disconnect()
        self.cli.loop_stop()


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_NIVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    try:
        cfg = Config.desde_entorno()
    except ErrorConfig as e:
        log.error("configuración inválida: %s", e)
        sys.exit(2)
    log.info("arrancando: %s", cfg.resumen())
    Servicio(cfg).correr()


if __name__ == "__main__":
    main()
