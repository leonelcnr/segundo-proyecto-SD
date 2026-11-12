package ar.sd2026.puertas

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.util.Locale

private val Ambar = Color(0xFFF59E0B)

@Composable
fun verdeEstado() = if (isSystemInDarkTheme()) Color(0xFF4ADE80) else Color(0xFF22C55E)

private val Degradado = Brush.linearGradient(listOf(Color(0xFF312E81), Color(0xFF6D28D9), Color(0xFF0E7490)))
private val es = Locale("es", "AR")
private fun grados(t: Double) = String.format(es, "%.1f°", t)

private data class Impedimento(val texto: String, val tipo: Mensaje.Tipo)

@Composable
fun PantallaSalas(abrirAjustes: () -> Unit) {
    val ctx = LocalContext.current
    val config = remember { Ajustes.leer(ctx) }
    var conectarActivo by remember { mutableStateOf(config.activo) }
    val conexion by Estado.conexion.collectAsState()
    val servicio by Salas.servicioEnLinea.collectAsState()
    val accesos by Salas.acceso.collectAsState()
    val rol by Salas.rol.collectAsState()
    var pestana by rememberSaveable { mutableStateOf(Sala.HALL) }

    var ahora by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            ahora = System.currentTimeMillis()
            delay(1_000 - ahora % 1_000)
        }
    }

    val impedimento = when {
        !conectarActivo -> Impedimento("Conexión apagada: conectate para controlar las salas", Mensaje.Tipo.ERROR)
        conexion !is Conexion.Conectada -> Impedimento(
            conexion.texto, if (conexion is Conexion.Conectando) Mensaje.Tipo.ESPERA else Mensaje.Tipo.ERROR,
        )
        servicio == null -> Impedimento("Esperando al servicio de salas…", Mensaje.Tipo.ESPERA)
        servicio == false -> Impedimento("Servicio de salas fuera de línea", Mensaje.Tipo.ERROR)
        else -> null
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Salas", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    config.usuario + (rol?.let { " · $it" } ?: ""),
                    style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = abrirAjustes) { Icon(Icons.Filled.Settings, contentDescription = "Ajustes") }
        }

        EstadoConexion(impedimento, conexion, conectarActivo) {
            conectarActivo = true
            Ajustes.guardarActivo(ctx, true)
            ServicioAvisos.iniciar(ctx)
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Sala.entries.forEach { FilaAcceso(it, accesos.getValue(it), ahora) }
            }
        }

        TabRow(
            selectedTabIndex = pestana.ordinal,
            containerColor = Color.Transparent,
        ) {
            Sala.entries.forEach { s ->
                val bloqueada = !accesos.getValue(s).dentro(ahora)
                Tab(
                    selected = pestana == s,
                    onClick = { pestana = s },
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (bloqueada) {
                                Icon(Icons.Filled.Lock, contentDescription = "bloqueada", Modifier.size(14.dp))
                                Spacer(Modifier.width(6.dp))
                            }
                            Text(s.titulo)
                        }
                    },
                )
            }
        }

        val acceso = accesos.getValue(pestana)
        EncabezadoSala(pestana, acceso, ahora)
        PanelSala(pestana, acceso, ahora, habilitado = impedimento == null)
        Spacer(Modifier.size(8.dp))
    }
}

