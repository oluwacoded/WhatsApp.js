const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const pino = require("pino");

const app = express();
app.use(cors());
app.use(express.json());

const SETTINGS_FILE   = path.join(__dirname, "settings.json");
const SAVED_FILE      = path.join(__dirname, "saved_messages.json");
const BROADCAST_FILE  = path.join(__dirname, "broadcast_contacts.json");
const STYLE_FILE      = path.join(__dirname, "style_samples.json");
const AUTH_DIR        = path.join(__dirname, "auth_info_baileys");

function readJson(file, def) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
  return def;
}
function writeJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) {}
}

function loadSettings() {
  return readJson(SETTINGS_FILE, {
    autoCallReject: false,
    callRejectMessage: "⚠️ This user has not authorized WhatsApp calls. Please wait for them to call you back.",
    greeting: "Hello! I am MFG_bot. How can I help you today?",
    systemPrompt: "You are MFG_bot, a helpful WhatsApp assistant. Answer questions clearly and concisely.",
  });
}
let settings = loadSettings();
const saveSettings = () => writeJson(SETTINGS_FILE, settings);

let sock               = null;
let currentQr          = null;
let currentPairingCode = null;
let isConnected        = false;
let hasQr              = false;
let reconnectTimer     = null;
let qrTimeout          = null;
let startTime          = Date.now();
let pairedPhone        = null;
let botJid             = null;

const aiDisabled          = new Set();
const conversationHistory = new Map();

function clearAuthFolder() {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      fs.readdirSync(AUTH_DIR).forEach(f => { try { fs.unlinkSync(path.join(AUTH_DIR, f)); } catch (e) {} });
      try { fs.rmdirSync(AUTH_DIR); } catch (e) {}
      console.log("[MFG_bot] Auth folder cleared");
    }
  } catch (e) { console.error("[MFG_bot] Error clearing auth:", e.message); }
}

function getAuthState() {
  if (!fs.existsSync(AUTH_DIR)) return { exists: false, files: [] };
  try { return { exists: true, files: fs.readdirSync(AUTH_DIR) }; } catch (e) { return { exists: false, files: [] }; }
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
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
    return (typeof result === "number" && isFinite(result)) ? result : null;
  } catch (e) { return null; }
}

function normalizePhone(raw) { return raw.replace(/[^0-9]/g, ""); }

const JOKES = [
  "Why don't scientists trust atoms? Because they make up everything! 😄",
  "I told my wife she was drawing her eyebrows too high. She looked surprised. 😂",
  "Why did the scarecrow win an award? He was outstanding in his field! 🌾",
  "What do you call a fake noodle? An impasta! 🍝",
  "Why can't you give Elsa a balloon? She'll let it go! ❄️",
  "I'm reading a book about anti-gravity. Impossible to put down! 📚",
  "Why did the bicycle fall over? It was two-tired! 🚲",
  "What do you call cheese that isn't yours? Nacho cheese! 🧀",
  "Why don't eggs tell jokes? They'd crack each other up! 🥚",
  "I asked my dog what 2 minus 2 is. He said nothing. 🐶",
];

const QUOTES = [
  "The only way to do great work is to love what you do. — Steve Jobs",
  "In the middle of every difficulty lies opportunity. — Albert Einstein",
  "It does not matter how slowly you go as long as you do not stop. — Confucius",
  "The future belongs to those who believe in the beauty of their dreams. — Eleanor Roosevelt",
  "Success is not final, failure is not fatal: courage to continue is what counts. — Winston Churchill",
  "You miss 100% of the shots you don't take. — Wayne Gretzky",
  "Whether you think you can or you can't, you're right. — Henry Ford",
  "The best time to plant a tree was 20 years ago. The second best is now. — Chinese Proverb",
];

function getStyleSamples() { return readJson(STYLE_FILE, []); }
function addStyleSample(sample) {
  const samples = getStyleSamples();
  samples.push(sample);
  if (samples.length > 50) samples.splice(0, samples.length - 50);
  writeJson(STYLE_FILE, samples);
}
function buildSystemPrompt() {
  const base = settings.systemPrompt;
  const samples = getStyleSamples();
  if (samples.length === 0) return base;
  const exampleBlock = samples.map((s, i) => `${i + 1}. "${s}"`).join("\n");
  return `${base}\n\nIMPORTANT — Mimic the owner's chat style. Here are real examples of how the owner texts:\n${exampleBlock}\nRespond in this same tone, vocabulary, and style.`;
}

