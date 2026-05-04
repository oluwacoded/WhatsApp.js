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
function loadSettings() {
  try { if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch (e) {}
  return { autoCallReject: false, greeting: "Hello! I am MFG_bot. How can I help you today?", systemPrompt: "You are MFG_bot, a helpful WhatsApp assistant. Answer questions clearly and concisely." };
}
function saveSettings(data) { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2)); } catch (e) {} }
let settings = loadSettings();

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
      for (const file of files) {
        try { fs.unlinkSync(path.join(AUTH_DIR, file)); } catch (e) {}
      }
      try { fs.rmdirSync(AUTH_DIR); } catch (e) {}
      console.log("[MFG_bot] Auth folder cleared");
    }
  } catch (e) {
    console.error("[MFG_bot] Error clearing auth:", e.message);
  }
}

function getAuthState() {
  if (!fs.existsSync(AUTH_DIR)) return { exists: false, files: [] };
  try { return { exists: true, files: fs.readdirSync(AUTH_DIR) }; } catch (e) { return { exists: false, files: [] }; }
}

async function connectToWhatsApp(phoneForPairing) {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (qrTimeout) { clearTimeout(qrTimeout); qrTimeout = null; }

  const authCheck = getAuthState();
  if (authCheck.exists && authCheck.files.length === 0) {
    console.log("[MFG_bot] Empty auth folder — clearing");
    try { fs.rmdirSync(AUTH_DIR); } catch (e) {}
  }

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
        console.log("[MFG_bot] QR code generated!");
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
    reconnectTimer = setTimeout(() => connectToWhatsApp(), 8000);
  }
}

app.get("/", (req, res) => res.send("Bot is running"));
app.get("/status", (req, res) => res.json({ connected: isConnected, hasQr, hasPairingCode: !!currentPairingCode }));
app.get("/qr", (req, res) => currentQr ? res.json({ qr: currentQr }) : res.status(404).json({ error: "No QR available" }));
app.get("/pairing-code", (req, res) => currentPairingCode ? res.json({ code: currentPairingCode, phone: pairedPhone }) : res.status(404).json({ error: "No pairing code" }));

app.get("/debug", (req, res) => {
  let baileysVersion = "unknown";
  try { baileysVersion = require("@whiskeysockets/baileys/package.json").version; } catch (e) {}
  res.json({ connected: isConnected, hasQr, hasPairingCode: !!currentPairingCode, uptimeSeconds: Math.floor((Date.now() - startTime) / 1000), auth: getAuthState(), hasSock: !!sock, baileysVersion });
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