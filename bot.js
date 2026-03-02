const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  jidDecode,
  proto,
  getAggregateVotesInPollMessage,
  makeWALegacySocket
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const jimp = require("jimp");
const cron = require("node-cron");
const { Server } = require("socket.io");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  PREFIX: ".",
  BOT_NAME: "Sinhala WhatsApp Bot",
  BOT_NUMBER: process.env.BOT_NUMBER || "",
  OWNER_NUMBER: process.env.OWNER_NUMBER || "",
  SESSION_DIR: "./session",
  AUTO_SEEN: false,
  AUTO_REPLY_STATUS: false,
  AUTO_LIKE_STATUS: false,
  AUTO_LIKE_EMOJI: "❤️",
  ALWAYS_ONLINE: false,
  AUTO_TYPING: false,
  STATUS_SAVE: false,
  OTP: "",
};

// Store for runtime settings
let botSettings = { ...CONFIG };
let io = null; // Will be set from server.js

// ─── HELPER: Send message to owner ────────────────────────────────────────────
async function sendToOwner(sock, text, media = null) {
  const jid = botSettings.OWNER_NUMBER + "@s.whatsapp.net";
  if (media) {
    await sock.sendMessage(jid, media);
  } else {
    await sock.sendMessage(jid, { text });
  }
}

// ─── HELPER: Get JID ──────────────────────────────────────────────────────────
function getJid(number) {
  return number.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
}

// ─── IMAGE EDIT COMMANDS ──────────────────────────────────────────────────────
async function editImage(sock, msg, from, args) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  let imageBuffer = null;

  if (quoted?.imageMessage) {
    imageBuffer = await sock.downloadMediaMessage({ message: quoted });
  } else {
    await sock.sendMessage(from, { text: "📸 Image එකක් mention කරලා command දාන්න!" });
    return;
  }

  const action = args[0]?.toLowerCase();
  let image = await jimp.read(imageBuffer);

  switch (action) {
    case "blur": image.blur(parseInt(args[1]) || 5); break;
    case "grayscale": image.grayscale(); break;
    case "invert": image.invert(); break;
    case "flip": image.flip(true, false); break;
    case "rotate": image.rotate(parseInt(args[1]) || 90); break;
    case "brightness": image.brightness(parseFloat(args[1]) || 0.5); break;
    case "contrast": image.contrast(parseFloat(args[1]) || 0.5); break;
    case "sepia": image.sepia(); break;
    case "pixelate": image.pixelate(parseInt(args[1]) || 10); break;
    case "circle":
      image.resize(512, 512);
      // Apply circle mask
      image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
        const cx = image.bitmap.width / 2;
        const cy = image.bitmap.height / 2;
        const r = Math.min(cx, cy);
        if (Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) > r) {
          this.bitmap.data[idx + 3] = 0;
        }
      });
      break;
    default:
      await sock.sendMessage(from, {
        text: `🖼️ *Image Edit Commands:*\n\n` +
          `${botSettings.PREFIX}img blur [amount]\n` +
          `${botSettings.PREFIX}img grayscale\n` +
          `${botSettings.PREFIX}img invert\n` +
          `${botSettings.PREFIX}img flip\n` +
          `${botSettings.PREFIX}img rotate [degrees]\n` +
          `${botSettings.PREFIX}img brightness [0-1]\n` +
          `${botSettings.PREFIX}img contrast [0-1]\n` +
          `${botSettings.PREFIX}img sepia\n` +
          `${botSettings.PREFIX}img pixelate [size]\n` +
          `${botSettings.PREFIX}img circle`
      });
      return;
  }

  const buffer = await image.getBufferAsync(jimp.MIME_JPEG);
  await sock.sendMessage(from, { image: buffer, caption: `✅ Image edited: *${action}*` });
}

