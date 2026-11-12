package ar.sd2026.puertas

import android.content.Context
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONObject
import java.security.SecureRandom
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId

enum class Sala(
    val id: String,
    val titulo: String,
    val puerta: String,
    val venceMin: Int,
    val comoEntrar: String,
) {
    HALL("hall", "Hall", "puerta-hall", 15, "Acercá el celular al lector de la puerta Hall"),
    SERVIDORES("servidores", "Servidores", "puerta-servidores", 10, "Pasá tu tarjeta por el lector de Servidores");

    companion object {
        fun deId(id: String) = entries.firstOrNull { it.id == id }
        fun dePuerta(p: String) = entries.firstOrNull { it.puerta == p }
            ?: when {
                p.contains("hall", ignoreCase = true) -> HALL
                p.contains("servidor", ignoreCase = true) -> SERVIDORES
                else -> null
            }
    }
}

data class Acceso(val hasta: Long = 0, val esperandoHasta: Long = 0) {
    fun dentro(ahora: Long) = hasta > ahora
    fun esperando(ahora: Long) = !dentro(ahora) && esperandoHasta > ahora
}

data class EstadoHall(
    val luz: Boolean,
    val nivel: Int,
    val cortina: Float,
    val cortinaMov: String?,
    val clima: Boolean,
    val modo: String,
    val sp: Double,
    val t: Double?,
)

data class EstadoServidores(
    val luz: String,
    val sp: Double,
    val t: Double?,
    val vent: Boolean,
    val crac: String?,
    val kw: Double?,
    val ups: Int?,
    val red: Boolean,
    val alarma: Boolean,
)

data class Pendiente(val reqId: String, val sala: Sala, val disp: String, val accion: String)

data class Mensaje(val tipo: Tipo, val titulo: String, val detalle: String? = null) {
    enum class Tipo { OK, ESPERA, ERROR }
}

fun interface Publicador {
    fun publicar(json: String): Boolean
}

object Salas {
    private const val PREFS = "salas"
    private const val ESPERA_RESPUESTA_MS = 5_000L
    private const val ESPERA_ADMIN_MS = 60_000L

    val acceso = MutableStateFlow(Sala.entries.associateWith { Acceso() })
    val hall = MutableStateFlow<EstadoHall?>(null)
    val servidores = MutableStateFlow<EstadoServidores?>(null)
    val servicioEnLinea = MutableStateFlow<Boolean?>(null)
    val pendientes = MutableStateFlow<Map<String, Pendiente>>(emptyMap())
    val bloqueos = MutableStateFlow<Map<String, Long>>(emptyMap())
    val rol = MutableStateFlow<String?>(null)
    val mensajes = MutableSharedFlow<Mensaje>(extraBufferCapacity = 8)

    @Volatile private var publicador: Publicador? = null
    @Volatile private var usuario: String = "celular"
    private val principal = Handler(Looper.getMainLooper())
    private val azar = SecureRandom()
    private var cargado = false

    fun clave(sala: Sala, disp: String) = "${sala.id}/$disp"

    fun conectado(usuario: String, p: Publicador) {
        this.usuario = usuario
        publicador = p
    }

    fun desconectado() {
        publicador = null
        servicioEnLinea.value = null
        val habia = pendientes.value
        pendientes.value = emptyMap()
        if (habia.isNotEmpty()) mensajes.tryEmit(Mensaje(Mensaje.Tipo.ERROR, "Se cortó la conexión", "El pedido no se envió"))
    }

    @Synchronized
    fun cargar(ctx: Context) {
        if (cargado) return
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        acceso.value = Sala.entries.associateWith {
            Acceso(p.getLong("${it.id}_hasta", 0), p.getLong("${it.id}_esperando", 0))
        }
        rol.value = p.getString("rol", null)
        cargado = true
    }

    private fun guardarAcceso(ctx: Context) {
        val e = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        acceso.value.forEach { (sala, a) ->
            e.putLong("${sala.id}_hasta", a.hasta).putLong("${sala.id}_esperando", a.esperandoHasta)
        }
        rol.value?.let { e.putString("rol", it) }
        e.apply()
    }

    fun registrarAviso(ctx: Context, o: JSONObject) {
        cargar(ctx)
        val sala = Sala.dePuerta(o.optString("puerta")) ?: return
        val ahora = System.currentTimeMillis()
        o.optString("rol").takeIf { it.isNotBlank() }?.let { rol.value = it }
        val desde = instante(o.optString("ts")) ?: ahora
        if (o.optString("resultado") == "salida") {
            bloquear(ctx, salasDe(o.optJSONArray("salas")) ?: conLasDeAdentro(sala))
            return
        }
        acceso.update { mapa ->
            val a = mapa.getValue(sala)
            val nuevo = when (o.optString("resultado")) {
                "acceso" -> Acceso(
                    hasta = instante(o.optString("hasta")) ?: (desde + sala.venceMin * 60_000L),
                    esperandoHasta = 0,
                )
                "solicitud" -> a.copy(esperandoHasta = maxOf(a.esperandoHasta, desde + ESPERA_ADMIN_MS))
                "denegado" -> a.copy(esperandoHasta = 0)
                else -> a
            }
            val otras = o.optJSONObject("dentro")?.let { d ->
                d.keys().asSequence().mapNotNull { id ->
                    val s = Sala.deId(id)?.takeIf { it != sala } ?: return@mapNotNull null
                    val hasta = instante(d.optString(id)) ?: return@mapNotNull null
                    s to Acceso(hasta = hasta)
                }.toMap()
            }.orEmpty()
            mapa + otras + (sala to nuevo)
        }
        guardarAcceso(ctx)
    }

