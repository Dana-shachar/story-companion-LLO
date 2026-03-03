// =====================================================
// esp32_mode2_clean.ino — ESP32 Serial JSON control for 32x8 WS2812B matrix
// Target: ESP32 Dev Module (WROOM)
// Panel: W=32, H=8 (WESIRI 8x32 flexible WS2812B)
// Wiring: vertical serpentine by COLUMN
//
// Requirements:
// - Visual TOP 4 rows always OFF (y=0..3 black)
// - Only bottom 4 rows show effects (y=4..7)
//
// Controls:
// - PC/web sends JSON lines over Serial (115200):
//     {"cmd":"set_rgb","msg_id":1,"r":0..255,"g":0..255,"b":0..255,
//      "intensity":0..1,
//      "pattern":0..4 (optional),
//      "auto_cycle":true/false (optional),
//      "duration_ms":0.. (optional, 0=indefinite)}
//     {"cmd":"clear"}
//     {"cmd":"set_mute","muted":true/false}   // optional, for PC-driven mute
//
// - TOUCH_PIN toggles "PC LED Gate":
//     Gate OFF => ignore applying PC set_rgb (but cache the last packet)
//     Gate ON  => apply cached packet immediately and accept future updates
//   Emits:
//     {"event":"pc_led_gate","enabled":true/false}
//
// - LDR_PIN controls "mute_state" to PC (dark => muted, bright => unmuted)
//   Emits:
//     {"event":"mute_state","muted":true/false}
//
// Notes:
// - This sketch is intentionally self-contained and robust against partial edits.
// =====================================================

#include <Arduino.h>
#include <ArduinoJson.h>
#include <FastLED.h>

// ----------------- Hardware -----------------
#define LED_PIN     23
#define TOUCH_PIN    4     // T0 = GPIO4
#define LDR_PIN     34     // ADC1 channel (GPIO34)

// Matrix geometry
static const uint8_t W = 32;
static const uint8_t H = 8;
static const uint16_t NUM_LEDS = (uint16_t)W * (uint16_t)H;

// Limit brightness for USB power safety
static const uint8_t BRIGHTNESS_CAP = 80;   // 0..255

CRGB leds[NUM_LEDS];

// ----------------- Touch gate tuning -----------------
// Dynamic calibration ported from Dana's capacitive sensor project:
//   startup baseline + EWM smoothing + slow drift + % thresholds
static const uint32_t TOUCH_DEBOUNCE_MS  = 250;
static const float    TOUCH_SMOOTH_ALPHA = 0.6f;   // EWM weight on new reading
static const float    TOUCH_ON_FACTOR    = 0.90f;  // press  = reading drops to 90% of baseline
static const float    TOUCH_OFF_FACTOR   = 0.95f;  // release = reading recovers to 95% of baseline
static const float    TOUCH_DRIFT_ALPHA  = 0.002f; // slow baseline drift when idle

static float    gTouchBaseline = 0;
static float    gTouchSmoothed = 0;
static int      gTouchThOn     = 0;   // computed at startup
static int      gTouchThOff    = 0;   // computed at startup

// Gate state
static bool gPcLedGate = false;
static bool gTouchArmed = true;
static bool gPrevPressed = false;
static uint32_t gLastToggleMs = 0;

// ----------------- LDR mute tuning -----------------
// Dynamic calibration: same approach as touch — baseline sampled at startup
static const uint32_t LDR_DEBOUNCE_MS    = 500;
// Sensor is COVERED at boot (dark baseline).
// Unmute when raw drops to 70% of dark baseline (uncovered = bright = lower raw).
// Re-mute when raw climbs back above 85% of dark baseline (covered again).
static const float    LDR_MUTE_FACTOR    = 0.85f; // re-mute when raw > baseline * 0.85
static const float    LDR_UNMUTE_FACTOR  = 0.70f; // unmute  when raw < baseline * 0.70