function getHistory(jid) {
  if (!conversationHistory.has(jid)) conversationHistory.set(jid, []);
  return conversationHistory.get(jid);
}
function pushHistory(jid, role, content) {
  const h = getHistory(jid);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
}
function clearHistory(jid) { conversationHistory.delete(jid); }

async function sendAIReply(from, text) {
  if (!sock || !isConnected) return;
  try {
    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (groqKey || openaiKey) {
      const apiUrl = groqKey ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
      const apiKey = groqKey || openaiKey;
      const model  = groqKey ? "llama-3.3-70b-versatile" : "gpt-3.5-turbo";
      pushHistory(from, "user", text);
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "system", content: buildSystemPrompt() }, ...getHistory(from)] }),
      });
      const data  = await resp.json();
      const reply = data.choices?.[0]?.message?.content;
      if (reply) {
        pushHistory(from, "assistant", reply);
        await sock.sendMessage(from, { text: reply });
        console.log("[MFG_bot] AI reply →", from, "via", groqKey ? "Groq" : "OpenAI");
        return;
      }
      console.error("[MFG_bot] AI no reply:", JSON.stringify(data));
    }
    await sock.sendMessage(from, { text: settings.greeting });
  } catch (err) {
    console.error("[MFG_bot] Reply error:", err.message);
    try { await sock.sendMessage(from, { text: settings.greeting }); } catch (e) {}
  }
}

