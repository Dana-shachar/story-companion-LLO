#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <FastLED.h>

// =====================================================
// Mode 2 — Resonance Mode (ESP32)
// Goals:
// 1) Connect Wi-Fi
// 2) Connect Node WebSocket server
// 3) Send upstream: resonance_request (triggered by touch long-press)
// 4) Parse downstream: apply_resonance
// 5) Execute: LED ambient_gen (+ DFPlayer stubs for now)
// 6) Send ACK
// =====================================================

// ========== Wi-Fi / WS CONFIG ==========
const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASS";

// IMPORTANT: set to the computer's LAN IP running server.js
const char* WS_HOST = "192.168.1.100";  // TODO: change to your computer IP
const uint16_t WS_PORT = 8080;
const char* WS_PATH = "/";

WebSocketsClient webSocket;

// ========== LED CONFIG (WS2812B RING) ==========
#define LED_PIN 23        // GPIO23 (D23)
#define NUM_LEDS 60
CRGB leds[NUM_LEDS];

// Safety brightness cap (0..255). Helps keep 5V/2A stable.
#define BRIGHTNESS_CAP 160

// ========== TOUCH CONFIG ==========
#define TOUCH_PIN 4       // GPIO4 = T0
// touchRead() is *lower* when touched on most ESP32 boards.
// You MUST calibrate this value for your electrode/foil/cloth size.
// Start with 35-45 range; print values to Serial to tune.
int TOUCH_THRESHOLD = 40;

// Long-press window for resonance (ms)
const uint16_t TOUCH_MIN_MS = 800;
const uint16_t TOUCH_MAX_MS = 1200;

// ========== DFPlayer STUB (replace later) ==========
void dfplayerPlayTrack(int trackId) {
  // TODO: implement DFPlayer serial commands
  Serial.printf("[DFP] play track %d\n", trackId);
}
void dfplayerSetVolume(int vol) {
  Serial.printf("[DFP] set volume %d\n", vol);
}

// ========== STATE FOR AMBIENT GEN ==========
struct LedParams {
  String palette_id = "deep_blue";
  String motion = "flow";
  float intensity = 0.55f;    // 0..1
  float brightness = 0.60f;   // 0..1
  float speed = 0.35f;        // 0..1
  float sparkle = 0.18f;      // 0..1
  float grain = 0.10f;        // 0..1
  float blur = 0.25f;         // 0..1
  uint32_t seed = 12345;
  uint32_t duration_ms = 12000;
};

LedParams gLed;
uint32_t gEffectStartMs = 0;
bool gEffectActive = false;

// touch state
bool gTouching = false;
uint32_t gTouchStartMs = 0;
bool gTouchFired = false;

// Basic palettes
CRGBPalette16 getPaletteById(const String& id) {
  if (id == "deep_blue") return OceanColors_p;
  if (id == "warm") return LavaColors_p;
  if (id == "forest") return ForestColors_p;
  if (id == "party") return PartyColors_p;
  return PartyColors_p;
}

void startAmbient(const LedParams& p) {
  gLed = p;
  gEffectStartMs = millis();
  gEffectActive = true;

  // brightness 0..1 -> 0..255 (cap for safety)
  uint8_t b = (uint8_t)(constrain(gLed.brightness, 0, 1) * 255);
  b = min<uint8_t>(b, BRIGHTNESS_CAP);
  FastLED.setBrightness(b);

  randomSeed(gLed.seed);
}

// A simple 1D ambient generator for a ring (noise + palette)
void renderAmbient() {
  if (!gEffectActive) return;

  uint32_t now = millis();
  if (now - gEffectStartMs > gLed.duration_ms) {
    gEffectActive = false;
    FastLED.clear(true);
    return;
  }

  // speed maps to time scale
  uint16_t t = (uint16_t)(now * (10 + 120 * constrain(gLed.speed, 0, 1)) / 1000);

  CRGBPalette16 pal = getPaletteById(gLed.palette_id);

  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    // 1D-ish noise across ring
    uint8_t n = inoise8(i * 18, t);

    // intensity controls contrast/variation
    float inten = constrain(gLed.intensity, 0, 1);
    uint8_t idx = qadd8((uint8_t)(n * (0.5 + inten)), (uint8_t)(i * 3));

    CRGB c = ColorFromPalette(pal, idx);

    // grain adds subtle flicker/noise
    if (gLed.grain > 0.0f) {
      uint8_t g = random8();
      c.nscale8_video(255 - (uint8_t)(constrain(gLed.grain, 0, 1) * (g & 0x3F)));
    }

    leds[i] = c;
  }

  // sparkle: random white pops
  uint16_t sparkleCount = (uint16_t)(constrain(gLed.sparkle, 0, 1) * 10.0f);
  for (uint16_t k = 0; k < sparkleCount; k++) {
    leds[random16(NUM_LEDS)] += CRGB(30, 30, 30);
  }

  // blur (1D)
  if (gLed.blur > 0.0f) {
    blur1d(leds, NUM_LEDS, (uint8_t)(constrain(gLed.blur, 0, 1) * 80));
  }

  FastLED.show();
}

