const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} = require("@whiskeysockets/baileys");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const pino = require("pino");

const app = express();
app.use(cors());
app.use(express.json());

const SETTINGS_FILE = path.join(__dirname, "settings.json");
const SAVED_FILE = path.join(__dirname, "saved_messages.json");

function loadSettings() {
  try { if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch (e) {}
  return {
    autoCallReject: false,
    greeting: "Hello! I am MFG_bot. How can I help you today?",
    systemPrompt: "You are MFG_bot, a helpful WhatsApp assistant. Answer questions clearly and concisely.",
  };
}
function saveSettings(data) { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2)); } catch (e) {} }
let settings = loadSettings();

function loadSaved() {
  try { if (fs.existsSync(SAVED_FILE)) return JSON.parse(fs.readFileSync(SAVED_FILE, "utf8")); } catch (e) {}
  return {};
}
function writeSaved(data) { try { fs.writeFileSync(SAVED_FILE, JSON.stringify(data, null, 2)); } catch (e) {} }

const aiDisabled = new Set();

let sock = null;
let currentQr = null;
let currentPairingCode = null;
let isConnected = false;
let hasQr = false;
let reconnectTimer = null;
let qrTimeout = null;
let startTime = Date.now();
let pairedPhone = null;

const AUTH_DIR = path.join(__dirname, "auth_info_baileys");

function clearAuthFolder() {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      const files = fs.readdirSync(AUTH_DIR);
      for (const file of files) { try { fs.unlinkSync(path.join(AUTH_DIR, file)); } catch (e) {} }
      try { fs.rmdirSync(AUTH_DIR); } catch (e) {}
      console.log("[MFG_bot] Auth folder cleared");
    }
  } catch (e) { console.error("[MFG_bot] Error clearing auth:", e.message); }
}

function getAuthState() {
  if (!fs.existsSync(AUTH_DIR)) return { exists: false, files: [] };
  try { return { exists: true, files: fs.readdirSync(AUTH_DIR) }; } catch (e) { return { exists: false, files: [] }; }
}

const JOKES = [
  "Why don't scientists trust atoms? Because they make up everything! 😄",
  "I told my wife she was drawing her eyebrows too high. She looked surprised. 😂",
  "Why did the scarecrow win an award? Because he was outstanding in his field! 🌾",
  "What do you call a fake noodle? An impasta! 🍝",
  "Why can't you give Elsa a balloon? Because she'll let it go! ❄️",
  "I'm reading a book about anti-gravity. It's impossible to put down! 📚",
  "Did you hear about the mathematician who's afraid of negative numbers? He'll stop at nothing to avoid them! 🔢",
  "Why did the bicycle fall over? Because it was two-tired! 🚲",
  "What do you call cheese that isn't yours? Nacho cheese! 🧀",
  "Why don't eggs tell jokes? They'd crack each other up! 🥚",
];

const QUOTES = [
  "The only way to do great work is to love what you do. — Steve Jobs",
  "In the middle of every difficulty lies opportunity. — Albert Einstein",
  "It does not matter how slowly you go as long as you do not stop. — Confucius",
  "Life is what happens when you're busy making other plans. — John Lennon",
  "The future belongs to those who believe in the beauty of their dreams. — Eleanor Roosevelt",
  "Success is not final, failure is not fatal: it is the courage to continue that counts. — Winston Churchill",
  "You miss 100% of the shots you don't take. — Wayne Gretzky",
  "Whether you think you can or you think you can't, you're right. — Henry Ford",
  "The best time to plant a tree was 20 years ago. The second best time is now. — Chinese Proverb",
  "An unexamined life is not worth living. — Socrates",
];

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function safeMath(expr) {
  try {
    const clean = expr.replace(/[^0-9+\-*/.()%\s]/g, "");
    if (!clean) return null;
    const result = Function('"use strict"; return (' + clean + ')')();
    if (typeof result !== "number" || !isFinite(result)) return null;
    return result;
  } catch (e) { return null; }
}

