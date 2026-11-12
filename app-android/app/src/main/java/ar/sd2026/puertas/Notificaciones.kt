package ar.sd2026.puertas

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput

object Notificaciones {
    const val ID_SERVICIO = 1
    const val CLAVE_TEXTO = "texto"
    private const val CANAL_SERVICIO = "servicio"
    private const val CANAL_AVISOS = "avisos"

    fun crearCanales(ctx: Context) {
        val gestor = ctx.getSystemService(NotificationManager::class.java)
        gestor.createNotificationChannel(
            NotificationChannel(CANAL_SERVICIO, "Conexión al broker", NotificationManager.IMPORTANCE_LOW)
                .apply { description = "Queda fija mientras la app está conectada (avisos y salas)" }
        )
        gestor.createNotificationChannel(
            NotificationChannel(CANAL_AVISOS, "Usos de tu credencial", NotificationManager.IMPORTANCE_HIGH)
                .apply { description = "Cuando alguien usa tu credencial en una puerta" }
        )
    }

    private fun abrirApp(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE,
    )

    fun servicio(ctx: Context, texto: String): Notification =
        NotificationCompat.Builder(ctx, CANAL_SERVICIO)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle("Puertas: avisos y salas")
            .setContentText(texto)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(abrirApp(ctx))
            .build()

    fun actualizarServicio(ctx: Context, texto: String) {
        if (!permitido(ctx)) return
        ctx.getSystemService(NotificationManager::class.java).notify(ID_SERVICIO, servicio(ctx, texto))
    }

    private fun accion(ctx: Context, aviso: Aviso, accion: String, codigo: Int, editable: Boolean = false): PendingIntent {
        val intent = Intent(ctx, AccionesAviso::class.java).setAction(accion).putExtra("aviso", aviso.aJson().toString())
        val banderas = PendingIntent.FLAG_UPDATE_CURRENT or
            if (editable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(ctx, aviso.idNotificacion * 4 + codigo, intent, banderas)
    }

    fun usoAjeno(ctx: Context, aviso: Aviso) {
        if (!permitido(ctx)) return
        val escribir = NotificationCompat.Action.Builder(
            R.drawable.ic_notificacion, "Escribir al admin",
            accion(ctx, aviso, AccionesAviso.ESCRIBIR, 3, editable = true),
        ).addRemoteInput(RemoteInput.Builder(CLAVE_TEXTO).setLabel("Mensaje para el admin").build()).build()

        val texto = "Alguien usó tu credencial ${aviso.uid} en ${aviso.puerta} y ${aviso.resultadoLegible()} " +
            "(${aviso.hora()}). Si no fuiste vos, avisale al administrador."
        val n = NotificationCompat.Builder(ctx, CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle("¿Fuiste vos?")
            .setContentText("Usaron tu credencial en ${aviso.puerta}")
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(abrirApp(ctx))
            .addAction(0, "Fui yo", accion(ctx, aviso, AccionesAviso.FUI_YO, 1))
            .addAction(0, "No fui yo", accion(ctx, aviso, AccionesAviso.NO_FUI_YO, 2))
            .addAction(escribir)
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(aviso.idNotificacion, n)
    }

    fun confirmacion(ctx: Context, aviso: Aviso, texto: String) {
        if (!permitido(ctx)) return
        val n = NotificationCompat.Builder(ctx, CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle("Aviso enviado al administrador")
            .setContentText(texto)
            .setTimeoutAfter(8_000)
            .setAutoCancel(true)
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(aviso.idNotificacion, n)
    }

    fun cancelar(ctx: Context, aviso: Aviso) =
        ctx.getSystemService(NotificationManager::class.java).cancel(aviso.idNotificacion)

    private fun permitido(ctx: Context) = Build.VERSION.SDK_INT < 33 ||
        ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
}
