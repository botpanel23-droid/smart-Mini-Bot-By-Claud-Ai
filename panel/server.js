const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const simpleGit = require('simple-git');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const AUTH_DIR = '../auth_info';
const CONFIG_FILE = '../src/config.js';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'wabot-panel-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ── Auth Middleware ──────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.redirect('/login');
}

// ── Routes ──────────────────────────────────────────────
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/connect', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public/connect.html')));

app.post('/api/login', (req, res) => {
  const { number, otp } = req.body;
  try {
    const otpData = fs.readJsonSync(`${AUTH_DIR}/otp.json`);
    const status = fs.readJsonSync(`${AUTH_DIR}/pairing_status.json`);
    const botNum = status.number?.replace(/[^0-9]/g, '');
    const inputNum = number?.replace(/[^0-9]/g, '');
    const isOtpValid = otpData.otp === otp && (Date.now() - otpData.time) < 10 * 60 * 1000; // 10 min
    const isNumValid = botNum && inputNum && (botNum.includes(inputNum) || inputNum.includes(botNum));

    if (isOtpValid && isNumValid) {
      req.session.authenticated = true;
      req.session.number = number;
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'Invalid number or OTP' });
    }
  } catch (e) {
    res.json({ success: false, message: 'Bot not connected yet. Connect bot first.' });
  }
});

app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ── Bot Status ───────────────────────────────────────────
app.get('/api/status', requireAuth, (req, res) => {
  try {
    const status = fs.readJsonSync(`${AUTH_DIR}/pairing_status.json`);
    res.json(status);
  } catch (e) {
    res.json({ status: 'disconnected' });
  }
});

// ── Get Config ───────────────────────────────────────────
app.get('/api/config', requireAuth, (req, res) => {
  try {
    // Read config and send as JSON
    delete require.cache[require.resolve('../src/config')];
    const cfg = require('../src/config');
    res.json({ success: true, config: cfg });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── Save Config ──────────────────────────────────────────
app.post('/api/config', requireAuth, (req, res) => {
  try {
    const updates = req.body;
    const configPath = path.join(__dirname, '../src/config.js');
    let content = fs.readFileSync(configPath, 'utf8');

    // Update boolean values
    const boolKeys = ['alwaysOnline', 'autoTyping', 'autoSeen', 'autoStatusSeen', 'autoStatusLike', 'autoStatusSave', 'autoStatusReply', 'greetingAutoReply'];
    boolKeys.forEach(key => {
      if (updates[key] !== undefined) {
        const val = updates[key] === 'true' || updates[key] === true;
        content = content.replace(new RegExp(`(${key}:\\s*)(true|false)`), `$1${val}`);
      }
    });

    // Update string values
    const strKeys = ['autoStatusLikeEmoji', 'autoStatusReplyMessage', 'botName', 'panelUrl', 'githubRepo', 'prefix'];
    strKeys.forEach(key => {
      if (updates[key] !== undefined) {
        content = content.replace(new RegExp(`(${key}:\\s*')[^']*(')`), `$1${updates[key]}$2`);
      }
    });

    fs.writeFileSync(configPath, content);
    res.json({ success: true, message: 'Settings saved!' });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── Pair Code Generation ─────────────────────────────────
let pairSocket = null;

app.post('/api/pair', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.json({ success: false, message: 'Number required' });

  try {
    // Clean number
    const cleanNumber = number.replace(/[^0-9]/g, '');

    // Start new session
    if (pairSocket) {
      try { pairSocket.end(); } catch (e) {}
      pairSocket = null;
    }

    await fs.remove('../auth_info');
    await fs.ensureDir('../auth_info');

    const { state, saveCreds } = await useMultiFileAuthState('../auth_info');
    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: 'silent' });

    pairSocket = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      browser: ['Bot', 'Chrome', '3.0'],
    });

    pairSocket.ev.on('creds.update', saveCreds);

    // Request pairing code
    if (!pairSocket.authState.creds.registered) {
      const code = await pairSocket.requestPairingCode(cleanNumber);
      const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
      fs.writeJsonSync('../auth_info/pairing_status.json', { pairingCode: formatted, status: 'pending', number: cleanNumber });

      // Emit to socket.io
      io.emit('pairingCode', { code: formatted });

      res.json({ success: true, code: formatted });
    }

    pairSocket.ev.on('connection.update', (update) => {
      const { connection } = update;
      if (connection === 'open') {
        io.emit('botConnected', { number: cleanNumber });
      }
    });

  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ── GitHub Update ────────────────────────────────────────
app.post('/api/update', requireAuth, async (req, res) => {
  try {
    const git = simpleGit('../');
    await git.fetch();
    const status = await git.status();
    if (status.behind > 0) {
      await git.pull();
      res.json({ success: true, message: `Updated! ${status.behind} commits pulled. Restarting bot...` });
      setTimeout(() => process.exit(0), 3000);
    } else {
      res.json({ success: true, message: 'Already up to date!' });
    }
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── Socket.io ────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[PANEL] Client connected');
  
  // Send current status
  try {
    const status = fs.readJsonSync(`${AUTH_DIR}/pairing_status.json`);
    socket.emit('statusUpdate', status);
  } catch (e) {}
});

// ── Watch pairing_status.json for changes ─────────────────
fs.ensureDir(AUTH_DIR).then(() => {
  const watchFile = `${AUTH_DIR}/pairing_status.json`;
  if (fs.existsSync(watchFile)) {
    fs.watchFile(watchFile, { interval: 1000 }, () => {
      try {
        const data = fs.readJsonSync(watchFile);
        io.emit('statusUpdate', data);
      } catch (e) {}
    });
  }
});

server.listen(PORT, () => {
  console.log(`\n🌐 Panel running at: http://localhost:${PORT}\n`);
});

// Auto-start bot if session exists
setTimeout(() => {
  const authCredsPath = AUTH_DIR + '/creds.json';
  const fs2 = require('fs');
  if (fs2.existsSync(authCredsPath)) {
    console.log('[AUTO-START] Session found, starting bot...');
    try {
      const { startBot } = require('../src/bot');
      startBot().catch(e => console.error('[AUTO-START ERROR]', e.message));
    } catch (e) {
      console.error('[AUTO-START ERROR]', e.message);
    }
  } else {
    console.log('[AUTO-START] No session found. Please connect via panel.');
  }
}, 2000);