// ─── COMMANDS ─────────────────────────────────────────────────────────────────
async function handleCommand(sock, msg, from, body) {
  const prefix = botSettings.PREFIX;
  if (!body.startsWith(prefix)) return;

  const args = body.slice(prefix.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  // Emit to panel
  if (io) io.emit("command_used", { cmd, from, time: new Date().toISOString() });

  switch (cmd) {

    // ── HELP ──
    case "help":
    case "menu":
      await sock.sendMessage(from, {
        text: `╔══════════════════════╗
║  🤖 *${botSettings.BOT_NAME}*  ║
╚══════════════════════╝

📋 *GENERAL COMMANDS*
├ ${prefix}help - මෙනු
├ ${prefix}ping - Bot check
├ ${prefix}info - Bot info
└ ${prefix}speed - Ping speed

🖼️ *IMAGE COMMANDS*
├ ${prefix}img blur [amount]
├ ${prefix}img grayscale
├ ${prefix}img invert
├ ${prefix}img flip
├ ${prefix}img rotate [deg]
├ ${prefix}img brightness
├ ${prefix}img contrast
├ ${prefix}img sepia
├ ${prefix}img pixelate
└ ${prefix}img circle

📊 *STATUS COMMANDS*
├ ${prefix}autoseen [on/off]
├ ${prefix}autoreply [on/off]
├ ${prefix}autolike [on/off]
├ ${prefix}likeemoji [emoji]
└ ${prefix}save (status mention)

⚙️ *BOT SETTINGS*
├ ${prefix}online [on/off]
├ ${prefix}typing [on/off]
├ ${prefix}setprefix [char]
└ ${prefix}restart

👑 *OWNER ONLY*
├ ${prefix}broadcast [msg]
└ ${prefix}settings

_Powered by ${botSettings.BOT_NAME}_`
      });
      break;

    // ── PING ──
    case "ping":
      const start = Date.now();
      await sock.sendMessage(from, { text: "🏓 Pong!" });
      await sock.sendMessage(from, { text: `⚡ Speed: *${Date.now() - start}ms*` });
      break;

    // ── INFO ──
    case "info":
      await sock.sendMessage(from, {
        text: `🤖 *Bot Info*\n\n` +
          `📛 Name: ${botSettings.BOT_NAME}\n` +
          `👑 Owner: ${botSettings.OWNER_NUMBER}\n` +
          `🔤 Prefix: ${prefix}\n` +
          `👁 Auto Seen: ${botSettings.AUTO_SEEN ? "✅" : "❌"}\n` +
          `💬 Auto Reply Status: ${botSettings.AUTO_REPLY_STATUS ? "✅" : "❌"}\n` +
          `❤️ Auto Like Status: ${botSettings.AUTO_LIKE_STATUS ? "✅" : "❌"}\n` +
          `🟢 Always Online: ${botSettings.ALWAYS_ONLINE ? "✅" : "❌"}\n` +
          `⌨️ Auto Typing: ${botSettings.AUTO_TYPING ? "✅" : "❌"}`
      });
      break;

    // ── IMAGE EDIT ──
    case "img":
    case "image":
      await editImage(sock, msg, from, args);
      break;

    // ── AUTO SEEN ──
    case "autoseen":
      botSettings.AUTO_SEEN = args[0] === "on";
      if (io) io.emit("settings_update", botSettings);
      await sock.sendMessage(from, {
        text: `👁 Auto Seen: ${botSettings.AUTO_SEEN ? "✅ ON" : "❌ OFF"}`
      });
      break;

    // ── AUTO REPLY STATUS ──
    case "autoreply":
      botSettings.AUTO_REPLY_STATUS = args[0] === "on";
      if (io) io.emit("settings_update", botSettings);
      await sock.sendMessage(from, {
        text: `💬 Auto Reply Status: ${botSettings.AUTO_REPLY_STATUS ? "✅ ON" : "❌ OFF"}`
      });
      break;

    // ── AUTO LIKE STATUS ──
    case "autolike":
      botSettings.AUTO_LIKE_STATUS = args[0] === "on";
      if (io) io.emit("settings_update", botSettings);
      await sock.sendMessage(from, {
        text: `❤️ Auto Like Status: ${botSettings.AUTO_LIKE_STATUS ? "✅ ON" : "❌ OFF"}`
      });
      break;

    // ── LIKE EMOJI ──
    case "likeemoji":
      if (args[0]) {
        botSettings.AUTO_LIKE_EMOJI = args[0];
        if (io) io.emit("settings_update", botSettings);
        await sock.sendMessage(from, { text: `✅ Like Emoji set to: ${args[0]}` });
      }
      break;

    // ── ALWAYS ONLINE ──
    case "online":
      botSettings.ALWAYS_ONLINE = args[0] === "on";
      if (botSettings.ALWAYS_ONLINE) {
        await sock.sendPresenceUpdate("available");
      } else {
        await sock.sendPresenceUpdate("unavailable");
      }
      if (io) io.emit("settings_update", botSettings);
      await sock.sendMessage(from, {
        text: `🟢 Always Online: ${botSettings.ALWAYS_ONLINE ? "✅ ON" : "❌ OFF"}`
      });
      break;

    // ── AUTO TYPING ──
    case "typing":
      botSettings.AUTO_TYPING = args[0] === "on";
      if (io) io.emit("settings_update", botSettings);
      await sock.sendMessage(from, {
        text: `⌨️ Auto Typing: ${botSettings.AUTO_TYPING ? "✅ ON" : "❌ OFF"}`
      });
      break;

    // ── STATUS SAVE ──
    case "save":
      botSettings.STATUS_SAVE = !botSettings.STATUS_SAVE;
      if (io) io.emit("settings_update", botSettings);
      await sock.sendMessage(from, {
        text: `💾 Status Save: ${botSettings.STATUS_SAVE ? "✅ ON" : "❌ OFF"}`
      });
      break;

    // ── SET PREFIX ──
    case "setprefix":
      if (args[0]) {
        botSettings.PREFIX = args[0];
        if (io) io.emit("settings_update", botSettings);
        await sock.sendMessage(from, { text: `✅ Prefix changed to: *${args[0]}*` });
      }
      break;

    // ── BROADCAST (owner only) ──
    case "broadcast":
      if (from !== getJid(botSettings.OWNER_NUMBER)) {
        await sock.sendMessage(from, { text: "❌ Owner only command!" });
        return;
      }
      const text = args.join(" ");
      const groups = await sock.groupFetchAllParticipating();
      let count = 0;
      for (const gid of Object.keys(groups)) {
        try {
          await sock.sendMessage(gid, { text });
          count++;
          await new Promise(r => setTimeout(r, 1000));
        } catch (e) {}
      }
      await sock.sendMessage(from, { text: `✅ Broadcast sent to ${count} groups!` });
      break;

    // ── SETTINGS ──
    case "settings":
      await sock.sendMessage(from, {
        text: `⚙️ *Current Settings:*\n\n${JSON.stringify(botSettings, null, 2)}`
      });
      break;

    default:
      // Unknown command - silently ignore or optionally reply
      break;
  }
}

// ─── MAIN BOT FUNCTION ────────────────────────────────────────────────────────
async function startBot(socketIO = null) {
  io = socketIO;

  if (!fs.existsSync(botSettings.SESSION_DIR)) {
    fs.mkdirSync(botSettings.SESSION_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(botSettings.SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    markOnlineOnConnect: botSettings.ALWAYS_ONLINE,
  });

  // Save credentials on update
  sock.ev.on("creds.update", saveCreds);

  // ── CONNECTION ──
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr, pairingCode } = update;

    if (qr && io) {
      io.emit("qr", qr);
    }

    if (connection === "open") {
      console.log("✅ Bot connected!");
      if (io) io.emit("connected", { number: botSettings.BOT_NUMBER });

      // Send welcome message + OTP to owner
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      botSettings.OTP = otp;
      if (io) io.emit("otp", otp);

      await sendToOwner(sock,
        `╔══════════════════════╗\n` +
        `║  🤖 Bot Connected! ✅  ║\n` +
        `╚══════════════════════╝\n\n` +
        `📱 Number: ${botSettings.BOT_NUMBER}\n` +
        `🕐 Time: ${new Date().toLocaleString()}\n` +
        `🔐 Panel OTP: *${otp}*\n\n` +
        `_Panel Login: http://localhost:3000_`
      );
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
          : true;
      if (io) io.emit("disconnected");
      if (shouldReconnect) {
        console.log("🔄 Reconnecting...");
        setTimeout(() => startBot(io), 3000);
      }
    }
  });

  // ── MESSAGES ──
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message) continue;
      const from = msg.key.remoteJid;
      const isStatus = from === "status@broadcast";
      const pushName = msg.pushName || "User";
      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        "";

      // ── AUTO SEEN ──
      if (botSettings.AUTO_SEEN && !msg.key.fromMe) {
        await sock.readMessages([msg.key]);
      }

      // ── STATUS HANDLING ──
      if (isStatus) {
        // Auto seen status
        if (botSettings.AUTO_SEEN) {
          await sock.readMessages([msg.key]);
        }

        // Auto like status
        if (botSettings.AUTO_LIKE_STATUS) {
          await sock.sendMessage(from, {
            react: { text: botSettings.AUTO_LIKE_EMOJI, key: msg.key }
          });
        }

        // Auto reply status
        if (botSettings.AUTO_REPLY_STATUS) {
          const sender = msg.key.participant;
          await sock.sendMessage(sender, {
            text: `👀 ඔයාගේ status එක දැක්කා! ${botSettings.AUTO_LIKE_EMOJI}`
          });
        }

        // Status save
        if (botSettings.STATUS_SAVE) {
          const imgMsg = msg.message?.imageMessage;
          const vidMsg = msg.message?.videoMessage;
          if (imgMsg) {
            const buffer = await sock.downloadMediaMessage(msg);
            await sendToOwner(sock, null, { image: buffer, caption: `💾 Status saved from @${msg.key.participant?.split("@")[0]}` });
          } else if (vidMsg) {
            const buffer = await sock.downloadMediaMessage(msg);
            await sendToOwner(sock, null, { video: buffer, caption: `💾 Status video saved from @${msg.key.participant?.split("@")[0]}` });
          }
        }
        continue;
      }

      // ── AUTO TYPING ──
      if (botSettings.AUTO_TYPING && !msg.key.fromMe) {
        await sock.sendPresenceUpdate("composing", from);
        setTimeout(() => sock.sendPresenceUpdate("paused", from), 2000);
      }

      // ── ALWAYS ONLINE ──
      if (botSettings.ALWAYS_ONLINE) {
        await sock.sendPresenceUpdate("available");
      }

      // ── HI AUTO GREET ──
      if (!msg.key.fromMe && body.toLowerCase().trim() === "hi") {
        const greetVoiceText = `🎙️ *Voice Note Style Greeting*\n\n` +
          `ආයුබෝවන් ${pushName}! 👋\n\n` +
          `මම ${botSettings.BOT_NAME}. ඔයාගේ නම, ගම, වයස save කරගන්න ඕනෙනම් කියන්නකෝ! 😊\n\n` +
          `ඔයාගේ info save කරන්නද?\n` +
          `Reply කරන්න: *.save [නම] [වයස] [ගම]*\n` +
          `Example: .save Kamal 25 Colombo`;
        await sock.sendMessage(from, { text: greetVoiceText });
      }

      // ── SAVE USER INFO ──
      if (!msg.key.fromMe && body.toLowerCase().startsWith(".save ") && !body.startsWith(".save") + "status") {
        const parts = body.split(" ").slice(1);
        if (parts.length >= 1) {
          const userInfo = {
            number: from,
            name: parts[0] || "Unknown",
            age: parts[1] || "Unknown",
            city: parts[2] || "Unknown",
            savedAt: new Date().toISOString()
          };
          const users = JSON.parse(fs.readFileSync("./users.json", "utf8").catch ? "[]" : fs.existsSync("./users.json") ? fs.readFileSync("./users.json", "utf8") : "[]");
          users.push(userInfo);
          fs.writeFileSync("./users.json", JSON.stringify(users, null, 2));
          if (io) io.emit("user_saved", userInfo);
          await sock.sendMessage(from, {
            text: `✅ Info Save වුණා!\n\n👤 Name: ${userInfo.name}\n🎂 Age: ${userInfo.age}\n🏙️ City: ${userInfo.city}`
          });
        }
      }

      // ── COMMANDS ──
      if (body.startsWith(botSettings.PREFIX)) {
        await handleCommand(sock, msg, from, body);
      }
    }
  });

  // Generate pair code if number set
  if (botSettings.BOT_NUMBER && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(
          botSettings.BOT_NUMBER.replace(/[^0-9]/g, "")
        );
        console.log(`📱 Pair Code: ${code}`);
        if (io) io.emit("pair_code", code);
      } catch (e) {
        console.error("Pair code error:", e.message);
      }
    }, 3000);
  }

  return sock;
}

module.exports = { startBot, botSettings };
