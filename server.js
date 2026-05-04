const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
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
  return { autoCallReject: false, greeting: "Hello! I am MFG_bot. How can I help you today?", systemPrompt: "You are MFG_bot, a helpful WhatsApp assistant." };
}
function saveSettings(data) { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2)); } catch (e) {} }
let settings = loadSettings();

let sock = null, currentQr = null, isConnected = false, hasQr = false, reconnectTimer = null;

function clearAuthFolder() {
  const authDir = path.join(__dirname, "auth_info_baileys");
  try { if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true }); } catch (e) {}
}

async function connectToWhatsApp() {
  try {
    console.log("[MFG_bot] Connecting...");
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: "silent" }),
      browser: ["MFG_bot", "Chrome", "1.0.0"],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      markOnlineOnConnect: false,
    });

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) { console.log("[MFG_bot] QR ready"); currentQr = qr; hasQr = true; isConnected = false; }
      if (connection === "open") { console.log("[MFG_bot] Connected!"); isConnected = true; hasQr = false; currentQr = null; if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } }
      if (connection === "close") {
        isConnected = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log(`[MFG_bot] Closed: ${code}`);
        if (code === DisconnectReason.loggedOut) { clearAuthFolder(); }
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
          const resp = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: "gpt-3.5-turbo", messages: [{ role: "system", content: settings.systemPrompt }, { role: "user", content: text }] }) });
          const data = await resp.json();
          const reply = data.choices?.[0]?.message?.content;
          if (reply) await sock.sendMessage(from, { text: reply });
        } catch (err) { console.error("[MFG_bot] OpenAI error:", err.message); }
      }
    });

    sock.ev.on("call", async (calls) => {
      if (!settings.autoCallReject) return;
      for (const call of calls) if (call.status === "offer") try { await sock.rejectCall(call.id, call.from); } catch (e) {}
    });

  } catch (err) {
    console.error("[MFG_bot] Startup error:", err.message);
    reconnectTimer = setTimeout(connectToWhatsApp, 8000);
  }
}

app.get("/", (req, res) => res.send("Bot is running"));
app.get("/status", (req, res) => res.json({ connected: isConnected, hasQr }));
app.get("/qr", (req, res) => currentQr ? res.json({ qr: currentQr }) : res.status(404).json({ error: "No QR available" }));

app.post("/request-pairing-code", async (req, res) => {
  try {
    const cleaned = String(req.body.phoneNumber || "").replace(/[^0-9]/g, "");
    if (!cleaned) return res.status(400).json({ error: "phoneNumber required" });
    res.json({ code: await sock.requestPairingCode(cleaned) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/logout", async (req, res) => {
  try {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (sock) { try { sock.ev.removeAllListeners(); } catch (e) {} try { await sock.logout(); } catch (e) {} sock = null; }
    isConnected = false; hasQr = false; currentQr = null;
    clearAuthFolder();
    res.json({ success: true });
    setTimeout(connectToWhatsApp, 2000);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`[MFG_bot] Server on port ${PORT}`); connectToWhatsApp(); });