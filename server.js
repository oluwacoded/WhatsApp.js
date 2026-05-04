const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
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

// --- LOAD/SAVE SETTINGS ---
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    }
  } catch {}
  return {
    autoCallReject: false,
    greeting: "Hello! I am MFG_bot. How can I help you today?",
    systemPrompt: "You are an expert assistant for a short-term rental and car rental business. Answer clearly.",
  };
}

function saveSettings(data) {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2)); } catch {}
}

let settings = loadSettings();
let sock = null;
let currentQr = null;
let isConnected = false;
let hasQr = false;

// --- WHATSAPP CONNECTION ---
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: "silent" });

  sock = makeWASocket({
    version, logger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    printQRInTerminal: false,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) { currentQr = qr; hasQr = true; }
    if (connection === "open") {
      isConnected = true; hasQr = false; currentQr = null;
      console.log("[MFG_bot] Connected!");
    }
    if (connection === "close") {
      isConnected = false;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) connectToWhatsApp();
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // --- MESSAGE & AI LOGIC ---
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (msg.key.fromMe || !msg.message) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    // Simple auto-reply if AI is not configured
    if (text.toLowerCase().includes("hi") || text.toLowerCase().includes("hello")) {
        await sock.sendMessage(from, { text: settings.greeting });
    }
  });

  // --- CALL REJECT LOGIC ---
  sock.ev.on("call", async (calls) => {
    if (settings.autoCallReject) {
      for (const call of calls) {
        if (call.status === "offer") await sock.rejectCall(call.id, call.from);
      }
    }
  });
}

// --- REPLIT DASHBOARD ENDPOINTS ---
app.get("/status", (req, res) => res.json({ connected: isConnected, hasQr }));
app.get("/qr", (req, res) => currentQr ? res.json({ qr: currentQr }) : res.status(404).json({ error: "No QR" }));

app.get("/get-features", (req, res) => res.json({ autoCallReject: settings.autoCallReject }));
app.post("/set-feature", (req, res) => {
  settings.autoCallReject = Boolean(req.body.enabled);
  saveSettings(settings);
  res.json({ success: true });
});

app.get("/get-greeting", (req, res) => res.json({ message: settings.greeting }));
app.post("/set-greeting", (req, res) => {
  settings.greeting = req.body.message;
  saveSettings(settings);
  res.json({ success: true });
});

app.get("/get-system-prompt", (req, res) => res.json({ prompt: settings.systemPrompt }));
app.post("/set-system-prompt", (req, res) => {
  settings.systemPrompt = req.body.prompt;
  saveSettings(settings);
  res.json({ success: true });
});

app.get("/", (req, res) => res.send("MFG_bot Backend Online"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server on port ${PORT}`);
  connectToWhatsApp();
});
