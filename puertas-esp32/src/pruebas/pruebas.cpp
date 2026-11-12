#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include "pines.h"
#include "salidas.h"
#include "lector.h"
#if __has_include("secretos.h")
#define CON_RED
#include <MQTT.h>
#include "red.h"
#endif
#ifdef CON_LCD
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(LCD_DIRECCION, 16, 2);
#endif

String versionLector;

void menu() {
  Serial.println();
  Serial.printf("===== Prueba de %s · lector %s =====\n", PUERTA_ID,
                versionLector.length() ? versionLector.c_str() : "NO RESPONDE");
  Serial.println("0 - Todo, una prueba detras de la otra, con resumen al final");
  Serial.println("1 - LEDs (verde, amarillo, rojo)");
  Serial.println("2 - Buzzer");
  Serial.println("3 - Lector (muestra cada tarjeta, llavero o celular)");
  Serial.println("4 - Buscar dispositivos I2C (el LCD)");
#ifdef CON_LCD
  Serial.println("5 - Escribir en el LCD");
#endif
#ifdef CON_RED
  Serial.println("6 - Wi-Fi");
  Serial.printf("7 - Broker: %s:%d %s\n", BROKER_HOST, BROKER_PUERTO, USAR_TLS ? "con TLS, por el relay" : "sin TLS");
#else
  Serial.println("(6 y 7, Wi-Fi y broker: aparecen cuando exista include/secretos.h)");
#endif
  Serial.println("8 - Datos de la placa");
  Serial.print("Opcion: ");
}

bool confirmar(const char *pregunta) {
  Serial.printf("%s (s/n): ", pregunta);
  while (true) {
    while (!Serial.available()) delay(10);
    char c = tolower(Serial.read());
    if (c == 's' || c == 'n') {
      Serial.println(c);
      delay(50);
      while (Serial.available()) Serial.read();
      return c == 's';
    }
  }
}

bool datosPlaca() {
  Serial.printf("Chip %s rev %d, %d nucleos a %d MHz\n", ESP.getChipModel(), ESP.getChipRevision(),
                ESP.getChipCores(), ESP.getCpuFreqMHz());
  Serial.printf("Flash %u MB · PSRAM %u MB · RAM libre %u KB · MAC %s\n", ESP.getFlashChipSize() >> 20,
                ESP.getPsramSize() >> 20, ESP.getFreeHeap() >> 10, WiFi.macAddress().c_str());
#if defined(PLACA_S3)
  if (ESP.getFlashChipSize() < (16u << 20) || ESP.getPsramSize() == 0) {
    Serial.println("La N16R8 tiene que mostrar flash 16 MB y PSRAM 8 MB: revisar la seccion [s3] de platformio.ini.");
    return false;
  }
#endif
  return true;
}

bool probarLeds() {
  const int pines[] = {PIN_LED_VERDE, PIN_LED_AMARILLO, PIN_LED_ROJO};
  const char *nombres[] = {"verde", "amarillo", "rojo"};
  for (int i = 0; i < 3; i++) {
    Serial.printf("LED %s (GPIO %d): 1 segundo\n", nombres[i], pines[i]);
    digitalWrite(pines[i], HIGH);
    delay(1000);
    digitalWrite(pines[i], LOW);
  }
  if (confirmar("Prendieron los tres, en ese orden?")) return true;
  Serial.println("El que no prendio: LED al reves (pata larga hacia la resistencia y el GPIO), cable en otra fila");
  Serial.println("o la pata corta sin llegar al riel GND. Si prendieron en otro orden, estan cruzados.");
  return false;
}

bool probarBuzzer() {
  Serial.printf("Buzzer (GPIO %d): 3 pitidos\n", PIN_BUZZER);
  for (int i = 0; i < 3; i++) {
    buzzer(true);
    delay(200);
    buzzer(false);
    delay(200);
  }
  if (confirmar("Se escucharon 3 pitidos?")) return true;
  Serial.println("Si suena todo el tiempo y se calla en los pitidos: BUZZER_ACTIVO_EN_BAJO 1 en pines.h");
  Serial.println("Si apenas hace 'clic': es pasivo, BUZZER_PASIVO 1 en pines.h. Si no hace nada: + al GPIO y - a GND.");
  return false;
}

