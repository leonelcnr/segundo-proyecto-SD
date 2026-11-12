package ar.sd2026.puertas

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarVisuals
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val permisoNotificaciones = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Notificaciones.crearCanales(this)
        Historial.cargar(this)
        Salas.cargar(this)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            permisoNotificaciones.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (Ajustes.leer(this).activo) ServicioAvisos.iniciar(this)
        setContent { TemaPuertas { App() } }
    }
}

@Composable
fun TemaPuertas(contenido: @Composable () -> Unit) {
    val esquema = if (isSystemInDarkTheme()) {
        darkColorScheme(
            primary = Color(0xFFC4B5FD), secondary = Color(0xFF7DD3FC),
            background = Color(0xFF0F0D1A), surface = Color(0xFF0F0D1A), surfaceVariant = Color(0xFF231F36),
            surfaceContainerLowest = Color(0xFF0B0914), surfaceContainerLow = Color(0xFF17142A),
            surfaceContainer = Color(0xFF1B1830), surfaceContainerHigh = Color(0xFF1F1B33),
            surfaceContainerHighest = Color(0xFF231F36),
        )
    } else {
        lightColorScheme(
            primary = Color(0xFF6D28D9), secondary = Color(0xFF0369A1),
            background = Color(0xFFF7F5FC), surface = Color(0xFFF7F5FC), surfaceVariant = Color(0xFFEAE5F7),
            surfaceContainerLowest = Color(0xFFFFFFFF), surfaceContainerLow = Color(0xFFF2EFFA),
            surfaceContainer = Color(0xFFEFEBF9), surfaceContainerHigh = Color(0xFFECE8F8),
            surfaceContainerHighest = Color(0xFFEAE5F7),
        )
    }
    MaterialTheme(colorScheme = esquema, content = contenido)
}

private enum class Pantalla { TARJETA, SALAS, AJUSTES }

private class VisualAviso(val mensaje: Mensaje) : SnackbarVisuals {
    override val message = mensaje.titulo
    override val actionLabel: String? = null
    override val withDismissAction = false
    override val duration = SnackbarDuration.Short
}

@Composable
private fun App() {
    var pantalla by rememberSaveable { mutableStateOf(Pantalla.TARJETA) }
    var principal by rememberSaveable { mutableStateOf(Pantalla.TARJETA) }
    BackHandler(enabled = pantalla != Pantalla.TARJETA) {
        pantalla = if (pantalla == Pantalla.AJUSTES) principal else Pantalla.TARJETA
        principal = pantalla
    }
    val avisos = remember { SnackbarHostState() }
    val alcance = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        Salas.mensajes.collect { m ->
            avisos.currentSnackbarData?.dismiss()
            alcance.launch { avisos.showSnackbar(VisualAviso(m)) }
        }
    }
    val abrirAjustes = { principal = pantalla; pantalla = Pantalla.AJUSTES }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets.safeDrawing,
        snackbarHost = {
            SnackbarHost(avisos) { datos ->
                (datos.visuals as? VisualAviso)?.let { AvisoBreve(it.mensaje) }
            }
        },
        bottomBar = {
            if (pantalla != Pantalla.AJUSTES) {
                NavigationBar {
                    NavigationBarItem(
                        selected = pantalla == Pantalla.TARJETA,
                        onClick = { pantalla = Pantalla.TARJETA },
                        icon = { Icon(Icons.Filled.AccountBox, contentDescription = null) },
                        label = { Text("Tarjeta") },
                    )
                    NavigationBarItem(
                        selected = pantalla == Pantalla.SALAS,
                        onClick = { pantalla = Pantalla.SALAS },
                        icon = { Icon(Icons.Filled.Home, contentDescription = null) },
                        label = { Text("Salas") },
                    )
                }
            }
        },
    ) { margen ->
        Box(Modifier.fillMaxSize().padding(margen).consumeWindowInsets(margen)) {
            when (pantalla) {
                Pantalla.TARJETA -> PantallaTarjeta(abrirAjustes = abrirAjustes)
                Pantalla.SALAS -> PantallaSalas(abrirAjustes = abrirAjustes)
                Pantalla.AJUSTES -> PantallaAjustes(volver = { pantalla = principal })
            }
        }
    }
}

