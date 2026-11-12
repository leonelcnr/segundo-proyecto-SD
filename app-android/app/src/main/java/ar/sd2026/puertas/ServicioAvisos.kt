package ar.sd2026.puertas

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import org.eclipse.paho.client.mqttv3.IMqttActionListener
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken
import org.eclipse.paho.client.mqttv3.IMqttToken
import org.eclipse.paho.client.mqttv3.MqttAsyncClient
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended
import org.eclipse.paho.client.mqttv3.MqttConnectOptions
import org.eclipse.paho.client.mqttv3.MqttException
import org.eclipse.paho.client.mqttv3.MqttMessage
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence
import org.json.JSONObject
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

class ServicioAvisos : Service() {

    private val hilo = Executors.newSingleThreadScheduledExecutor()
    private var reintento: ScheduledFuture<*>? = null

    @Volatile private var cliente: MqttAsyncClient? = null
    @Volatile private var config: ConfigMqtt? = null

    private val porEnviar = ConcurrentLinkedQueue<Pair<String, String>>()

    override fun onBind(intent: Intent?): IBinder? = null

    private val vigiaVpn = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            if (hilo.isShutdown) return
            hilo.execute { if (cliente?.isConnected != true && config?.let { Red.esTailscale(it.host) } == true) conectar() }
        }
    }

    override fun onCreate() {
        super.onCreate()
        Salas.cargar(this)
        runCatching {
            getSystemService(ConnectivityManager::class.java).registerNetworkCallback(
                NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_VPN)
                    .removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
                    .build(),
                vigiaVpn,
            )
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        enPrimerPlano()
        when (intent?.action) {
            REPORTAR -> {
                val aviso = Aviso.desdeIntent(intent)
                val mensaje = intent.getStringExtra("mensaje").orEmpty()
                hilo.execute {
                    if (aviso != null) encolarReporte(aviso, mensaje)
                    if (cliente == null) conectar() else enviarPendientes()
                }
            }
            SALIR -> {
                val sala = intent.getStringExtra("sala").orEmpty()
                hilo.execute {
                    encolarSalida(sala)
                    if (cliente == null) conectar() else enviarPendientes()
                }
            }
            else -> hilo.execute {
                val nueva = Ajustes.leer(this)
                if (cliente == null || !nueva.mismaConexion(config)) conectar()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(vigiaVpn) }
        hilo.execute {
            reintento?.cancel(false)
            cerrar()
            Estado.conexion.value = Conexion.Apagada
        }
        hilo.shutdown()
        super.onDestroy()
    }

    private fun enPrimerPlano() {
        val n = Notificaciones.servicio(this, Estado.conexion.value.texto)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(Notificaciones.ID_SERVICIO, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(Notificaciones.ID_SERVICIO, n)
        }
    }

    private fun estado(c: Conexion) {
        Estado.conexion.value = c
        Notificaciones.actualizarServicio(this, c.texto)
    }

    private fun conectar() {
        reintento?.cancel(false)
        cerrar()
        val c = Ajustes.leer(this)
        config = c
        estado(Conexion.Conectando(c.destino))
        if (Red.esTailscale(c.host) && !Red.vpnActiva(this)) {
            estado(Conexion.Error("Prendé Tailscale: sin él no llego a ${c.host} · reintento en 10 s"))
            programarReintento()
            return
        }
        try {
            val cli = MqttAsyncClient(c.uri, c.usuario, MemoryPersistence())
            cli.setCallback(object : MqttCallbackExtended {
                override fun connectComplete(reconnect: Boolean, serverURI: String) {
                    if (cliente !== cli) return
                    estado(Conexion.Conectada(c.destino))
                    runCatching {
                        cli.subscribe(
                            arrayOf(c.temaAvisos, c.temaRespuesta, TEMA_ESTADO_SALAS, TEMA_PRESENCIA_SALAS),
                            intArrayOf(1, 1, 1, 1),
                        )
                    }
                    Salas.conectado(c.usuario) { json -> publicarControl(cli, c, json) }
                    hilo.execute { enviarPendientes() }
                }

                override fun connectionLost(cause: Throwable?) {
                    if (cliente !== cli) return
                    Salas.desconectado()
                    estado(
                        Conexion.Error(
                            if (Red.esTailscale(c.host) && !Red.vpnActiva(this@ServicioAvisos)) "Se apagó Tailscale: prendelo para seguir"
                            else "Se cortó la conexión; reintentando…",
                        ),
                    )
                }

                override fun messageArrived(topic: String, message: MqttMessage) {
                    if (cliente !== cli) return
                    val texto = String(message.payload, Charsets.UTF_8)
                    when {
                        topic == c.temaAvisos -> recibir(texto)
                        topic == c.temaRespuesta -> Salas.recibirRespuesta(texto)
                        topic == TEMA_PRESENCIA_SALAS -> Salas.recibirPresencia(texto)
                        topic.startsWith("sala/") && topic.endsWith("/estado") -> Salas.recibirEstado(topic, texto)
                    }
                }

                override fun deliveryComplete(token: IMqttDeliveryToken?) {}
            })
            cliente = cli
            cli.connect(opciones(c), null, object : IMqttActionListener {
                override fun onSuccess(token: IMqttToken?) {}

                override fun onFailure(token: IMqttToken?, e: Throwable?) {
                    if (cliente !== cli) return
                    estado(Conexion.Error(explicar(e, c)))
                    programarReintento()
                }
            })
        } catch (e: Exception) {
            estado(Conexion.Error(explicar(e, c)))
            programarReintento()
        }
    }

    private fun opciones(c: ConfigMqtt) = MqttConnectOptions().apply {
        isCleanSession = false          // el broker guarda los avisos mientras no hay conexión
        isAutomaticReconnect = true
        keepAliveInterval = 30
        connectionTimeout = 10
        if (c.usuario.isNotBlank()) userName = c.usuario
        if (c.clave.isNotEmpty()) password = c.clave.toCharArray()
        if (c.tls) {
            socketFactory = Tls.fabrica(c.caPem)
            isHttpsHostnameVerificationEnabled = false
            sslHostnameVerifier = Tls.verificador(c.nombreCertificado)
        }
    }

    private fun programarReintento() {
        if (hilo.isShutdown) return
        reintento?.cancel(false)
        reintento = hilo.schedule({ conectar() }, 10, TimeUnit.SECONDS)
    }

    private fun publicarControl(cli: MqttAsyncClient, c: ConfigMqtt, json: String): Boolean = runCatching {
        if (cliente !== cli || !cli.isConnected) return false
        cli.publish(c.temaControl, json.toByteArray(Charsets.UTF_8), 1, false)
        true
    }.getOrDefault(false)

    private fun cerrar() {
        Salas.desconectado()
        val c = cliente ?: return
        cliente = null
        runCatching { c.disconnectForcibly(0, 1_000) }
        runCatching { c.close() }
    }

    private fun recibir(texto: String) {
        val o = runCatching { JSONObject(texto) }.getOrNull() ?: return
        if (o.optString("tipo") == "salida") {
            Salas.registrarSalida(this, o)
            return
        }
        if (o.optString("tipo") != "uso_credencial") return
        val ahora = System.currentTimeMillis()
        val uid = o.optString("uid")
        val propio = uid == Credencial.comoLaVeElServicio(this) && ahora - Credencial.ultimoUso(this) < VENTANA_PROPIA_MS
        val aviso = Aviso(
            reqId = o.optString("req_id").ifBlank { "aviso-$ahora" },
            puerta = o.optString("puerta", "?"),
            uid = uid,
            resultado = o.optString("resultado"),
            ts = o.optString("ts"),
            recibido = ahora,
            estado = if (propio) Aviso.PROPIO else Aviso.PENDIENTE,
        )
        if (!Historial.agregar(this, aviso)) return   // repetido (QoS 1)
        Salas.registrarAviso(this, o)
        if (!propio) Notificaciones.usoAjeno(this, aviso)
    }

    private fun encolarReporte(aviso: Aviso, mensaje: String) {
        val c = Ajustes.leer(this)
        val json = JSONObject()
            .put("tipo", "no_fui_yo")
            .put("req_id", aviso.reqId)
            .put("puerta", aviso.puerta)
            .put("uid", aviso.uid)
            .put("mensaje", mensaje)
            .put("ts", ahoraIso())
        porEnviar.add(c.temaPedidos to json.toString())
    }

    private fun encolarSalida(sala: String) {
        val c = Ajustes.leer(this)
        val json = JSONObject()
            .put("tipo", "salir")
            .put("sala", sala)
            .put("req_id", "${c.usuario}-salir-${System.currentTimeMillis()}")
            .put("ts", ahoraIso())
        porEnviar.add(c.temaPedidos to json.toString())
    }

    private fun enviarPendientes() {
        val cli = cliente ?: return
        if (!cli.isConnected) return
        while (true) {
            val (tema, json) = porEnviar.peek() ?: break
            try {
                cli.publish(tema, json.toByteArray(Charsets.UTF_8), 1, false)
                porEnviar.poll()
            } catch (e: MqttException) {
                break
            }
        }
        if (porEnviar.isEmpty() && !Ajustes.leer(this).activo) stopSelf()
    }

    private fun explicar(e: Throwable?, c: ConfigMqtt): String {
        val cadena = generateSequence(e) { it.cause }.toList()
        val codigo = (e as? MqttException)?.reasonCode
        val ts = Red.esTailscale(c.host)
        return when {
            ts && !Red.vpnActiva(this) -> "Prendé Tailscale: sin él no llego a ${c.host}"
            ts && cadena.any { it is UnknownHostException } -> "No encuentro ${c.host}: prendé MagicDNS en Tailscale"
            ts && cadena.any { it is ConnectException || it is SocketTimeoutException } ->
                "No llego al servidor: revisá que tu Tailscale tenga acceso a sd-2026"
            !ts && !Red.hayInternet(this) -> "El teléfono no tiene red"
            cadena.any { it is UnknownHostException } -> "No encuentro ${c.host}: probá con la IP"
            cadena.any { it is ConnectException || it is SocketTimeoutException } -> "Nadie contesta en ${c.host}:${c.puerto}"
            cadena.any { it is SSLPeerUnverifiedException } -> "El certificado del broker no es para ${c.nombreCertificado}"
            cadena.any { it is SSLHandshakeException || it is CertificateException } -> "El certificado del broker no es de tu CA"
            cadena.any { it is IllegalArgumentException } -> "Revisá los ajustes: ${cadena.first { it is IllegalArgumentException }.message}"
            codigo == MqttException.REASON_CODE_FAILED_AUTHENTICATION.toInt() ||
                codigo == MqttException.REASON_CODE_NOT_AUTHORIZED.toInt() -> "El broker rechazó el usuario o la clave"
            codigo == MqttException.REASON_CODE_INVALID_CLIENT_ID.toInt() -> "El broker rechazó el client ID (${c.usuario})"
            else -> "Error: ${e?.message ?: e?.javaClass?.simpleName ?: "desconocido"}"
        } + " · reintento en 10 s"
    }

    companion object {
        private const val INICIAR = "ar.sd2026.puertas.INICIAR"
        private const val REPORTAR = "ar.sd2026.puertas.REPORTAR"
        private const val SALIR = "ar.sd2026.puertas.SALIR"
        private const val VENTANA_PROPIA_MS = 90_000L
        private const val TEMA_ESTADO_SALAS = "sala/+/+/estado"
        private const val TEMA_PRESENCIA_SALAS = "servicio-salas/presencia"

        fun iniciar(ctx: Context) =
            ContextCompat.startForegroundService(ctx, Intent(ctx, ServicioAvisos::class.java).setAction(INICIAR))

        fun detener(ctx: Context) = ctx.stopService(Intent(ctx, ServicioAvisos::class.java))

        fun reportar(ctx: Context, aviso: Aviso, mensaje: String) = ContextCompat.startForegroundService(
            ctx,
            Intent(ctx, ServicioAvisos::class.java).setAction(REPORTAR)
                .putExtra("aviso", aviso.aJson().toString())
                .putExtra("mensaje", mensaje),
        )

        fun salir(ctx: Context, sala: Sala) = ContextCompat.startForegroundService(
            ctx,
            Intent(ctx, ServicioAvisos::class.java).setAction(SALIR).putExtra("sala", sala.id),
        )
    }
}