async function handleCommand(from, msg, text, isOwner) {
  const parts = text.trim().split(/\s+/);
  const cmd   = parts[0].toLowerCase();
  const args  = parts.slice(1).join(" ");
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const reply = async (t) => sock.sendMessage(from, { text: t }, { quoted: msg });

  switch (cmd) {
    case ".ping":
      await reply("🏓 *Pong!* Bot is online and responding.");
      return true;

    case ".help":
      await reply(
        "*🤖 MFG_bot Commands*\n\n" +
        "*General*\n" +
        "*.ping* — Check if bot is alive\n" +
        "*.help* — This list\n" +
        "*.info* — Bot status & uptime\n" +
        "*.time* — Current date & time\n" +
        "*.joke* — Random joke\n" +
        "*.quote* — Motivational quote\n" +
        "*.echo <text>* — Bot repeats your text\n" +
        "*.calc <expr>* — Calculator (e.g. .calc 5*8)\n" +
        "*.ai* — Toggle AI replies on/off\n" +
        "*.reset* — Clear conversation memory\n\n" +
        "*Saving*\n" +
        "*.save [text]* — Save a note or quoted message\n" +
        "*.saved* — View saved notes\n" +
        "*.del <#>* — Delete a saved note by number\n" +
        "*.clear* — Clear all saved notes\n\n" +
        "*Broadcast (owner only)*\n" +
        "*.addbc <number>* — Add to broadcast list\n" +
        "*.removebc <number>* — Remove from broadcast list\n" +
        "*.listbc* — View broadcast list\n" +
        "*.broadcast <message>* — Send to all broadcast contacts\n\n" +
        "*Style Learning (owner only)*\n" +
        "*.learnme <text>* — Teach bot how you talk\n" +
        "*.mystyle* — Show style samples\n" +
        "*.clearstyle* — Clear style samples\n\n" +
        "*.greet* — Send greeting\n" +
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
      const aiEngine = process.env.GROQ_API_KEY ? "Groq (Llama 3)" : process.env.OPENAI_API_KEY ? "OpenAI (GPT-3.5)" : "None";
      await reply(
        "*🤖 MFG_bot Info*\n\n" +
        `⏱ *Uptime:* ${uptime}\n` +
        `🔗 *Status:* Connected\n` +
        `🧠 *AI Engine:* ${aiEngine}\n` +
        `📦 *Baileys:* v${baileysVer}\n` +
        `📵 *Auto-reject calls:* ${settings.autoCallReject ? "On" : "Off"}\n` +
        `📣 *Broadcast contacts:* ${readJson(BROADCAST_FILE, []).length}\n` +
        `🎭 *Style samples:* ${getStyleSamples().length}\n` +
        `💬 *Active conversations:* ${conversationHistory.size}`
      );
      return true;
    }

    case ".time": {
      const now = new Date();
      await reply(`🕐 *Current Time*\n\n${now.toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}`);
      return true;
    }

    case ".joke":
      await reply(`😂 *Random Joke*\n\n${JOKES[Math.floor(Math.random() * JOKES.length)]}`);
      return true;

    case ".quote":
      await reply(`💡 *Quote*\n\n_${QUOTES[Math.floor(Math.random() * QUOTES.length)]}_`);
      return true;

    case ".echo":
      if (!args) { await reply("Usage: *.echo <text>*"); return true; }
      await reply(args);
      return true;

    case ".calc": {
      if (!args) { await reply("Usage: *.calc <expression>*"); return true; }
      const result = safeMath(args);
      if (result === null) { await reply("❌ Invalid expression."); return true; }
      await reply(`🧮 *Calculator*\n\n${args} = *${result}*`);
      return true;
    }

    case ".ai": {
      if (aiDisabled.has(from)) { aiDisabled.delete(from); await reply("🤖 AI replies turned *ON*."); }
      else { aiDisabled.add(from); await reply("🔇 AI replies turned *OFF*. Send *.ai* again to re-enable."); }
      return true;
    }

    case ".reset":
      clearHistory(from);
      await reply("🔄 Conversation memory cleared. Starting fresh!");
      return true;

    case ".save": {
      const savedAll = readJson(SAVED_FILE, {});
      const userSaved = savedAll[from] || [];
      let textToSave = args;
      if (!textToSave && quoted) textToSave = quoted.conversation || quoted.extendedTextMessage?.text || "";
      if (!textToSave) { await reply("❌ Reply to a message with *.save* or type *.save <text>*."); return true; }
      userSaved.push({ text: textToSave, savedAt: new Date().toLocaleString() });
      savedAll[from] = userSaved;
      writeJson(SAVED_FILE, savedAll);
      await reply(`✅ *Saved!* (${userSaved.length} total)\n\n_"${textToSave}"_`);
      return true;
    }

    case ".saved": {
      const userSaved = (readJson(SAVED_FILE, {}))[from] || [];
      if (userSaved.length === 0) { await reply("📭 No saved notes. Use *.save <text>* to add one."); return true; }
      await reply(`📌 *Saved Notes* (${userSaved.length})\n\n${userSaved.map((e, i) => `*${i + 1}.* ${e.text}\n   _${e.savedAt}_`).join("\n\n")}`);
      return true;
    }

    case ".del": {
      const n = parseInt(args, 10);
      const savedAll = readJson(SAVED_FILE, {});
      const userSaved = savedAll[from] || [];
      if (!n || n < 1 || n > userSaved.length) { await reply(`❌ Invalid number. You have ${userSaved.length} saved note(s).`); return true; }
      const removed = userSaved.splice(n - 1, 1)[0];
      savedAll[from] = userSaved;
      writeJson(SAVED_FILE, savedAll);
      await reply(`🗑 Deleted note ${n}:\n_"${removed.text}"_`);
      return true;
    }

    case ".clear": {
      const savedAll = readJson(SAVED_FILE, {});
      const count = (savedAll[from] || []).length;
      if (count === 0) { await reply("📭 No saved notes to clear."); return true; }
      delete savedAll[from];
      writeJson(SAVED_FILE, savedAll);
      await reply(`🗑 Cleared *${count}* note${count !== 1 ? "s" : ""}.`);
      return true;
    }

    case ".addbc": {
      if (!isOwner) { await reply("❌ Only the bot owner can manage the broadcast list."); return true; }
      const num = normalizePhone(args);
      if (!num) { await reply("Usage: *.addbc <number with country code>*\nExample: .addbc 2349012345678"); return true; }
      const list = readJson(BROADCAST_FILE, []);
      const jid  = `${num}@s.whatsapp.net`;
      if (list.includes(jid)) { await reply(`⚠️ *+${num}* is already in the broadcast list.`); return true; }
      list.push(jid);
      writeJson(BROADCAST_FILE, list);
      await reply(`✅ *+${num}* added. (${list.length} total)`);
      return true;
    }

    case ".removebc": {
      if (!isOwner) { await reply("❌ Only the bot owner can manage the broadcast list."); return true; }
      const num = normalizePhone(args);
      if (!num) { await reply("Usage: *.removebc <number>*"); return true; }
      let list = readJson(BROADCAST_FILE, []);
      const jid = `${num}@s.whatsapp.net`;
      const before = list.length;
      list = list.filter(j => j !== jid);
      if (list.length === before) { await reply(`⚠️ *+${num}* not found.`); return true; }
      writeJson(BROADCAST_FILE, list);
      await reply(`✅ *+${num}* removed. (${list.length} remaining)`);
      return true;
    }

    case ".listbc": {
      if (!isOwner) { await reply("❌ Only the bot owner can view the broadcast list."); return true; }
      const list = readJson(BROADCAST_FILE, []);
      if (list.length === 0) { await reply("📭 Broadcast list is empty. Use *.addbc <number>* to add contacts."); return true; }
      await reply(`📣 *Broadcast List* (${list.length})\n\n${list.map((j, i) => `*${i + 1}.* +${j.replace("@s.whatsapp.net", "")}`).join("\n")}`);
      return true;
    }

    case ".broadcast": {
      if (!isOwner) { await reply("❌ Only the bot owner can send broadcasts."); return true; }
      if (!args) { await reply("Usage: *.broadcast <your message>*"); return true; }
      const list = readJson(BROADCAST_FILE, []);
      if (list.length === 0) { await reply("❌ Broadcast list is empty. Use *.addbc <number>* first."); return true; }
      await reply(`📣 Sending to *${list.length}* contact${list.length !== 1 ? "s" : ""}...`);
      let sent = 0, failed = 0;
      for (const jid of list) {
        try { await sock.sendMessage(jid, { text: args }); sent++; await new Promise(r => setTimeout(r, 1000)); }
        catch (e) { failed++; console.error("[MFG_bot] Broadcast failed for", jid, e.message); }
      }
      await reply(`✅ Done!\n📨 Sent: *${sent}*\n❌ Failed: *${failed}*`);
      return true;
    }

    case ".learnme": {
      if (!isOwner) { await reply("❌ Only the bot owner can train the style."); return true; }
      let sample = args;
      if (!sample && quoted) sample = quoted.conversation || quoted.extendedTextMessage?.text || "";
      if (!sample) { await reply("Usage: *.learnme <example of how you text>*\nOr reply to one of your messages with *.learnme*"); return true; }
      addStyleSample(sample);
      await reply(`🎭 *Style sample saved!* (${getStyleSamples().length} total)\n\nAI will now talk more like you. Add more examples to improve it.`);
      return true;
    }

    case ".mystyle": {
      if (!isOwner) { await reply("❌ Only the bot owner can view style samples."); return true; }
      const samples = getStyleSamples();
      if (samples.length === 0) { await reply("🎭 No style samples yet. Use *.learnme <your message>* to teach the bot."); return true; }
      await reply(`🎭 *Your Style Samples* (${samples.length})\n\n${samples.map((s, i) => `*${i + 1}.* "${s}"`).join("\n")}`);
      return true;
    }

    case ".clearstyle": {
      if (!isOwner) { await reply("❌ Only the bot owner can clear style samples."); return true; }
      const count = getStyleSamples().length;
      writeJson(STYLE_FILE, []);
      await reply(`🗑 Cleared *${count}* style sample${count !== 1 ? "s" : ""}. AI will use default style.`);
      return true;
    }

    case ".about":
      await reply(
        "*🤖 About MFG_bot*\n\n" +
        "WhatsApp bot powered by Baileys + AI (Groq/OpenAI).\n\n" +
        "✅ Stays online 24/7\n" +
        "✅ Auto-views all statuses\n" +
        "✅ AI replies to everyone\n" +
        "✅ Learns your chat style\n" +
        "✅ Remembers conversation context\n" +
        "✅ Rejects calls with a message\n" +
        "✅ Broadcast messaging\n" +
        "✅ Notes/saving system\n\n" +
        "Built with ❤️ on Railway + Replit."
      );
      return true;

    default:
      return false;
  }
}

