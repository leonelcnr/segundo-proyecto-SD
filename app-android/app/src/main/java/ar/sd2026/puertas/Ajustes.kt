package ar.sd2026.puertas

import android.content.Context

enum class Perfil(
    val titulo: String,
    val descripcion: String,
    val host: String,
    val puerto: Int,
    val tls: Boolean,
    val nombreCertificado: String,
) {
    TAILSCALE(
        "Tailscale", "Recomendado: directo al broker en sd-2026, desde cualquier red, con TLS",
        "sd-2026.tailb9d8eb.ts.net", 18107, true, "broker.puertas",
    ),
    WIFI(
        "Wi-Fi del edificio", "Por el relay de la Raspberry (reenvía el 8883), con TLS",
        "relay-puertas.local", 8883, true, "broker.puertas",
    ),
    PRUEBA(
        "Prueba", "Broker local sin TLS. Poné su IP",
        "relay-puertas.local", 1883, false, "broker.puertas",
    ),
    MANUAL("Manual", "Datos cargados a mano", "", 0, false, "broker.puertas");

    companion object {
        fun de(nombre: String?) = entries.firstOrNull { it.name == nombre }
    }
}

data class ConfigMqtt(
    val activo: Boolean,
    val perfil: Perfil,
    val host: String,
    val puerto: Int,
    val tls: Boolean,
    val nombreCertificado: String,
    val caPem: String,
    val usuario: String,
    val clave: String,
) {
    val uri get() = "${if (tls) "ssl" else "tcp"}://$host:$puerto"
    val destino get() = "$host:$puerto" + if (tls) " · TLS" else ""
    val temaAvisos get() = "usuario/$usuario/aviso"
    val temaPedidos get() = "usuario/$usuario/pedido"
    val temaControl get() = "usuario/$usuario/control"
    val temaRespuesta get() = "usuario/$usuario/respuesta"

    fun mismaConexion(otra: ConfigMqtt?) = otra != null && copy(activo = true) == otra.copy(activo = true)

    override fun toString() = "ConfigMqtt($perfil, $uri, usuario=$usuario, clave=${if (clave.isEmpty()) "-" else "***"})"
}

object Ajustes {
    private const val PREFS = "mqtt"

    fun leer(ctx: Context): ConfigMqtt {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        p.getString("clave", null)?.let { vieja ->
            val e = p.edit().remove("clave")
            if (vieja.isNotEmpty()) e.putString("clave_cifrada", Clave.cifrar(vieja))
            e.apply()
        }
        val perfil = Perfil.de(p.getString("perfil", null))
            ?: if (p.contains("host")) Perfil.MANUAL else Perfil.TAILSCALE
        val base = if (perfil == Perfil.MANUAL) Perfil.PRUEBA else perfil
        return ConfigMqtt(
            activo = p.getBoolean("activo", false),
            perfil = perfil,
            host = p.getString("host", null) ?: base.host,
            puerto = p.getInt("puerto", base.puerto),
            tls = p.getBoolean("tls", base.tls),
            nombreCertificado = p.getString("nombre_certificado", null) ?: base.nombreCertificado,
            caPem = p.getString("ca", null) ?: "",
            usuario = p.getString("usuario", null) ?: "celular-1",
            clave = p.getString("clave_cifrada", null)?.let { Clave.descifrar(it) } ?: "",
        )
    }

    fun hayClave(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).contains("clave_cifrada")

    fun guardar(ctx: Context, c: ConfigMqtt, claveNueva: String?) {
        val e = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("activo", c.activo)
            .putString("perfil", c.perfil.name)
            .putString("host", c.host.trim())
            .putInt("puerto", c.puerto)
            .putBoolean("tls", c.tls)
            .putString("nombre_certificado", c.nombreCertificado.trim())
            .putString("ca", c.caPem)
            .putString("usuario", c.usuario.trim())
            .remove("clave")
        when {
            claveNueva == null -> {}
            claveNueva.isEmpty() -> e.remove("clave_cifrada")
            else -> e.putString("clave_cifrada", Clave.cifrar(claveNueva))
        }
        e.apply()
    }

    fun guardarActivo(ctx: Context, activo: Boolean) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("activo", activo).apply()
}
