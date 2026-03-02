const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const AUTH_DIR   = path.join(__dirname, '..', 'auth_info');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'wabot-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(PUBLIC_DIR));

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login');
}

// Page Routes
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get('/connect', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'connect.html')));

// API: Login
app.post('/api/login', (req, res) => {
  const { number, otp } = req.body;
  try {
    const otpData    = fs.readJsonSync(path.join(AUTH_DIR, 'otp.json'));
    const statusData = fs.readJsonSync(path.join(AUTH_DIR, 'pairing_status.json'));
    const botNum   = (statusData.number || '').replace(/[^0-9]/g, '');
    const inputNum = (number || '').replace(/[^0-9]/g, '');
    const otpValid = otpData.otp === otp && (Date.now() - otpData.time) < 10 * 60 * 1000;
    const numValid = botNum && inputNum && (botNum.includes(inputNum) || inputNum.includes(botNum));
    if (otpValid && numValid) {
      req.session.authenticated = true;
      req.session.number = number;
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'OTP හෝ Number වැරදියි!' });
    }
  } catch (e) {
    res.json({ success: false, message: 'Bot connect කරලා නෑ. කලින් /connect යන්න!' });
  }
});

app.get('/api/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

app.get('/api/status', (req, res) => {
  try { res.json(fs.readJsonSync(path.join(AUTH_DIR, 'pairing_status.json'))); }
  catch (e) { res.json({ status: 'disconnected' }); }
});

// API: Pair Code
let pairSocket = null;

app.post('/api/pair', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.json({ success: false, message: 'Number දාන්න!' });
  try {
    const cleanNumber = number.replace(/[^0-9]/g, '');
    if (pairSocket) { try { pairSocket.end(); } catch (e) {} pairSocket = null; }
    await fs.remove(AUTH_DIR);
    await fs.ensureDir(AUTH_DIR);
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: 'silent' });
    pairSocket = makeWASocket({ version, logger, printQRInTerminal: false,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      browser: ['WA-BOT', 'Chrome', '3.0'] });
    pairSocket.ev.on('creds.update', saveCreds);
    await new Promise(r => setTimeout(r, 2000));
    if (!pairSocket.authState.creds.registered) {
      const code = await pairSocket.requestPairingCode(cleanNumber);
      const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
      fs.writeJsonSync(path.join(AUTH_DIR, 'pairing_status.json'), { pairingCode: formatted, status: 'pending', number: cleanNumber });
      io.emit('pairingCode', { code: formatted });
      res.json({ success: true, code: formatted });
    } else {
      res.json({ success: false, message: 'Already registered!' });
    }
    pairSocket.ev.on('connection.update', async (update) => {
      if (update.connection === 'open') {
        const botJid = pairSocket.user?.id || '';
        const botNum = botJid.split(':')[0] || cleanNumber;
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        fs.writeJsonSync(path.join(AUTH_DIR, 'pairing_status.json'), { status: 'connected', number: botNum });
        fs.writeJsonSync(path.join(AUTH_DIR, 'otp.json'), { otp, number: botNum, time: Date.now() });
        io.emit('botConnected', { number: botNum });
        console.log(`[CONNECTED] Number: ${botNum} | OTP: ${otp}`);
        try { const { startBot } = require('../src/bot'); startBot().catch(console.error); } catch(e) { console.error(e.message); }
      }
    });
  } catch (e) {
    console.error('[PAIR ERROR]', e.message);
    res.json({ success: false, message: e.message });
  }
});

// Socket.io
io.on('connection', (socket) => {
  try { socket.emit('statusUpdate', fs.readJsonSync(path.join(AUTH_DIR, 'pairing_status.json'))); }
  catch (e) { socket.emit('statusUpdate', { status: 'disconnected' }); }
});

setInterval(() => {
  const f = path.join(AUTH_DIR, 'pairing_status.json');
  if (fs.existsSync(f)) { try { io.emit('statusUpdate', fs.readJsonSync(f)); } catch(e){} }
}, 2000);

// Auto-start bot if session exists
setTimeout(() => {
  if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
    console.log('[AUTO-START] Session found...');
    try { const { startBot } = require('../src/bot'); startBot().catch(console.error); }
    catch(e) { console.error('[AUTO-START]', e.message); }
  }
}, 3000);

server.listen(PORT, '0.0.0.0', () => console.log(`\n✅ Panel: http://0.0.0.0:${PORT}\n`));
