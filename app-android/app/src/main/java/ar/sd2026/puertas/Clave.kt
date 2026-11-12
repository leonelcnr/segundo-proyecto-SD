package ar.sd2026.puertas

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object Clave {
    private const val ALIAS = "clave-mqtt"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORMACION = "AES/GCM/NoPadding"

    private fun llave(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply {
            init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
        }.generateKey()
    }

    fun cifrar(texto: String): String {
        val c = Cipher.getInstance(TRANSFORMACION).apply { init(Cipher.ENCRYPT_MODE, llave()) }
        val cifrado = c.doFinal(texto.toByteArray(Charsets.UTF_8))
        return b64(c.iv) + ":" + b64(cifrado)
    }

    fun descifrar(guardado: String): String? = runCatching {
        val (iv, cifrado) = guardado.split(":", limit = 2).map { Base64.decode(it, Base64.NO_WRAP) }
        val c = Cipher.getInstance(TRANSFORMACION).apply {
            init(Cipher.DECRYPT_MODE, llave(), GCMParameterSpec(128, iv))
        }
        String(c.doFinal(cifrado), Charsets.UTF_8)
    }.getOrNull()

    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
}