bool pidioSalir(unsigned long desde) {
  if (!Serial.available()) return false;
  Serial.read();
  return millis() - desde > 1000;
}

int probarLector(unsigned long limite) {
  if (!lectorListo) versionLector = iniciarLector();
  if (!lectorListo) {
#if defined(LECTOR_RC522)
    Serial.println("El RC522 NO responde: revisar los 7 cables, que este en 3V3 (no 5V) y la soldadura.");
#else
    Serial.println("El PN532 NO responde: revisar que las llaves esten en modo SPI (1 OFF, 2 ON),");
    Serial.println("los 6 cables (SCK, MISO, MOSI, SS, VCC, GND) y que VCC vaya a 3V3.");
#endif
    return -1;
  }
  Serial.printf("Lector %s OK. ", versionLector.c_str());
  if (limite) Serial.printf("Acerquen una tarjeta (%lu s)...\n", limite / 1000);
  else Serial.println("Acerquen tarjetas, llaveros o el celular; Enter para volver al menu.");
  int leidas = 0;
  unsigned long inicio = millis();
  while (limite ? millis() - inicio < limite && leidas == 0 : !pidioSalir(inicio)) {
    String credencial, tipo;
    if (leerCredencial(credencial, tipo)) {
      leidas++;
      Serial.printf("  %-24s %s\n", credencial.length() ? credencial.c_str() : "(no identificable)", tipo.c_str());
      leds(credencial.length(), false, !credencial.length());
      buzzer(true);
      delay(100);
      buzzer(false);
      delay(200);
      leds(false, false, false);
    }
    delay(20);
  }
  if (leidas) Serial.println("Anoten los UID: son los que se cargan en la base del servicio.");
  return leidas;
}

int buscarI2C() {
  Serial.printf("Buscando en SDA=GPIO %d, SCL=GPIO %d...\n", PIN_I2C_SDA, PIN_I2C_SCL);
  int encontrados = 0;
  for (byte dir = 1; dir < 127; dir++) {
    Wire.beginTransmission(dir);
    if (Wire.endTransmission() != 0) continue;
    encontrados++;
    const char *que = "";
    if (dir >= 0x20 && dir <= 0x27) que = " (adaptador I2C de LCD, PCF8574)";
    if (dir >= 0x38 && dir <= 0x3F) que = " (adaptador I2C de LCD, PCF8574A)";
    if (dir == 0x3C || dir == 0x3D) que = " (parece una pantalla OLED, no un LCD 16x2: avisar)";
    Serial.printf("  Hay un dispositivo en 0x%02X%s\n", dir, que);
  }
  if (encontrados == 0) Serial.println("  Nada: revisar SDA y SCL (no cruzarlos) y que el LCD tenga 5V y GND.");
  else Serial.printf("El firmware busca el LCD en 0x%02X: si esta en otra, cambiar LCD_DIRECCION en pines.h\n", LCD_DIRECCION);
  return encontrados;
}

