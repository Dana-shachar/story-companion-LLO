// =====================================================
// esp32_mode2.ino — Serial JSON control (AI real-time)
//
// Panel: W=32, H=8 (WESIRI 8x32 flexible WS2812B)
// Wiring: vertical serpentine by COLUMN
//
// Trigger requirements:
// - Touch OR Button both can trigger -> send event to computer via Serial
// =====================================================

#include "mode2_types.h"
#include <ArduinoJson.h>

// ============== LED buffer ==============
CRGB leds[PHYS_LEDS];

// ============== Crop settings ==============
static const uint8_t ACTIVE_Y0 = 4;   // inclusive
static const uint8_t ACTIVE_Y1 = 8;   // exclusive

// ============== Touch ==============
#define TOUCH_PIN 4
int TOUCH_THRESHOLD = 600;
const uint16_t TOUCH_MIN_MS = 800;
const uint16_t TOUCH_MAX_MS = 1200;

bool gTouching = false;
uint32_t gTouchStartMs = 0;
bool gTouchFired = false;

// ============== Button (NEW) ==============
#define BTN_PIN 14
#define BTN_ACTIVE_LOW 1        // most button modules: pressed -> LOW. If yours is opposite, set to 0.
const uint16_t BTN_DEBOUNCE_MS = 35;

bool gBtnStable = false;        // stable pressed state
bool gBtnLastRead = false;      // last raw read (pressed/unpressed)
uint32_t gBtnLastChangeMs = 0;

// ============== AI state ==============
bool     gActive = false;
CRGB     gBase = CRGB::Black;
float    gIntensity = 0.25f;       // USB-friendly default
uint8_t  gPattern = 0;
bool     gAutoCycle = true;
uint32_t gStartMs = 0;
uint32_t gEndMs = 0;               // 0 => indefinite

// ============== Serial line buffer ==============
static String gSerialLine;

// ============== Helpers ==============
static inline void transportSendText(const String& s) { Serial.println(s); }

static inline void clearAll() {
  fill_solid(leds, PHYS_LEDS, CRGB::Black);
}

static inline void forceTopRowsOff() {
  for (uint8_t x = 0; x < PHYS_W; x++) {
    for (uint8_t y = 0; y < ACTIVE_Y0; y++) leds[XY(x, y)] = CRGB::Black;
  }
}

static inline void setBrightnessFromIntensity(float intensity01) {
  float ii = constrain(intensity01, 0.0f, 1.0f);
  uint8_t br = (uint8_t)(ii * 255.0f);
  br = min<uint8_t>(br, BRIGHTNESS_CAP);
  FastLED.setBrightness(br);
}

static inline CRGB driftColor(const CRGB& base, uint32_t now) {
  CHSV hsv = rgb2hsv_approximate(base);
  int8_t wiggle = (int8_t)(6.0f * sinf(now * 0.00025f)); // +/-6 hue
  hsv.hue = (uint8_t)(hsv.hue + wiggle);
  uint8_t satW = (uint8_t)(10.0f * (0.5f + 0.5f * sinf(now * 0.00018f)));
  hsv.sat = qadd8(hsv.sat, satW);
  return CRGB(hsv);
}

// ============== Patterns ==============
static inline void patternWave(uint32_t now, const CRGB& base, float power) {
  float t = now * (0.0020f + 0.0012f * power);
  float freq = 0.30f + 0.15f * power;

  for (uint8_t x = 0; x < PHYS_W; x++) {
    float wave = 0.15f + 0.85f * (0.5f + 0.5f * sinf(t + x * freq));
    CRGB c = base; c.nscale8((uint8_t)(wave * 255));
    for (uint8_t y = ACTIVE_Y0; y < ACTIVE_Y1; y++) leds[XY(x, y)] = c;
  }
}

static inline void patternBreath(uint32_t now, const CRGB& base, float power) {
  float t = now * (0.0012f + 0.0010f * power);
  float breath = 0.08f + 0.92f * (0.5f + 0.5f * sinf(t));
  CRGB c = base; c.nscale8((uint8_t)(breath * 255));

  for (uint8_t x = 0; x < PHYS_W; x++)
    for (uint8_t y = ACTIVE_Y0; y < ACTIVE_Y1; y++)
      leds[XY(x, y)] = c;
}

static inline void patternSparkle(uint32_t now, const CRGB& base, float power) {
  fadeToBlackBy(leds, PHYS_LEDS, 22);

  CRGB wash = base;
  wash.nscale8((uint8_t)(30 + 70 * power));

  for (uint8_t x = 0; x < PHYS_W; x++)
    for (uint8_t y = ACTIVE_Y0; y < ACTIVE_Y1; y++)
      leds[XY(x, y)] += wash;

  float lfo = 0.5f + 0.5f * sinf(now * 0.0009f);
  uint8_t sparkleN = (uint8_t)(2 + (10.0f * power) + (6.0f * lfo));

  for (uint8_t i = 0; i < sparkleN; i++) {
    uint8_t x = random8(PHYS_W);
    uint8_t y = ACTIVE_Y0 + random8(ACTIVE_Y1 - ACTIVE_Y0);
    CRGB s = base; s.nscale8(200);
    leds[XY(x, y)] += s;
  }
}