static float gLdrBaseline        = 0;
static int   gLdrMuteThreshold   = 0;   // computed at startup
static int   gLdrUnmuteThreshold = 0;   // computed at startup

static bool gMutedByLight = true;   // starts muted — sensor covered at boot
static bool gMutedByPc = false;
static bool gEffectiveMuted = true; // send muted=true on hello
static uint32_t gLdrLastFlipMs = 0;

// ----------------- Serial RX -----------------
static String gSerialLine;

// ----------------- AI / pattern state -----------------
static bool     gActive = false;
static CRGB     gBase = CRGB(0, 0, 0);
static float    gIntensity = 0.2f;         // 0..1
static uint8_t  gPattern = 0;              // 0..4
static bool     gAutoCycle = false;
static uint32_t gStartMs = 0;
static uint32_t gEndMs = 0;

// Cache the last command from PC so that Gate ON can "resume immediately"
static bool     gHasLastCmd = false;
static uint8_t  gLastR = 0, gLastG = 0, gLastB = 0;
static float    gLastIntensity = 0.2f;
static int      gLastPatternOpt = -1;      // -1 means "keep"
static int      gLastAutoCycleOpt = -1;    // -1 means "keep"
static uint32_t gLastDurationMs = 0;

// ----------------- Utils: mapping -----------------
static inline uint16_t XY(uint8_t x, uint8_t y) {
  // Vertical serpentine by COLUMN:
  // even column: y 0->H-1
  // odd  column: y H-1->0
  if (x >= W) x = W - 1;
  if (y >= H) y = H - 1;
  uint16_t base = (uint16_t)x * (uint16_t)H;
  if ((x & 1) == 0) return base + y;
  return base + (H - 1 - y);
}

static inline void forceTopRowsOff() {
  for (uint8_t y = 0; y < 4; y++) {
    for (uint8_t x = 0; x < W; x++) {
      leds[XY(x, y)] = CRGB::Black;
    }
  }
}

static inline void clearAll() {
  fill_solid(leds, NUM_LEDS, CRGB::Black);
}

// ----------------- Transport -----------------
static inline void transportSendText(const String& s) {
  Serial.println(s);
}

// ----------------- Events / ACKs -----------------
static void sendAck(int msg_id, const char* status, const char* reason) {
  StaticJsonDocument<256> doc;
  doc["event"] = "ack";
  doc["msg_id"] = msg_id;
  doc["status"] = status;
  if (reason && reason[0]) doc["reason"] = reason;
  String out;
  serializeJson(doc, out);
  transportSendText(out);
}

static void sendGateState() {
  StaticJsonDocument<128> doc;
  doc["event"] = "pc_led_gate";
  doc["enabled"] = gPcLedGate;
  String out;
  serializeJson(doc, out);
  transportSendText(out);
}

static void sendMuteState(bool muted) {
  StaticJsonDocument<128> doc;
  doc["event"] = "mute_state";
  doc["muted"] = muted;
  String out;
  serializeJson(doc, out);
  transportSendText(out);
}

// ----------------- Patterns -----------------
static uint8_t storyPattern(uint32_t sinceMs) {
  // Simple cycle among 0..4 every ~8s
  return (sinceMs / 8000UL) % 5;
}

static CRGB driftColor(CRGB base, uint32_t nowMs) {
  // Gentle hue drift based on time
  CHSV hsv = rgb2hsv_approximate(base);
  hsv.hue += (uint8_t)(nowMs / 60UL);
  return CRGB(hsv);
}

static void patternSolid(CRGB c) {
  for (uint8_t y = 4; y < H; y++) {
    for (uint8_t x = 0; x < W; x++) {
      leds[XY(x, y)] = c;
    }
  }
}

static void patternPulse(CRGB c, uint32_t sinceMs) {
  float t = (sinceMs % 2000UL) / 2000.0f;
  float wave = 0.5f + 0.5f * sinf(2.0f * PI * t);
  uint8_t scale = (uint8_t)(255.0f * wave);
  CRGB cc = c; cc.nscale8_video(scale);
  patternSolid(cc);
}

