package ar.sd2026.puertas

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

object Estado {
    val lecturas = MutableSharedFlow<Long>(extraBufferCapacity = 4)

    val conexion = MutableStateFlow<Conexion>(Conexion.Apagada)
}

sealed class Conexion(val texto: String) {
    data object Apagada : Conexion("Conexión apagada")
    data class Conectando(val destino: String) : Conexion("Conectando a $destino…")
    data class Conectada(val destino: String) : Conexion("Conectado a $destino")
    data class Error(val motivo: String) : Conexion(motivo)
}
