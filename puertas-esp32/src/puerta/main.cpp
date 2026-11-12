#include <Arduino.h>
#include <MQTT.h>
#include <ArduinoJson.h>
#include "pines.h"
#include "salidas.h"
#include "lector.h"
#include "red.h"
#ifdef CON_LCD
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#endif

const String BASE         = String("acceso/") + SITIO + "/puerta/" + PUERTA_ID;
const String T_LECTURA    = BASE + "/lectura";
const String T_ORDEN      = BASE + "/orden";
const String T_PRESENCIA  = BASE + "/presencia";
const String T_TELEMETRIA = BASE + "/telemetria";
const String T_ALARMA     = String("acceso/") + SITIO + "/alarma";
const String T_SERVICIO   = "servicio/presencia";

#ifndef ESPERA_SERVICIO_MS
#define ESPERA_SERVICIO_MS 5000
#endif
const unsigned long ESPERA_SERVICIO = ESPERA_SERVICIO_MS;
const unsigned long ESPERA_ADMIN    = 40000;   // el servicio vence la solicitud a los 30 s
const unsigned long TIEMPO_ABIERTA  = 5000;
const unsigned long TIEMPO_DENEGADA = 2000;
const unsigned long SIRENA          = 10000;
const unsigned long CADA_TELEMETRIA = 30000;

ClienteRed red;
MQTTClient mqtt(512);
#ifdef CON_LCD
LiquidCrystal_I2C lcd(LCD_DIRECCION, 16, 2);
#endif

enum Estado { REPOSO, ESPERANDO, ABIERTA, DENEGADA };
Estado estado = REPOSO;
unsigned long estadoDesde = 0;
unsigned long esperaMax = 0;
String reqPendiente;
String mensaje;
bool servicioOnline = false;
bool alarmaActiva = false;
unsigned long alarmaDesde = 0;
unsigned long ultimoIntento = 0;
unsigned long ultimaTelemetria = 0;
unsigned long ultimoIntentoLector = 0;

void cambiarEstado(Estado nuevo) {
  estado = nuevo;
  estadoDesde = millis();
}

void mostrar(const String &linea1, const String &linea2 = "") {
  static String antes1, antes2;
  if (linea1 == antes1 && linea2 == antes2) return;
  antes1 = linea1;
  antes2 = linea2;
  Serial.printf("[pantalla] %s | %s\n", linea1.c_str(), linea2.c_str());
#ifdef CON_LCD
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(linea1.substring(0, 16));
  lcd.setCursor(0, 1);
  lcd.print(linea2.substring(0, 16));
#endif
}

void alRecibir(String &topic, String &payload) {
  Serial.printf("[mqtt] %s -> %s\n", topic.c_str(), payload.c_str());
  if (topic == T_SERVICIO) {
    servicioOnline = (payload == "online");
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, payload)) return;
  if (topic == T_ALARMA) {
    bool activa = doc["activa"] | false;
    if (activa && !alarmaActiva) alarmaDesde = millis();
    alarmaActiva = activa;
  } else if (topic == T_ORDEN) {
    // Sólo vale la orden de la lectura en curso: las repetidas (QoS 1) o tardías se descartan
    if (estado != ESPERANDO || reqPendiente != (doc["req_id"] | "")) return;
    String accion = doc["accion"] | "";
    mensaje = doc["mensaje"] | "";
    if (accion == "esperar") {
      esperaMax = ESPERA_ADMIN;
    } else if (accion == "abrir") {
      cambiarEstado(ABIERTA);
    } else {
      cambiarEstado(DENEGADA);
    }
  }
}

