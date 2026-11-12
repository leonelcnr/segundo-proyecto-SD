#pragma once

#if defined(PLACA_CLASICA)
#define PIN_SPI_SCK      18
#define PIN_SPI_MISO     19
#define PIN_SPI_MOSI     23
#define PIN_RFID_SS       5
#define PIN_RFID_RST      4
#define PIN_I2C_SDA      21
#define PIN_I2C_SCL      22
#define PIN_LED_VERDE    25
#define PIN_LED_AMARILLO 26
#define PIN_LED_ROJO     27
#define PIN_BUZZER       33

#elif defined(PLACA_S3)
#define PIN_SPI_SCK      12
#define PIN_SPI_MISO     13
#define PIN_SPI_MOSI     11
#define PIN_RFID_SS      10
#define PIN_RFID_RST     14
#define PIN_I2C_SDA       8
#define PIN_I2C_SCL       9
#define PIN_LED_VERDE     4
#define PIN_LED_AMARILLO  5
#define PIN_LED_ROJO      6
#define PIN_BUZZER        7

#else
#error "Falta -D PLACA_CLASICA o -D PLACA_S3 en platformio.ini"
#endif

#define LCD_DIRECCION 0x27

#define BUZZER_PASIVO          0
#define BUZZER_ACTIVO_EN_BAJO  0
