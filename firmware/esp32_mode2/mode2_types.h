#pragma once
#include <ArduinoJson.h>

// ================== Hardware config ==================
#define LED_PIN 23

// WESIRI 8x32 panel => logical coordinates: W=32 (x columns), H=8 (y rows)
#define PHYS_W 32
#define PHYS_H 8
#define PHYS_LEDS (PHYS_W * PHYS_H)

// Wiring: vertical serpentine by COLUMN (each column has 8 pixels)
#define MATRIX_VERTICAL_SERPENTINE true

// USB-friendly brightness cap.
// (If later you use a proper 5V supply, you can raise this.)
#define BRIGHTNESS_CAP 40

// ================== XY mapping ==================
// x: 0..31, y: 0..7  (y=0 is visual TOP row)
static inline uint16_t xyIndexPhys(uint8_t x, uint8_t y) {
  if (x >= PHYS_W || y >= PHYS_H) return 0;

  if (MATRIX_VERTICAL_SERPENTINE) {
    // Each column is a chain of 8 pixels; odd columns are reversed
    if (x & 0x01) return x * PHYS_H + (PHYS_H - 1 - y);
    else          return x * PHYS_H + y;
  } else {
    // Row-major (not your case)
    return y * PHYS_W + x;
  }
}
#define XY(x,y) xyIndexPhys((uint8_t)(x),(uint8_t)(y))

#include <FastLED.h>