static uint32_t xorshift32(uint32_t& s) {
  s ^= s << 13; s ^= s >> 17; s ^= s << 5;
  return s;
}

static void patternSparkle(CRGB c, uint32_t nowMs) {
  // fade a bit
  for (uint8_t y = 4; y < H; y++) {
    for (uint8_t x = 0; x < W; x++) {
      leds[XY(x, y)].fadeToBlackBy(28);
    }
  }
  // add sparkles
  static uint32_t seed = 0x12345678;
  seed ^= nowMs;
  for (int i = 0; i < 6; i++) {
    uint32_t r = xorshift32(seed);
    uint8_t x = r % W;
    uint8_t y = 4 + ((r >> 8) % 4);
    leds[XY(x, y)] += c;
  }
}

static void patternWave(CRGB c, uint32_t sinceMs) {
  for (uint8_t y = 4; y < H; y++) {
    for (uint8_t x = 0; x < W; x++) {
      float t = (sinceMs / 1000.0f) + x * 0.25f + y * 0.6f;
      float w = 0.5f + 0.5f * sinf(2.0f * PI * t / 3.5f);
      uint8_t sc = (uint8_t)(255.0f * w);
      CRGB cc = c; cc.nscale8_video(sc);
      leds[XY(x, y)] = cc;
    }
  }
}

static void patternDrift(CRGB c, uint32_t nowMs) {
  CRGB d = driftColor(c, nowMs);
  patternSolid(d);
}

// Render current pattern
static void renderAI() {
  if (!gActive) return;

  uint32_t now = millis();

  // duration
  if (gEndMs != 0 && (int32_t)(now - gEndMs) > 0) {
    // when expired, keep a dim "breathing" to avoid abrupt darkness
    gIntensity = min(gIntensity, 0.18f);
    gEndMs = 0; // stop expiring repeatedly
  }

  uint32_t since = now - gStartMs;
  uint8_t p = gAutoCycle ? storyPattern(since) : gPattern;

  CRGB base = driftColor(gBase, now);
  float power = constrain(gIntensity, 0.0f, 1.0f);
  base.nscale8_video((uint8_t)(power * 255.0f));

  // When gate is OFF, force black (but keep animation state alive)
  if (!gPcLedGate) {
    clearAll();
    FastLED.show();
    return;
  }

  // draw
  if (p == 0) patternSolid(base);
  else if (p == 1) patternPulse(base, since);
  else if (p == 2) patternSparkle(base, now);
  else if (p == 3) patternWave(base, since);
  else patternDrift(base, now);

  forceTopRowsOff();
  FastLED.show();
}

// Apply a new command into state (does not check gate)
static void applyAI(uint8_t r, uint8_t g, uint8_t b, float intensity01,
                    uint32_t durationMs, int patternOpt, int autoCycleOpt) {
  gActive = true;
  gBase = CRGB(r, g, b);
  gIntensity = constrain(intensity01, 0.0f, 1.0f);

  if (patternOpt >= 0) {
    gPattern = (uint8_t)constrain(patternOpt, 0, 4);
    gAutoCycle = false;
  }
  if (autoCycleOpt == 0) gAutoCycle = false;
  if (autoCycleOpt == 1) gAutoCycle = true;

  gEndMs = (durationMs == 0) ? 0 : (millis() + durationMs);
  gStartMs = millis();
}

