const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers
} = require("baileys");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const pino = require("pino");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "client/dist")));

// ─── Persistence ────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function readJSON(file, def) {
  try {
    const p = path.join(DATA_DIR, file);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {}
  return def;
}
function writeJSON(file, data) {
  try { fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2)); } catch (e) {}
}

let settings = readJSON("settings.json", {
  autoCallReject: false,
  autoReadStatus: false,
  aiEnabled: false,
  aiMode: "smart",
  aiDelay: 2,
  aiTyping: true,
  greeting: "yo. mfg_bot here.",
  systemPrompt: "You are a 30-year-old Texas developer/entrepreneur. Owner of rentals and cars. Be short, direct, lowercase, no AI fluff.",
  prefix: ".",
  botName: "mfg_bot",
  owners: []
});

let styleSamples = readJSON("style_samples.json", []);
let userData = readJSON("users.json", {});

// ─── Bot State ───────────────────────────────────────────────────────────────
let sock = null, currentQr = null, isConnected = false, hasQr = false;
let reconnectCount = 0, startTime = Date.now();
let allChats = [];
let commandStats = {};
let messageCount = 0;

function trackCommand(cmd) {
  commandStats[cmd] = (commandStats[cmd] || 0) + 1;
}

// ─── Owner Config ────────────────────────────────────────────────────────────
const OWNER_NUMBER = "23409132883869";
const OWNER_JID = `${OWNER_NUMBER}@s.whatsapp.net`;

function isOwner(jid) {
  return jid === OWNER_JID || jid?.replace(/[^0-9]/g, "") === OWNER_NUMBER;
}

// ─── Groq AI ─────────────────────────────────────────────────────────────────
async function askGroq(userText, jid) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const styleContext = styleSamples.length
      ? `\n\nLearned user style samples:\n${styleSamples.slice(-5).join("\n")}`
      : "";
    const userStyle = userData[jid]?.style || "";
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: `${settings.systemPrompt}${styleContext}${userStyle ? "\n\nAdapt to this user's style: " + userStyle : ""}` },
          { role: "user", content: userText }
        ],
        max_tokens: 300,
        temperature: 0.7
      })
    });
    const data = await resp.json();
    if (!resp.ok) { console.error("[MFG_bot] Groq error:", data); return null; }
    return data.choices?.[0]?.message?.content?.toLowerCase()?.trim() || null;
  } catch (err) {
    console.error("[MFG_bot] Groq fetch error:", err.message);
    return null;
  }
}