@Composable
private fun PantallaTarjeta(abrirAjustes: () -> Unit) {
    val ctx = LocalContext.current
    val nfc = remember { NfcAdapter.getDefaultAdapter(ctx) }
    val tieneHce = remember { ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION) }
    var nfcPrendido by remember { mutableStateOf(nfc?.isEnabled == true) }
    LifecycleResumeEffect(Unit) {
        nfcPrendido = nfc?.isEnabled == true
        onPauseOrDispose { }
    }
    val conexion by Estado.conexion.collectAsState()
    val avisos by Historial.avisos.collectAsState()
    var avisosActivos by remember { mutableStateOf(Ajustes.leer(ctx).activo) }
    val nombre = remember { Credencial.nombre(ctx) }
    val credencial = remember { Credencial.comoLaVeElServicio(ctx) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Puerta NFC", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    "Sistema de puertas · edificio1", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = abrirAjustes) { Icon(Icons.Filled.Settings, contentDescription = "Ajustes") }
        }

        TarjetaAnimada(nombre, credencial, Modifier.padding(vertical = 6.dp))

        EstadoNfc(
            tieneNfc = nfc != null, tieneHce = tieneHce, prendido = nfcPrendido,
            abrirAjustesNfc = { ctx.startActivity(Intent(Settings.ACTION_NFC_SETTINGS)) },
        )

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Avisos de uso y salas", style = MaterialTheme.typography.titleMedium)
                        Text(
                            if (avisosActivos) conexion.texto
                            else "Conectate para enterarte si alguien usa tu credencial y para controlar las salas",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    Switch(checked = avisosActivos, modifier = Modifier.semantics { contentDescription = "Conexión al broker" }, onCheckedChange = { v ->
                        avisosActivos = v
                        Ajustes.guardarActivo(ctx, v)
                        if (v) ServicioAvisos.iniciar(ctx) else ServicioAvisos.detener(ctx)
                    })
                }
                if (avisosActivos) {
                    TextButton(onClick = {
                        val aviso = Aviso.simulado(ctx)
                        Historial.agregar(ctx, aviso)
                        Notificaciones.usoAjeno(ctx, aviso)
                    }) { Text("Simular un uso ajeno") }
                }
            }
        }

        if (avisos.isNotEmpty()) {
            Text("Últimos usos de tus credenciales", style = MaterialTheme.typography.titleMedium)
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { avisos.forEach { FilaAviso(it) } }
        }
        Spacer(Modifier.size(8.dp))
    }
}

@Composable
private fun EstadoNfc(tieneNfc: Boolean, tieneHce: Boolean, prendido: Boolean, abrirAjustesNfc: () -> Unit) {
    val (texto, problema) = when {
        !tieneNfc -> "Este teléfono no tiene NFC: no puede usarse como tarjeta." to true
        !tieneHce -> "El NFC de este teléfono no puede emular tarjetas (HCE)." to true
        !prendido -> "El NFC está apagado." to true
        else -> "Listo. Con la pantalla encendida, apoyá la parte de atrás del teléfono sobre el lector de la puerta." to false
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(10.dp).background(
                if (problema) MaterialTheme.colorScheme.error else Color(0xFF22C55E), CircleShape,
            ),
        )
        Spacer(Modifier.width(10.dp))
        Text(texto, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        if (tieneNfc && tieneHce && !prendido) {
            OutlinedButton(onClick = abrirAjustesNfc) { Text("Activar") }
        }
    }
}

