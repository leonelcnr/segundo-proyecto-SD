package ar.sd2026.puertas

import android.nfc.cardemulation.HostApduService
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

class TarjetaHce : HostApduService() {

    override fun processCommandApdu(apdu: ByteArray, extras: Bundle?): ByteArray {
        if (!esNuestroSelect(apdu)) return NO_ENCONTRADO
        val ahora = System.currentTimeMillis()
        val anterior = Credencial.ultimoUso(this)
        Credencial.registrarUso(this, ahora)
        if (ahora - anterior > 2_000) {
            Estado.lecturas.tryEmit(ahora)
            vibrar()
        }
        return Credencial.codigo(this).toByteArray(Charsets.US_ASCII) + OK
    }

    override fun onDeactivated(reason: Int) {}

    private fun esNuestroSelect(apdu: ByteArray): Boolean {
        if (apdu.size < 5 + AID.size) return false
        val cabecera = apdu[0] == 0x00.toByte() && apdu[1] == 0xA4.toByte() && apdu[2] == 0x04.toByte()
        val largo = apdu[4].toInt() == AID.size
        return cabecera && largo && apdu.copyOfRange(5, 5 + AID.size).contentEquals(AID)
    }

    private fun vibrar() {
        val vibrador = if (Build.VERSION.SDK_INT >= 31) {
            getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Vibrator::class.java)
        }
        vibrador?.vibrate(VibrationEffect.createOneShot(70, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    companion object {
        // F0 + "PUERTA": el mismo AID que pide la puerta Hall (apduservice.xml)
        val AID = byteArrayOf(0xF0.toByte(), 'P'.code.toByte(), 'U'.code.toByte(), 'E'.code.toByte(),
            'R'.code.toByte(), 'T'.code.toByte(), 'A'.code.toByte())
        private val OK = byteArrayOf(0x90.toByte(), 0x00)
        private val NO_ENCONTRADO = byteArrayOf(0x6A, 0x82.toByte())
    }
}
