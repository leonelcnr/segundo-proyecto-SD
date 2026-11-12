#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ESPmDNS.h>
#include "secretos.h"

#ifndef PUERTA_ID
#error "Falta -D PUERTA_ID en platformio.ini"
#endif

#if USAR_TLS
using ClienteRed = WiFiClientSecure;
#else
using ClienteRed = WiFiClient;
#endif

inline const char *empezarWiFi() {
  static int intento = 0;
  const char *ssid = WIFI_SSID;
  const char *clave = WIFI_PASS;
#ifdef WIFI_SSID_2
  if (intento % 2) {
    ssid = WIFI_SSID_2;
    clave = WIFI_PASS_2;
  }
#endif
  intento++;
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(PUERTA_ID);
  WiFi.disconnect();
  WiFi.begin(ssid, clave);
  return ssid;
}

inline bool resolverBroker(IPAddress &ip) {
  if (ip.fromString(BROKER_HOST)) return true;
  String nombre = BROKER_HOST;
  if (!nombre.endsWith(".local")) return WiFi.hostByName(BROKER_HOST, ip) == 1;
  static bool mdnsIniciado = false;
  static IPAddress ultimaConocida;
  if (!mdnsIniciado) mdnsIniciado = MDNS.begin(PUERTA_ID);
  nombre.remove(nombre.length() - 6);
  ip = MDNS.queryHost(nombre, 2000);
  if ((uint32_t)ip != 0) {
    ultimaConocida = ip;
    return true;
  }
  ip = ultimaConocida;
  return (uint32_t)ip != 0;
}

inline String abrirConexion(ClienteRed &red, const IPAddress &ip) {
  red.stop();
#if USAR_TLS
  red.setTimeout(5);
  red.setHandshakeTimeout(10);
  if (red.connect(ip, BROKER_PUERTO, BROKER_NOMBRE, CA_CERT, nullptr, nullptr)) return "";
  char detalle[80];
  int codigo = red.lastError(detalle, sizeof(detalle));
  if (codigo == -1) return "nadie contesta en " + ip.toString() + ":" + String(BROKER_PUERTO) + " (relay apagado o IP/puerto mal)";
  if (codigo == -0x2700) return "el certificado del broker no es de nuestra CA o no tiene el nombre " BROKER_NOMBRE;
  if (codigo == -0x7280 || codigo == -0x50) return "el relay atendio pero corto: no llega al broker (Tailscale o broker caidos)";
  return "TLS -0x" + String(-codigo, HEX) + ": " + detalle;
#else
  if (red.connect(ip, BROKER_PUERTO)) return "";
  return "nadie contesta en " + ip.toString() + ":" + String(BROKER_PUERTO) + " (broker apagado o IP/puerto mal)";
#endif
}

inline const char *motivoRechazo(int codigo) {
  switch (codigo) {
    case 2: return "client ID rechazado";
    case 3: return "broker no disponible";
    case 4: return "usuario o clave incorrectos";
    case 5: return "no autorizado (usuario, clave o client ID distinto del usuario)";
    default: return "sin respuesta del broker (TLS o red)";
  }
}