async function handleCommand(from, msg, text) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(" ");
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

  const reply = async (replyText) => {
    await sock.sendMessage(from, { text: replyText }, { quoted: msg });
  };

  switch (cmd) {
    case ".ping":
      await reply("🏓 *Pong!* Bot is online and responding.");
      return true;

    case ".help":
      await reply(
        "*🤖 MFG_bot Commands*\n\n" +
        "*.ping* — Check if bot is alive\n" +
        "*.help* — Show this command list\n" +
        "*.greet* — Send the greeting message\n" +
        "*.info* — Show bot info & uptime\n" +
        "*.time* — Current date and time\n" +
        "*.joke* — Get a random joke\n" +
        "*.quote* — Get a motivational quote\n" +
        "*.echo <text>* — Bot repeats your text\n" +
        "*.calc <expr>* — Calculate math (e.g. .calc 5*8+2)\n" +
        "*.save* — Save a quoted message\n" +
        "*.saved* — View your saved messages\n" +
        "*.clear* — Clear your saved messages\n" +
        "*.ai* — Toggle AI replies on/off\n" +
        "*.about* — About this bot"
      );
      return true;

    case ".greet":
      await reply(settings.greeting);
      return true;

    case ".info": {
      const uptime = formatUptime(Date.now() - startTime);
      let baileysVer = "unknown";
      try { baileysVer = require("@whiskeysockets/baileys/package.json").version; } catch (e) {}
      const aiEngine = process.env.GROQ_API_KEY ? "Groq (Llama 3)" : process.env.OPENAI_API_KEY ? "OpenAI (GPT-3.5)" : "None (greeting only)";
      await reply(
        "*🤖 MFG_bot Info*\n\n" +
        `⏱ *Uptime:* ${uptime}\n` +
        `🔗 *Status:* Connected\n` +
        `🧠 *AI Engine:* ${aiEngine}\n` +
        `📦 *Baileys:* v${baileysVer}\n` +
        `📵 *Auto-reject calls:* ${settings.autoCallReject ? "On" : "Off"}`
      );
      return true;
    }

    case ".time": {
      const now = new Date();
      const dateStr = now.toLocaleString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
      });
      await reply(`🕐 *Current Time*\n\n${dateStr}`);
      return true;
    }

    case ".joke": {
      const joke = JOKES[Math.floor(Math.random() * JOKES.length)];
      await reply(`😂 *Random Joke*\n\n${joke}`);
      return true;
    }

    case ".quote": {
      const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      await reply(`💡 *Quote of the Moment*\n\n_${quote}_`);
      return true;
    }

    case ".echo":
      if (!args) { await reply("Usage: *.echo <your text>*"); return true; }
      await reply(args);
      return true;

    case ".calc": {
      if (!args) { await reply("Usage: *.calc <expression>*\nExample: .calc 10 * 5 / 2"); return true; }
      const result = safeMath(args);
      if (result === null) { await reply("❌ Invalid expression. Example: *.calc 10 * 5 / 2*"); return true; }
      await reply(`🧮 *Calculator*\n\n${args} = *${result}*`);
      return true;
    }

    case ".save": {
      const savedAll = loadSaved();
      const userSaved = savedAll[from] || [];
      let textToSave = args;
      if (!textToSave && quoted) {
        textToSave = quoted.conversation || quoted.extendedTextMessage?.text || "";
      }
      if (!textToSave) {
        await reply("❌ Reply to a message with *.save* or type *.save <text>* to save a note.");
        return true;
      }
      userSaved.push({ text: textToSave, savedAt: new Date().toLocaleString() });
      savedAll[from] = userSaved;
      writeSaved(savedAll);
      await reply(`✅ *Saved!* (${userSaved.length} total)\n\n_"${textToSave}"_`);
      return true;
    }

    case ".saved": {
      const savedAll = loadSaved();
      const userSaved = savedAll[from] || [];
      if (userSaved.length === 0) {
        await reply("📭 You have no saved messages.\n\nUse *.save <text>* or reply to a message with *.save*.");
        return true;
      }
      const list = userSaved.map((e, i) => `*${i + 1}.* ${e.text}\n   _${e.savedAt}_`).join("\n\n");
      await reply(`📌 *Your Saved Messages* (${userSaved.length})\n\n${list}`);
      return true;
    }

    case ".clear": {
      const savedAll = loadSaved();
      const count = (savedAll[from] || []).length;
      if (count === 0) { await reply("📭 You have no saved messages to clear."); return true; }
      delete savedAll[from];
      writeSaved(savedAll);
      await reply(`🗑 Cleared *${count}* saved message${count !== 1 ? "s" : ""}.`);
      return true;
    }

    case ".ai": {
      if (aiDisabled.has(from)) {
        aiDisabled.delete(from);
        await reply("🤖 AI replies turned *ON*. I'll respond to your messages intelligently.");
      } else {
        aiDisabled.add(from);
        await reply("🔇 AI replies turned *OFF*. I'll only respond to commands now.\n\nSend *.ai* again to turn it back on.");
      }
      return true;
    }

    case ".about":
      await reply(
        "*🤖 About MFG_bot*\n\n" +
        "MFG_bot is a WhatsApp automation bot powered by Baileys and AI.\n\n" +
        "It can reply to messages using AI, reject calls automatically, " +
        "respond to commands, and save your notes — all from WhatsApp.\n\n" +
        "Built with ❤️ on Railway + Replit."
      );
      return true;

    default:
      return false;
  }
}

