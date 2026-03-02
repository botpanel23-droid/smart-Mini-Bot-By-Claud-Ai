import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
} from "@whiskeysockets/baileys";
import pino from "pino";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ====== BOT STATE ======
let sock = null;
let botState = "disconnected"; // disconnected | pairing | connected
let pairCode = null;
let phoneNumber = null;

const settings = {
  autoReply: false,
  autoReplyMsg: "Hi! I'm a bot. I'll get back to you soon. 🤖",
  antiLink: false,
  antiLinkMsg: "⚠️ Links are not allowed here!",
  welcomeMsg: false,
  welcomeText: "👋 Welcome to the group!",
  farewell: false,
  farewellText: "👋 Goodbye! We'll miss you.",
  spamProtect: false,
  readReceipts: false,
  botPrefix: "!",
  ownerNumber: "",
};

const logs = [];
const addLog = (type, msg) => {
  const entry = { type, msg, time: new Date().toLocaleTimeString() };
  logs.unshift(entry);
  if (logs.length > 100) logs.pop();
  io.emit("log", entry);
};

const stats = { msgReceived: 0, msgSent: 0, commandsRun: 0, uptime: null };

// ====== COMMANDS ======
const commands = {
  ping: async (sock, msg, from) => {
    await sock.sendMessage(from, { text: "🏓 Pong! Bot is alive!" });
    stats.msgSent++;
  },
  info: async (sock, msg, from) => {
    const text = `🤖 *Bot Info*\n\n📊 Messages Received: ${stats.msgReceived}\n📤 Messages Sent: ${stats.msgSent}\n⚡ Commands Run: ${stats.commandsRun}\n🕒 Started: ${stats.uptime}`;
    await sock.sendMessage(from, { text });
    stats.msgSent++;
  },
  help: async (sock, msg, from) => {
    const text = `📋 *Available Commands*\n\n${settings.botPrefix}ping - Check bot status\n${settings.botPrefix}info - Bot statistics\n${settings.botPrefix}help - This menu\n${settings.botPrefix}sticker - Convert image to sticker\n${settings.botPrefix}say [text] - Bot repeats text\n${settings.botPrefix}time - Current time\n${settings.botPrefix}joke - Random joke`;
    await sock.sendMessage(from, { text });
    stats.msgSent++;
  },
  say: async (sock, msg, from, args) => {
    const text = args.join(" ") || "You didn't say anything!";
    await sock.sendMessage(from, { text: `🗣️ ${text}` });
    stats.msgSent++;
  },
  time: async (sock, msg, from) => {
    await sock.sendMessage(from, {
      text: `🕒 Current time: ${new Date().toLocaleString()}`,
    });
    stats.msgSent++;
  },
  joke: async (sock, msg, from) => {
    const jokes = [
      "Why don't scientists trust atoms? Because they make up everything! 😂",
      "I told my wife she was drawing her eyebrows too high. She looked surprised! 😄",
      "Why do programmers prefer dark mode? Because light attracts bugs! 🐛",
      "What do you call a fake noodle? An impasta! 🍝",
      "Why did the scarecrow win an award? He was outstanding in his field! 🌾",
    ];
    const joke = jokes[Math.floor(Math.random() * jokes.length)];
    await sock.sendMessage(from, { text: `😂 ${joke}` });
    stats.msgSent++;
  },
};

