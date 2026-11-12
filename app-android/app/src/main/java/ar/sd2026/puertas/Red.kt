package ar.sd2026.puertas

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

object Red {

    fun esTailscale(host: String): Boolean {
        if (host.endsWith(".ts.net", ignoreCase = true)) return true
        val partes = host.split(".").mapNotNull { it.toIntOrNull() }
        return partes.size == 4 && partes[0] == 100 && partes[1] in 64..127
    }

    @Suppress("DEPRECATION")
    fun vpnActiva(ctx: Context): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return true
        return runCatching {
            cm.allNetworks.any { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
        }.getOrDefault(true)
    }

    fun hayInternet(ctx: Context): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}