async function sendAIReply(from, text) {
  if (!sock || !isConnected) return;
  try {
    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (groqKey || openaiKey) {
      const apiUrl = groqKey
        ? "https://api.groq.com/openai/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
      const apiKey = groqKey || openaiKey;
      const model = groqKey ? "llama-3.3-70b-versatile" : "gpt-3.5-turbo";

      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: settings.systemPrompt },
            { role: "user", content: text },
          ],
        }),
      });
      const data = await resp.json();
      const reply = data.choices?.[0]?.message?.content;
      if (reply) {
        await sock.sendMessage(from, { text: reply });
        console.log("[MFG_bot] AI reply sent to", from, "via", groqKey ? "Groq" : "OpenAI");
        return;
      }
      console.error("[MFG_bot] AI returned no reply:", JSON.stringify(data));
    }

    await sock.sendMessage(from, { text: settings.greeting });
    console.log("[MFG_bot] Greeting reply sent to", from, "(no AI key configured)");
  } catch (err) {
    console.error("[MFG_bot] Reply error:", err.message);
    try { await sock.sendMessage(from, { text: settings.greeting }); } catch (e) {}
  }
}

async function connectToWhatsApp(phoneForPairing) {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }

  try {
    console.log("[MFG_bot] Connecting... Auth:", JSON.stringify(getAuthState()));
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

    const { version } = await fetchLatestBaileysVersion().catch(() => {
      return { version: [2, 3000, 1023044367] };
    });
    console.log("[MFG_bot] WA version:", version.join("."));

    const usePairingCode = !!phoneForPairing;

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: !usePairingCode,
      logger: pino({ level: "silent" }),
      browser: Browsers.macOS("Desktop"),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    if (usePairingCode && !sock.authState.creds.registered) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const code = await sock.requestPairingCode(phoneForPairing);
        currentPairingCode = code;
        pairedPhone = phoneForPairing;
        console.log("[MFG_bot] Pairing code:", code);
      } catch (err) {
        console.error("[MFG_bot] Pairing code error:", err.message);
      }
    }

    qrTimeout = setTimeout(() => {
      if (!isConnected && !hasQr && !currentPairingCode) {
        console.log("[MFG_bot] No QR/code after 30s — retrying");
        if (sock) { try { sock.ev.removeAllListeners(); } catch (e) {} sock = null; }
        clearAuthFolder();
        reconnectTimer = setTimeout(() => connectToWhatsApp(), 3000);
      }
    }, 30000);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("[MFG_bot] QR code generated");
        currentQr = qr;
        hasQr = true;
        isConnected = false;
        if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
      }

      if (connection === "open") {
        console.log("[MFG_bot] Connected successfully!");
        isConnected = true;
        hasQr = false;
        currentQr = null;
        currentPairingCode = null;
        if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      }

      if (connection === "close") {
        isConnected = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log("[MFG_bot] Closed. Code:", code, "Full:", JSON.stringify(lastDisconnect));
        if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
        if (code === DisconnectReason.loggedOut) {
          console.log("[MFG_bot] Logged out — clearing credentials");
          currentQr = null;
          hasQr = false;
          currentPairingCode = null;
          clearAuthFolder();
        }
        reconnectTimer = setTimeout(() => connectToWhatsApp(), 5000);
      }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (msg.key.fromMe || !msg.message) continue;
        const from = msg.key.remoteJid;
        if (!from || from.endsWith("@g.us")) continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          "";

        console.log("[MFG_bot] Message from", from, ":", text || "(no text)");
        if (!text) continue;

        if (text.startsWith(".")) {
          const handled = await handleCommand(from, msg, text);
          if (handled) continue;
        }

        if (aiDisabled.has(from)) continue;

        await sendAIReply(from, text);
      }
    });

    sock.ev.on("call", async (calls) => {
      if (!settings.autoCallReject) return;
      for (const call of calls) {
        if (call.status === "offer") {
          try {
            await sock.rejectCall(call.id, call.from);
            console.log("[MFG_bot] Call rejected from", call.from);
          } catch (e) { console.error("[MFG_bot] Call reject error:", e.message); }
        }
      }
    });

  } catch (err) {
    console.error("[MFG_bot] Startup error:", err.message);
    if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
    reconnectTimer = setTimeout(() => connectToWhatsApp(), 8000);
  }
}