void mantenerWiFi() {
  static unsigned long desde = 0;
  static bool conectado = false;
  if (WiFi.status() == WL_CONNECTED) {
    if (!conectado) Serial.printf("[wifi] conectado a %s, IP %s\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
    conectado = true;
    return;
  }
  if (conectado) Serial.println("[wifi] se perdio la conexion");
  conectado = false;
  if (desde != 0 && millis() - desde < 15000) return;
  if (desde != 0) Serial.println("[wifi] no conecta: revisar nombre y clave, y que la red sea de 2,4 GHz (prueba 6)");
  Serial.printf("[wifi] conectando a %s...\n", empezarWiFi());
  desde = millis();
}

bool conectarMQTT() {
  mostrar("Conectando", "al broker...");
  IPAddress ip;
  if (!resolverBroker(ip)) {
    Serial.printf("[mqtt] no encuentro %s: relay apagado o en otra red (prueba 7)\n", BROKER_HOST);
    return false;
  }
  String error = abrirConexion(red, ip);
  if (error.length()) {
    Serial.printf("[mqtt] %s\n", error.c_str());
    return false;
  }
  mqtt.setWill(T_PRESENCIA.c_str(), "offline", true, 1);
  if (!mqtt.connect(PUERTA_ID, PUERTA_ID, MQTT_CLAVE, true)) {
    Serial.printf("[mqtt] rechazado: %s (error %d, codigo %d)\n", motivoRechazo(mqtt.returnCode()),
                  (int)mqtt.lastError(), (int)mqtt.returnCode());
    return false;
  }
  Serial.printf("[mqtt] conectado a %s (%s)\n", BROKER_HOST, ip.toString().c_str());
  mqtt.subscribe(T_ORDEN, 1);
  mqtt.subscribe(T_ALARMA, 1);
  mqtt.subscribe(T_SERVICIO, 1);
  mqtt.publish(T_PRESENCIA, "online", true, 1);
  return true;
}

void leerTarjeta() {
  if (!lectorListo && millis() - ultimoIntentoLector > 10000) {
    ultimoIntentoLector = millis();
    if (iniciarLector().length()) Serial.println("[lector] volvio a responder");
  }
  String credencial, tipo;
  if (!leerCredencial(credencial, tipo)) return;
  Serial.printf("[lector] %s (%s)\n", credencial.length() ? credencial.c_str() : "?", tipo.c_str());
  if (estado != REPOSO) return;
  if (credencial.isEmpty()) {
    mensaje = "Use tarjeta o app";
    cambiarEstado(DENEGADA);
    return;
  }
  if (!mqtt.connected() || !servicioOnline) {
    mensaje = "Sin servicio";
    cambiarEstado(DENEGADA);
    return;
  }
  reqPendiente = String(PUERTA_ID) + "-" + String(esp_random(), HEX);
  JsonDocument doc;
  doc["req_id"] = reqPendiente;
  doc["uid"] = credencial;
  String json;
  serializeJson(doc, json);
  mqtt.publish(T_LECTURA, json, false, 1);
  mensaje = "";
  esperaMax = ESPERA_SERVICIO;
  cambiarEstado(ESPERANDO);
}

void actualizarSalidas() {
  unsigned long ahora = millis();
  if (estado == ESPERANDO && ahora - estadoDesde > esperaMax) {
    mensaje = "Sin respuesta";
    cambiarEstado(DENEGADA);
  }
  if (estado == ABIERTA && ahora - estadoDesde > TIEMPO_ABIERTA) cambiarEstado(REPOSO);
  if (estado == DENEGADA && ahora - estadoDesde > TIEMPO_DENEGADA) cambiarEstado(REPOSO);

  unsigned long enEstado = ahora - estadoDesde;
  bool parpadeo = (ahora / 250) % 2;
  bool sirena = alarmaActiva && ahora - alarmaDesde < SIRENA && parpadeo;

  switch (estado) {
    case ESPERANDO:
      leds(false, true, false);
      buzzer(sirena);
      mostrar(mensaje.length() ? mensaje : "Consultando...", esperaMax == ESPERA_ADMIN ? "Espere al admin" : "");
      return;
    case ABIERTA:
      leds(true, false, false);
      buzzer(enEstado < 150);
      mostrar("Acceso permitido", mensaje);
      return;
    case DENEGADA:
      leds(false, false, true);
      buzzer(enEstado < 600);
      mostrar("Acceso denegado", mensaje);
      return;
    case REPOSO:
      break;
  }
  if (!mqtt.connected()) {
    leds(false, false, parpadeo);
    buzzer(false);
    mostrar("Sin conexion", WiFi.status() == WL_CONNECTED ? "Buscando broker" : "Buscando WiFi");
  } else if (!servicioOnline) {
    leds(false, parpadeo, false);
    buzzer(false);
    mostrar("Fuera de", "servicio");
  } else if (alarmaActiva) {
    leds(false, false, parpadeo);
    buzzer(sirena);
    mostrar("!! ALARMA !!", "Aviso enviado");
  } else if (!lectorListo) {
    leds(false, false, true);
    buzzer(false);
    mostrar("Falla del lector", "Avise a soporte");
  } else {
    leds(false, false, false);
    buzzer(false);
    mostrar("Acerque su", "tarjeta");
  }
}

void publicarTelemetria() {
  JsonDocument doc;
  doc["rssi"] = WiFi.RSSI();
  doc["uptime_s"] = millis() / 1000;
  doc["heap_libre"] = ESP.getFreeHeap();
  doc["lector_ok"] = lectorListo;
  String json;
  serializeJson(doc, json);
  mqtt.publish(T_TELEMETRIA, json, false, 0);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("\n=== Puerta %s (sitio %s) ===\n", PUERTA_ID, SITIO);
  Serial.printf("Broker %s:%d %s · espera al servicio %lu ms\n", BROKER_HOST, BROKER_PUERTO,
                USAR_TLS ? "con TLS" : "SIN TLS", ESPERA_SERVICIO);
  iniciarSalidas();
#ifdef CON_LCD
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  lcd.init();
  lcd.backlight();
#endif
  String version = iniciarLector();
  if (version.length()) Serial.printf("[lector] %s OK\n", version.c_str());
  else Serial.println("[lector] NO responde: correr la prueba 3 del programa de prueba");
  mqtt.begin(red);
  mqtt.setOptions(10, true, 2000);             // keepalive 10 s, sesión limpia
  mqtt.onMessage(alRecibir);
}

void loop() {
  mantenerWiFi();
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected() && millis() - ultimoIntento > 3000) {
    servicioOnline = false;
    conectarMQTT();
    ultimoIntento = millis();
  }
  mqtt.loop();
  leerTarjeta();
  actualizarSalidas();
  if (mqtt.connected() && millis() - ultimaTelemetria > CADA_TELEMETRIA) {
    ultimaTelemetria = millis();
    publicarTelemetria();
  }
}
