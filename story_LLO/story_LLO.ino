// ===== Pins =====
const int PIN_BTN = 2;

const int PIN_R = 5;   // PWM
const int PIN_G = 6;   // PWM
const int PIN_B = 9;   // PWM

const int PIN_VIB = 10;   // vibration IN
const int PIN_BUZ = 3;    // ✅ buzzer IN (tone)  改成 D3

// 如果你的 RGB 逻辑反了，把这个改成 true
const bool RGB_INVERT = false;

// ===== Button debounce =====
bool lastBtn = HIGH;
unsigned long lastDebounceMs = 0;
const unsigned long DEBOUNCE_MS = 40;

// ===== Time base =====
unsigned long nowMs;

// ===== Preset definition =====
struct Preset {
  const char* name;

  // Base color (0-255)
  uint8_t r, g, b;

  // LED breathing speed (ms). 0 = static
  uint16_t ledPulsePeriodMs;

  // Vibration pattern (ms). vibOnMs=0 => off
  uint16_t vibOnMs;
  uint16_t vibOffMs;

  // Buzzer pattern (ms). buzzOnMs=0 => off
  uint16_t buzzFreqHz;     // used for passive buzzer; active buzzer will still "click"
  uint16_t buzzOnMs;
  uint16_t buzzOffMs;
};

// ✅ 加一个 STOP 模式（全关）作为第 0 个 preset
Preset presets[] = {
  // name     r   g   b   ledPulse  vibOn vibOff  freq  buzOn buzOff
  {"stop",      0,   0,   0,    0,    0,   0,     0,     0,    0},
  {"cozy",    255, 120,  20, 1800,    0,   0,     0,     0,    0},
  {"mystery",  80,  40, 255, 1200,   80, 180,   220,   60,  240},
  {"horror",  255,   0,   0,  600,  140, 120,   120,  120,  80},
  {"romantic",255,  30, 120, 1600,   40, 260,   440,   40,  360},
};

const int PRESET_COUNT = sizeof(presets) / sizeof(presets[0]);
int presetIndex = 0;  // ✅ 默认从 stop 开始

// ===== LED breathing state =====
unsigned long ledT0 = 0;

// ===== Vibration state =====
bool vibOn = false;
unsigned long vibT0 = 0;

// ===== Buzzer state =====
bool buzzOn = false;
unsigned long buzzT0 = 0;

void writeRGB(uint8_t r, uint8_t g, uint8_t b, float brightness01) {
  // brightness01: 0..1
  int rr = (int)(r * brightness01);
  int gg = (int)(g * brightness01);
  int bb = (int)(b * brightness01);

  rr = constrain(rr, 0, 255);
  gg = constrain(gg, 0, 255);
  bb = constrain(bb, 0, 255);

  if (RGB_INVERT) {
    rr = 255 - rr; gg = 255 - gg; bb = 255 - bb;
  }

  analogWrite(PIN_R, rr);
  analogWrite(PIN_G, gg);
  analogWrite(PIN_B, bb);
}

float breathing01(unsigned long t, uint16_t periodMs) {
  // simple triangle wave 0..1..0
  if (periodMs == 0) return 1.0f;
  unsigned long phase = (t % periodMs);
  float x = (float)phase / (float)periodMs; // 0..1
  // triangle
  return (x < 0.5f) ? (x * 2.0f) : (2.0f - x * 2.0f);
}

void applyPreset(int idx) {
  const Preset& p = presets[idx];

  // reset timers so patterns start “from the beginning”
  ledT0 = nowMs;
  vibT0 = nowMs;
  buzzT0 = nowMs;
  vibOn = false;
  buzzOn = false;

  // immediately set outputs to safe state
  digitalWrite(PIN_VIB, LOW);
  noTone(PIN_BUZ);

  // ✅ 立即更新 LED（stop 就会立刻熄灭）
  writeRGB(p.r, p.g, p.b, 1.0f);

  // debug
  Serial.print("Preset: ");
  Serial.println(p.name);
}

void setup() {
  pinMode(PIN_BTN, INPUT_PULLUP);

  pinMode(PIN_R, OUTPUT);
  pinMode(PIN_G, OUTPUT);
  pinMode(PIN_B, OUTPUT);

  pinMode(PIN_VIB, OUTPUT);
  digitalWrite(PIN_VIB, LOW);

  pinMode(PIN_BUZ, OUTPUT);
  noTone(PIN_BUZ);

  Serial.begin(115200);
  delay(200);

  nowMs = millis();
  applyPreset(presetIndex);
}

void handleButton() {
  bool reading = digitalRead(PIN_BTN);

  if (reading != lastBtn) {
    lastDebounceMs = nowMs;
    lastBtn = reading;
  }

  if ((nowMs - lastDebounceMs) > DEBOUNCE_MS) {
    // press = LOW
    if (reading == LOW) {
      // wait release (simple)
      while (digitalRead(PIN_BTN) == LOW) { delay(5); }

      presetIndex = (presetIndex + 1) % PRESET_COUNT;
      applyPreset(presetIndex);
    }
  }
}

void updateLED() {
  const Preset& p = presets[presetIndex];

  // ✅ stop：保持熄灯，不做呼吸
  if (presetIndex == 0) {
    writeRGB(0, 0, 0, 1.0f);
    return;
  }

  unsigned long t = nowMs - ledT0;

  float b01 = breathing01(t, p.ledPulsePeriodMs);
  // 最低亮度，避免完全熄灭（你也可以改小或改成 0）
  b01 = 0.15f + 0.85f * b01;

  writeRGB(p.r, p.g, p.b, b01);
}

void updateVibration() {
  const Preset& p = presets[presetIndex];

  // ✅ stop：强制关
  if (presetIndex == 0 || p.vibOnMs == 0) {
    digitalWrite(PIN_VIB, LOW);
    vibOn = false;
    return;
  }

  unsigned long elapsed = nowMs - vibT0;
  if (!vibOn) {
    // currently off
    if (elapsed >= p.vibOffMs) {
      vibOn = true;
      vibT0 = nowMs;
      digitalWrite(PIN_VIB, HIGH);
    }
  } else {
    // currently on
    if (elapsed >= p.vibOnMs) {
      vibOn = false;
      vibT0 = nowMs;
      digitalWrite(PIN_VIB, LOW);
    }
  }
}

void updateBuzzer() {
  const Preset& p = presets[presetIndex];

  // ✅ stop：强制关
  if (presetIndex == 0 || p.buzzOnMs == 0) {
    noTone(PIN_BUZ);
    buzzOn = false;
    digitalWrite(PIN_BUZ, LOW);
    return;
  }

  unsigned long elapsed = nowMs - buzzT0;
  if (!buzzOn) {
    if (elapsed >= p.buzzOffMs) {
      buzzOn = true;
      buzzT0 = nowMs;
      // passive buzzer: tone(freq). active buzzer: 也会有反应（可能是固定音）
      if (p.buzzFreqHz > 0) tone(PIN_BUZ, p.buzzFreqHz);
      else digitalWrite(PIN_BUZ, HIGH);
    }
  } else {
    if (elapsed >= p.buzzOnMs) {
      buzzOn = false;
      buzzT0 = nowMs;
      noTone(PIN_BUZ);
      digitalWrite(PIN_BUZ, LOW);
    }
  }
}

void loop() {
  nowMs = millis();

  handleButton();
  updateLED();
  updateVibration();
  updateBuzzer();
}
