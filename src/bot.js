const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');
const { handleMessage } = require('./messageHandler');
const { handleStatusUpdate } = require('./statusHandler');
const config = require('./config');
const cron = require('node-cron');
const simpleGit = require('simple-git');

const logger = pino({ level: 'silent' });
let sock = null;
let isConnected = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('../auth_info');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: ['Bot', 'Chrome', '3.0'],
    markOnlineOnConnect: config.alwaysOnline,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, pairingCode } = update;

    if (pairingCode) {
      fs.writeJsonSync('../auth_info/pairing_status.json', { pairingCode, status: 'pending' });
      console.log('[PAIRING CODE]:', pairingCode);
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(() => startBot(), 3000);
      else fs.writeJsonSync('../auth_info/pairing_status.json', { status: 'disconnected' });
    }

    if (connection === 'open') {
      isConnected = true;
      const botJid = sock.user.id;
      const botNum = botJid.split(':')[0];
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      fs.writeJsonSync('../auth_info/pairing_status.json', { status: 'connected', number: botNum });
      fs.writeJsonSync('../auth_info/otp.json', { otp, number: botNum, time: Date.now() });

      console.log('[BOT CONNECTED] Number:', botNum, '| OTP:', otp);

      // Send welcome message
      await sock.sendMessage(botJid, {
        text: `┏━━━━━━━━━━━━━━━━━━━━┓\n┃   🤖 *BOT CONNECTED* 🤖   ┃\n┗━━━━━━━━━━━━━━━━━━━━┛\n\n✅ *සාර්ථකව සම්බන්ධ විය!*\n\n📱 *Number:* ${botNum}\n🔐 *OTP:* \`${otp}\`\n\n🌐 Panel: ${config.panelUrl}\n_OTP සහ ඔබේ Number panel login සඳහා භාවිත කරන්න_\n\n━━━━━━━━━━━━━━━━━━━━\n💫 *Powered by WA-BOT PANEL*`
      });
    }
  });

  // Handle all messages
  sock.ev.on('messages.upsert', async (m) => {
    if (!isConnected) return;
    for (const msg of m.messages) {
      if (msg.key.remoteJid === 'status@broadcast') {
        await handleStatusUpdate(sock, msg);
      } else {
        await handleMessage(sock, m);
        break;
      }
    }
  });

  // Auto-update via GitHub
  if (config.githubRepo) {
    cron.schedule('*/30 * * * *', async () => {
      try {
        const git = simpleGit('../');
        await git.fetch();
        const status = await git.status();
        if (status.behind > 0) {
          await git.pull();
          if (sock && isConnected) {
            await sock.sendMessage(sock.user.id, {
              text: '🔄 *Auto Update සාර්ථකයි!*\n\nGitHub වලින් නව version pull කළා.\n♻️ Restarting bot...'
            });
          }
          setTimeout(() => process.exit(0), 2000);
        }
      } catch (e) { /* silent */ }
    });
  }

  return sock;
}

module.exports = { startBot, getSock: () => sock, isConnected: () => isConnected };

startBot().catch(console.error);
