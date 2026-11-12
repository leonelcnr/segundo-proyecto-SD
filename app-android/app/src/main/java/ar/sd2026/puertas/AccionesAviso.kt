package ar.sd2026.puertas

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

class AccionesAviso : BroadcastReceiver() {

    override fun onReceive(ctx: Context, intent: Intent) {
        val aviso = Aviso.desdeIntent(intent) ?: return
        when (intent.action) {
            FUI_YO -> {
                Historial.marcar(ctx, aviso.reqId, Aviso.CONFIRMADO)
                Notificaciones.cancelar(ctx, aviso)
            }
            NO_FUI_YO -> reportar(ctx, aviso, "No fui yo: alguien usó mi credencial")
            ESCRIBIR -> {
                val texto = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notificaciones.CLAVE_TEXTO)?.toString()
                reportar(ctx, aviso, texto?.trim().takeUnless { it.isNullOrEmpty() } ?: "No fui yo")
            }
        }
    }

    private fun reportar(ctx: Context, aviso: Aviso, mensaje: String) {
        ServicioAvisos.reportar(ctx, aviso, mensaje)
        Historial.marcar(ctx, aviso.reqId, Aviso.REPORTADO)
        Notificaciones.confirmacion(ctx, aviso, mensaje)
    }

    companion object {
        const val FUI_YO = "ar.sd2026.puertas.FUI_YO"
        const val NO_FUI_YO = "ar.sd2026.puertas.NO_FUI_YO"
        const val ESCRIBIR = "ar.sd2026.puertas.ESCRIBIR"
    }
}