// ─── WhatsApp Connection ─────────────────────────────────────────────────────
async function connectToWhatsApp() {
  console.log("[MFG_bot] Attempting connection...");
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({
    version: [2, 3000, 1015901307], isLatest: false
  }));
  console.log(`[MFG_bot] WA version: ${version.join(".")} (latest: ${isLatest})`);

  sock = makeWASocket({
    version, auth: state,
    printQRInTerminal: true,
    logger: pino({ level: "silent" }),
    browser: Browsers.ubuntu("Chrome"),
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
    retryRequestDelayMs: 2000,
    maxMsgRetryCount: 3,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) { currentQr = qr; hasQr = true; isConnected = false; console.log("[MFG_bot] QR Generated"); }
    if (connection === "open") {
      isConnected = true; hasQr = false; currentQr = null; reconnectCount = 0;
      console.log("[MFG_bot] Connected to WhatsApp");
      // Greet the owner on every fresh connection
      setTimeout(async () => {
        try {
          await sock.sendMessage(OWNER_JID, {
            text: `mfg_bot online ✅\n\nyou're linked. i'm ready.\n\nmodel: openai/gpt-oss-120b via groq\nai: ${settings.aiEnabled ? "on" : "off"}\n\nyou're my maker. i listen to you first.`
          });
        } catch (e) { console.log("[MFG_bot] Could not message owner:", e.message); }
      }, 3000);
    }
    if (connection === "close") {
      isConnected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`[MFG_bot] Disconnected. Code: ${code}. Reconnect: ${shouldReconnect}`);
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync(path.join(__dirname, "auth_info_baileys"), { recursive: true, force: true });
      }
      if (shouldReconnect) {
        reconnectCount++;
        setTimeout(connectToWhatsApp, Math.min(reconnectCount * 5000, 30000));
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("chats.set", ({ chats }) => { allChats = chats || []; });
  sock.ev.on("chats.upsert", (newChats) => {
    for (const c of newChats) {
      const idx = allChats.findIndex(x => x.id === c.id);
      if (idx >= 0) allChats[idx] = c; else allChats.push(c);
    }
  });

  // ─── Message Handler ──────────────────────────────────────────────────────
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (msg.key.fromMe || !msg.message) continue;
      messageCount++;
      const from = msg.key.remoteJid;
      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption || ""
      ).trim();
      const pfx = settings.prefix || ".";

      const send = (t) => sock.sendMessage(from, { text: t });
      const senderIsOwner = isOwner(from);

      // Auto-read status
      if (settings.autoReadStatus && from.endsWith("@broadcast")) {
        try { await sock.readMessages([msg.key]); } catch (e) {}
        continue;
      }

      if (!text) continue;

      // ── Owner greeting when they message the bot ──────────────────────
      if (senderIsOwner && !userData[from]?.greeted) {
        if (!userData[from]) userData[from] = {};
        userData[from].greeted = true;
        writeJSON("users.json", userData);
        await send(`sup maker 👋 i'm your bot. all commands unlocked. type .menu to see what i can do.`);
      }

      // ── Who-made-you detection (non-commands, natural language) ───────
      const lowerText = text.toLowerCase();
      const creatorTriggers = ["who made you", "who created you", "who built you", "who is your creator", "who is your maker", "who owns you", "who is your owner", "wey make you", "who program you"];
      if (!text.startsWith(pfx) && creatorTriggers.some(t => lowerText.includes(t))) {
        await send(`i was built by my maker — +${OWNER_NUMBER}. he's the only one i fully listen to.`);
        continue;
      }

      // ── Commands ────────────────────────────────────────────────────────
      if (text.startsWith(pfx)) {
        const [rawCmd, ...args] = text.slice(pfx.length).trim().split(/\s+/);
        const cmd = rawCmd.toLowerCase();
        trackCommand(cmd);

        // .vv — resend as view once
        if (cmd === "vv") {
          const content = args.join(" ");
          await sock.sendMessage(from, { text: content || "view this once." }, { viewOnce: true });
          continue;
        }

        // .site
        if (cmd === "site") {
          await send("check the portfolio: https://ash-cloth.ink");
          continue;
        }

        // .ai on | off | status | mode | reset | prompt
        if (cmd === "ai") {
          const sub = args[0]?.toLowerCase();
          if (sub === "on") { settings.aiEnabled = true; writeJSON("settings.json", settings); await send("ai on. 👀"); }
          else if (sub === "off") { settings.aiEnabled = false; writeJSON("settings.json", settings); await send("ai off."); }
          else if (sub === "status") { await send(`ai is ${settings.aiEnabled ? "on" : "off"} | mode: ${settings.aiMode}`); }
          else if (sub === "mode") { settings.aiMode = args[1] || "smart"; writeJSON("settings.json", settings); await send(`mode set: ${settings.aiMode}`); }
          else if (sub === "reset") { styleSamples = []; writeJSON("style_samples.json", styleSamples); await send("ai memory cleared."); }
          else if (sub === "prompt") {
            const view = args.slice(1).join(" ");
            if (view) { settings.systemPrompt = view; writeJSON("settings.json", settings); await send("prompt updated."); }
            else await send(settings.systemPrompt);
          }
          else if (sub === "delay") { settings.aiDelay = parseInt(args[1]) || 2; writeJSON("settings.json", settings); await send(`delay: ${settings.aiDelay}s`); }
          else if (sub === "typing") { settings.aiTyping = args[1] !== "off"; writeJSON("settings.json", settings); await send(`typing indicator: ${settings.aiTyping ? "on" : "off"}`); }
          else await send(`ai is ${settings.aiEnabled ? "on ✅" : "off ❌"} | .ai on | .ai off | .ai mode smart/aggressive/chill`);
          continue;
        }

        // .learnme — store style samples
        if (cmd === "learnme") {
          const sub = args[0]?.toLowerCase();
          if (sub === "add") {
            const sample = args.slice(1).join(" ");
            if (sample) { styleSamples.push(sample); writeJSON("style_samples.json", styleSamples); await send("style learned."); }
          } else if (sub === "view") {
            await send(styleSamples.length ? styleSamples.slice(-5).join("\n---\n") : "no samples yet.");
          } else if (sub === "clear") {
            styleSamples = []; writeJSON("style_samples.json", styleSamples); await send("style cleared.");
          } else if (sub === "auto") {
            if (!userData[from]) userData[from] = {};
            userData[from].autoLearn = true; writeJSON("users.json", userData);
            await send("auto-learn enabled for this chat.");
          } else {
            await send(".learnme add <text> | .learnme view | .learnme clear | .learnme auto");
          }
          continue;
        }

        // .style
        if (cmd === "style") {
          const mode = args.join(" ");
          if (!userData[from]) userData[from] = {};
          userData[from].style = mode; writeJSON("users.json", userData);
          await send(`style set: ${mode}`);
          continue;
        }

        // .broadcast — owner only guard FIRST
        if (cmd === "broadcast") {
          if (!senderIsOwner) { await send("nah. that's a maker-only command."); continue; }
          const sub = args[0]?.toLowerCase();
          const msgText = args.slice(1).join(" ");
          if (sub === "all" || sub === "dm") {
            const targets = allChats.filter(c => c.id.endsWith("@s.whatsapp.net"));
            let sent = 0;
            for (const chat of targets.slice(0, 50)) {
              try { await sock.sendMessage(chat.id, { text: msgText }); sent++; } catch (e) {}
            }
            await send(`broadcast sent to ${sent} chats.`);
          } else if (sub === "group") {
            const targets = allChats.filter(c => c.id.endsWith("@g.us"));
            let sent = 0;
            for (const chat of targets.slice(0, 20)) {
              try { await sock.sendMessage(chat.id, { text: msgText }); sent++; } catch (e) {}
            }
            await send(`broadcast sent to ${sent} groups.`);
          } else if (sub === "status") {
            await send(`chats available: ${allChats.length}`);
          } else {
            await send(".broadcast all <msg> | .broadcast group <msg> | .broadcast status");
          }
          continue;
        }

        // .owner — anyone can check
        if (cmd === "owner") {
          await send(`mfg_bot was built by its maker.\ncontact: +${OWNER_NUMBER}`);
          continue;
        }

        // .bot
        if (cmd === "bot") {
          const sub = args[0]?.toLowerCase();
          const uptime = Math.floor((Date.now() - startTime) / 1000);
          if (sub === "status") await send(`mfg_bot online ✅\nuptime: ${uptime}s\nmessages: ${messageCount}\nai: ${settings.aiEnabled ? "on" : "off"}`);
          else if (sub === "ping") await send(`pong 🏓 ${Date.now() - msg.messageTimestamp * 1000}ms`);
          else if (sub === "uptime") await send(`uptime: ${uptime}s`);
          else if (sub === "version") await send("mfg_bot v2.0 | baileys + groq");
          else if (sub === "prefix") { settings.prefix = args[1] || "."; writeJSON("settings.json", settings); await send(`prefix set: ${settings.prefix}`); }
          else await send(".bot status | .bot ping | .bot uptime | .bot version | .bot prefix <symbol>");
          continue;
        }

        // .stats
        if (cmd === "stats") {
          const sub = args[0]?.toLowerCase();
          if (sub === "commands") {
            const top = Object.entries(commandStats).sort((a, b) => b[1] - a[1]).slice(0, 5);
            await send("top commands:\n" + top.map(([k, v]) => `${k}: ${v}`).join("\n"));
          } else if (sub === "memory") {
            const mem = process.memoryUsage();
            await send(`rss: ${Math.round(mem.rss / 1024 / 1024)}mb\nheap: ${Math.round(mem.heapUsed / 1024 / 1024)}mb`);
          } else {
            await send(`messages: ${messageCount}\nchats: ${allChats.length}\ncommands used:\n${Object.keys(commandStats).length} unique`);
          }
          continue;
        }

        // .send — owner only
        if (cmd === "send") {
          if (!senderIsOwner) { await send("only my maker can send messages to other numbers."); continue; }
          const number = args[0]?.replace(/[^0-9]/g, "");
          const msgContent = args.slice(1).join(" ");
          if (number && msgContent) {
            await sock.sendMessage(`${number}@s.whatsapp.net`, { text: msgContent });
            await send(`sent to ${number}`);
          } else await send(".send <number> <message>");
          continue;
        }

        // .qr — show QR as text
        if (cmd === "qr") {
          const content = args.join(" ");
          if (content) await sock.sendMessage(from, { text: content }); // simplified
          else await send("use: .qr <text>");
          continue;
        }

        // .define, .joke, .quote, .fact, .flip, .roll
        if (cmd === "flip") { await send(Math.random() > 0.5 ? "heads 🪙" : "tails 🪙"); continue; }
        if (cmd === "roll") { await send(`rolled: ${Math.floor(Math.random() * 6) + 1} 🎲`); continue; }
        if (cmd === "ping") { await send("pong 🏓"); continue; }

        // .menu / .help
        if (cmd === "menu" || cmd === "help") {
          const topic = args[0]?.toLowerCase();
          if (topic === "ai") await send(".ai on | off | status | mode | reset | prompt | delay | typing");
          else if (topic === "broadcast") await send(".broadcast all | group | dm | status");
          else await send(`mfg_bot commands:\n.ai | .learnme | .broadcast | .bot | .stats | .send | .vv | .site | .style | .owner | .flip | .roll | .ping\n\n.help ai | .help broadcast for details`);
          continue;
        }

        // Unknown command
        if (settings.aiEnabled) {
          // fall through to AI below
        } else {
          await send(`unknown command. try .menu`);
          continue;
        }
      }

      // ── Auto-Learn ──────────────────────────────────────────────────────
      if (userData[from]?.autoLearn && text.length > 10 && !text.startsWith(pfx)) {
        styleSamples.push(text);
        if (styleSamples.length > 100) styleSamples = styleSamples.slice(-100);
        writeJSON("style_samples.json", styleSamples);
      }

      // ── AI Reply ────────────────────────────────────────────────────────
      if (settings.aiEnabled && text.length > 1 && !text.startsWith(pfx)) {
        try {
          if (settings.aiTyping) await sock.sendPresenceUpdate("composing", from);
          if (settings.aiDelay > 0) await new Promise(r => setTimeout(r, settings.aiDelay * 1000));
          const reply = await askGroq(text, from);
          if (settings.aiTyping) await sock.sendPresenceUpdate("paused", from);
          if (reply) await send(reply);
        } catch (err) { console.error("[MFG_bot] AI error:", err.message); }
      }
    }
  });

  // ─── Call Rejection ───────────────────────────────────────────────────────
  sock.ev.on("call", async (calls) => {
    if (!settings.autoCallReject) return;
    for (const call of calls) {
      if (call.status === "offer") {
        try { await sock.rejectCall(call.id, call.from); } catch (e) {}
      }
    }
  });
}

