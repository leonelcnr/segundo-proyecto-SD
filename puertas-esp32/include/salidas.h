#pragma once
#include <Arduino.h>
#include "pines.h"

inline void buzzer(bool sonar) {
  static int ultimo = -1;
  if (ultimo == (int)sonar) return;
  ultimo = sonar;
#if BUZZER_PASIVO
  if (sonar) tone(PIN_BUZZER, 2000);
  else noTone(PIN_BUZZER);
#else
  digitalWrite(PIN_BUZZER, (sonar != (bool)BUZZER_ACTIVO_EN_BAJO) ? HIGH : LOW);
#endif
}

inline void leds(bool verde, bool amarillo, bool rojo) {
  digitalWrite(PIN_LED_VERDE, verde);
  digitalWrite(PIN_LED_AMARILLO, amarillo);
  digitalWrite(PIN_LED_ROJO, rojo);
}

inline void iniciarSalidas() {
  pinMode(PIN_LED_VERDE, OUTPUT);
  pinMode(PIN_LED_AMARILLO, OUTPUT);
  pinMode(PIN_LED_ROJO, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  leds(false, false, false);
  buzzer(false);
}