@Composable
private fun FilaAviso(aviso: Aviso) {
    val color = when (aviso.estado) {
        Aviso.PROPIO, Aviso.CONFIRMADO -> Color(0xFF22C55E)
        Aviso.REPORTADO -> MaterialTheme.colorScheme.error
        else -> Color(0xFFF59E0B)
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).background(color, CircleShape))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text("${aviso.puerta} · ${aviso.uid}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            Text(
                "${aviso.resultadoLegible().replaceFirstChar { it.uppercase() }} · ${aviso.hora()} · ${aviso.estadoLegible()}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun PantallaAjustes(volver: () -> Unit) {
    val ctx = LocalContext.current
    val inicial = remember { Ajustes.leer(ctx) }
    var perfil by remember { mutableStateOf(inicial.perfil) }
    var nombre by remember { mutableStateOf(Credencial.nombre(ctx)) }
    var codigo by remember { mutableStateOf(Credencial.codigo(ctx)) }
    var host by remember { mutableStateOf(inicial.host) }
    var puerto by remember { mutableStateOf(inicial.puerto.toString()) }
    var tls by remember { mutableStateOf(inicial.tls) }
    var nombreCertificado by remember { mutableStateOf(inicial.nombreCertificado) }
    var caPem by remember { mutableStateOf(inicial.caPem) }
    var usuario by remember { mutableStateOf(inicial.usuario) }
    var clave by remember { mutableStateOf("") }
    var hayClave by remember { mutableStateOf(Ajustes.hayClave(ctx)) }
    var borrarClave by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val elegirCa = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val texto = runCatching {
            ctx.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
        }.getOrNull()
        if (texto != null && Tls.describir(texto) != null) {
            caPem = texto
            error = null
        } else {
            error = "Ese archivo no es un certificado PEM (ca.crt)"
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = volver) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Volver") }
            Text("Ajustes", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }

        Titulo("Credencial")
        OutlinedTextField(
            nombre, { nombre = it.take(30) }, Modifier.fillMaxWidth(),
            label = { Text("Nombre en la tarjeta") }, singleLine = true,
        )
        OutlinedTextField(
            codigo,
            { codigo = it.uppercase().filter { c -> c.isLetterOrDigit() || c == '-' }.take(32) },
            Modifier.fillMaxWidth(),
            label = { Text("Código (8 a 32 letras, números o -)") },
            supportingText = { Text("La puerta se lo manda al servicio como CEL-$codigo. Cargalo en la base del servicio.") },
            textStyle = TextStyle(fontFamily = FontFamily.Monospace),
            trailingIcon = { TextButton(onClick = { codigo = Credencial.generar() }) { Text("Nuevo") } },
            singleLine = true,
        )

        Titulo("Conexión (avisos y salas)")
        Column(Modifier.selectableGroup()) {
            Perfil.entries.forEach { p ->
                Row(
                    Modifier.fillMaxWidth().selectable(
                        selected = perfil == p, role = Role.RadioButton,
                        onClick = {
                            perfil = p
                            if (p != Perfil.MANUAL) {
                                host = p.host
                                puerto = p.puerto.toString()
                                tls = p.tls
                                nombreCertificado = p.nombreCertificado
                            }
                        },
                    ).padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = perfil == p, onClick = null)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(p.titulo, style = MaterialTheme.typography.bodyLarge)
                        Text(
                            p.descripcion, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        if (perfil == Perfil.TAILSCALE) {
            Text(
                "Necesitás la app de Tailscale prendida, con acceso a sd-2026 y MagicDNS activado. " +
                    "Sacá Tailscale y esta app del ahorro de batería. Android permite una sola VPN a la vez.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        OutlinedTextField(
            host, { host = it.trim() }, Modifier.fillMaxWidth(),
            label = { Text("Broker: IP o nombre") },
            supportingText = {
                Text(
                    when (perfil) {
                        Perfil.TAILSCALE -> "Nombre MagicDNS del servidor en Tailscale"
                        Perfil.WIFI, Perfil.PRUEBA -> "Si no resuelve relay-puertas.local, poné la IP de la Raspberry"
                        Perfil.MANUAL -> "IP o nombre del broker"
                    },
                )
            },
            textStyle = TextStyle(fontFamily = FontFamily.Monospace),
            singleLine = true,
        )
        OutlinedTextField(
            puerto, { puerto = it.filter(Char::isDigit).take(5) }, Modifier.fillMaxWidth(),
            label = { Text("Puerto") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("TLS", style = MaterialTheme.typography.bodyLarge)
                Text(
                    "Cifrado con la CA del broker", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = tls, modifier = Modifier.semantics { contentDescription = "TLS" }, onCheckedChange = {
                tls = it
                if (it && puerto == "1883") puerto = "8883"
                if (!it && puerto == "8883") puerto = "1883"
            })
        }
        if (tls) {
            OutlinedTextField(
                nombreCertificado, { nombreCertificado = it.trim() }, Modifier.fillMaxWidth(),
                label = { Text("Nombre en el certificado") },
                supportingText = { Text("broker.puertas (o el nombre de Tailscale: el certificado tiene los dos)") },
                singleLine = true,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    Tls.describir(caPem)?.let { "CA cargada: $it" } ?: "Falta la CA: cargá el ca.crt del broker",
                    Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
                    color = if (Tls.describir(caPem) == null) MaterialTheme.colorScheme.error else Color.Unspecified,
                )
                OutlinedButton(onClick = { elegirCa.launch(arrayOf("*/*")) }) { Text("Elegir ca.crt") }
            }
        }
        OutlinedTextField(
            usuario, { usuario = it.trim() }, Modifier.fillMaxWidth(),
            label = { Text("Usuario MQTT (= client ID)") },
            supportingText = { Text("Avisos en usuario/$usuario/aviso · salas en usuario/$usuario/control") },
            singleLine = true,
        )
        OutlinedTextField(
            clave, { clave = it; if (it.isNotEmpty()) borrarClave = false }, Modifier.fillMaxWidth(),
            label = { Text(if (hayClave && !borrarClave) "Clave MQTT nueva" else "Clave MQTT") },
            supportingText = {
                Text(
                    when {
                        borrarClave -> "La clave guardada se borra al tocar Guardar"
                        hayClave -> "Hay una clave guardada, cifrada en el teléfono. Dejá el campo vacío para no cambiarla"
                        else -> "Se guarda cifrada con el Keystore de Android"
                    },
                )
            },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            singleLine = true,
        )
        if (hayClave && !borrarClave) {
            TextButton(onClick = { borrarClave = true; clave = "" }) { Text("Borrar la clave guardada") }
        }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Button(
            onClick = {
                val numero = puerto.toIntOrNull()
                error = when {
                    !Credencial.esValido(codigo) -> "El código tiene que tener entre 8 y 32 letras, números o guiones"
                    host.isBlank() -> "Falta el broker"
                    numero == null || numero !in 1..65535 -> "Puerto inválido"
                    usuario.isBlank() || usuario.any { it in "/+#" } -> "El usuario no puede estar vacío ni tener / + #"
                    tls && Tls.describir(caPem) == null -> "Con TLS hace falta cargar la CA (ca.crt)"
                    perfil == Perfil.TAILSCALE && !tls -> "El perfil Tailscale va siempre con TLS"
                    else -> null
                }
                if (error == null) {
                    Credencial.guardar(ctx, codigo, nombre)
                    val activo = Ajustes.leer(ctx).activo
                    Ajustes.guardar(
                        ctx,
                        ConfigMqtt(activo, perfil, host, numero!!, tls, nombreCertificado, caPem, usuario, ""),
                        claveNueva = when {
                            clave.isNotEmpty() -> clave
                            borrarClave -> ""
                            else -> null
                        },
                    )
                    hayClave = Ajustes.hayClave(ctx)
                    if (activo) ServicioAvisos.iniciar(ctx)
                    volver()
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Guardar") }
        Spacer(Modifier.size(8.dp))
    }
}

@Composable
private fun Titulo(texto: String) {
    Text(
        texto, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 8.dp),
    )
}
