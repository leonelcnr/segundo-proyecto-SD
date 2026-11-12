#pragma once
// Copiar como secretos.h (no se sube al repositorio) y completar.

#define WIFI_SSID      "nombre-de-la-red"
#define WIFI_PASS      "clave-de-la-red"
// #define WIFI_SSID_2    "otra-red"
// #define WIFI_PASS_2    "otra-clave"

#define SITIO          "edificio1"

#define CLAVE_PUERTA_SERVIDORES  "clave-de-puerta-servidores"
#define CLAVE_PUERTA_HALL        "clave-de-puerta-hall"

#define USAR_TLS       1
#define BROKER_HOST    "relay-puertas.local"
#define BROKER_PUERTO  8883
#define BROKER_NOMBRE  "broker.puertas"

static const char CA_CERT[] = R"EOF(
-----BEGIN CERTIFICATE-----
...contenido de ca.crt...
-----END CERTIFICATE-----
)EOF";