// ─── API Endpoints ────────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => res.json({
  connected: isConnected,
  hasQr,
  uptime: Math.floor((Date.now() - startTime) / 1000),
  messageCount,
  chatCount: allChats.length,
  aiEnabled: settings.aiEnabled
}));

app.get("/api/qr", (req, res) =>
  currentQr ? res.json({ qr: currentQr }) : res.status(404).json({ error: "no qr available" })
);

// Pairing code — more reliable than QR on newer WhatsApp versions
app.post("/api/pair", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "missing phone number" });
  if (!sock) return res.status(503).json({ error: "bot not initialised" });
  if (isConnected) return res.status(400).json({ error: "already connected" });
  try {
    const clean = phone.replace(/[^0-9]/g, "");
    const code = await sock.requestPairingCode(clean);
    console.log(`[MFG_bot] Pairing code for ${clean}: ${code}`);
    res.json({ success: true, code });
  } catch (e) {
    console.error("[MFG_bot] Pairing code error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/settings", (req, res) => res.json(settings));
app.post("/api/settings", (req, res) => {
  settings = { ...settings, ...req.body };
  writeJSON("settings.json", settings);
  res.json({ success: true, settings });
});

app.post("/api/set-system-prompt", (req, res) => {
  if (!req.body.prompt) return res.status(400).json({ error: "missing prompt" });
  settings.systemPrompt = req.body.prompt;
  writeJSON("settings.json", settings);
  res.json({ success: true });
});

app.get("/api/style", (req, res) => res.json({ samples: styleSamples }));
app.post("/api/style", (req, res) => {
  const { sample } = req.body;
  if (!sample) return res.status(400).json({ error: "missing sample" });
  styleSamples.push(sample);
  writeJSON("style_samples.json", styleSamples);
  res.json({ success: true, count: styleSamples.length });
});
app.delete("/api/style", (req, res) => {
  styleSamples = [];
  writeJSON("style_samples.json", styleSamples);
  res.json({ success: true });
});

app.get("/api/stats", (req, res) => res.json({
  messageCount,
  chatCount: allChats.length,
  commandStats,
  uptime: Math.floor((Date.now() - startTime) / 1000),
  memory: process.memoryUsage()
}));

app.post("/api/broadcast", async (req, res) => {
  const { message, type = "all" } = req.body;
  if (!message) return res.status(400).json({ error: "missing message" });
  if (!isConnected) return res.status(503).json({ error: "bot not connected" });
  let targets = type === "group"
    ? allChats.filter(c => c.id.endsWith("@g.us"))
    : allChats.filter(c => c.id.endsWith("@s.whatsapp.net"));
  targets = targets.slice(0, 50);
  let sent = 0, failed = 0;
  for (const chat of targets) {
    try { await sock.sendMessage(chat.id, { text: message }); sent++; } catch (e) { failed++; }
  }
  res.json({ success: true, sent, failed, total: targets.length });
});

app.post("/api/logout", (req, res) => {
  try {
    fs.rmSync(path.join(__dirname, "auth_info_baileys"), { recursive: true, force: true });
    isConnected = false; hasQr = false; currentQr = null;
    if (sock) { try { sock.logout(); } catch (e) {} }
    setTimeout(connectToWhatsApp, 2000);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve React for all non-API routes
app.get("*", (req, res) => {
  const indexPath = path.join(__dirname, "client/dist/index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send("MFG_bot Hub — building frontend... restart after build completes.");
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[MFG_bot] Server running on port ${PORT}`);
  connectToWhatsApp();
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`[MFG_bot] Port ${PORT} busy, retrying in 3s...`);
    setTimeout(() => {
      server.close();
      server.listen(PORT, "0.0.0.0");
    }, 3000);
  } else {
    console.error("[MFG_bot] Server error:", err);
  }
});