// ----------------- Touch gate -----------------
static void updateTouchGate() {
  uint32_t now = millis();
  int raw = touchRead(TOUCH_PIN);

  // Exponential smoothing (from Dana's project: kills noise without lag)
  gTouchSmoothed = TOUCH_SMOOTH_ALPHA * raw + (1.0f - TOUCH_SMOOTH_ALPHA) * gTouchSmoothed;

  // Slow baseline drift — only when clearly not touched (above off threshold)
  if (gTouchSmoothed > gTouchThOff) {
    gTouchBaseline = TOUCH_DRIFT_ALPHA * gTouchSmoothed + (1.0f - TOUCH_DRIFT_ALPHA) * gTouchBaseline;
    gTouchThOn  = (int)(gTouchBaseline * TOUCH_ON_FACTOR);
    gTouchThOff = (int)(gTouchBaseline * TOUCH_OFF_FACTOR);
  }

  bool pressed  = (gTouchSmoothed < gTouchThOn);
  bool released = (gTouchSmoothed > gTouchThOff);

  if ((now - gLastToggleMs) < TOUCH_DEBOUNCE_MS) {
    gPrevPressed = pressed;
    if (released) gTouchArmed = true;
    return;
  }

  if (gTouchArmed && !gPrevPressed && pressed) {
    gPcLedGate = !gPcLedGate;
    gLastToggleMs = now;
    sendGateState();

    // If gate turned ON and we have cached cmd, apply immediately
    if (gPcLedGate && gHasLastCmd) {
      applyAI(gLastR, gLastG, gLastB, gLastIntensity, gLastDurationMs,
              gLastPatternOpt, gLastAutoCycleOpt);
    }

    // If turned OFF, blank immediately
    if (!gPcLedGate) {
      clearAll();
      forceTopRowsOff();
      FastLED.show();
    }

    gTouchArmed = false;
  }

  if (released) gTouchArmed = true;
  gPrevPressed = pressed;
}

// ----------------- LDR mute (kept) -----------------
static void updateEffectiveMuteAndNotify() {
  bool next = gMutedByLight || gMutedByPc;
  if (next != gEffectiveMuted) {
    gEffectiveMuted = next;
    sendMuteState(gEffectiveMuted);
  }
}

static void updateLdrMute() {
  uint32_t now = millis();
  int raw = analogRead(LDR_PIN); // 0..4095

  // Debug: print every 3 seconds so you can see live values in serial monitor
  static uint32_t sLdrLastPrint = 0;
  if (now - sLdrLastPrint > 3000) {
    Serial.printf("[LDR] raw=%d baseline=%.0f muteAt=%d unmuteAt=%d muted=%d\n",
                  raw, gLdrBaseline, gLdrMuteThreshold, gLdrUnmuteThreshold, (int)gMutedByLight);
    sLdrLastPrint = now;
  }

  bool nextMuted = gMutedByLight;

  // darker => higher raw: mute when raw climbs above mute threshold
  if (!gMutedByLight) {
    if (raw > gLdrMuteThreshold) nextMuted = true;
  } else {
    if (raw < gLdrUnmuteThreshold) nextMuted = false;
  }

  if (nextMuted != gMutedByLight && (now - gLdrLastFlipMs) > LDR_DEBOUNCE_MS) {
    gMutedByLight = nextMuted;
    gLdrLastFlipMs = now;
    updateEffectiveMuteAndNotify();
  }
}

