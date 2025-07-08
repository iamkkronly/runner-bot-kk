const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec, spawn, execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// CONFIG
const BOT_TOKEN = '7542704316:AAE9nDkiramhQvxTJeTSDfhAfC7n2kY1zs8';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const BASE_DIR = __dirname;
const UPLOAD_DIR = path.join(BASE_DIR, 'userbot');
const USERS_FILE = path.join(BASE_DIR, 'users.json');
const KEEP_FILES = ['server.js', 'package.json', 'users.json', 'node_modules'];

// Ensure folders exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));

// Express route for UptimeRobot
app.get('/', (req, res) => {
  res.send('🤖 Telegram Bot Runner is live.');
});

// Handle /start and track users
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  let users = JSON.parse(fs.readFileSync(USERS_FILE));
  if (!users.includes(chatId)) {
    users.push(chatId);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users));
  }

  bot.sendMessage(chatId, '👋 Send me your `bot.js` and `package.json`. I will install and run it!');
});

// Handle uploaded files
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.document.file_id;
  const fileName = msg.document.file_name;

  const file = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const fileStream = fs.createWriteStream(filePath);

  https.get(fileUrl, (res) => {
    res.pipe(fileStream);
    fileStream.on('finish', () => {
      fileStream.close();
      bot.sendMessage(chatId, `✅ Saved ${fileName}`);

      const files = fs.readdirSync(UPLOAD_DIR);
      if (files.includes('bot.js') && files.includes('package.json')) {
        bot.sendMessage(chatId, '📦 Installing dependencies...');
        exec(`cd ${UPLOAD_DIR} && npm install`, (err, stdout, stderr) => {
          if (err) {
            bot.sendMessage(chatId, `❌ Install error:\n${stderr}`);
            return;
          }

          bot.sendMessage(chatId, '🚀 Running your bot...');
          const child = spawn('node', ['bot.js'], {
            cwd: UPLOAD_DIR,
            detached: true,
            stdio: 'ignore'
          });
          child.unref();

          bot.sendMessage(chatId, '✅ Your bot is now running!');
        });
      }
    });
  });
});

// Cleanup Function
function runCleanup(reason) {
  fs.readdir(BASE_DIR, (err, items) => {
    if (err) return;
    let deleted = false;

    items.forEach(item => {
      if (KEEP_FILES.includes(item)) return;
      const itemPath = path.join(BASE_DIR, item);
      fs.rm(itemPath, { recursive: true, force: true }, () => {});
      deleted = true;
    });

    if (deleted && fs.existsSync(USERS_FILE)) {
      const users = JSON.parse(fs.readFileSync(USERS_FILE));
      const notifyBot = new TelegramBot(BOT_TOKEN);
      const message = reason === 'disk'
        ? '⚠️ Server was 80% full. Auto-cleanup triggered.'
        : '🧹 Daily auto-cleanup: Old files were deleted after 1 day.';
      users.forEach(chatId => {
        notifyBot.sendMessage(chatId, message);
      });
    }
  });
}

// Daily cleanup every 1 hour (checks for files older than 1 day)
setInterval(() => {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;

  fs.readdir(BASE_DIR, (err, items) => {
    if (err) return;
    let deleted = false;

    items.forEach(item => {
      if (KEEP_FILES.includes(item)) return;
      const itemPath = path.join(BASE_DIR, item);
      fs.stat(itemPath, (err, stats) => {
        if (err) return;
        if (stats.mtimeMs < cutoff) {
          fs.rm(itemPath, { recursive: true, force: true }, () => {});
          deleted = true;
        }
      });
    });

    if (deleted) runCleanup('daily');
  });
}, 60 * 60 * 1000); // every hour

// Disk space monitor every 30 mins
setInterval(() => {
  try {
    const output = execSync(`df -h /`).toString();
    const lines = output.split('\n');
    const usageLine = lines[1];
    const usedPercent = parseInt(usageLine.split(/\s+/)[4].replace('%', ''));

    if (usedPercent >= 80) {
      runCleanup('disk');
    }
  } catch (e) {
    // Silent fail (if command is blocked)
  }
}, 30 * 60 * 1000);

// Start server
app.listen(PORT);