async function connectToWhatsApp(phoneForPairing) {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (qrTimeout)      { clearTimeout(qrTimeout);      qrTimeout = null; }

  try {
    console.log("[MFG_bot] Connecting... Auth:", JSON.stringify(getAuthState()));
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1023044367] }));
    console.log("[MFG_bot] WA version:", version.join("."));

    const usePairingCode = !!phoneForPairing;

    sock = makeWASocket({
      version, auth: state,
      printQRInTerminal: !usePairingCode,
      logger: pino({ level: "silent" }),
      browser: Browsers.macOS("Desktop"),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      markOnlineOnConnect: true,
      syncFullHistory: false,
    });

    if (usePairingCode && !sock.authState.creds.registered) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const code = await sock.requestPairingCode(phoneForPairing);
        currentPairingCode = code; pairedPhone = phoneForPairing;
        console.log("[MFG_bot] Pairing code:", code);
      } catch (err) { console.error("[MFG_bot] Pairing code error:", err.message); }
    }

    qrTimeout = setTimeout(() => {
      if (!isConnected && !hasQr && !currentPairingCode) {
        console.log("[MFG_bot] No QR/code after 30s — retrying");
        if (sock) { try { sock.ev.removeAllListeners(); } catch (e) {} sock = null; }
        clearAuthFolder();
        reconnectTimer = setTimeout(() => connectToWhatsApp(), 3000);
      }
    }, 30000);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("[MFG_bot] QR code generated");
        currentQr = qr; hasQr = true; isConnected = false;
        if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
      }

      if (connection === "open") {
        console.log("[MFG_bot] Connected!");
        isConnected = true; hasQr = false; currentQr = null; currentPairingCode = null;
        botJid = sock.user?.id?.replace(/:.*@/, "@") || null;
        if (qrTimeout)      { clearTimeout(qrTimeout);      qrTimeout = null; }
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

        // Stay online permanently
        try { await sock.sendPresenceUpdate("available"); } catch (e) {}
        setInterval(async () => {
          if (isConnected && sock) {
            try { await sock.sendPresenceUpdate("available"); } catch (e) {}
          }
        }, 60000);
      }

      if (connection === "close") {
        isConnected = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log("[MFG_bot] Closed. Code:", code, JSON.stringify(lastDisconnect));
        if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
        if (code === DisconnectReason.loggedOut) {
          currentQr = null; hasQr = false; currentPairingCode = null;
          clearAuthFolder();
        }
        reconnectTimer = setTimeout(() => connectToWhatsApp(), 5000);
      }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (!msg.message) continue;
        const from = msg.key.remoteJid;
        if (!from) continue;

        // Auto-view WhatsApp statuses
        if (from === "status@broadcast") {
          try { await sock.readMessages([msg.key]); console.log("[MFG_bot] Viewed status from", msg.key.participant); } catch (e) {}
          continue;
        }

        if (from.endsWith("@g.us"))      continue;  // skip groups
        if (from.endsWith("@broadcast")) continue;  // skip other broadcasts

        const isOwner = msg.key.fromMe;
        const text =
          msg.message.conversation                      ||
          msg.message.extendedTextMessage?.text         ||
          msg.message.imageMessage?.caption             ||
          msg.message.videoMessage?.caption             ||
          "";

        // Owner's own device — only handle commands, don't AI-reply to yourself
        if (isOwner) {
          if (text.startsWith(".")) await handleCommand(from, msg, text, true);
          continue;
        }

        console.log("[MFG_bot] Message from", from, ":", text || "(no text)");
        if (!text) continue;

        if (text.startsWith(".")) {
          const handled = await handleCommand(from, msg, text, false);
          if (handled) continue;
        }

        if (aiDisabled.has(from)) continue;
        await sendAIReply(from, text);
      }
    });

    sock.ev.on("call", async (calls) => {
      for (const call of calls) {
        if (call.status !== "offer") continue;
        if (settings.autoCallReject) {
          try { await sock.rejectCall(call.id, call.from); console.log("[MFG_bot] Call rejected from", call.from); }
          catch (e) { console.error("[MFG_bot] Call reject error:", e.message); }
        }
        try { await sock.sendMessage(call.from, { text: settings.callRejectMessage }); }
        catch (e) { console.error("[MFG_bot] Call message error:", e.message); }
      }
    });

  } catch (err) {
    console.error("[MFG_bot] Startup error:", err.message);
    if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
    reconnectTimer = setTimeout(() => connectToWhatsApp(), 8000);
  }
}

