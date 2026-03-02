const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── STATE ────────────────────────────────────────────────────────────────────
let botSocket = null;
let isConnected = false;
let currentSettings = {};
let currentOTP = "";
let pairCode = "";
let commandLog = [];
let connectedNumber = "";
let sessions = {}; // { number: { otp, authenticated } }

// ─── BOT STARTER ──────────────────────────────────────────────────────────────
const { startBot, botSettings } = require("./bot");

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("🌐 Panel connected");

  // Send current state
  socket.emit("state", {
    connected: isConnected,
    settings: currentSettings,
    pairCode,
    commandLog: commandLog.slice(-50),
    connectedNumber,
  });

  // ── LOGIN ──
  socket.on("login", ({ number, otp }) => {
    const session = sessions[number];
    if (session && session.otp === otp) {
      session.authenticated = true;
      socket.emit("login_success", { number });
    } else {
      socket.emit("login_fail", { message: "Wrong number or OTP!" });
    }
  });

  // ── START BOT ──
  socket.on("start_bot", async ({ number }) => {
    if (isConnected) {
      socket.emit("error", { message: "Bot already connected!" });
      return;
    }
    botSettings.BOT_NUMBER = number;
    botSettings.OWNER_NUMBER = number;
    sessions[number] = { otp: "", authenticated: false };
    connectedNumber = number;
    try {
      await startBot(io);
    } catch (e) {
      socket.emit("error", { message: e.message });
    }
  });

  // ── TOGGLE SETTINGS ──
  socket.on("update_setting", ({ key, value }) => {
    if (botSettings.hasOwnProperty(key)) {
      botSettings[key] = value;
      currentSettings[key] = value;
      io.emit("settings_update", botSettings);
    }
  });
});

// ─── BOT EVENTS → PANEL ───────────────────────────────────────────────────────
// These are emitted from bot.js via io object passed to startBot

// Listen for events from bot and forward to all panel clients
const originalEmit = io.emit.bind(io);
io.emit = function (event, ...args) {
  if (event === "connected") {
    isConnected = true;
    connectedNumber = args[0]?.number || connectedNumber;
  }
  if (event === "disconnected") isConnected = false;
  if (event === "settings_update") currentSettings = args[0];
  if (event === "pair_code") pairCode = args[0];
  if (event === "otp") {
    currentOTP = args[0];
    if (sessions[connectedNumber]) {
      sessions[connectedNumber].otp = args[0];
    }
  }
  if (event === "command_used") {
    commandLog.push(args[0]);
    if (commandLog.length > 100) commandLog.shift();
  }
  return originalEmit(event, ...args);
};

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  res.json({
    connected: isConnected,
    number: connectedNumber,
    pairCode,
    settings: currentSettings,
  });
});

app.get("/api/users", (req, res) => {
  try {
    const users = JSON.parse(fs.readFileSync("./users.json", "utf8"));
    res.json(users);
  } catch {
    res.json([]);
  }
});

app.get("/api/logs", (req, res) => {
  res.json(commandLog.slice(-50));
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌐 Panel running at http://localhost:${PORT}`);
});