#ifdef CON_LCD
bool probarLcd() {
  lcd.init();
  Serial.println("La luz de fondo se apaga y se prende 3 veces...");
  for (int i = 0; i < 3; i++) {
    lcd.noBacklight();
    delay(400);
    lcd.backlight();
    delay(400);
  }
  if (!confirmar("Parpadeo la luz de fondo?")) {
    Serial.println("Si no prende nunca: VCC tiene que ir al pin 5V y el puente 'LED' del adaptador tiene que estar puesto.");
    Serial.println("Si queda siempre prendida: el adaptador no esta bien soldado a los 16 pines del LCD.");
    return false;
  }
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Hola, grupo!");
  lcd.setCursor(0, 1);
  for (int i = 0; i < 16; i++) lcd.write(0xFF);
  Serial.println("Arriba tiene que decir 'Hola, grupo!' y abajo, 16 bloques llenos.");
  Serial.println("Si no se ve, giren DESPACIO el potenciometro azul de atras, de punta a punta, mirando el LCD.");
  if (confirmar("Se lee 'Hola, grupo!'?")) return true;
  Serial.println("Bloques solo en la fila de ARRIBA: el LCD no arranca; revisar la soldadura del adaptador al LCD.");
  Serial.println("Nada en ninguna posicion del potenciometro: VCC esta en 3,3 V. Tiene que ir al pin 5V.");
  return false;
}
#endif

#ifdef CON_RED
bool esRedNuestra(const String &ssid) {
#ifdef WIFI_SSID_2
  if (ssid == WIFI_SSID_2) return true;
#endif
  return ssid == WIFI_SSID;
}

bool probarWiFi() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Redes que ve la placa (sólo ve las de 2,4 GHz):");
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    int cantidad = WiFi.scanNetworks();
    bool vista = false;
    for (int i = 0; i < cantidad; i++) {
      bool nuestra = esRedNuestra(WiFi.SSID(i));
      vista |= nuestra;
      Serial.printf("  %s %-32s %4d dBm  canal %d\n", nuestra ? ">>" : "  ", WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.channel(i));
    }
    WiFi.scanDelete();
    if (!vista) {
      Serial.printf("No aparece %s: es de 5 GHz, esta apagada o el nombre de secretos.h no coincide (mayusculas, espacios).\n", WIFI_SSID);
      Serial.println("En el hotspot del celular: activar 'banda 2,4 GHz' o 'maximizar compatibilidad' (iPhone).");
    }
#ifdef WIFI_SSID_2
    const int redes = 2;
#else
    const int redes = 1;
#endif
    for (int i = 0; i < redes && WiFi.status() != WL_CONNECTED; i++) {
      Serial.printf("Conectando a %s", empezarWiFi());
      unsigned long inicio = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) {
        delay(500);
        Serial.print(".");
      }
      Serial.println();
    }
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("No conecta. Si la red aparece en la lista: clave incorrecta, o es una red con portal");
      Serial.println("(la de la facultad, eduroam). Usen el hotspot de un celular.");
      return false;
    }
  }
  Serial.printf("Conectado a %s · IP %s · router %s · senal %d dBm\n", WiFi.SSID().c_str(),
                WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(), WiFi.RSSI());
  if (WiFi.RSSI() < -80) Serial.println("La senal es muy debil (menos de -80 dBm): acerquen la placa al router o al celular.");
  return true;
}

String presenciaServicio;

void alRecibir(String &topic, String &payload) {
  presenciaServicio = payload;
}