// ----------------- Serial JSON handling -----------------
static void handleIncomingJsonText(const String& line) {
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, line);
  if (err) {
    // ignore noisy lines
    return;
  }

  const char* cmd = doc["cmd"] | "";
  int msg_id = doc["msg_id"] | 0;

  if (strcmp(cmd, "clear") == 0) {
    gActive = false;
    clearAll();
    forceTopRowsOff();
    FastLED.show();
    sendAck(msg_id, "ok", "cleared");
    return;
  }

  if (strcmp(cmd, "set_mute") == 0) {
    gMutedByPc = doc["muted"] | false;
    updateEffectiveMuteAndNotify();
    sendAck(msg_id, "ok", "mute_updated");
    return;
  }

  if (strcmp(cmd, "set_rgb") == 0) {
    uint8_t r = (uint8_t)constrain((int)(doc["r"] | 0), 0, 255);
    uint8_t g = (uint8_t)constrain((int)(doc["g"] | 0), 0, 255);
    uint8_t b = (uint8_t)constrain((int)(doc["b"] | 0), 0, 255);
    float intensity = doc["intensity"] | 0.2f;
    uint32_t durationMs = doc["duration_ms"] | 0;

    int patternOpt = -1;
    int autoCycleOpt = -1;
    if (doc.containsKey("pattern")) patternOpt = (int)doc["pattern"];
    if (doc.containsKey("auto_cycle")) autoCycleOpt = (bool)doc["auto_cycle"] ? 1 : 0;

    // Cache always (so Gate ON can resume immediately)
    gHasLastCmd = true;
    gLastR = r; gLastG = g; gLastB = b;
    gLastIntensity = intensity;
    gLastDurationMs = durationMs;
    gLastPatternOpt = patternOpt;
    gLastAutoCycleOpt = autoCycleOpt;

    if (gPcLedGate) {
      applyAI(r, g, b, intensity, durationMs, patternOpt, autoCycleOpt);
      sendAck(msg_id, "ok", "applied");
    } else {
      // gate off: keep black, but acknowledge queued
      clearAll();
      forceTopRowsOff();
      FastLED.show();
      sendAck(msg_id, "queued", "pc_led_gate_off");
    }
    return;
  }

  // unknown cmd
  sendAck(msg_id, "error", "unknown_cmd");
}

static void processSerialInput() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      String line = gSerialLine;
      gSerialLine = "";
      line.trim();
      if (line.length() == 0) continue;
      handleIncomingJsonText(line);
    } else {
      if (gSerialLine.length() < 2048) gSerialLine += c;
      else gSerialLine = "";
    }
  }
}

// ----------------- Arduino setup/loop -----------------
void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(LDR_PIN, INPUT);

  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(BRIGHTNESS_CAP);
  clearAll();
  forceTopRowsOff();
  FastLED.show();

  // Calibrate touch baseline — sample 50 readings over 1 second (don't touch!)
  Serial.println("[TOUCH] Calibrating baseline — keep hands off sensor...");
  {
    long sum = 0;
    const int CALIB_N = 50;
    for (int i = 0; i < CALIB_N; i++) {
      sum += touchRead(TOUCH_PIN);
      delay(20);
    }
    gTouchBaseline = (float)(sum / CALIB_N);
    gTouchSmoothed = gTouchBaseline;
    gTouchThOn  = (int)(gTouchBaseline * TOUCH_ON_FACTOR);
    gTouchThOff = (int)(gTouchBaseline * TOUCH_OFF_FACTOR);
    Serial.printf("[TOUCH] baseline=%.0f thOn=%d thOff=%d\n",
                  gTouchBaseline, gTouchThOn, gTouchThOff);
  }

  // Calibrate LDR baseline — sample 50 readings over 1 second (leave sensor uncovered)
  Serial.println("[LDR] Calibrating baseline — leave sensor uncovered...");
  {
    long sum = 0;
    const int CALIB_N = 50;
    for (int i = 0; i < CALIB_N; i++) {
      sum += analogRead(LDR_PIN);
      delay(20);
    }
    gLdrBaseline        = (float)(sum / CALIB_N);
    gLdrMuteThreshold   = (int)(gLdrBaseline * LDR_MUTE_FACTOR);
    gLdrUnmuteThreshold = (int)(gLdrBaseline * LDR_UNMUTE_FACTOR);
    Serial.printf("[LDR] baseline=%.0f muteAt=%d unmuteAt=%d\n",
                  gLdrBaseline, gLdrMuteThreshold, gLdrUnmuteThreshold);
  }

  transportSendText("{\"event\":\"hello\",\"matrix\":\"32x8\",\"active_rows\":\"y=4..7\",\"transport\":\"serial\"}");
  sendGateState();
  sendMuteState(gEffectiveMuted);
}

void loop() {
  processSerialInput();
  updateTouchGate();
  updateLdrMute();
  renderAI();
  delay(10); // ~100Hz tick
}
