module.exports = {
  // Panel Settings
  panelPort: 3000,
  panelUrl: 'http://localhost:3000',
  panelSecret: 'your-secret-key-change-this',

  // GitHub Auto-Update
  githubRepo: '', // e.g. 'https://github.com/yourname/wabot'

  // Bot Features (toggle on/off)
  alwaysOnline: true,
  autoTyping: true,
  autoSeen: true,
  autoStatusSeen: true,
  autoStatusLike: true,
  autoStatusLikeEmoji: '❤️',
  autoStatusSave: false,
  autoStatusReply: true,
  autoStatusReplyMessage: '✨ *Status කියෙව්වා!* ❤️',

  // Auto Reply when someone says Hi
  greetingAutoReply: true,
  greetingKeywords: ['hi', 'hello', 'hii', 'hey', 'hy', 'හෙලෝ', 'හායි'],

  // Prefix for commands
  prefix: '.',

  // Bot name
  botName: 'WA-BOT',

  // Welcome image URL
  welcomeImage: 'https://i.imgur.com/your-welcome-image.jpg',
};
