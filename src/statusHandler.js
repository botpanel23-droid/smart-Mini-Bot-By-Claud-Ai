const fs = require('fs-extra');
const config = require('./config');

async function handleStatusUpdate(sock, msg) {
  try {
    const sender = msg.key.participant || msg.key.remoteJid;
    const statusJid = 'status@broadcast';

    // Auto Seen Status
    if (config.autoStatusSeen) {
      await sock.readMessages([msg.key]);
    }

    // Auto Like Status
    if (config.autoStatusLike) {
      await sock.sendMessage(statusJid, {
        react: { text: config.autoStatusLikeEmoji, key: msg.key }
      });
    }

    // Auto Reply to Status
    if (config.autoStatusReply) {
      await sock.sendMessage(sender, {
        text: config.autoStatusReplyMessage
      });
    }

    // Auto Save Status
    if (config.autoStatusSave) {
      const savedDir = '../saved_status';
      await fs.ensureDir(savedDir);
      const content = msg.message;
      let mediaMsg = null;
      let ext = 'txt';

      if (content?.imageMessage) {
        mediaMsg = content.imageMessage;
        ext = 'jpg';
      } else if (content?.videoMessage) {
        mediaMsg = content.videoMessage;
        ext = 'mp4';
      }

      if (mediaMsg) {
        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
        const type = ext === 'jpg' ? 'image' : 'video';
        const stream = await downloadContentFromMessage(mediaMsg, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        const fileName = `${savedDir}/${sender.split('@')[0]}_${Date.now()}.${ext}`;
        await fs.writeFile(fileName, buffer);
      }
    }

  } catch (e) {
    console.log('[STATUS HANDLER ERROR]', e.message);
  }
}

module.exports = { handleStatusUpdate };
