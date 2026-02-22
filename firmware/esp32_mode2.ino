#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <FastLED.h>

// ========== Wi-Fi / WS CONFIG ==========
const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASS";

// 电脑 IP：先写死，后续可以做 mDNS（lamp.local）
// 运行 server.js 的电脑在同一 Wi-Fi 下
const char* WS_HOST = "192.168.1.100";  // TODO: 改成你电脑局域网 IP
const uint16_t WS_PORT = 8080;
const char* WS_PATH = "/";

WebSocketsClient webSocket;

// ========== LED CONFIG (8x32) ==========
#define LED_PIN 23          // TODO: 你可随便改
#define LED_WIDTH 32
#define LED_HEIGHT 8
#define NUM_LEDS (LED_WIDTH * LED_HEIGHT)

CRGB leds[NUM_LEDS];

// 你是 8x32 长条矩阵：常见是蛇形走线。这里给一个最通用映射（可后续再校正）
uint16_t XY(uint8_t x, uint8_t y) {
  // y: 0..7, x: 0..31
  // serpentine: even rows left->right, odd rows right->left
  if (y % 2 == 0) return y * LED_WIDTH + x;
  return y * LED_WIDTH + (LED_WIDTH - 1 - x);
}

// ========== DFPlayer STUB ==========
void dfplayerPlayTrack(int trackId) {
  // TODO: 接 DFPlayer 后改成真正串口指令
  Serial.printf("[DFP] play track %d\n", trackId);
}
void dfplayerSetVolume(int vol) {
  Serial.printf("[DFP] set volume %d\n", vol);
}

// ========== STATE FOR AMBIENT GEN ==========
struct LedParams {
  String palette_id = "deep_blue";
  String motion = "flow";
  float intensity = 0.5f;     // 0..1
  float brightness = 0.6f;    // 0..1
  float speed = 0.35f;        // 0..1
  float sparkle = 0.15f;      // 0..1
  float grain = 0.10f;        // 0..1
  float blur = 0.20f;         // 0..1
  uint32_t seed = 12345;
  uint32_t duration_ms = 12000;
};

LedParams gLed;
uint32_t gEffectStartMs = 0;
bool gEffectActive = false;

// Basic palettes
CRGBPalette16 getPaletteById(const String& id) {
  if (id == "deep_blue") return OceanColors_p;
  if (id == "warm") return LavaColors_p;
  if (id == "forest") return ForestColors_p;
  return PartyColors_p;
}

void startAmbient(const LedParams& p) {
  gLed = p;
  gEffectStartMs = millis();
  gEffectActive = true;

  // brightness 0..1 -> 0..255
  FastLED.setBrightness((uint8_t)(constrain(gLed.brightness, 0, 1) * 255));
  randomSeed(gLed.seed);
}

// A simple ambient generator (flow-ish) using noise + palette
void renderAmbient() {
  if (!gEffectActive) return;

  uint32_t now = millis();
  if (now - gEffectStartMs > gLed.duration_ms) {
    gEffectActive = false;
    return;
  }

  // speed maps to time scale
  uint16_t t = (uint16_t)(now * (10 + 120 * constrain(gLed.speed, 0, 1)) / 1000);

  CRGBPalette16 pal = getPaletteById(gLed.palette_id);

  // noise field
  for (uint8_t y = 0; y < LED_HEIGHT; y++) {
    for (uint8_t x = 0; x < LED_WIDTH; x++) {
      uint8_t n = inoise8(x * 18, y * 28, t);
      // intensity controls contrast
      uint8_t idx = qadd8((uint8_t)(n * (0.5 + constrain(gLed.intensity, 0, 1))), (uint8_t)(y * 6));
      CRGB c = ColorFromPalette(pal, idx);

      // grain adds subtle noise
      if (gLed.grain > 0.0f) {
        uint8_t g = random8();
        c.nscale8_video(255 - (uint8_t)(gLed.grain * (g & 0x3F)));
      }

      leds[XY(x, y)] = c;
    }
  }

  // sparkle: random white pops
  uint16_t sparkleCount = (uint16_t)(gLed.sparkle * 20);
  for (uint16_t i = 0; i < sparkleCount; i++) {
    uint8_t x = random8(LED_WIDTH);
    uint8_t y = random8(LED_HEIGHT);
    leds[XY(x, y)] += CRGB(30, 30, 30);
  }

  // blur (simple)
  if (gLed.blur > 0.0f) {
    blur2d(leds, LED_WIDTH, LED_HEIGHT, (uint8_t)(gLed.blur * 80));
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
  outVol = doc["audio"]["volume"] | 18;

  // led
  outLed.seed = doc["led"]["seed"] | 12345;
  outLed.duration_ms = doc["led"]["duration_ms"] | 12000;
  outLed.palette_id = (const char*)doc["led"]["palette_id"] | "deep_blue";
  outLed.motion = (const char*)doc["led"]["motion"] | "flow";
  outLed.intensity = doc["led"]["intensity"] | 0.55;
  outLed.brightness = doc["led"]["brightness"] | 0.6;
  outLed.speed = doc["led"]["speed"] | 0.35;
  outLed.sparkle = doc["led"]["sparkle"] | 0.18;
  outLed.grain = doc["led"]["grain"] | 0.10;
  outLed.blur = doc["led"]["blur"] | 0.25;

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
      // 上来就可以主动发一次“hello”（可选）
      webSocket.sendTXT("{\"event\":\"hello\",\"device\":\"lamp\"}");
      break;
    case WStype_TEXT: {
      String msg = String((char*)payload).substring(0, length);
      Serial.print("[WS] RX: ");
      Serial.println(msg);

      StaticJsonDocument<1024> doc;
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

// ========== TRIGGER (TEMP) ==========
#define BTN_PIN 0 // ESP32 dev boards often have BOOT on GPIO0; you can rewire later
bool lastBtn = true;
uint32_t lastDebounce = 0;

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(BTN_PIN, INPUT_PULLUP);

  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_LEDS);
  FastLED.clear(true);
  FastLED.setBrightness(128);

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

  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(2000);
}

void loop() {
  webSocket.loop();

  // Render effect continuously
  renderAmbient();

  // TEMP trigger: press BOOT button to request resonance
  bool btn = digitalRead(BTN_PIN);
  if (btn != lastBtn && millis() - lastDebounce > 40) {
    lastDebounce = millis();
    lastBtn = btn;

    if (btn == LOW) {
      // Send resonance_request upstream
      StaticJsonDocument<256> req;
      req["event"] = "resonance_request";
      req["mode"] = "resonance";
      req["region"] = 2;
      req["duration_ms"] = 980;
      req["ts"] = (uint32_t)(millis() / 1000);

      String out;
      serializeJson(req, out);
      webSocket.sendTXT(out);
      Serial.println("[WS] Sent resonance_request");
    }
  }
}