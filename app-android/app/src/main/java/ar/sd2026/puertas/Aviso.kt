package ar.sd2026.puertas

import android.content.Context
import android.content.Intent
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class Aviso(
    val reqId: String,
    val puerta: String,
    val uid: String,
    val resultado: String,
    val ts: String,
    val recibido: Long,
    val estado: String,
) {
    val idNotificacion get() = reqId.hashCode()

    fun resultadoLegible() = when (resultado) {
        "acceso" -> "entró"
        "denegado" -> "no pudo entrar"
        "solicitud" -> "pidió permiso al admin"
        "salida" -> "salió"
        else -> resultado.ifBlank { "la usó" }
    }

    fun estadoLegible() = when (estado) {
        PROPIO -> "Fuiste vos (este teléfono)"
        CONFIRMADO -> "Confirmaste que fuiste vos"
        REPORTADO -> "Avisado al admin"
        else -> "Sin responder"
    }

    fun hora(): String = SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(Date(recibido))

    fun aJson(): JSONObject = JSONObject()
        .put("req_id", reqId).put("puerta", puerta).put("uid", uid).put("resultado", resultado)
        .put("ts", ts).put("recibido", recibido).put("estado", estado)

    companion object {
        const val PROPIO = "propio"
        const val PENDIENTE = "pendiente"
        const val CONFIRMADO = "confirmado"
        const val REPORTADO = "reportado"

        fun desdeJson(o: JSONObject) = Aviso(
            reqId = o.optString("req_id"),
            puerta = o.optString("puerta", "?"),
            uid = o.optString("uid"),
            resultado = o.optString("resultado"),
            ts = o.optString("ts"),
            recibido = o.optLong("recibido", System.currentTimeMillis()),
            estado = o.optString("estado", PENDIENTE),
        )

        fun desdeIntent(intent: Intent): Aviso? =
            intent.getStringExtra("aviso")?.let { runCatching { desdeJson(JSONObject(it)) }.getOrNull() }

        fun simulado(ctx: Context) = Aviso(
            reqId = "simulado-" + System.currentTimeMillis().toString(16),
            puerta = "puerta-hall",
            uid = Credencial.comoLaVeElServicio(ctx),
            resultado = "acceso",
            ts = ahoraIso(),
            recibido = System.currentTimeMillis(),
            estado = PENDIENTE,
        )
    }
}

fun ahoraIso(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).format(Date())

object Historial {
    private const val PREFS = "historial"
    private const val MAXIMO = 30
    val avisos = MutableStateFlow<List<Aviso>>(emptyList())
    private var cargado = false

    @Synchronized
    fun cargar(ctx: Context) {
        if (cargado) return
        val texto = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("avisos", "[]")
        val arreglo = runCatching { JSONArray(texto) }.getOrDefault(JSONArray())
        avisos.value = (0 until arreglo.length()).map { Aviso.desdeJson(arreglo.getJSONObject(it)) }
        cargado = true
    }

    @Synchronized
    fun agregar(ctx: Context, aviso: Aviso): Boolean {
        cargar(ctx)
        if (avisos.value.any { it.reqId == aviso.reqId }) return false
        avisos.value = (listOf(aviso) + avisos.value).take(MAXIMO)
        guardar(ctx)
        return true
    }

    @Synchronized
    fun marcar(ctx: Context, reqId: String, estado: String) {
        cargar(ctx)
        avisos.value = avisos.value.map { if (it.reqId == reqId) it.copy(estado = estado) else it }
        guardar(ctx)
    }

    private fun guardar(ctx: Context) {
        val arreglo = JSONArray()
        avisos.value.forEach { arreglo.put(it.aJson()) }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("avisos", arreglo.toString()).apply()
    }
}