// ========== JSON HANDLING ==========
void sendAck(int msgId, const char* status, const char* reason = "") {
  StaticJsonDocument<256> doc;
  doc["event"] = "ack";
  doc["msg_id"] = msgId;
  doc["status"] = status;
  if (reason && reason[0]) doc["reason"] = reason;

  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

bool parseApplyResonance(const JsonDocument& doc, LedParams& outLed, int& outTrack, int& outVol, int& outMsgId) {
  if (!doc.containsKey("cmd")) return false;
  if (String((const char*)doc["cmd"]) != "apply_resonance") return false;

  outMsgId = doc["msg_id"] | -1;

  // audio
  outTrack = doc["audio"]["track_id"] | 5;
  outVol   = doc["audio"]["volume"]   | 18;

  // led (new schema)
  outLed.seed        = doc["led"]["seed"]        | 12345;
  outLed.duration_ms = doc["led"]["duration_ms"] | 12000;
  outLed.palette_id  = (const char*)doc["led"]["palette_id"] | "deep_blue";
  outLed.motion      = (const char*)doc["led"]["motion"]     | "flow";
  outLed.intensity   = doc["led"]["intensity"]  | 0.55;
  outLed.brightness  = doc["led"]["brightness"] | 0.60;
  outLed.speed       = doc["led"]["speed"]      | 0.35;
  outLed.sparkle     = doc["led"]["sparkle"]    | 0.18;
  outLed.grain       = doc["led"]["grain"]      | 0.10;
  outLed.blur        = doc["led"]["blur"]       | 0.25;

  return true;
}

// ========== WS EVENTS ==========
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected");
      break;

    case WStype_CONNECTED:
      Serial.println("[WS] Connected");
      webSocket.sendTXT("{\"event\":\"hello\",\"device\":\"lamp\",\"mode\":2}");
      break;

    case WStype_TEXT: {
      String msg = String((char*)payload).substring(0, length);
      Serial.print("[WS] RX: ");
      Serial.println(msg);

      StaticJsonDocument<1536> doc;
      DeserializationError err = deserializeJson(doc, msg);
      if (err) {
        Serial.println("[JSON] parse error");
        return;
      }

      LedParams lp;
      int trackId = 5, vol = 18, msgId = -1;
      if (parseApplyResonance(doc, lp, trackId, vol, msgId)) {
        dfplayerSetVolume(vol);
        dfplayerPlayTrack(trackId);
        startAmbient(lp);
        sendAck(msgId, "ok");
      }

      break;
    }

    default:
      break;
  }
}

// ========== UPSTREAM EVENT ==========
void sendResonanceRequest(uint32_t heldMs) {
  StaticJsonDocument<256> req;
  req["event"] = "resonance_request";
  req["mode"] = "resonance";
  req["region"] = 2;
  req["duration_ms"] = heldMs;
  req["ts"] = (uint32_t)(millis() / 1000);

  String out;
  serializeJson(req, out);
  webSocket.sendTXT(out);
  Serial.printf("[WS] Sent resonance_request (held=%lums)\n", (unsigned long)heldMs);
}

// ========== TOUCH LOOP ==========
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
      sendResonanceRequest(held);
      gTouchFired = true;
    } else if (held > TOUCH_MAX_MS) {
      // After max window, do nothing (prevents late firing)
      gTouchFired = true;
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  // LED init
  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_LEDS);
  FastLED.clear(true);
  FastLED.setBrightness(min(128, BRIGHTNESS_CAP));
  FastLED.show();

  // Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("Connecting WiFi: %s\n", WIFI_SSID);

  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi connected, IP=");
  Serial.println(WiFi.localIP());

  // WebSocket
  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(2000);

  Serial.println("[TOUCH] Tip: print touchRead(GPIO4) raw values to tune TOUCH_THRESHOLD.");
  Serial.printf("[TOUCH] Current TOUCH_THRESHOLD=%d\n", TOUCH_THRESHOLD);
}

void loop() {
  webSocket.loop();
  renderAmbient();
  updateTouchTrigger();
}