bool probarBroker() {
  if (WiFi.status() != WL_CONNECTED && !probarWiFi()) return false;
  Serial.printf("Broker %s:%d, %s\n", BROKER_HOST, BROKER_PUERTO, USAR_TLS ? "con TLS" : "sin TLS");
  IPAddress ip;
  if (!resolverBroker(ip)) {
    Serial.printf("  1. Buscar %s: NO lo encuentro. La Raspberry esta apagada o en otra red;\n", BROKER_HOST);
    Serial.println("     si el mDNS no anda en esta red, pongan la IP de la Raspberry en BROKER_HOST.");
    return false;
  }
  Serial.printf("  1. %s es %s\n", BROKER_HOST, ip.toString().c_str());

  ClienteRed red;
  unsigned long inicio = millis();
  String error = abrirConexion(red, ip);
  if (error.length()) {
    Serial.printf("  2. Conexion: FALLA, %s\n", error.c_str());
    return false;
  }
  Serial.printf("  2. Conexion %s: OK (%lu ms)\n", USAR_TLS ? "TCP + TLS, certificado verificado" : "TCP", millis() - inicio);

  MQTTClient mqtt(512);
  mqtt.begin(red);
  mqtt.setOptions(10, true, 3000);
  mqtt.onMessage(alRecibir);
  if (!mqtt.connect(PUERTA_ID, PUERTA_ID, MQTT_CLAVE, true)) {
    Serial.printf("  3. Login MQTT como %s: RECHAZADO, %s (error %d, codigo %d)\n", PUERTA_ID,
                  motivoRechazo(mqtt.returnCode()), (int)mqtt.lastError(), (int)mqtt.returnCode());
    return false;
  }
  Serial.printf("  3. Login MQTT como %s: OK\n", PUERTA_ID);
  presenciaServicio = "";
  mqtt.subscribe("servicio/presencia", 1);
  inicio = millis();
  while (millis() - inicio < 2000 && presenciaServicio.isEmpty()) {
    mqtt.loop();
    delay(10);
  }
  Serial.printf("  4. Servicio central: %s\n", presenciaServicio.length() ? presenciaServicio.c_str()
                                                                           : "sin dato (nadie publico servicio/presencia todavia)");
  mqtt.disconnect();
  return true;
}
#endif

void probarTodo() {
  String resumen;
  auto anotar = [&](const char *que, bool ok, const String &detalle) {
    resumen += String(ok ? "  OK     " : "  FALLA  ") + que + (detalle.length() ? " · " + detalle : "") + "\n";
  };
  Serial.println("\n--- Placa");
  anotar("Placa", datosPlaca(), ESP.getChipModel());
  Serial.println("\n--- LEDs");
  anotar("LEDs", probarLeds(), "");
  Serial.println("\n--- Buzzer");
  anotar("Buzzer", probarBuzzer(), "");
  Serial.println("\n--- Lector");
  int leidas = probarLector(15000);
  anotar("Lector", leidas > 0, leidas < 0 ? "no responde" : (leidas == 0 ? "responde, pero no leyo ninguna tarjeta" : versionLector));
#ifdef CON_LCD
  Serial.println("\n--- I2C y LCD");
  int i2c = buscarI2C();
  anotar("LCD", i2c > 0 && probarLcd(), i2c ? "" : "no aparece en el bus I2C");
#endif
#ifdef CON_RED
  Serial.println("\n--- Wi-Fi");
  bool wifi = probarWiFi();
  anotar("Wi-Fi", wifi, wifi ? WiFi.SSID() + ", " + String(WiFi.RSSI()) + " dBm" : "");
  Serial.println("\n--- Broker");
  anotar("Broker", wifi && probarBroker(), String(BROKER_HOST) + (USAR_TLS ? " (TLS)" : " (sin TLS)"));
#endif
  Serial.println("\n===== Resumen =====");
  Serial.print(resumen);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  iniciarSalidas();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
#ifdef CON_LCD
  lcd.init();
  lcd.backlight();
  lcd.print("Modo prueba");
  lcd.setCursor(0, 1);
  lcd.print(PUERTA_ID);
#endif
  versionLector = iniciarLector();
  menu();
}

void loop() {
  if (!Serial.available()) return;
  char opcion = Serial.read();
  if (opcion == '\n' || opcion == '\r') return;
  Serial.println(opcion);
  delay(50);
  while (Serial.available()) Serial.read();
  switch (opcion) {
    case '0': probarTodo(); break;
    case '1': probarLeds(); break;
    case '2': probarBuzzer(); break;
    case '3': probarLector(0); break;
    case '4': buscarI2C(); break;
#ifdef CON_LCD
    case '5': probarLcd(); break;
#endif
#ifdef CON_RED
    case '6': probarWiFi(); break;
    case '7': probarBroker(); break;
#endif
    case '8': datosPlaca(); break;
    default: Serial.println("Opcion desconocida");
  }
  delay(50);
  while (Serial.available()) Serial.read();
  menu();
}
