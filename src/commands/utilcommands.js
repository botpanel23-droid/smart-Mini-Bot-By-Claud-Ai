const config = require('../config');
const axios = require('axios');

const quotes = [
  "ජීවිතය කෙටිය, සිහිනය දිගය. - Unknown",
  "ශක්තිය physical force නොවෙයි. Indomitable will ශක්තිය. - Gandhi",
  "Success is not final, failure is not fatal. - Churchill",
  "The only way to do great work is to love what you do. - Steve Jobs",
  "හිතන්ට කලින් හදිස්සි වෙන්න එපා. - Sinhala Proverb",
];

const jokes = [
  "Teacher: Why are you late?\nStudent: I saw a sign that said 'School Ahead, Go Slow!' 😂",
  "Programmer bugs fix කරනකොට: Fixed 1 bug → Found 3 more bugs 😅",
  "Sleep: Nah bro.\nMe at 3am: Fine, I'll stare at the ceiling then 💀",
  "WhatsApp bot: \'Auto reply activated\'\nMe: Finally some peace\nBot: Hi! How can I help you? 🤖",
];

const facts = [
  "🐙 Octopuses have 3 hearts and blue blood!",
  "🍯 Honey never expires. 3000 year old honey was found in Egyptian tombs!",
  "🌙 Moon dust smells like gunpowder, according to Apollo astronauts.",
  "🐜 Ants can carry 50 times their own body weight!",
  "🧠 Your brain uses 20% of your body's total energy.",
];

async function handle(sock, msg, sender, command, args, body) {
  const prefix = config.prefix;

  // ─── QUOTE ──────────────────────────────────────────────
  if (command === 'quote' || command === 'q') {
    const q = quotes[Math.floor(Math.random() * quotes.length)];
    await sock.sendMessage(sender, { text: `💬 *Quote of the Moment*\n\n_"${q}"_` });
    return true;
  }

  // ─── JOKE ───────────────────────────────────────────────
  if (command === 'joke' || command === 'j') {
    const j = jokes[Math.floor(Math.random() * jokes.length)];
    await sock.sendMessage(sender, { text: `😂 *Joke Time!*\n\n${j}` });
    return true;
  }

  // ─── FACT ───────────────────────────────────────────────
  if (command === 'fact' || command === 'f') {
    const f = facts[Math.floor(Math.random() * facts.length)];
    await sock.sendMessage(sender, { text: `🧠 *Did You Know?*\n\n${f}` });
    return true;
  }

  // ─── WEATHER ────────────────────────────────────────────
  if (command === 'weather' || command === 'w') {
    const city = args.join(' ') || 'Colombo';
    try {
      // Using wttr.in free API
      const res = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { timeout: 5000 });
      const data = res.data;
      const current = data.current_condition[0];
      const area = data.nearest_area[0];

      const areaName = area.areaName[0].value;
      const country = area.country[0].value;
      const temp = current.temp_C;
      const feels = current.FeelsLikeC;
      const humidity = current.humidity;
      const windspeed = current.windspeedKmph;
      const desc = current.weatherDesc[0].value;

      await sock.sendMessage(sender, {
        text: `🌤️ *Weather - ${areaName}, ${country}*\n\n🌡️ *Temp:* ${temp}°C (Feels ${feels}°C)\n☁️ *Sky:* ${desc}\n💧 *Humidity:* ${humidity}%\n💨 *Wind:* ${windspeed} km/h`
      });
    } catch (e) {
      await sock.sendMessage(sender, { text: `❌ Weather data ගන්නට බැරි වුණා.\nCity name correct ද check කරන්න.` });
    }
    return true;
  }

  // ─── LYRICS ─────────────────────────────────────────────
  if (command === 'lyrics') {
    if (args.length < 2) {
      await sock.sendMessage(sender, { text: `Usage: \`${prefix}lyrics Artist Song Name\`` });
      return true;
    }
    const [artist, ...songParts] = args;
    const song = songParts.join(' ');
    try {
      const res = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(song)}`, { timeout: 8000 });
      const lyrics = res.data.lyrics?.substring(0, 1000) + (res.data.lyrics?.length > 1000 ? '...\n\n_(truncated)_' : '');
      await sock.sendMessage(sender, { text: `🎵 *${song} - ${artist}*\n\n${lyrics}` });
    } catch (e) {
      await sock.sendMessage(sender, { text: `❌ Lyrics හොයාගත නොහැකිය.` });
    }
    return true;
  }

  // ─── TRANSLATE ──────────────────────────────────────────
  if (command === 'translate' || command === 'tr') {
    const lang = args[0] || 'si';
    const text = args.slice(1).join(' ');
    if (!text) {
      await sock.sendMessage(sender, { text: `Usage: \`${prefix}translate si Your text here\`` });
      return true;
    }
    try {
      const res = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`, { timeout: 5000 });
      const translated = res.data[0][0][0];
      await sock.sendMessage(sender, { text: `🌐 *Translation*\n\n📝 *Original:* ${text}\n✅ *Translated (${lang}):* ${translated}` });
    } catch (e) {
      await sock.sendMessage(sender, { text: `❌ Translation error!` });
    }
    return true;
  }

  // ─── TIKTOK DOWNLOAD ────────────────────────────────────
  if (command === 'tt' || command === 'tiktok') {
    const url = args[0];
    if (!url || !url.includes('tiktok')) {
      await sock.sendMessage(sender, { text: `Usage: \`${prefix}tt https://tiktok.com/...\`` });
      return true;
    }
    await sock.sendMessage(sender, { text: `⏳ TikTok video download කරනවා...` });
    try {
      const res = await axios.get(`https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(url)}`, { timeout: 15000 });
      const videoUrl = res.data?.video?.noWatermark;
      if (!videoUrl) throw new Error('No video URL');
      const videoRes = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const buffer = Buffer.from(videoRes.data);
      await sock.sendMessage(sender, { video: buffer, caption: `✅ TikTok Video (No Watermark)` });
    } catch (e) {
      await sock.sendMessage(sender, { text: `❌ Download error! URL valid ද check කරන්න.` });
    }
    return true;
  }

  return false;
}

module.exports = { handle };
