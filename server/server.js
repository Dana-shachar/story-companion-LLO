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

// read resonace+ add msg_id/seed
import fs from "fs";

function loadPreset(path) {
  const raw = fs.readFileSync(path, "utf-8");
  return JSON.parse(raw);
}

function buildApplyResonanceFromFile() {
  const out = loadPreset("./presets/apply_resonance_deep_blue.json");
  out.cmd = "apply_resonance";
  out.msg_id = nextMsgId++;
  out.led.seed = Math.floor(Math.random() * 1000000);
  return out;
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