app.get("/", (req, res) => res.send("MFG_bot is running"));
app.get("/status", (req, res) => res.json({ connected: isConnected, hasQr, hasPairingCode: !!currentPairingCode }));
app.get("/qr", (req, res) => currentQr ? res.json({ qr: currentQr }) : res.status(404).json({ error: "No QR available" }));
app.get("/pairing-code", (req, res) => currentPairingCode ? res.json({ code: currentPairingCode, phone: pairedPhone }) : res.status(404).json({ error: "No pairing code" }));

app.get("/debug", (req, res) => {
  let baileysVersion = "unknown";
  try { baileysVersion = require("@whiskeysockets/baileys/package.json").version; } catch (e) {}
  res.json({
    connected: isConnected,
    hasQr,
    hasPairingCode: !!currentPairingCode,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    auth: getAuthState(),
    hasSock: !!sock,
    baileysVersion,
    hasGroq: !!process.env.GROQ_API_KEY,
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    autoCallReject: settings.autoCallReject,
  });
});

app.post("/logout", async (req, res) => {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (e) {}
    try { await sock.logout(); } catch (e) {}
    sock = null;
  }
  isConnected = false; hasQr = false; currentQr = null; currentPairingCode = null; pairedPhone = null;
  clearAuthFolder();
  res.json({ success: true });
  setTimeout(() => connectToWhatsApp(), 2000);
});

app.post("/request-pairing-code", async (req, res) => {
  try {
    const cleaned = String(req.body.phoneNumber || "").replace(/[^0-9]/g, "");
    if (!cleaned) return res.status(400).json({ error: "phoneNumber required (digits only, with country code)" });
    if (sock) { try { sock.ev.removeAllListeners(); } catch (e) {} sock = null; }
    clearAuthFolder();
    currentPairingCode = null;
    await new Promise(r => setTimeout(r, 1000));
    connectToWhatsApp(cleaned);
    await new Promise(r => setTimeout(r, 6000));
    if (currentPairingCode) return res.json({ code: currentPairingCode });
    res.status(503).json({ error: "Could not get pairing code yet — try GET /pairing-code in a few seconds" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/get-features", (req, res) => res.json({ autoCallReject: settings.autoCallReject }));
app.post("/set-feature", (req, res) => {
  if (req.body.feature === "autoCallReject") {
    settings.autoCallReject = Boolean(req.body.enabled);
    saveSettings(settings);
    return res.json({ success: true });
  }
  res.status(400).json({ error: "Unknown feature" });
});
app.get("/get-greeting", (req, res) => res.json({ message: settings.greeting }));
app.post("/set-greeting", (req, res) => {
  if (!req.body.message) return res.status(400).json({ error: "required" });
  settings.greeting = req.body.message;
  saveSettings(settings);
  res.json({ success: true });
});
app.get("/get-system-prompt", (req, res) => res.json({ prompt: settings.systemPrompt }));
app.post("/set-system-prompt", (req, res) => {
  if (!req.body.prompt) return res.status(400).json({ error: "required" });
  settings.systemPrompt = req.body.prompt;
  saveSettings(settings);
  res.json({ success: true });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[MFG_bot] Server running on port ${PORT}`);
  startTime = Date.now();
  connectToWhatsApp();
});