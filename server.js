const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers
} = require("@whiskeysockets/baileys");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const pino = require("pino");

const app = express();
app.use(cors());
app.use(express.json());

[span_1](start_span)// Persistent Settings Management[span_1](end_span)
const SETTINGS_FILE = path.join(__dirname, "settings.json");
function loadSettings() {
  try { if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch (e) {}
  return { 
    autoCallReject: false, 
    greeting: "yo. mfg_bot here.", 
    systemPrompt: "You are a 30-year-old Texas developer/entrepreneur. owner of rentals and cars. be short, direct, lowercase, no ai fluff." 
  };
}
function saveSettings(data) { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2)); } catch (e) {} }
let settings = loadSettings();

let sock = null, currentQr = null, isConnected = false, hasQr = false, reconnectCount = 0;

async function connectToWhatsApp() {
  console.log("[MFG_bot] Attempting connection...");
  
  // 1. [span_2](start_span)Setup Auth State[span_2](end_span)
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  
  // 2. [span_3](start_span)Fetch Latest Version to avoid rejection[span_3](end_span)
  const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ 
    version: [2, 3000, 1015901307], 
    isLatest: false 
  }));
  console.log(`[MFG_bot] Using WA version: ${version.join('.')} (Latest: ${isLatest})`);

  [span_4](start_span)sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: "silent" }),
    // FIX: Using MACOS browser to resolve current pairing rejection issues[span_4](end_span)
    browser: Browsers.macOS("Chrome"), 
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
    syncFullHistory: false, // Prevents heavy data usage on startup
  });

  // 3. [span_5](start_span)Handle Connection Updates[span_5](end_span)
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) { 
      currentQr = qr; 
      hasQr = true; 
      isConnected = false; 
      console.log("[MFG_bot] NEW QR GENERATED"); 
    }
    
    if (connection === "open") { 
      isConnected = true; 
      hasQr = false; 
      currentQr = null; 
      reconnectCount = 0;
      console.log("[MFG_bot] SUCCESS: WhatsApp Connected"); 
    }
    
    if (connection === "close") {
      isConnected = false;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      const reason = lastDisconnect?.error?.output?.statusCode;
      
      console.log(`[MFG_bot] Connection Closed. Reason Code: ${reason}. Reconnecting: ${shouldReconnect}`);
      
      if (reason === DisconnectReason.loggedOut) {
        console.log("[MFG_bot] Logged out. Clearing auth folder...");
        fs.rmSync(path.join(__dirname, "auth_info_baileys"), { recursive: true, force: true });
      }
      
      if (shouldReconnect) {
        reconnectCount++;
        const delay = Math.min(reconnectCount * 5000, 30000); // Incremental backoff
        setTimeout(connectToWhatsApp, delay);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // 4. Message & Command Logic
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (msg.key.fromMe || !msg.message) continue;
      const from = msg.key.remoteJid;
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

      // COMMAND: .vv (View Once)
      if (text.startsWith(".vv")) {
        const content = text.replace(".vv", "").trim();
        return await sock.sendMessage(from, { text: content || "view this once." }, { viewOnce: true });
      }
      
      // COMMAND: .site
      if (text === ".site") {
        return await sock.sendMessage(from, { text: "check the portfolio: https://ash-cloth.ink" });
      }

      // AI Logic (OpenAI/Groq Integration)
      if (process.env.OPENAI_API_KEY && text.length > 1) {
        try {
          const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json", 
              "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` 
            },
            body: JSON.stringify({ 
              model: "gpt-3.5-turbo", 
              messages: [
                { role: "system", content: `${settings.systemPrompt} Always provide straight, short, lowercase answers. No AI fluff.` }, 
                { role: "user", content: text }
              ] 
            }),
          });
          const data = await resp.json();
          const reply = data.choices?.[0]?.message?.content;
          if (reply) await sock.sendMessage(from, { text: reply.toLowerCase() });
        } catch (err) { console.error("[MFG_bot] AI Error:", err.message); }
      }
    }
  });

  // Call Rejection Logic
  sock.ev.on("call", async (calls) => {
    if (!settings.autoCallReject) return;
    for (const call of calls) {
      if (call.status === "offer") {
        try { await sock.rejectCall(call.id, call.from); } catch (e) {}
      }
    }
  });
}

// 5. API Endpoints for your Replit Dashboard
app.get("/", (req, res) => res.send("MFG_bot Backend Online"));
app.get("/status", (req, res) => res.json({ connected: isConnected, hasQr }));
app.get("/qr", (req, res) => currentQr ? res.json({ qr: currentQr }) : res.status(404).send("no qr"));
app.post("/set-system-prompt", (req, res) => {
  if (!req.body.prompt) return res.status(400).send("missing prompt");
  settings.systemPrompt = req.body.prompt;
  saveSettings(settings);
  res.json({ success: true });
});

// FIX: PORT 8080 for Railway
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => { 
  console.log(`[MFG_bot] Server active on port ${PORT}`); 
  connectToWhatsApp(); 
});