// ====== CONNECT FUNCTION ======
async function connectBot(phone) {
  phoneNumber = phone;
  botState = "pairing";
  io.emit("status", { state: botState, phone });

  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    printQRInTerminal: false,
    mobile: false,
  });

  // Request pair code
  if (!sock.authState.creds.registered) {
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(cleanPhone);
        pairCode = code;
        addLog("success", `Pair code generated: ${code}`);
        io.emit("pairCode", { code });
      } catch (e) {
        addLog("error", `Pair code error: ${e.message}`);
      }
    }, 3000);
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      botState = "connected";
      stats.uptime = new Date().toLocaleString();
      pairCode = null;
      addLog("success", "✅ Bot connected successfully!");
      io.emit("status", { state: botState, phone });
    } else if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      botState = "disconnected";
      addLog("error", `Connection closed (${code}). Reconnecting: ${shouldReconnect}`);
      io.emit("status", { state: botState });
      if (shouldReconnect) {
        setTimeout(() => connectBot(phoneNumber), 5000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      stats.msgReceived++;
      const from = msg.key.remoteJid;
      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";

      addLog("info", `📨 Message from ${from.split("@")[0]}: ${body}`);
      io.emit("stats", stats);

      // Anti-Link
      if (settings.antiLink && body.match(/https?:\/\/[^\s]+/gi)) {
        await sock.sendMessage(from, { text: settings.antiLinkMsg });
        addLog("warn", `🔗 Anti-link triggered in ${from}`);
        continue;
      }

      // Auto Reply
      if (settings.autoReply && body && !body.startsWith(settings.botPrefix)) {
        await sock.sendMessage(from, { text: settings.autoReplyMsg });
        stats.msgSent++;
        io.emit("stats", stats);
        continue;
      }

      // Commands
      if (body.startsWith(settings.botPrefix)) {
        const [cmd, ...args] = body.slice(settings.botPrefix.length).trim().split(" ");
        const command = commands[cmd.toLowerCase()];
        if (command) {
          stats.commandsRun++;
          addLog("success", `⚡ Command: ${cmd} from ${from.split("@")[0]}`);
          await command(sock, msg, from, args);
          io.emit("stats", stats);
        } else {
          await sock.sendMessage(from, {
            text: `❓ Unknown command. Type ${settings.botPrefix}help for commands.`,
          });
        }
      }
    }
  });

  // Group events
  sock.ev.on("group-participants.update", async ({ id, participants, action }) => {
    if (action === "add" && settings.welcomeMsg) {
      for (const p of participants) {
        await sock.sendMessage(id, {
          text: `${settings.welcomeText}\n@${p.split("@")[0]}`,
          mentions: [p],
        });
      }
    }
    if (action === "remove" && settings.farewell) {
      for (const p of participants) {
        await sock.sendMessage(id, {
          text: `${settings.farewellText}\n@${p.split("@")[0]}`,
          mentions: [p],
        });
      }
    }
  });
}

// ====== API ROUTES ======
app.post("/api/connect", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone required" });
  if (botState === "connected") return res.json({ success: true, state: "already_connected" });

  try {
    await connectBot(phone);
    res.json({ success: true, message: "Pairing started" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/disconnect", async (req, res) => {
  if (sock) {
    await sock.logout();
    sock = null;
    botState = "disconnected";
    pairCode = null;
    fs.rmSync("./auth_info", { recursive: true, force: true });
    io.emit("status", { state: botState });
    addLog("warn", "Bot disconnected and logged out.");
  }
  res.json({ success: true });
});

app.get("/api/status", (req, res) => {
  res.json({ state: botState, phone: phoneNumber, pairCode, stats });
});

app.get("/api/settings", (req, res) => res.json(settings));

app.post("/api/settings", (req, res) => {
  Object.assign(settings, req.body);
  addLog("info", "⚙️ Settings updated");
  io.emit("settingsUpdated", settings);
  res.json({ success: true, settings });
});

app.get("/api/logs", (req, res) => res.json(logs));

app.post("/api/send", async (req, res) => {
  if (botState !== "connected") return res.status(400).json({ error: "Bot not connected" });
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: "to and message required" });
  try {
    const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    stats.msgSent++;
    addLog("success", `📤 Message sent to ${to}`);
    io.emit("stats", stats);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ====== SOCKET.IO ======
io.on("connection", (socket) => {
  socket.emit("status", { state: botState, phone: phoneNumber, pairCode });
  socket.emit("settings", settings);
  socket.emit("stats", stats);
  socket.emit("allLogs", logs);
});

// ====== START SERVER ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🤖 WA Bot Panel running at http://localhost:${PORT}\n`);
  addLog("info", `Server started on port ${PORT}`);
});
