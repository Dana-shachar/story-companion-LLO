#include <Adafruit_NeoPixel.h>
#include <Adafruit_NeoMatrix.h>

#define PIN 6
#define BUTTON_PIN 2
#define LED_PIN 3  


Adafruit_NeoMatrix matrix = Adafruit_NeoMatrix(
  16, 16,
  PIN,
  NEO_MATRIX_TOP + NEO_MATRIX_LEFT +
  NEO_MATRIX_ROWS + NEO_MATRIX_ZIGZAG,
  NEO_GRB + NEO_KHZ800
);

String incomingData = "";
int lastButtonState = HIGH;

// ===== ADDED: Function declarations =====
void parseData(String data);
void updateMatrix(String matrixData, String colorData);
// ========================================

void setup() {
  Serial.begin(9600);
  matrix.begin();
  matrix.setBrightness(50);  // ADDED: Brightness control (adjust 0-255)
  matrix.show();
  
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT); 
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  // ===== IMPROVED: Better button debouncing =====
  int buttonState = digitalRead(BUTTON_PIN);
  static unsigned long lastPressTime = 0;
  unsigned long debounceDelay = 500;

  if (buttonState == LOW) {
    digitalWrite(LED_PIN, HIGH);  // Button pressed → LED on
  } else {
    digitalWrite(LED_PIN, LOW);   // Button released → LED off
  }
  
  if (buttonState == LOW && lastButtonState == HIGH) {
    if (millis() - lastPressTime > debounceDelay) {
      Serial.println("BUTTON_PRESSED");
      lastPressTime = millis();
    }
  }
  
  lastButtonState = buttonState;
  // ==============================================
  
  // Serial data from p5
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      parseData(incomingData);
      incomingData = "";
    } else {
      incomingData += c;
    }
  }
}

void parseData(String data) {
  int sepIndex = data.indexOf('|');
  if (sepIndex == -1) return;

  String colorData = data.substring(0, sepIndex);
  String matrixData = data.substring(sepIndex + 1);

  if (matrixData.length() != 256) return;

  updateMatrix(matrixData, colorData);
}

void updateMatrix(String matrixData, String colorData) {
  // Parse RGB values from "R,G,B" format
  int r = 0, g = 0, b = 0;
  int comma1 = colorData.indexOf(',');
  int comma2 = colorData.lastIndexOf(',');
  
  if (comma1 != -1 && comma2 != -1) {
    r = colorData.substring(0, comma1).toInt();
    g = colorData.substring(comma1 + 1, comma2).toInt();
    b = colorData.substring(comma2 + 1).toInt();
  }
  
  // Visual debug - blink LED when color changes
  static int lastR = -1, lastG = -1, lastB = -1;
  if (r != lastR || g != lastG || b != lastB) {
    digitalWrite(LED_BUILTIN, HIGH);
    delay(20);
    digitalWrite(LED_BUILTIN, LOW);
    lastR = r; lastG = g; lastB = b;
  }
  
  uint16_t handColor = matrix.Color(r, g, b);
  
  // Clear entire matrix first (faster than pixel-by-pixel)
  matrix.fillScreen(0);
  
  // Draw hand pixels with mirrored x-coordinate
  for (int y = 0; y < 16; y++) {
    for (int x = 0; x < 16; x++) {
      int gridIndex = y * 16 + x;
      
      if (matrixData.charAt(gridIndex) == '1') {
        // Mirror x-coordinate to fix backwards rotation
        matrix.drawPixel(15 - x, y, handColor);
      }
    }
  }
  
  matrix.show();
}