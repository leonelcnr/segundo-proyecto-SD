package ar.sd2026.puertas

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

private val Verde = Color(0xFF4ADE80)
private val FormaTarjeta = RoundedCornerShape(22.dp)

@Composable
fun TarjetaAnimada(nombre: String, credencial: String, modifier: Modifier = Modifier) {
    val infinita = rememberInfiniteTransition(label = "tarjeta")
    val flotar by infinita.animateFloat(
        initialValue = -4f, targetValue = 4f,
        animationSpec = infiniteRepeatable(tween(2400, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "flotar",
    )
    val brillo by infinita.animateFloat(
        initialValue = -0.6f, targetValue = 1.8f,
        animationSpec = infiniteRepeatable(tween(3600, easing = LinearEasing)),
        label = "brillo",
    )
    val escala = remember { Animatable(1f) }
    val onda = remember { Animatable(1f) }
    var leida by remember { mutableStateOf(false) }
    var dadaVuelta by remember { mutableStateOf(false) }
    val giro by animateFloatAsState(
        targetValue = if (dadaVuelta) 180f else 0f,
        animationSpec = tween(650, easing = FastOutSlowInEasing),
        label = "giro",
    )

    LaunchedEffect(Unit) {
        Estado.lecturas.collectLatest {
            dadaVuelta = false
            leida = true
            launch {
                escala.animateTo(1.06f, tween(110))
                escala.animateTo(1f, spring(dampingRatio = 0.3f, stiffness = Spring.StiffnessLow))
            }
            launch {
                onda.snapTo(0f)
                onda.animateTo(1f, tween(1100, easing = LinearOutSlowInEasing))
            }
            delay(2600)
            leida = false
        }
    }

    Box(
        modifier
            .fillMaxWidth()
            .aspectRatio(1.586f)
            .graphicsLayer {
                translationY = flotar * density
                scaleX = escala.value
                scaleY = escala.value
                rotationY = giro
                cameraDistance = 14f * density
            }
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                dadaVuelta = !dadaVuelta
            },
    ) {
        if (giro <= 90f) {
            Frente(nombre, credencial, brillo, onda.value, leida)
        } else {
            Box(Modifier.fillMaxSize().graphicsLayer { rotationY = 180f }) { Dorso() }
        }
    }
}

@Composable
private fun Frente(nombre: String, credencial: String, brillo: Float, onda: Float, leida: Boolean) {
    Box(
        Modifier
            .fillMaxSize()
            .clip(FormaTarjeta)
            .background(Brush.linearGradient(listOf(Color(0xFF312E81), Color(0xFF6D28D9), Color(0xFF0E7490))))
            .drawWithContent {
                drawContent()
                val x = size.width * brillo
                drawRect(
                    Brush.linearGradient(
                        listOf(Color.Transparent, Color.White.copy(alpha = 0.16f), Color.Transparent),
                        start = Offset(x - size.width * 0.25f, 0f),
                        end = Offset(x + size.width * 0.25f, size.height),
                    ),
                )
                if (onda < 1f) {
                    val centro = Offset(size.width - 38.dp.toPx(), 38.dp.toPx())
                    for (i in 0..1) {
                        val t = ((onda - i * 0.18f) / (1f - i * 0.18f)).coerceIn(0f, 1f)
                        if (t > 0f && t < 1f) {
                            drawCircle(
                                Verde.copy(alpha = (1f - t) * 0.7f),
                                radius = t * size.width,
                                center = centro,
                                style = Stroke(width = 3.dp.toPx()),
                            )
                        }
                    }
                }
            }
            .border(if (leida) 3.dp else 1.dp, if (leida) Verde else Color.White.copy(alpha = 0.22f), FormaTarjeta)
            .padding(20.dp),
    ) {
        Text(
            "PUERTA NFC", Modifier.align(Alignment.TopStart),
            color = Color.White.copy(alpha = 0.9f), fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 3.sp,
        )
        SinContacto(Modifier.align(Alignment.TopEnd).size(36.dp), if (leida) Verde else Color.White)
        Chip(Modifier.align(Alignment.CenterStart).size(width = 44.dp, height = 33.dp))
        Column(Modifier.align(Alignment.BottomStart).padding(end = if (leida) 70.dp else 0.dp)) {
            Text("UID", color = Color.White.copy(alpha = 0.6f), fontSize = 10.sp, letterSpacing = 2.sp)
            Text(
                credencial,
                color = Color.White,
                fontFamily = FontFamily.Monospace,
                fontSize = when {
                    credencial.length <= 14 -> 21.sp
                    credencial.length <= 22 -> 15.sp
                    else -> 11.sp
                },
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 1.5.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                nombre.uppercase(), color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp, letterSpacing = 1.5.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        if (leida) {
            Text(
                "✓ LEÍDA", Modifier.align(Alignment.BottomEnd),
                color = Verde, fontSize = 13.sp, fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun Dorso() {
    Box(
        Modifier
            .fillMaxSize()
            .clip(FormaTarjeta)
            .background(Brush.linearGradient(listOf(Color(0xFF1E1B4B), Color(0xFF3B0764))))
            .border(1.dp, Color.White.copy(alpha = 0.22f), FormaTarjeta),
    ) {
        Box(Modifier.fillMaxWidth().padding(top = 24.dp).height(40.dp).background(Color(0xFF0B0B12)))
        Column(Modifier.align(Alignment.BottomStart).padding(20.dp)) {
            Text(
                "Apoyá la parte de atrás del teléfono sobre el lector de la puerta, con la pantalla encendida.",
                color = Color.White.copy(alpha = 0.9f), fontSize = 13.sp,
            )
            Spacer(Modifier.height(6.dp))
            Text("Tocá la tarjeta para darla vuelta", color = Color.White.copy(alpha = 0.55f), fontSize = 11.sp)
        }
    }
}

@Composable
private fun SinContacto(modifier: Modifier, color: Color) {
    Canvas(modifier) {
        val centro = Offset(size.width * 0.22f, size.height / 2)
        val grosor = size.width * 0.08f
        drawCircle(color, radius = grosor * 0.8f, center = centro)
        for (i in 1..3) {
            val r = size.width * 0.22f * i
            drawArc(
                color, startAngle = -45f, sweepAngle = 90f, useCenter = false,
                topLeft = Offset(centro.x - r, centro.y - r), size = Size(r * 2, r * 2),
                style = Stroke(width = grosor, cap = StrokeCap.Round),
            )
        }
    }
}

@Composable
private fun Chip(modifier: Modifier) {
    Canvas(modifier) {
        drawRoundRect(
            Brush.linearGradient(listOf(Color(0xFFFDE68A), Color(0xFFD4A017))),
            cornerRadius = CornerRadius(6.dp.toPx()),
        )
        val linea = Color(0xFF8B6914).copy(alpha = 0.6f)
        val grosor = 1.dp.toPx()
        drawLine(linea, Offset(0f, size.height / 3), Offset(size.width, size.height / 3), grosor)
        drawLine(linea, Offset(0f, size.height * 2 / 3), Offset(size.width, size.height * 2 / 3), grosor)
        drawLine(linea, Offset(size.width / 2, 0f), Offset(size.width / 2, size.height), grosor)
    }
}
