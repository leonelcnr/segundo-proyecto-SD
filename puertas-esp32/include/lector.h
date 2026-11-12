#pragma once
#include <Arduino.h>
#include <SPI.h>
#include "pines.h"

#if defined(LECTOR_RC522)
#include <MFRC522.h>
MFRC522 rc522(PIN_RFID_SS, PIN_RFID_RST);
#elif defined(LECTOR_PN532)
#include <Adafruit_PN532.h>
Adafruit_PN532 pn532(PIN_RFID_SS, &SPI);
// [7] cantidad · [11] SAK · [12] largo del UID · [13…] UID
extern byte pn532_packetbuffer[];
#else
#error "Falta -D LECTOR_RC522 o -D LECTOR_PN532 en platformio.ini"
#endif

bool lectorListo = false;

String enHexa(const byte *datos, byte largo) {
  String texto;
  for (byte i = 0; i < largo; i++) {
    if (datos[i] < 0x10) texto += "0";
    texto += String(datos[i], HEX);
  }
  texto.toUpperCase();
  return texto;
}

bool esUidAleatorio(const byte *uid, byte largo) {
  return largo == 4 && uid[0] == 0x08;
}

String iniciarLector() {
  SPI.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI, PIN_RFID_SS);
#if defined(LECTOR_RC522)
  rc522.PCD_Init();
  rc522.PCD_SetAntennaGain(rc522.RxGain_max);
  byte version = rc522.PCD_ReadRegister(MFRC522::VersionReg);
  lectorListo = version != 0x00 && version != 0xFF;
  return lectorListo ? "RC522 0x" + String(version, HEX) : "";
#else
  pn532.begin();
  uint32_t version = pn532.getFirmwareVersion();
  lectorListo = version != 0;
  if (!lectorListo) return "";
  pn532.setPassiveActivationRetries(0x01);
  return "PN5" + String((version >> 24) & 0xFF, HEX) + " v" + String((version >> 16) & 0xFF) + "." +
         String((version >> 8) & 0xFF);
#endif
}

#if defined(LECTOR_PN532)
// AID F0 + "PUERTA": tiene que coincidir con apduservice.xml de la app
const byte SELECT_APP[] = {0x00, 0xA4, 0x04, 0x00, 0x07, 0xF0, 'P', 'U', 'E', 'R', 'T', 'A', 0x00};

bool pedirCodigoApp(String &codigo) {
  byte respuesta[40];
  byte largo = sizeof(respuesta);
  if (!pn532.inDataExchange((uint8_t *)SELECT_APP, sizeof(SELECT_APP), respuesta, &largo)) return false;
  if (largo < 10 || largo > 34 || respuesta[largo - 2] != 0x90 || respuesta[largo - 1] != 0x00) return false;
  codigo = "";
  for (byte i = 0; i < largo - 2; i++) {
    if (!isAlphaNumeric(respuesta[i]) && respuesta[i] != '-') return false;
    codigo += (char)respuesta[i];
  }
  return true;
}
#endif

bool leerCredencial(String &credencial, String &tipo) {
  if (!lectorListo) return false;
#if defined(LECTOR_RC522)
  if (!rc522.PICC_IsNewCardPresent() || !rc522.PICC_ReadCardSerial()) return false;
  bool aleatorio = esUidAleatorio(rc522.uid.uidByte, rc522.uid.size);
  credencial = aleatorio ? "" : enHexa(rc522.uid.uidByte, rc522.uid.size);
  tipo = aleatorio ? String("UID aleatorio (celular?)") : String(rc522.PICC_GetTypeName(rc522.PICC_GetType(rc522.uid.sak)));
  rc522.PICC_HaltA();
  return true;
#else
  static unsigned long ultimaConsulta = 0;
  if (millis() - ultimaConsulta < 150) return false;
  ultimaConsulta = millis();
  if (!pn532.inListPassiveTarget()) return false;

  byte sak = pn532_packetbuffer[11];
  byte largo = min(pn532_packetbuffer[12], (byte)10);
  bool aleatorio = esUidAleatorio(&pn532_packetbuffer[13], largo);
  String uid = enHexa(&pn532_packetbuffer[13], largo);

  String codigo;
  if ((sak & 0x20) && pedirCodigoApp(codigo)) {
    credencial = "CEL-" + codigo;
    tipo = "celular con la app";
  } else if (aleatorio) {
    credencial = "";
    tipo = "UID aleatorio (celular sin la app?)";
  } else {
    credencial = uid;
    tipo = (sak & 0x20) ? "ISO 14443-4" : (sak == 0x00 ? "MIFARE Ultralight/NTAG" : "MIFARE Classic");
  }

  static String anterior;
  static unsigned long vistaPorUltimaVez = 0;
  String clave = credencial.length() ? credencial : uid;
  bool sigueApoyada = clave == anterior && millis() - vistaPorUltimaVez < 1500;
  anterior = clave;
  vistaPorUltimaVez = millis();
  return !sigueApoyada;
#endif
}
