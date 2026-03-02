const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const config = require('../config');
const Jimp = require('jimp');

async function getImageBuffer(msg) {
  let imageMsg = msg.message?.imageMessage ||
    msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
  if (!imageMsg) return null;
  const stream = await downloadContentFromMessage(imageMsg, 'image');
  let buffer = Buffer.from([]);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer;
}

async function handle(sock, msg, sender, command, args, body) {
  const prefix = config.prefix;

  // ─── STICKER ────────────────────────────────────────────
  if (command === 'sticker' || command === 's') {
    const imageBuffer = await getImageBuffer(msg);
    if (!imageBuffer) {
      await sock.sendMessage(sender, { text: `📸 Image attach කරලා \`${prefix}sticker\` ගහන්න!` });
      return true;
    }
    await sock.sendMessage(sender, { sticker: imageBuffer });
    return true;
  }

  // ─── TO IMAGE (sticker to image) ────────────────────────
  if (command === 'toimg') {
    const stickerMsg = msg.message?.stickerMessage ||
      msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
    if (!stickerMsg) {
      await sock.sendMessage(sender, { text: `Sticker quote කරලා \`${prefix}toimg\` ගහන්න!` });
      return true;
    }
    const stream = await downloadContentFromMessage(stickerMsg, 'sticker');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    await sock.sendMessage(sender, { image: buffer, caption: '✅ Sticker → Image' });
    return true;
  }

  // ─── BLUR ───────────────────────────────────────────────
  if (command === 'blur') {
    const imageBuffer = await getImageBuffer(msg);
    if (!imageBuffer) {
      await sock.sendMessage(sender, { text: `Image attach කරලා \`${prefix}blur\` ගහන්න!` });
      return true;
    }
    await sock.sendMessage(sender, { text: '⏳ Processing...' });
    const img = await Jimp.read(imageBuffer);
    const level = parseInt(args[0]) || 10;
    img.blur(Math.min(level, 20));
    const result = await img.getBufferAsync(Jimp.MIME_JPEG);
    await sock.sendMessage(sender, { image: result, caption: `✅ Blur level: ${level}` });
    return true;
  }

  // ─── ENHANCE ────────────────────────────────────────────
  if (command === 'enhance') {
    const imageBuffer = await getImageBuffer(msg);
    if (!imageBuffer) {
      await sock.sendMessage(sender, { text: `Image attach කරලා \`${prefix}enhance\` ගහන්න!` });
      return true;
    }
    await sock.sendMessage(sender, { text: '⏳ Enhancing...' });
    const img = await Jimp.read(imageBuffer);
    img.contrast(0.2).brightness(0.05).saturate(0.1);
    const result = await img.getBufferAsync(Jimp.MIME_JPEG);
    await sock.sendMessage(sender, { image: result, caption: '✅ Image Enhanced!' });
    return true;
  }

  // ─── CIRCLE ─────────────────────────────────────────────
  if (command === 'circle') {
    const imageBuffer = await getImageBuffer(msg);
    if (!imageBuffer) {
      await sock.sendMessage(sender, { text: `Image attach කරලා \`${prefix}circle\` ගහන්න!` });
      return true;
    }
    await sock.sendMessage(sender, { text: '⏳ Processing...' });
    const img = await Jimp.read(imageBuffer);
    const size = Math.min(img.getWidth(), img.getHeight());
    img.resize(size, size);
    // Create circle mask
    const mask = new Jimp(size, size, 0x00000000);
    const cx = size / 2, cy = size / 2, r = size / 2;
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        if (Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) <= r) {
          mask.setPixelColor(0xffffffff, x, y);
        }
      }
    }
    img.mask(mask, 0, 0);
    const result = await img.getBufferAsync(Jimp.MIME_PNG);
    await sock.sendMessage(sender, { image: result, caption: '⭕ Circular Image' });
    return true;
  }

  // ─── RESIZE ─────────────────────────────────────────────
  if (command === 'resize') {
    const imageBuffer = await getImageBuffer(msg);
    if (!imageBuffer) {
      await sock.sendMessage(sender, { text: `Image attach කරලා \`${prefix}resize 800 600\` ගහන්න!` });
      return true;
    }
    const w = parseInt(args[0]) || 800;
    const h = parseInt(args[1]) || 600;
    const img = await Jimp.read(imageBuffer);
    img.resize(w, h);
    const result = await img.getBufferAsync(Jimp.MIME_JPEG);
    await sock.sendMessage(sender, { image: result, caption: `✅ Resized to ${w}x${h}` });
    return true;
  }

  // ─── CAPTION ────────────────────────────────────────────
  if (command === 'caption') {
    const imageBuffer = await getImageBuffer(msg);
    const text = args.join(' ');
    if (!imageBuffer || !text) {
      await sock.sendMessage(sender, { text: `Image attach කරලා \`${prefix}caption Your Text Here\` ගහන්න!` });
      return true;
    }
    const img = await Jimp.read(imageBuffer);
    const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const w = img.getWidth();
    const h = img.getHeight();
    // Add dark bar at bottom
    const bar = new Jimp(w, 60, 0x000000aa);
    img.composite(bar, 0, h - 60);
    img.print(font, 10, h - 50, { text, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER, alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE }, w - 20, 50);
    const result = await img.getBufferAsync(Jimp.MIME_JPEG);
    await sock.sendMessage(sender, { image: result, caption: `✅ Caption added!` });
    return true;
  }

  return false;
}

module.exports = { handle };
