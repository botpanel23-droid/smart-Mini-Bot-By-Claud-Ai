const config = require('../config');
const fs = require('fs-extra');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function handle(sock, msg, sender, command, args, body) {
  const prefix = config.prefix;

  // ─── MENU ───────────────────────────────────────────────
  if (command === 'menu' || command === 'help' || command === 'start') {
    await sock.sendMessage(sender, {
      text: `┏━━━━━━━━━━━━━━━━━━━━┓
┃      🤖 *${config.botName} MENU* 🤖      ┃
┗━━━━━━━━━━━━━━━━━━━━┛

📸 *IMAGE COMMANDS*
┣ \`${prefix}sticker\` - Image → Sticker
┣ \`${prefix}toimg\` - Sticker → Image  
┣ \`${prefix}blur\` - Image blur
┣ \`${prefix}enhance\` - Image enhance
┣ \`${prefix}circle\` - Circular crop
┣ \`${prefix}resize w h\` - Resize image
┗ \`${prefix}caption text\` - Add text to image

🎭 *FUN COMMANDS*
┣ \`${prefix}quote\` - Random quote
┣ \`${prefix}joke\` - Random joke
┣ \`${prefix}fact\` - Random fact
┗ \`${prefix}weather city\` - Weather info

💾 *STATUS COMMANDS*
┣ \`${prefix}save\` (mention status) - Save status
┗ \`${prefix}laststatus\` - Last saved status

⚙️ *BOT SETTINGS*
┣ \`${prefix}autoseen on/off\` - Auto seen
┣ \`${prefix}autolike on/off\` - Auto status like
┣ \`${prefix}autoreply on/off\` - Auto status reply
┣ \`${prefix}alwaysonline on/off\` - Always online
┣ \`${prefix}autotyping on/off\` - Auto typing
┗ \`${prefix}setemoji 💖\` - Status like emoji

🔄 *SYSTEM*
┣ \`${prefix}update\` - Check for updates
┣ \`${prefix}ping\` - Bot ping
┗ \`${prefix}info\` - Bot info

━━━━━━━━━━━━━━━━━━━━
💫 *Panel:* ${config.panelUrl}`
    });
    return true;
  }

  // ─── PING ───────────────────────────────────────────────
  if (command === 'ping') {
    const start = Date.now();
    const m = await sock.sendMessage(sender, { text: '🏓 Pinging...' });
    const ping = Date.now() - start;
    await sock.sendMessage(sender, { text: `🏓 *Pong!*\n⚡ *Speed:* ${ping}ms` });
    return true;
  }

  // ─── INFO ───────────────────────────────────────────────
  if (command === 'info') {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    await sock.sendMessage(sender, {
      text: `┏━━━━━━━━━━━━━━━━┓
┃    🤖 *BOT INFO*    ┃
┗━━━━━━━━━━━━━━━━┛

🏷️ *Name:* ${config.botName}
⏱️ *Uptime:* ${hours}h ${mins}m
🌐 *Panel:* ${config.panelUrl}
📌 *Version:* 1.0.0
✅ *Status:* Online

⚙️ *Settings:*
• Auto Seen: ${config.autoSeen ? '✅' : '❌'}
• Auto Like: ${config.autoStatusLike ? '✅' : '❌'}
• Always Online: ${config.alwaysOnline ? '✅' : '❌'}
• Auto Typing: ${config.autoTyping ? '✅' : '❌'}
• Like Emoji: ${config.autoStatusLikeEmoji}`
    });
    return true;
  }

  // ─── SETTINGS ───────────────────────────────────────────
  const settingsMap = {
    'autoseen': ['autoSeen', 'Auto Seen'],
    'autolike': ['autoStatusLike', 'Auto Status Like'],
    'autoreply': ['autoStatusReply', 'Auto Status Reply'],
    'alwaysonline': ['alwaysOnline', 'Always Online'],
    'autotyping': ['autoTyping', 'Auto Typing'],
    'autostatus': ['autoStatusSeen', 'Auto Status Seen'],
  };

  if (settingsMap[command]) {
    const [key, label] = settingsMap[command];
    const value = args[0]?.toLowerCase();
    if (value === 'on') {
      config[key] = true;
      await sock.sendMessage(sender, { text: `✅ *${label}* ON කළා!` });
    } else if (value === 'off') {
      config[key] = false;
      await sock.sendMessage(sender, { text: `❌ *${label}* OFF කළා!` });
    } else {
      await sock.sendMessage(sender, { text: `⚙️ *${label}* දැනට: ${config[key] ? '✅ ON' : '❌ OFF'}\n\nUsage: \`${config.prefix}${command} on/off\`` });
    }
    return true;
  }

  // ─── SET EMOJI ──────────────────────────────────────────
  if (command === 'setemoji') {
    if (args[0]) {
      config.autoStatusLikeEmoji = args[0];
      await sock.sendMessage(sender, { text: `✅ Status Like emoji \`${args[0]}\` ලෙස සකස් කළා!` });
    } else {
      await sock.sendMessage(sender, { text: `Usage: \`${config.prefix}setemoji 💖\`` });
    }
    return true;
  }

  // ─── SAVE STATUS ────────────────────────────────────────
  if (command === 'save') {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted) {
      await sock.sendMessage(sender, { text: `💾 Status save කිරීමට:\n\nStatus reply කරලා \`${prefix}save\` ගහන්න!` });
      return true;
    }

    try {
      let mediaMsg = null;
      let ext = 'jpg';
      let type = 'image';

      if (quoted.imageMessage) { mediaMsg = quoted.imageMessage; ext = 'jpg'; type = 'image'; }
      else if (quoted.videoMessage) { mediaMsg = quoted.videoMessage; ext = 'mp4'; type = 'video'; }

      if (mediaMsg) {
        const stream = await downloadContentFromMessage(mediaMsg, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        const savedDir = '../saved_status';
        await fs.ensureDir(savedDir);
        const fileName = `${savedDir}/status_${Date.now()}.${ext}`;
        await fs.writeFile(fileName, buffer);

        await sock.sendMessage(sender, {
          [type]: buffer,
          caption: `✅ *Status Saved!*\n📁 ${fileName}`
        });
      } else {
        await sock.sendMessage(sender, { text: `❌ Image/Video status එකක් quote කරලා \`${prefix}save\` ගහන්න!` });
      }
    } catch (e) {
      await sock.sendMessage(sender, { text: `❌ Save error: ${e.message}` });
    }
    return true;
  }

  // ─── UPDATE ─────────────────────────────────────────────
  if (command === 'update') {
    if (!config.githubRepo) {
      await sock.sendMessage(sender, { text: `❌ GitHub repo config නෑ!\n\nPanel settings වල \`GitHub Repo\` add කරන්න.` });
      return true;
    }
    try {
      const simpleGit = require('simple-git');
      const git = simpleGit('../');
      await git.fetch();
      const status = await git.status();
      if (status.behind > 0) {
        await sock.sendMessage(sender, { text: `🔄 *Update Available!*\n${status.behind} commits behind.\n\nPulling update...` });
        await git.pull();
        await sock.sendMessage(sender, { text: `✅ *Updated!* Restarting...` });
        setTimeout(() => process.exit(0), 2000);
      } else {
        await sock.sendMessage(sender, { text: `✅ *Bot is up to date!*\nLatest version use කරනවා.` });
      }
    } catch (e) {
      await sock.sendMessage(sender, { text: `❌ Update error: ${e.message}` });
    }
    return true;
  }

  return false;
}

module.exports = { handle };
