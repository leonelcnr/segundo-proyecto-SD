package ar.sd2026.puertas

import android.content.Context
import java.security.SecureRandom

object Credencial {
    private const val PREFS = "credencial"

    private val FORMATO = Regex("^[A-Za-z0-9-]{8,32}$")

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun codigo(ctx: Context): String {
        prefs(ctx).getString("codigo", null)?.let { return it }
        val nuevo = generar()
        prefs(ctx).edit().putString("codigo", nuevo).apply()
        return nuevo
    }

    fun generar(): String {
        val bytes = ByteArray(4)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02X".format(it) }
    }

    fun esValido(codigo: String) = FORMATO.matches(codigo)

    fun nombre(ctx: Context): String =
        prefs(ctx).getString("nombre", null)?.takeIf { it.isNotBlank() } ?: "Mi credencial"

    fun guardar(ctx: Context, codigo: String, nombre: String) {
        require(esValido(codigo))
        prefs(ctx).edit().putString("codigo", codigo).putString("nombre", nombre.trim()).apply()
    }

    fun comoLaVeElServicio(ctx: Context) = "CEL-" + codigo(ctx)

    fun registrarUso(ctx: Context, momento: Long) {
        prefs(ctx).edit().putLong("ultimo_uso", momento).apply()
    }

    fun ultimoUso(ctx: Context) = prefs(ctx).getLong("ultimo_uso", 0L)
}