    fun registrarSalida(ctx: Context, o: JSONObject) {
        cargar(ctx)
        salasDe(o.optJSONArray("salas"))?.let { bloquear(ctx, it) }
    }

    fun salir(ctx: Context, sala: Sala): List<Sala> {
        cargar(ctx)
        val salas = conLasDeAdentro(sala)
        bloquear(ctx, salas)
        return salas
    }

    fun conLasDeAdentro(sala: Sala): List<Sala> = if (sala == Sala.HALL) listOf(Sala.HALL, Sala.SERVIDORES) else listOf(sala)

    private fun salasDe(a: org.json.JSONArray?): List<Sala>? =
        a?.let { (0 until it.length()).mapNotNull { i -> Sala.deId(it.optString(i)) } }?.takeIf { it.isNotEmpty() }

    private fun bloquear(ctx: Context, salas: List<Sala>) {
        acceso.update { mapa -> mapa + salas.associateWith { Acceso() } }
        pendientes.update { mapa -> mapa.filterValues { it.sala !in salas } }
        guardarAcceso(ctx)
    }

    private fun instante(texto: String): Long? {
        if (texto.isBlank()) return null
        return runCatching { OffsetDateTime.parse(texto).toInstant().toEpochMilli() }.getOrNull()
            ?: runCatching { LocalDateTime.parse(texto).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() }.getOrNull()
    }

    fun recibirEstado(topic: String, texto: String) {
        val sala = topic.split("/").getOrNull(2)?.let { Sala.deId(it) } ?: return
        val o = runCatching { JSONObject(texto) }.getOrNull() ?: return
        val ahora = System.currentTimeMillis()
        when (sala) {
            Sala.HALL -> {
                val cortina = o.optDouble("cortina", 0.0).toFloat()
                val mov = o.optString("cortina_mov").takeIf { it == "subiendo" || it == "bajando" }
                    ?: o.optDouble("objetivo", Double.NaN).takeUnless { it.isNaN() }?.let {
                        when {
                            it > cortina + 0.5 -> "bajando"
                            it < cortina - 0.5 -> "subiendo"
                            else -> null
                        }
                    }
                hall.value = EstadoHall(
                    luz = o.optBoolean("luz"),
                    nivel = o.optInt("nivel", 100),
                    cortina = cortina.coerceIn(0f, 100f),
                    cortinaMov = mov,
                    clima = o.optBoolean("clima"),
                    modo = o.optString("modo", "frio"),
                    sp = o.optDouble("sp", 23.0),
                    t = numero(o, "t") ?: numero(o, "temp"),
                )
            }
            Sala.SERVIDORES -> servidores.value = EstadoServidores(
                luz = o.optString("luz", "normal"),
                sp = o.optDouble("sp", 22.0),
                t = numero(o, "t") ?: numero(o, "temp"),
                vent = o.optBoolean("vent", true),
                crac = o.optString("crac").ifBlank { null },
                kw = numero(o, "kw"),
                ups = o.optInt("ups", -1).takeIf { it >= 0 },
                red = o.optBoolean("red", true),
                alarma = o.optBoolean("alarma"),
            )
        }
        o.optJSONObject("bloqueos")?.let { b ->
            bloqueos.update { mapa ->
                val sinEsta = mapa.filterKeys { !it.startsWith("${sala.id}/") }
                sinEsta + b.keys().asSequence().mapNotNull { disp ->
                    val s = b.optDouble(disp, 0.0)
                    if (s > 0) clave(sala, disp) to (ahora + (s * 1000).toLong()) else null
                }
            }
        }
    }

    private fun numero(o: JSONObject, k: String) = o.optDouble(k, Double.NaN).takeUnless { it.isNaN() }

    fun recibirPresencia(texto: String) {
        val v = runCatching { JSONObject(texto).optString("estado") }.getOrNull()?.ifBlank { null } ?: texto.trim()
        servicioEnLinea.value = v.equals("online", ignoreCase = true)
    }

