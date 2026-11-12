package ar.sd2026.puertas

import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory

object Tls {

    private fun certificados(pem: String): List<X509Certificate> = runCatching {
        CertificateFactory.getInstance("X.509").generateCertificates(pem.byteInputStream())
            .filterIsInstance<X509Certificate>()
    }.getOrDefault(emptyList())

    fun describir(pem: String): String? =
        certificados(pem).firstOrNull()?.subjectX500Principal?.name?.split(",")?.firstOrNull { it.startsWith("CN=") }
            ?: certificados(pem).firstOrNull()?.subjectX500Principal?.name

    fun fabrica(caPem: String): SSLSocketFactory {
        val certs = certificados(caPem)
        require(certs.isNotEmpty()) { "La CA no es un certificado PEM válido" }
        val almacen = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, null)
            certs.forEachIndexed { i, c -> setCertificateEntry("ca$i", c) }
        }
        val confianza = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(almacen) }
        return SSLContext.getInstance("TLS").apply { init(null, confianza.trustManagers, null) }.socketFactory
    }

    // Verifica el nombre del certificado (broker.puertas) aunque se conecte a la IP del relay
    fun verificador(nombre: String): HostnameVerifier = HostnameVerifier { host, sesion ->
        HttpsURLConnection.getDefaultHostnameVerifier().verify(nombre.ifBlank { host }, sesion)
    }
}
