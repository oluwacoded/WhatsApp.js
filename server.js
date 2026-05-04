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
function loadSettings() {
  try { if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch (e) {}
  return { autoCallReject: false, greeting: "Hello! I am MFG_bot. How can I help you today?", systemPrompt: "You are MFG_bot, a helpful WhatsApp assistant. Answer questions clearly and concisely." };
}
function saveSettings(data) { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2)); } catch (e) {} }
let settings = loadSettings();

let sock = null;
let currentQr = null;
let isConnected = false;
let hasQr = false;
let reconnectTimer = null;
let qrTimeout = null;
let startTime = Date.now();

const AUTH_DIR = path.join(__dirname, "auth_info_baileys");

function clearAuthFolder() {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      const files = fs.readdirSync(AUTH_DIR);
      for (const file of files) {
        try { fs.unlinkSync(path.join(AUTH_DIR, file)); } catch (e) {}
      }
      try { fs.rmdirSync(AUTH_DIR); } catch (e) {}
      console.log("[MFG_bot] Auth folder cleared");
    } else {
      console.log("[MFG_bot] Auth folder does not exist");
    }
  } catch (e) {
    console.error("[MFG_bot] Error clearing auth:", e.message);
  }
}

function getAuthState() {
  if (!fs.existsSync(AUTH_DIR)) return { exists: false, files: [] };
  try { return { exists: true, files: fs.readdirSync(AUTH_DIR) }; } catch (e) { return { exists: false, files: [] }; }
}

async function connectToWhatsApp() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
  try {
    console.log("[MFG_bot] Connecting... Auth:", JSON.stringify(getAuthState()));
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

    const { version } = await fetchLatestBaileysVersion().catch(() => {
      console.log("[MFG_bot] Could not fetch latest version, using fallback");
      return { version: [2, 3000, 1023044367] };
    });
    console.log("[MFG_bot] Using WA version:", version.join("."));

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: "silent" }),
      browser: Browsers.ubuntu("Chrome"),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    qrTimeout = setTimeout(() => {
      if (!isConnected && !hasQr) {
        console.log("[MFG_bot] No QR after 25s — clearing auth and retrying");
        if (sock) { try { sock.ev.removeAllListeners(); } catch (e) {} sock = null; }
        clearAuthFolder();
        reconnectTimer = setTimeout(connectToWhatsApp, 2000);
      }
    }, 25000);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("[MFG_bot] QR code generated!");
        currentQr = qr;
        hasQr = true;
        isConnected = false;
        if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
      }

      if (connection === "open") {
        console.log("[MFG_bot] WhatsApp connected successfully!");
        isConnected = true;
        hasQr = false;
        currentQr = null;
        if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      }

      if (connection === "close") {
        isConnected = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log("[MFG_bot] Connection closed. Code:", code);
        if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
        if (code === DisconnectReason.loggedOut) {
          console.log("[MFG_bot] Logged out — clearing credentials");
          currentQr = null;
          hasQr = false;
          clearAuthFolder();
        }
        reconnectTimer = setTimeout(connectToWhatsApp, 5000);
      }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (msg.key.fromMe || !msg.message) continue;
        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text || !process.env.OPENAI_API_KEY) continue;
        try {
          const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            body: JSON.stringify({ model: "gpt-3.5-turbo", messages: [{ role: "system", content: settings.systemPrompt }, { role: "user", content: text }] }),
          });
          const data = await resp.json();
          const reply = data.choices?.[0]?.message?.content;
          if (reply) await sock.sendMessage(from, { text: reply });
        } catch (err) { console.error("[MFG_bot] OpenAI error:", err.message); }
      }
    });

    sock.ev.on("call", async (calls) => {
      if (!settings.autoCallReject) return;
      for (const call of calls) {
        if (call.status === "offer") try { await sock.rejectCall(call.id, call.from); } catch (e) {}
      }
    });

  } catch (err) {
    console.error("[MFG_bot] Startup error:", err.message);
    if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
    reconnectTimer = setTimeout(connectToWhatsApp, 8000);
  }
}

app.get("/", (req, res) => res.send("Bot is running"));
app.get("/status", (req, res) => res.json({ connected: isConnected, hasQr }));
app.get("/qr", (req, res) => currentQr ? res.json({ qr: currentQr }) : res.status(404).json({ error: "No QR available" }));

app.get("/debug", (req, res) => {
  res.json({
    connected: isConnected,
    hasQr,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    auth: getAuthState(),
    hasSock: !!sock,
    hasReconnectTimer: !!reconnectTimer,
  });
});

app.post("/logout", async (req, res) => {
  console.log("[MFG_bot] Manual logout triggered");
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (e) {}
    try { await sock.logout(); } catch (e) {}
    sock = null;
  }
  isConnected = false;
  hasQr = false;
  currentQr = null;
  clearAuthFolder();
  res.json({ success: true, authAfterClear: getAuthState() });
  setTimeout(connectToWhatsApp, 2000);
});

app.post("/request-pairing-code", async (req, res) => {
  try {
    const cleaned = String(req.body.phoneNumber || "").replace(/[^0-9]/g, "");
    if (!cleaned) return res.status(400).json({ error: "phoneNumber required" });
    if (!sock) return res.status(503).json({ error: "Bot not ready" });
    const code = await sock.requestPairingCode(cleaned);
    res.json({ code });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/get-features", (req, res) => res.json({ autoCallReject: settings.autoCallReject }));
app.post("/set-feature", (req, res) => {
  if (req.body.feature === "autoCallReject") { settings.autoCallReject = Boolean(req.body.enabled); saveSettings(settings); return res.json({ success: true }); }
  res.status(400).json({ error: "Unknown feature" });
});
app.get("/get-greeting", (req, res) => res.json({ message: settings.greeting }));
app.post("/set-greeting", (req, res) => { if (!req.body.message) return res.status(400).json({ error: "required" }); settings.greeting = req.body.message; saveSettings(settings); res.json({ success: true }); });
app.get("/get-system-prompt", (req, res) => res.json({ prompt: settings.systemPrompt }));
app.post("/set-system-prompt", (req, res) => { if (!req.body.prompt) return res.status(400).json({ error: "required" }); settings.systemPrompt = req.body.prompt; saveSettings(settings); res.json({ success: true }); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[MFG_bot] Server running on port ${PORT}`);
  startTime = Date.now();
  connectToWhatsApp();
});