    fun pedir(sala: Sala, disp: String, accion: String, valor: Any? = null) {
        val k = clave(sala, disp)
        if (pendientes.value.containsKey(k)) return
        val p = publicador
        if (p == null || servicioEnLinea.value != true) {
            mensajes.tryEmit(
                Mensaje(
                    Mensaje.Tipo.ERROR,
                    if (p == null) "Sin conexión al broker" else "Servicio de salas fuera de línea",
                    "El pedido no se envió",
                ),
            )
            return
        }
        val reqId = "$usuario-" + ByteArray(4).also { azar.nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val json = JSONObject()
            .put("req_id", reqId)
            .put("sala", sala.id)
            .put("disp", disp)
            .put("accion", accion)
            .apply { if (valor != null) put("valor", valor) }
            .put("ts", ahoraIso())
        val pendiente = Pendiente(reqId, sala, disp, accion)
        pendientes.update { it + (k to pendiente) }
        if (!p.publicar(json.toString())) {
            pendientes.update { it - k }
            mensajes.tryEmit(Mensaje(Mensaje.Tipo.ERROR, "No se pudo enviar", "Revisá la conexión"))
            return
        }
        principal.postDelayed({
            if (pendientes.value[k]?.reqId == reqId) {
                pendientes.update { it - k }
                mensajes.tryEmit(Mensaje(Mensaje.Tipo.ERROR, "El servicio de salas no responde", "No hubo respuesta en 5 s"))
            }
        }, ESPERA_RESPUESTA_MS)
    }

    fun recibirRespuesta(texto: String) {
        val o = runCatching { JSONObject(texto) }.getOrNull() ?: return
        val reqId = o.optString("req_id")
        val (k, pendiente) = pendientes.value.entries.firstOrNull { it.value.reqId == reqId }?.toPair() ?: return
        pendientes.update { it - k }
        val ok = o.optBoolean("ok")
        val motivo = o.optString("motivo")
        val espera = o.optDouble("espera_s", 0.0).coerceAtLeast(0.0)
        if (!ok && espera > 0 && motivo in BLOQUEOS) {
            bloqueos.update { it + (k to System.currentTimeMillis() + (espera * 1000).toLong()) }
        }
        mensajes.tryEmit(explicar(pendiente, ok, motivo, espera.toLong(), o.optString("texto").ifBlank { null }))
    }

    private val BLOQUEOS = setOf("bloqueado", "limite", "rebote", "compresor", "ritmo")

    private fun explicar(p: Pendiente, ok: Boolean, motivo: String, espera: Long, textoServicio: String?): Mensaje {
        val (nombre, bloqueadx) = when (p.disp) {
            "luz", "sluz" -> "Luz" to "bloqueada"
            "cortina" -> "Cortina" to "bloqueada"
            "clima" -> "Aire" to "bloqueado"
            "crac" -> "Aire de precisión" to "bloqueado"
            "vent" -> "Ventilación" to "bloqueada"
            else -> p.disp.replaceFirstChar { it.uppercase() } to "bloqueado"
        }
        val enCuanto = if (espera > 0) " · ${duracion(espera)}" else ""
        val E = Mensaje.Tipo.ESPERA
        val X = Mensaje.Tipo.ERROR
        if (ok) return Mensaje(Mensaje.Tipo.OK, "Listo", textoServicio)
        return when (motivo) {
            "sin_acceso" -> Mensaje(X, "Sin acceso", "Primero tenés que entrar a ${p.sala.titulo}")
            "bloqueado" -> Mensaje(E, "$nombre $bloqueadx$enCuanto", "Demasiados cambios seguidos")
            "limite" -> Mensaje(E, "$nombre $bloqueadx$enCuanto", "Pasaste el límite de cambios. Se avisó al dashboard")
            "rebote" -> Mensaje(E, "Muy rápido$enCuanto", "Esperá un poco entre encendidos: cuida el relé")
            "compresor" -> Mensaje(E, "Protección del compresor$enCuanto", "El aire recién se apagó y todavía no puede arrancar")
            "rango" -> Mensaje(
                X, "Fuera de rango",
                if (p.sala == Sala.HALL) "El hall admite de 17 a 26 °C" else "La sala de servidores admite de 18 a 27 °C",
            )
            "ritmo" -> Mensaje(E, "Un cambio cada 5 min$enCuanto", "El aire de precisión cambia de a 1 °C")
            "rol" -> Mensaje(X, "Sólo un admin cambia la temperatura", "Quedó registrado para el dashboard")
            "prohibido" -> Mensaje(
                X, if (p.disp == "vent") "La ventilación no se puede apagar" else "No permitido",
                "Los equipos se recalientan en minutos. Quedó registrado",
            )
            "personal_dentro" -> Mensaje(X, "La luz no se apaga con gente adentro", "Como mucho, pasala a ahorro. Quedó registrado")
            "vencido" -> Mensaje(X, "El pedido llegó tarde", "No se ejecutó. Volvé a intentarlo")
            else -> Mensaje(X, "Rechazado", textoServicio ?: motivo.ifBlank { "Sin motivo" })
        }
    }

    fun duracion(segundos: Long): String = when {
        segundos < 90 -> "$segundos s"
        else -> "%d:%02d min".format(segundos / 60, segundos % 60)
    }
}
