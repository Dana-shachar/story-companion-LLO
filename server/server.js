cd server
npm init -y
npm i ws
node server.js

// server/server.js
import { WebSocketServer } from "ws";

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

console.log(`WS server listening on ws://localhost:${PORT}`);

let nextMsgId = 1;

// Mode2 test json：add LLM mapping later
function buildApplyResonance() {
  return {
    cmd: "apply_resonance",
    msg_id: nextMsgId++,
    mode: "resonance",
    led: {
      engine: "ambient_gen",
      seed: Math.floor(Math.random() * 1000000),
      duration_ms: 12000,
      palette_id: "deep_blue",
      motion: "flow",
      intensity: 0.55,
      brightness: 0.60,
      speed: 0.35,
      sparkle: 0.18,
      grain: 0.10,
      blur: 0.25,
    },
    audio: {
      action: "play",
      track_id: 5,
      volume: 18,
      fade_ms: 0,
    },
  };
}

wss.on("connection", (ws, req) => {
  console.log("Client connected:", req.socket.remoteAddress);

  ws.on("message", (data) => {
    const msgText = data.toString();
    console.log("RX:", msgText);

    let msg;
    try {
      msg = JSON.parse(msgText);
    } catch (e) {
      console.log("Not JSON, ignore.");
      return;
    }

    // ESP32 上行：resonance_request
    if (msg.event === "resonance_request") {
      const out = buildApplyResonance();
      ws.send(JSON.stringify(out));
      console.log("TX apply_resonance:", out.msg_id);
    }

    // ESP32 ACK（for debug）
    if (msg.event === "ack") {
      console.log("ACK:", msg.msg_id, msg.status || "");
    }
  });

  ws.on("close", () => console.log("Client disconnected"));
});