app.get("/",             (req, res) => res.send("MFG_bot is running"));
app.get("/status",       (req, res) => res.json({ connected: isConnected, hasQr, hasPairingCode: !!currentPairingCode }));
app.get("/qr",           (req, res) => currentQr ? res.json({ qr: currentQr }) : res.status(404).json({ error: "No QR" }));
app.get("/pairing-code", (req, res) => currentPairingCode ? res.json({ code: currentPairingCode, phone: pairedPhone }) : res.status(404).json({ error: "No pairing code" }));

app.get("/debug", (req, res) => {
  let baileysVersion = "unknown";
  try { baileysVersion = require("@whiskeysockets/baileys/package.json").version; } catch (e) {}
  res.json({
    connected: isConnected, hasQr, hasPairingCode: !!currentPairingCode,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    auth: getAuthState(), hasSock: !!sock, baileysVersion,
    hasGroq: !!process.env.GROQ_API_KEY, hasOpenAI: !!process.env.OPENAI_API_KEY,
    autoCallReject: settings.autoCallReject,
    broadcastCount: readJson(BROADCAST_FILE, []).length,
    styleSamples: getStyleSamples().length,
    activeConversations: conversationHistory.size,
  });
});

app.post("/logout", async (req, res) => {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (qrTimeout)      { clearTimeout(qrTimeout);      qrTimeout = null; }
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
    if (!cleaned) return res.status(400).json({ error: "phoneNumber required" });
    if (sock) { try { sock.ev.removeAllListeners(); } catch (e) {} sock = null; }
    clearAuthFolder(); currentPairingCode = null;
    await new Promise(r => setTimeout(r, 1000));
    connectToWhatsApp(cleaned);
    await new Promise(r => setTimeout(r, 6000));
    if (currentPairingCode) return res.json({ code: currentPairingCode });
    res.status(503).json({ error: "Could not get pairing code yet — try GET /pairing-code in a few seconds" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/get-features",      (req, res) => res.json({ autoCallReject: settings.autoCallReject, callRejectMessage: settings.callRejectMessage }));
app.post("/set-feature",      (req, res) => {
  if (req.body.feature === "autoCallReject") { settings.autoCallReject = Boolean(req.body.enabled); saveSettings(); return res.json({ success: true }); }
  if (req.body.feature === "callRejectMessage") { if (!req.body.value) return res.status(400).json({ error: "value required" }); settings.callRejectMessage = req.body.value; saveSettings(); return res.json({ success: true }); }
  res.status(400).json({ error: "Unknown feature" });
});
app.get("/get-greeting",      (req, res) => res.json({ message: settings.greeting }));
app.post("/set-greeting",     (req, res) => { if (!req.body.message) return res.status(400).json({ error: "required" }); settings.greeting = req.body.message; saveSettings(); res.json({ success: true }); });
app.get("/get-system-prompt", (req, res) => res.json({ prompt: settings.systemPrompt }));
app.post("/set-system-prompt",(req, res) => { if (!req.body.prompt) return res.status(400).json({ error: "required" }); settings.systemPrompt = req.body.prompt; saveSettings(); res.json({ success: true }); });
app.get("/get-broadcast",     (req, res) => res.json({ contacts: readJson(BROADCAST_FILE, []) }));
app.get("/get-style",         (req, res) => res.json({ samples: getStyleSamples() }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[MFG_bot] Server running on port ${PORT}`);
  startTime = Date.now();
  connectToWhatsApp();
});