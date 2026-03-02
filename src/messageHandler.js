const config = require('./config');
const fs = require('fs-extra');

// Load all command handlers
const imageCommands = require('./commands/imageCommands');
const utilCommands = require('./commands/utilCommands');
const botCommands = require('./commands/botCommands');

async function handleMessage(sock, m) {
  try {
    const msg = m.messages[0];
    if (!msg || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const isGroup = sender.endsWith('@g.us');
    const pushName = msg.pushName || 'User';
    const senderNumber = msg.key.participant?.split('@')[0] || sender.split('@')[0];

    // Get message text
    const body = msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption || '';

    const prefix = config.prefix;
    const isCommand = body.startsWith(prefix);
    const command = isCommand ? body.slice(prefix.length).trim().split(' ')[0].toLowerCase() : '';
    const args = isCommand ? body.trim().split(/\s+/).slice(1) : [];

    // Auto Typing indicator
    if (config.autoTyping && isCommand) {
      await sock.sendPresenceUpdate('composing', sender);
      await new Promise(r => setTimeout(r, 1500));
    }

    // Auto Seen
    if (config.autoSeen) {
      await sock.readMessages([msg.key]);
    }

    // Greeting auto reply with voice-style text
    if (config.greetingAutoReply && !isCommand) {
      const lowerBody = body.toLowerCase().trim();
      if (config.greetingKeywords.some(k => lowerBody === k || lowerBody.startsWith(k + ' '))) {
        const userData = loadUserData(senderNumber);

        if (!userData) {
          // First time - ask for details
          await sock.sendMessage(sender, {
            text: `🎙️ *හෙලෝ ${pushName}!* 👋\n\nමම *${config.botName}* 🤖\n\n_ඔබව identify කිරීමට..._\n\n📝 *ඔබේ Details Save කරගන්නද?*\n\nකරුණාකර ඔබේ Name, City සහ Age reply කරන්න:\n\nFormat: \`save:Name:City:Age\`\nExample: \`save:Kamal:Colombo:22\``
          });
        } else {
          await sock.sendMessage(sender, {
            text: `🎙️ *හෙලෝ ${userData.name}!* 👋\n\n📍 *City:* ${userData.city}\n🎂 *Age:* ${userData.age}\n\n✨ *ඔබට සහය වීමට සූදානම්!*\n\n💡 Commands list: \`${prefix}menu\``
          });
        }
        return;
      }

      // Save user data
      if (lowerBody.startsWith('save:')) {
        const parts = body.split(':');
        if (parts.length >= 4) {
          saveUserData(senderNumber, { name: parts[1], city: parts[2], age: parts[3] });
          await sock.sendMessage(sender, {
            text: `✅ *Data Saved!*\n\n👤 *Name:* ${parts[1]}\n📍 *City:* ${parts[2]}\n🎂 *Age:* ${parts[3]}\n\n🎉 ස්තූතියි! දැන් \`${prefix}menu\` ගහලා commands බලන්න.`
          });
          return;
        }
      }
    }

    if (!isCommand) return;

    // Route commands
    const handled = await imageCommands.handle(sock, msg, sender, command, args, body) ||
                    await utilCommands.handle(sock, msg, sender, command, args, body) ||
                    await botCommands.handle(sock, msg, sender, command, args, body);

    if (!handled) {
      await sock.sendMessage(sender, {
        text: `❓ *Unknown Command!*\n\n\`${prefix}${command}\` command හොයාගත නොහැකිය.\n\n💡 Commands list: \`${prefix}menu\``
      });
    }

  } catch (e) {
    console.log('[MESSAGE HANDLER ERROR]', e.message);
  }
}

function loadUserData(number) {
  try {
    const file = `../auth_info/users/${number}.json`;
    return fs.existsSync(file) ? fs.readJsonSync(file) : null;
  } catch { return null; }
}

function saveUserData(number, data) {
  fs.ensureDirSync('../auth_info/users');
  fs.writeJsonSync(`../auth_info/users/${number}.json`, data);
}

module.exports = { handleMessage };