static inline void patternComet(uint32_t now, const CRGB& base, float power) {
  fadeToBlackBy(leds, PHYS_LEDS, 30);

  float t = now * (0.0022f + 0.0016f * power);
  uint8_t headX = (uint8_t)((sinf(t) * 0.5f + 0.5f) * (PHYS_W - 1));
  uint8_t thick = (power > 0.6f) ? 2 : 1;

  CRGB halo1 = base; halo1.nscale8_video(180);
  CRGB halo2 = base; halo2.nscale8_video(120);

  for (uint8_t y = ACTIVE_Y0; y < ACTIVE_Y1; y++) {
    leds[XY(headX, y)] += base;

    if (headX > 0)               leds[XY(headX - 1, y)] += halo1;
    if (headX + 1 < PHYS_W)      leds[XY(headX + 1, y)] += halo1;

    if (thick == 2) {
      if (headX > 1)             leds[XY(headX - 2, y)] += halo2;
      if (headX + 2 < PHYS_W)    leds[XY(headX + 2, y)] += halo2;
    }
  }
}

static inline void patternNoise(uint32_t now, const CRGB& base, float power) {
  uint16_t t = (uint16_t)(now * (0.05f + 0.08f * power));
  uint8_t contrast = (uint8_t)(110 + 110 * power);

  for (uint8_t x = 0; x < PHYS_W; x++) {
    for (uint8_t y = ACTIVE_Y0; y < ACTIVE_Y1; y++) {
      uint8_t n = inoise8(x * 35, y * 70, t);
      uint8_t k = qadd8(15, scale8(n, contrast));
      CRGB c = base; c.nscale8(k);
      leds[XY(x, y)] = c;
    }
  }
}

// ============== Story schedule ==============
static inline uint8_t storyPattern(uint32_t nowSinceStart) {
  uint32_t phase = nowSinceStart % 16000;
  if      (phase < 3000)  return 1;
  else if (phase < 6500)  return 0;
  else if (phase < 10000) return 4;
  else if (phase < 13000) return 3;
  else                    return 2;
}

// ============== Render ==============
void renderAI() {
  if (!gActive) return;

  uint32_t now = millis();

  if (gEndMs != 0 && (int32_t)(now - gEndMs) > 0) {
    gEndMs = 0;
    gIntensity = min(gIntensity, 0.18f);
    setBrightnessFromIntensity(gIntensity);
  }

  uint32_t since = now - gStartMs;
  uint8_t p = gAutoCycle ? storyPattern(since) : gPattern;

  float drift = 0.85f + 0.15f * sinf(now * 0.00023f);
  CRGB base = driftColor(gBase, now);

  float power = constrain(gIntensity, 0.0f, 1.0f);
  power = constrain(power * drift, 0.0f, 1.0f);

  if (p == 0 || p == 1 || p == 4) clearAll();
  else forceTopRowsOff();

  switch (p) {
    case 0: patternWave(now, base, power);    break;
    case 1: patternBreath(now, base, power);  break;
    case 2: patternSparkle(now, base, power); break;
    case 3: patternComet(now, base, power);   break;
    case 4: patternNoise(now, base, power);   break;
    default: patternWave(now, base, power);   break;
  }

  forceTopRowsOff();
  FastLED.show();
}

// ============== Apply AI update ==============
void applyAI(uint8_t r, uint8_t g, uint8_t b,
             float intensity01,
             uint32_t durationMs,
             int patternOpt,
             int autoCycleOpt) {
  gActive = true;
  gBase = CRGB(r, g, b);
  gIntensity = constrain(intensity01, 0.0f, 1.0f);

  if (patternOpt >= 0 && patternOpt <= 4) {
    gPattern = (uint8_t)patternOpt;
    gAutoCycle = false;
  } else {
    gAutoCycle = true;
  }
  if (autoCycleOpt == 0) gAutoCycle = false;
  if (autoCycleOpt == 1) gAutoCycle = true;

  gEndMs = (durationMs == 0) ? 0 : (millis() + durationMs);
  gStartMs = millis();

  setBrightnessFromIntensity(gIntensity);
}

// ============== ACK ==============
void sendAck(int msgId, const char* status, const char* reason = "") {
  StaticJsonDocument<256> doc;
  doc["event"] = "ack";
  doc["msg_id"] = msgId;
  doc["status"] = status;
  if (reason && reason[0]) doc["reason"] = reason;

  String out;
  serializeJson(doc, out);
  transportSendText(out);
}