@Composable
private fun EstadoConexion(imp: Impedimento?, conexion: Conexion, activo: Boolean, conectar: () -> Unit) {
    val color = when (imp?.tipo) {
        null -> verdeEstado()
        Mensaje.Tipo.ESPERA -> Ambar
        else -> MaterialTheme.colorScheme.error
    }
    val texto = imp?.texto ?: (conexion.texto + " · servicio de salas en línea")
    Row(verticalAlignment = Alignment.CenterVertically) {
        Punto(color)
        Spacer(Modifier.width(10.dp))
        Text(texto, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        if (!activo) {
            Spacer(Modifier.width(8.dp))
            OutlinedButton(onClick = conectar) { Text("Conectar") }
        }
    }
}

@Composable
private fun Punto(color: Color) = Box(Modifier.size(10.dp).background(color, CircleShape))

private fun textoAcceso(a: Acceso, ahora: Long): String = when {
    a.dentro(ahora) -> {
        val s = (a.hasta - ahora) / 1000
        if (s >= 60) "Dentro · quedan ${(s + 59) / 60} min" else "Dentro · quedan $s s"
    }
    a.esperando(ahora) -> "Esperando al admin"
    else -> "Sin entrada"
}

@Composable
private fun FilaAcceso(sala: Sala, a: Acceso, ahora: Long) {
    val color = when {
        a.dentro(ahora) -> verdeEstado()
        a.esperando(ahora) -> Ambar
        else -> MaterialTheme.colorScheme.outline
    }
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Punto(color)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(sala.titulo, style = MaterialTheme.typography.titleMedium)
            Text(
                textoAcceso(a, ahora), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (!a.dentro(ahora)) {
            Text(
                if (a.esperando(ahora)) "Aguardá en la puerta"
                else if (sala == Sala.HALL) "Acercá el celular" else "Pasá la tarjeta",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
            )
        } else {
            BotonSalir(sala)
        }
    }
}

@Composable
private fun BotonSalir(sala: Sala) {
    val ctx = LocalContext.current
    OutlinedButton(onClick = {
        val salas = Salas.salir(ctx, sala)
        ServicioAvisos.salir(ctx, sala)
        Salas.mensajes.tryEmit(
            Mensaje(
                Mensaje.Tipo.OK,
                "Saliste de " + salas.joinToString(" y ") { it.titulo },
                "Para volver a entrar, pasá de nuevo por la puerta",
            ),
        )
    }) { Text("Salir") }
}

@Composable
private fun EncabezadoSala(sala: Sala, a: Acceso, ahora: Long) {
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Degradado).padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(sala.titulo, color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    if (sala == Sala.HALL) "Sala común · luz, cortina y aire" else "Sala privilegiada · controles estrictos",
                    color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall,
                )
            }
            Surface(shape = RoundedCornerShape(50), color = Color.White.copy(alpha = 0.16f)) {
                Text(
                    textoAcceso(a, ahora), Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    color = Color.White, style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

@Composable
private fun PanelSala(sala: Sala, a: Acceso, ahora: Long, habilitado: Boolean) {
    val dentro = a.dentro(ahora)
    val hall by Salas.hall.collectAsState()
    val srv by Salas.servidores.collectAsState()
    val pendientes by Salas.pendientes.collectAsState()
    val bloqueos by Salas.bloqueos.collectAsState()

    val ctl = Controles(sala, habilitado && dentro, pendientes, bloqueos, ahora)

    Box {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when (sala) {
                Sala.HALL -> hall?.let { PanelHall(it, ctl) } ?: SinEstado()
                Sala.SERVIDORES -> srv?.let { PanelServidores(it, ctl) } ?: SinEstado()
            }
        }
        if (!dentro) {
            Box(
                Modifier.matchParentSize().clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.background.copy(alpha = 0.86f)),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(
                        Modifier.size(56.dp).background(MaterialTheme.colorScheme.surfaceVariant, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Filled.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.primary) }
                    Text(
                        if (sala == Sala.HALL) "Hall bloqueado" else "Sala privilegiada",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        if (a.esperando(ahora)) "Esperando que un admin apruebe tu entrada…"
                        else sala.comoEntrar + ". Con la entrada concedida podés controlar la sala " +
                            "durante ${sala.venceMin} min.",
                        style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun SinEstado() {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp).height(260.dp), verticalArrangement = Arrangement.Center) {
            Text(
                "Todavía no llegó el estado de esta sala.", Modifier.fillMaxWidth(),
                style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private class Controles(
    val sala: Sala,
    private val habilitado: Boolean,
    private val pendientes: Map<String, Pendiente>,
    private val bloqueos: Map<String, Long>,
    val ahora: Long,
) {
    fun enviando(disp: String) = pendientes.containsKey(Salas.clave(sala, disp))
    fun activo(disp: String) = habilitado && !enviando(disp)
    fun bloqueo(disp: String): Long = ((bloqueos[Salas.clave(sala, disp)] ?: 0L) - ahora + 999) / 1000
    fun pedir(disp: String, accion: String, valor: Any? = null) = Salas.pedir(sala, disp, accion, valor)
}

@Composable
private fun PanelHall(e: EstadoHall, c: Controles) {
    TarjetaDispositivo("Luz", if (e.luz) "Encendida al ${e.nivel} %" else "Apagada", c, "luz", accion = {
        Switch(
            checked = e.luz, enabled = c.activo("luz"),
            onCheckedChange = { c.pedir("luz", "toggle") },
            modifier = Modifier.semantics {
                contentDescription = "Luz del hall"
                stateDescription = if (e.luz) "encendida" else "apagada"
            },
        )
    }) {
        var arrastre by remember { mutableStateOf<Float?>(null) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Slider(
                value = arrastre ?: e.nivel.toFloat(),
                onValueChange = { arrastre = it },
                onValueChangeFinished = {
                    arrastre?.let { c.pedir("luz", "nivel", (Math.round(it / 5f) * 5).coerceIn(10, 100)) }
                    arrastre = null
                },
                valueRange = 10f..100f, steps = 17, enabled = c.activo("luz"),
                modifier = Modifier.weight(1f).semantics { contentDescription = "Intensidad de la luz" },
            )
            Spacer(Modifier.width(12.dp))
            Text(
                "${(arrastre?.let { Math.round(it / 5f) * 5 } ?: e.nivel)} %",
                fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.width(52.dp), textAlign = TextAlign.End,
            )
        }
    }

    val movimiento = e.cortinaMov?.let { " · $it" } ?: ""
    TarjetaDispositivo("Cortina", "${e.cortina.toInt()} % cerrada$movimiento", c, "cortina") {
        val ok = c.activo("cortina")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { c.pedir("cortina", "subir") }, enabled = ok, modifier = Modifier.weight(1f)) {
                Icon(Icons.Filled.KeyboardArrowUp, contentDescription = null)
                Text("Subir")
            }
            OutlinedButton(onClick = { c.pedir("cortina", "parar") }, enabled = ok, modifier = Modifier.weight(1f)) {
                Text("Parar")
            }
            OutlinedButton(onClick = { c.pedir("cortina", "bajar") }, enabled = ok, modifier = Modifier.weight(1f)) {
                Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null)
                Text("Bajar")
            }
        }
        val cerrada by animateFloatAsState(e.cortina / 100f, tween(900), label = "cortina")
        LinearProgressIndicator(
            progress = { cerrada },
            modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp))
                .semantics { contentDescription = "Cortina ${e.cortina.toInt()} % cerrada" },
            color = MaterialTheme.colorScheme.secondary,
            trackColor = MaterialTheme.colorScheme.surfaceVariant,
            drawStopIndicator = {},
        )
    }

    TarjetaDispositivo("Aire acondicionado", if (e.clima) "Encendido · ${if (e.modo == "calor") "calor" else "frío"}" else "Apagado", c, "clima", accion = {
        Switch(
            checked = e.clima, enabled = c.activo("clima"),
            onCheckedChange = { c.pedir("clima", "toggle") },
            modifier = Modifier.semantics {
                contentDescription = "Aire acondicionado del hall"
                stateDescription = if (e.clima) "encendido" else "apagado"
            },
        )
    }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                ValorGrande(e.t?.let(::grados) ?: "–")
                Text("ahora", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Paso(grados(e.sp), "consigna", c.activo("clima"), "temperatura del hall",
                bajar = { c.pedir("clima", "sp", -0.5) }, subir = { c.pedir("clima", "sp", 0.5) })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Opcion("Frío", e.modo != "calor", c.activo("clima"), Modifier.weight(1f)) { c.pedir("clima", "modo", "frio") }
            Opcion("Calor", e.modo == "calor", c.activo("clima"), Modifier.weight(1f)) { c.pedir("clima", "modo", "calor") }
        }
    }
}

@Composable
private fun PanelServidores(e: EstadoServidores, c: Controles) {
    AnimatedVisibility(e.alarma, enter = fadeIn(), exit = fadeOut()) {
        Surface(
            shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.error.copy(alpha = 0.14f),
            modifier = Modifier.fillMaxWidth().border(1.dp, MaterialTheme.colorScheme.error, RoundedCornerShape(12.dp)),
        ) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                Spacer(Modifier.width(10.dp))
                Column {
                    Text("Alarma de temperatura", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.error)
                    Text(
                        "La sala pasó los 27 °C. Se avisó al dashboard.", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }

    TarjetaDispositivo("Aire de precisión", e.crac ?: "refrigerando", c, "crac") {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                ValorGrande(e.t?.let(::grados) ?: "–", alarma = e.alarma)
                Text("sala", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Paso(grados(e.sp), "consigna", c.activo("crac"), "consigna del aire de precisión",
                bajar = { c.pedir("crac", "sp", -1) }, subir = { c.pedir("crac", "sp", 1) })
        }
        Text(
            "Sólo un admin cambia la consigna: de a 1 °C, un cambio cada 5 min.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Ventilación y refrigeración", style = MaterialTheme.typography.bodyMedium)
                Text(
                    if (c.bloqueo("vent") > 0) "Pedido rechazado" else "No se puede apagar",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(
                checked = e.vent, enabled = c.activo("vent"),
                onCheckedChange = { c.pedir("vent", "apagar") },
                thumbContent = { Icon(Icons.Filled.Lock, contentDescription = null, Modifier.size(SwitchDefaults.IconSize)) },
                modifier = Modifier.semantics {
                    contentDescription = "Ventilación de servidores, bloqueada"
                    stateDescription = if (e.vent) "encendida" else "apagada"
                },
            )
        }
    }

    TarjetaDispositivo("Luz", if (e.luz == "ahorro") "Ahorro" else "Normal", c, "sluz") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Opcion("Normal", e.luz == "normal", c.activo("sluz"), Modifier.weight(1f)) { c.pedir("sluz", "normal") }
            Opcion("Ahorro", e.luz == "ahorro", c.activo("sluz"), Modifier.weight(1f)) { c.pedir("sluz", "ahorro") }
            Opcion("Apagar", e.luz == "apagada", c.activo("sluz"), Modifier.weight(1f)) { c.pedir("sluz", "apagar") }
        }
        Text(
            "Con gente adentro no se apaga. Un cambio cada 5 s.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    TarjetaDispositivo("Energía", null, c, "energia", accion = {
        Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.surfaceVariant) {
            Text(
                "sólo lectura", Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }) {
        Row(verticalAlignment = Alignment.Bottom) {
            ValorGrande(e.kw?.let { String.format(es, "%.1f", it) } ?: "–")
            Text(" kW", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.weight(1f))
            Text(
                "UPS ${e.ups?.let { "$it %" } ?: "–"} · ${if (e.red) "red OK" else "SIN RED"}",
                fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall,
                color = if (e.red) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun TarjetaDispositivo(
    titulo: String,
    subtitulo: String?,
    c: Controles,
    disp: String,
    accion: (@Composable () -> Unit)? = null,
    contenido: @Composable ColumnScope.() -> Unit,
) {
    val enviando = c.enviando(disp)
    val bloqueo = c.bloqueo(disp)
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(titulo, style = MaterialTheme.typography.titleMedium)
                    val sub = if (enviando) "enviando…" else subtitulo
                    if (sub != null) {
                        Text(
                            sub, style = MaterialTheme.typography.bodySmall,
                            color = if (enviando) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                AnimatedVisibility(bloqueo > 0, enter = fadeIn(), exit = fadeOut()) { PastillaBloqueo(bloqueo) }
                if (accion != null) {
                    Spacer(Modifier.width(8.dp))
                    accion()
                }
            }
            contenido()
        }
    }
}

@Composable
private fun PastillaBloqueo(segundos: Long) {
    Surface(shape = RoundedCornerShape(50), color = Ambar.copy(alpha = 0.18f)) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 4.dp).semantics(mergeDescendants = true) {
                contentDescription = "Bloqueado, faltan $segundos segundos"
            },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Lock, contentDescription = null, tint = Ambar, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(4.dp))
            Text(Salas.duracion(segundos), color = Ambar, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
        }
    }
}

@Composable
private fun ValorGrande(texto: String, alarma: Boolean = false) {
    AnimatedContent(
        targetState = texto,
        transitionSpec = {
            (slideInVertically(tween(260)) { it / 3 } + fadeIn(tween(260))) togetherWith
                (slideOutVertically(tween(200)) { -it / 3 } + fadeOut(tween(200)))
        },
        label = "valor",
    ) { t ->
        Text(
            t, fontFamily = FontFamily.Monospace, fontSize = 34.sp, fontWeight = FontWeight.SemiBold,
            color = if (alarma) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun Paso(
    valor: String,
    etiqueta: String,
    habilitado: Boolean,
    que: String,
    bajar: () -> Unit,
    subir: () -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedIconButton(onClick = bajar, enabled = habilitado) {
            Text("−", fontSize = 20.sp, modifier = Modifier.semantics { contentDescription = "Bajar $que" })
        }
        Column(Modifier.width(76.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            AnimatedContent(targetState = valor, label = "consigna") { v ->
                Text(v, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.titleMedium)
            }
            Text(etiqueta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        OutlinedIconButton(onClick = subir, enabled = habilitado) {
            Text("+", fontSize = 20.sp, modifier = Modifier.semantics { contentDescription = "Subir $que" })
        }
    }
}

@Composable
private fun Opcion(texto: String, elegida: Boolean, habilitado: Boolean, modifier: Modifier, alTocar: () -> Unit) {
    val mod = modifier.semantics { stateDescription = if (elegida) "elegido" else "no elegido" }
    if (elegida) {
        FilledTonalButton(onClick = alTocar, enabled = habilitado, modifier = mod) { Text(texto, maxLines = 1) }
    } else {
        OutlinedButton(onClick = alTocar, enabled = habilitado, modifier = mod) { Text(texto, maxLines = 1) }
    }
}

@Composable
fun AvisoBreve(m: Mensaje) {
    val color = when (m.tipo) {
        Mensaje.Tipo.OK -> verdeEstado()
        Mensaje.Tipo.ESPERA -> Ambar
        Mensaje.Tipo.ERROR -> MaterialTheme.colorScheme.error
    }
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        shadowElevation = 6.dp,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp).fillMaxWidth()
            .border(1.dp, color.copy(alpha = 0.6f), RoundedCornerShape(14.dp)),
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Punto(color)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(m.titulo, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                m.detalle?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