// ============== Trigger Event (Touch OR Button) ==============
void sendTriggerEvent(const char* source, uint32_t heldMsOr0) {
  StaticJsonDocument<256> req;
  req["event"] = "resonance_request";
  req["mode"] = "resonance";
  req["region"] = 2;
  req["source"] = source;            // "touch" or "button"
  req["duration_ms"] = heldMsOr0;
  req["ts"] = (uint32_t)(millis() / 1000);

  String out;
  serializeJson(req, out);
  transportSendText(out);
}

// ============== Incoming JSON ==============
void handleIncomingJsonText(const String& msg) {
  StaticJsonDocument<1536> doc;
  DeserializationError err = deserializeJson(doc, msg);
  if (err) {
    Serial.print("[JSON] parse error: ");
    Serial.println(err.c_str());
    return;
  }

  const char* cmd = doc["cmd"] | "";
  int msgId = doc["msg_id"] | -1;

  if (String(cmd) == "stop") {
    gActive = false;
    clearAll();
    forceTopRowsOff();
    FastLED.show();
    sendAck(msgId, "ok");
    return;
  }

  if (String(cmd) == "set_rgb") {
    uint8_t r = doc["r"] | 0;
    uint8_t g = doc["g"] | 0;
    uint8_t b = doc["b"] | 0;

    float intensity = doc["intensity"] | 0.25f;
    uint32_t dur = doc["duration_ms"] | 0;

    int pattern = -1;
    if (doc.containsKey("pattern")) pattern = (int)(doc["pattern"] | -1);

    int autoCycleOpt = -1;
    if (doc.containsKey("auto_cycle")) autoCycleOpt = (doc["auto_cycle"] ? 1 : 0);

    applyAI(r, g, b, intensity, dur, pattern, autoCycleOpt);
    sendAck(msgId, "ok");
    return;
  }

  sendAck(msgId, "error", "unknown_cmd");
}

// ============== Touch trigger ==============
void updateTouchTrigger() {
  int v = touchRead(TOUCH_PIN);
  bool isTouch = (v < TOUCH_THRESHOLD);
  uint32_t now = millis();

  if (isTouch && !gTouching) {
    gTouching = true;
    gTouchStartMs = now;
    gTouchFired = false;
  }
  if (!isTouch && gTouching) {
    gTouching = false;
    gTouchFired = false;
  }

  if (gTouching && !gTouchFired) {
    uint32_t held = now - gTouchStartMs;
    if (held >= TOUCH_MIN_MS && held <= TOUCH_MAX_MS) {
      sendTriggerEvent("touch", held);
      gTouchFired = true;
    } else if (held > TOUCH_MAX_MS) {
      gTouchFired = true;
    }
  }
}

// ============== Button trigger (NEW) ==============
void updateButtonTrigger() {
  int raw = digitalRead(BTN_PIN);
  bool pressed = BTN_ACTIVE_LOW ? (raw == LOW) : (raw == HIGH);

  uint32_t now = millis();

  if (pressed != gBtnLastRead) {
    gBtnLastRead = pressed;
    gBtnLastChangeMs = now;
  }

  // accept stable state after debounce time
  if ((now - gBtnLastChangeMs) > BTN_DEBOUNCE_MS) {
    if (gBtnStable != gBtnLastRead) {
      gBtnStable = gBtnLastRead;

      // trigger only on press down
      if (gBtnStable) {
        sendTriggerEvent("button", 0);
      }
    }
  }
}

// ============== Serial input ==============
void processSerialInput() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;

    if (c == '\n') {
      String line = gSerialLine;
      gSerialLine = "";
      line.trim();
      if (line.length() == 0) continue;

      Serial.print("[SER] RX: ");
      Serial.println(line);
      handleIncomingJsonText(line);
    } else {
      if (gSerialLine.length() < 2048) gSerialLine += c;
      else {
        gSerialLine = "";
        Serial.println("[SER] Line too long, reset");
      }
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  // Button input
  pinMode(BTN_PIN, INPUT_PULLUP); // works for most modules; if your module is active HIGH, keep this but set BTN_ACTIVE_LOW=0

  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, PHYS_LEDS);
  clearAll();
  setBrightnessFromIntensity(0.20f);
  forceTopRowsOff();
  FastLED.show();

  transportSendText("{\"event\":\"hello\",\"matrix\":\"32x8\",\"active_rows\":\"y=4..7\",\"transport\":\"serial\"}");
  Serial.printf("[INFO] BRIGHTNESS_CAP=%d\n", BRIGHTNESS_CAP);
  Serial.printf("[TOUCH] TOUCH_THRESHOLD=%d\n", TOUCH_THRESHOLD);
  Serial.printf("[BTN] pin=%d active_low=%d\n", BTN_PIN, BTN_ACTIVE_LOW);
}

void loop() {
  processSerialInput();
  renderAI();

  updateTouchTrigger();
  updateButtonTrigger();
}