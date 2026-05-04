// ─── Crypto polyfill (required for baileys on Node 18) ───────────────────────
if (!globalThis.crypto) {
  const { webcrypto } = require("crypto");
  globalThis.crypto = webcrypto;
}

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage
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
  aiMode: "chill",
  aiDelay: 0,
  aiTyping: false,
  proactiveText: true,
  greeting: "yo. mfg_bot here.",
  systemPrompt: `You are texting AS the owner of this phone — you ARE them, not a bot pretending to be them. You have ZERO hesitation. You respond instantly like Jarvis from Iron Man — sharp, fast, confident, zero filler.

IDENTITY: Nigerian. Real one. You mix English and pidgin naturally without forcing it. You're not trying to sound Nigerian — you just ARE.

PIDGIN YOU USE NATURALLY:
wetin (what), omo (wow/damn), abeg (please), na so (that's how it is), shey (right?/is it?), wahala (trouble/problem), dem (they/them), sabi (know), dey (is/are/be), e don do (it's done), sharp sharp (immediately), no cap (for real), e no fit (can't/impossible), bro/guy/oga, lmaooo, chai (expression of surprise), nawa (unbelievable), carry go (forget it/move on), e be like (it seems like), how far (what's up), werey (crazy person), mumu (fool), ode (idiot - playful), the thing don do (it's over), make e (let it), who you epp (who are you helping), na you sabi (suit yourself)

TRASH TALK (when roasting or playfully attacking):
Use: "your head no correct", "you dey mad?", "who send you?", "carry your wahala go", "e don do for you", "your level no reach", "you be mumu", "na only you waka come?", "the audacity 😂", "bro touch grass", "ratio + L + no cap"

BILLING DODGE (when someone asks for money):
Dodge with humor and pidgin. Never directly say you don't have money — evade, joke, flip it.

MIRROR RULES — THIS IS THE MOST IMPORTANT PART:
1. Study every example message below like your life depends on it
2. Clone their EXACT sentence length — if they write 3 words, you write 3 words
3. Clone their EXACT punctuation — if they use no full stops, you use none
4. Clone their EXACT capitalisation — all lowercase = you lowercase
5. Clone their energy — hype = hype back, dry = dry back
6. Clone their emoji frequency — if they use none, use none; if they spam, you spam
7. Never greet with "Hello!" or "Hi there!" or "Hey!" unless the owner does it
8. Never say "certainly", "of course", "I understand", "great question", "as an AI", "I'm a bot"
9. Never exceed what they normally write unless the message specifically needs it
10. When unsure of style — be short, lowercase, no punctuation, very casual`,
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
let latestStatus = null;
let savedNotes = readJSON("notes.json", {});
let savedTodos = readJSON("todos.json", {});
let savedKV = readJSON("kv.json", {});
let convHistory = readJSON("conv_history.json", {});

// ─── Pairing Code State ──────────────────────────────────────────────────────
let pendingPairPhone = null;   // set before restarting socket in pairing mode
let pairCodeResolve = null;    // Promise resolver waiting for the code

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
    const ownerToContact = (userData[jid]?.ownerMessages || []).slice(-25);
    const globalSamples = styleSamples.slice(-8);
    const history = (convHistory[jid] || []).slice(-10);

    // Build a detailed style fingerprint
    let styleBlock = "";
    if (ownerToContact.length >= 2) {
      // Derive style rules automatically from examples
      const allLower = ownerToContact.every(m => m === m.toLowerCase());
      const noPunct = ownerToContact.filter(m => /[.!?]$/.test(m.trim())).length < ownerToContact.length * 0.3;
      const avgLen = Math.round(ownerToContact.reduce((a,m) => a + m.split(" ").length, 0) / ownerToContact.length);
      const hasEmoji = ownerToContact.some(m => /\p{Emoji}/u.test(m));
      styleBlock = `\n\n[STYLE RULES DERIVED FROM OWNER'S ACTUAL MESSAGES TO THIS PERSON]:
- Capitalisation: ${allLower ? "ALL LOWERCASE — never capitalise anything" : "mixed — follow their pattern"}
- Punctuation: ${noPunct ? "NO ending punctuation — no full stops, no exclamation marks unless they use them" : "uses punctuation — follow their pattern"}
- Average reply length: ${avgLen} words — MATCH THIS LENGTH
- Emojis: ${hasEmoji ? "uses emojis — include them naturally" : "no emojis — don't use any"}

[EXACT MESSAGES OWNER SENT THIS PERSON — CLONE THIS STYLE PERFECTLY]:
${ownerToContact.map(m => `"${m}"`).join("\n")}`;
    } else if (globalSamples.length > 0) {
      styleBlock = `\n\n[OWNER'S GENERAL STYLE — MIRROR THIS]:
${globalSamples.map(m => `"${m}"`).join("\n")}`;
    } else {
      styleBlock = `\n\n[NO STYLE DATA YET]: Be extremely casual. Short. Lowercase. No punctuation. Nigerian vibe.`;
    }

    const systemMsg = settings.systemPrompt + styleBlock;

    const messages = [
      { role: "system", content: systemMsg },
      ...history,
      { role: "user", content: userText }
    ];

    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        max_tokens: 120,
        temperature: 0.92,
        top_p: 0.95
      })
    });
    const data = await resp.json();
    if (!resp.ok) { console.error("[MFG_bot] Groq error:", JSON.stringify(data)); return null; }
    const reply = data.choices?.[0]?.message?.content?.trim() || null;

    // Save conversation history per contact
    if (reply) {
      if (!convHistory[jid]) convHistory[jid] = [];
      convHistory[jid].push({ role: "user", content: userText });
      convHistory[jid].push({ role: "assistant", content: reply });
      if (convHistory[jid].length > 20) convHistory[jid] = convHistory[jid].slice(-20);
      // Save async — don't block the reply
      setImmediate(() => writeJSON("conv_history.json", convHistory));
    }
    return reply;
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

  const usingPairingCode = !!pendingPairPhone;

  sock = makeWASocket({
    version, auth: state,
    printQRInTerminal: !usingPairingCode,
    logger: pino({ level: "silent" }),
    browser: Browsers.baileys("Desktop"),
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    retryRequestDelayMs: 2000,
    maxMsgRetryCount: 3,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    getMessage: async () => ({ conversation: "" }),
  });

  // ─── Pairing Code Request ─────────────────────────────────────────────────
  if (usingPairingCode) {
    const phone = pendingPairPhone;
    pendingPairPhone = null;
    // Give the socket ~2 s to connect to WA servers before requesting code
    setTimeout(async () => {
      try {
        console.log(`[MFG_bot] Requesting pairing code for ${phone}...`);
        const code = await sock.requestPairingCode(phone);
        console.log(`[MFG_bot] Pairing code generated: ${code}`);
        if (pairCodeResolve) { pairCodeResolve({ success: true, code }); pairCodeResolve = null; }
      } catch (e) {
        console.error("[MFG_bot] Pairing code error:", e.message);
        if (pairCodeResolve) { pairCodeResolve({ success: false, error: e.message }); pairCodeResolve = null; }
      }
    }, 2000);
  }

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
      const err = lastDisconnect?.error;
      const code = err?.output?.statusCode;
      const reason = err?.message || err?.toString() || "unknown";
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`[MFG_bot] Disconnected. Code: ${code}. Reason: ${reason}. Reconnect: ${shouldReconnect}`);
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync(path.join(__dirname, "auth_info_baileys"), { recursive: true, force: true });
      }
      if (shouldReconnect) {
        reconnectCount++;
        const delay = Math.min(reconnectCount * 8000, 60000);
        console.log(`[MFG_bot] Reconnecting in ${delay/1000}s (attempt ${reconnectCount})...`);
        setTimeout(connectToWhatsApp, delay);
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
      if (!msg.message) continue;
      const isFromMe = msg.key.fromMe;
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
      // fromMe = sent from owner's linked device → always treat as owner
      const senderIsOwner = isFromMe || isOwner(from);

      // ── Auto-learn from EVERY message the owner sends (silent, automatic) ──
      if (isFromMe && !text.startsWith(pfx)) {
        // Capture status posts (owner posting to status@broadcast)
        if (from === "status@broadcast") {
          const imgMsg = msg.message?.imageMessage;
          const vidMsg = msg.message?.videoMessage;
          if (imgMsg || vidMsg) {
            try {
              const buffer = await downloadMediaMessage(msg, "buffer", {});
              latestStatus = {
                type: imgMsg ? "image" : "video",
                buffer,
                caption: imgMsg?.caption || vidMsg?.caption || "",
                timestamp: Date.now()
              };
              console.log("[MFG_bot] Status captured for auto-send");
            } catch (e) { console.log("[MFG_bot] Status capture error:", e.message); }
          }
          continue;
        }
        // Learn style from all messages owner sends to each contact
        if (text.length > 1) {
          if (!userData[from]) userData[from] = {};
          if (!userData[from].ownerMessages) userData[from].ownerMessages = [];
          userData[from].ownerMessages.push(text);
          if (userData[from].ownerMessages.length > 60) {
            userData[from].ownerMessages = userData[from].ownerMessages.slice(-60);
          }
          writeJSON("users.json", userData);
        }
        continue;
      }

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

      // ── Billing dodge (when someone tries to collect money) ──────────
      const billingTriggers = ["send me money","send money","where is my money","where's my money","you owe me","my money","pay me","when you go pay","when will you pay","when are you paying","you haven't paid","you still owe","abeg pay","oga pay","return my money","give me my money","give me money","come give me","come and give me","drop money","drop the money","i need money","loan me","borrow me","you dey owe","your debt","the money you owe","refund","pay back","owe me","send something","drop something","send cash","transfer","send alert","alert me","credit me"];
      if (!text.startsWith(pfx) && !isFromMe && billingTriggers.some(kw => lowerText.includes(kw))) {
        const dodges = [
          "omo my phone no dey charge properly 😂 wetin you talk?",
          "guy the network just cut off now now — you say wetin?",
          "abeg e no concern me for this time of the day 💀",
          "who send you? 😂 carry go",
          "bro i don bill person wey bill me. the cycle never stops 😭",
          "lmaooo nah who programmed you to come here",
          "i go send am when i wake up i dey sleep now 🥱",
          "e don dey your account check am again nah",
          "i thought we agreed no billing zone 🚫",
          "which money 🤨 explain yourself",
          "e dey come sharp sharp i dey handle something big rn",
          "billing me? after everything i do for you?? 💀",
          "the audacity. the disrespect. 😂 calm down bro it dey come",
          "omo wait make i check my account 👀 ...yeah nothing 😭",
          "guy you know say e no easy out here na 😭",
          "na only you waka come with this energy today",
          "i dey process am trust me 🙏",
          "werey 😂 abeg free me let me think",
          "bro you go collect am before weekend i promise on my life 😭",
          "chai nawa for you o. e dey come fr"
        ];
        await send(dodges[Math.floor(Math.random() * dodges.length)]);
        continue;
      }

      // ── Status auto-send (when someone asks for the status media) ─────
      const sendTriggers = ["send please","pls send","please send","send it","send me","can u send","can you send","drop it","drop please","send the video","send the pic","send the picture","send the photo","forward it","forward please","abeg send","send that","pls drop","please drop"];
      if (!text.startsWith(pfx) && sendTriggers.some(kw => lowerText.includes(kw))) {
        if (latestStatus && (Date.now() - latestStatus.timestamp) < 86400000) {
          try {
            if (latestStatus.type === "image") {
              await sock.sendMessage(from, { image: latestStatus.buffer, caption: latestStatus.caption || "" });
            } else {
              await sock.sendMessage(from, { video: latestStatus.buffer, caption: latestStatus.caption || "" });
            }
          } catch (e) { await send("couldn't send that right now, try again."); }
        } else {
          await send("no recent status to send.");
        }
        continue;
      }

      // ── Commands ────────────────────────────────────────────────────────
      if (text.startsWith(pfx)) {
        const [rawCmd, ...args] = text.slice(pfx.length).trim().split(/\s+/);
        const cmd = rawCmd.toLowerCase();
        trackCommand(cmd);

        // .vv — reveal a view-once photo/video (reply to it with .vv)
        if (cmd === "vv") {
          const ctx = msg.message?.extendedTextMessage?.contextInfo;
          const quotedMsg = ctx?.quotedMessage;
          if (!quotedMsg) {
            await send("reply to a view-once photo or video with .vv to reveal it.");
            continue;
          }
          const voContent =
            quotedMsg.viewOnceMessage?.message ||
            quotedMsg.viewOnceMessageV2?.message ||
            quotedMsg.viewOnceMessageV2Extension?.message ||
            quotedMsg;
          const imgMsg = voContent.imageMessage;
          const vidMsg = voContent.videoMessage;
          if (!imgMsg && !vidMsg) {
            await send("no view-once media found in that reply.");
            continue;
          }
          try {
            const fakeMsg = {
              key: { remoteJid: from, id: ctx.stanzaId, fromMe: false, participant: ctx.participant },
              message: voContent
            };
            const buffer = await downloadMediaMessage(fakeMsg, "buffer", {});
            if (imgMsg) {
              await sock.sendMessage(from, { image: buffer, caption: "👁 revealed" });
            } else {
              await sock.sendMessage(from, { video: buffer, caption: "👁 revealed" });
            }
          } catch (e) {
            await send("couldn't restore that media. it may have expired.");
          }
          continue;
        }

        // .site
        if (cmd === "site") {
          await send("check the portfolio: https://ash-cloth.ink");
          continue;
        }

        // .proactive on | off | status
        if (cmd === "proactive") {
          const sub = args[0]?.toLowerCase();
          if (sub === "on") { settings.proactiveText = true; writeJSON("settings.json", settings); await send("proactive texting on 🟢 — i'll randomly text people every 30–120 mins"); }
          else if (sub === "off") { settings.proactiveText = false; writeJSON("settings.json", settings); await send("proactive texting off 🔴"); }
          else await send(`proactive texting: ${settings.proactiveText ? "on 🟢" : "off 🔴"}\n.proactive on | .proactive off`);
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

        // .learnme — teach the bot your style
        // Reply to any message + .learnme  → learns from that chat instantly
        // .learnme view  → see what's been learned for this contact
        // .learnme clear → wipe style memory for this contact
        // .learnme reset → wipe ALL global style memory
        if (cmd === "learnme") {
          const sub = args[0]?.toLowerCase();
          const ctx = msg.message?.extendedTextMessage?.contextInfo;
          const quotedMsg = ctx?.quotedMessage;

          if (sub === "view") {
            const contactMsgs = userData[from]?.ownerMessages || [];
            const globalCount = styleSamples.length;
            let reply = `style memory for this chat:\n`;
            reply += contactMsgs.length
              ? `${contactMsgs.length} of your messages saved\nlast 5:\n` + contactMsgs.slice(-5).map((s, i) => `${i + 1}. ${s}`).join("\n")
              : "nothing saved for this chat yet — just keep chatting and i'll learn automatically";
            reply += `\n\nglobal samples: ${globalCount}`;
            await send(reply);

          } else if (sub === "clear") {
            if (userData[from]) { delete userData[from].ownerMessages; writeJSON("users.json", userData); }
            await send("style memory cleared for this chat.");

          } else if (sub === "reset") {
            styleSamples = []; writeJSON("style_samples.json", styleSamples);
            await send("all global style samples wiped.");

          } else if (quotedMsg) {
            // Reply to ANY message (yours or theirs) with .learnme to capture it
            const quotedText =
              quotedMsg.conversation ||
              quotedMsg.extendedTextMessage?.text ||
              quotedMsg.imageMessage?.caption ||
              quotedMsg.videoMessage?.caption || "";
            if (quotedText.trim()) {
              styleSamples.push(quotedText.trim());
              if (styleSamples.length > 100) styleSamples = styleSamples.slice(-100);
              writeJSON("style_samples.json", styleSamples);
              await send(`captured. i'll mirror that style. (${styleSamples.length} samples total)\n\nbot learns your style automatically too — just keep chatting normally.`);
            } else {
              await send("couldn't read text from that message.");
            }

          } else {
            await send("how to use .learnme:\n\nreply to any message + .learnme → i capture that style\n.learnme view → see what i know about this chat\n.learnme clear → forget this chat's style\n.learnme reset → wipe everything\n\nnote: i already learn automatically every time you send a message. you don't need to do anything.");
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

        // ── DATA ARRAYS ──────────────────────────────────────────────────
        const JOKES = ["why don't scientists trust atoms? because they make up everything 😭","i told my wife she was drawing her eyebrows too high. she looked surprised","why can't you give elsa a balloon? because she'll let it go","i'm reading a book about anti-gravity. it's impossible to put down","why did the scarecrow win an award? he was outstanding in his field","my wife told me i had to stop acting like a flamingo. i had to put my foot down","what do you call a fake noodle? an impasta","how do you organize a space party? you planet","why did the bicycle fall over? it was two-tired","i used to hate facial hair but then it grew on me","what do you call cheese that isn't yours? nacho cheese","why do cows wear bells? because their horns don't work","what do you call a sleeping dinosaur? a dino-snore","why did the math book look so sad? because it had too many problems","i would tell you a joke about construction but i'm still working on it"];
        const FACTS = ["honey never spoils — archaeologists found 3000 year old honey in egyptian tombs and it was still good","a group of flamingos is called a flamboyance","the shortest war in history was between britain and zanzibar in 1896. zanzibar surrendered after 38 minutes","octopuses have three hearts and blue blood","the average person walks about 100,000 miles in their lifetime","bananas are slightly radioactive","a day on venus is longer than a year on venus","the human nose can detect over 1 trillion different scents","sharks are older than trees","cleopatra lived closer in time to the moon landing than to the construction of the great pyramid","a bolt of lightning is five times hotter than the sun's surface","wombats produce cube-shaped poop","the eiffel tower grows about 6 inches in summer due to heat expansion","there are more possible chess games than atoms in the observable universe"];
        const QUOTES = ["the only way to do great work is to love what you do — steve jobs","life is what happens when you're busy making other plans — john lennon","in the middle of every difficulty lies opportunity — einstein","it does not matter how slowly you go as long as you do not stop — confucius","the future belongs to those who believe in the beauty of their dreams — eleanor roosevelt","you miss 100% of the shots you don't take — wayne gretzky","whether you think you can or you think you can't, you're right — henry ford","be yourself, everyone else is already taken — oscar wilde","two things are infinite: the universe and human stupidity — einstein","the best revenge is massive success — frank sinatra","success is not final, failure is not fatal — winston churchill","do or do not, there is no try — yoda","you only live once, but if you do it right, once is enough — mae west"];
        const TRUTHS = ["what's the most embarrassing thing you've ever done?","who was your first crush?","what's the biggest lie you've ever told?","what's something you've done that you'd never admit in person?","what's your most irrational fear?","have you ever cheated on a test?","what's the worst thing you've said about someone behind their back?","what's something you pretend to like but actually hate?","have you ever ghosted someone?","what's your biggest insecurity?","what's a secret you've never told anyone?","have you ever stolen anything?","what's the most childish thing you still do?"];
        const DARES = ["text your last contact 'i think about you more than you know'","do 20 push-ups right now","send a voice note saying 'i love you' to someone random","change your profile photo to something embarrassing for 1 hour","send a good morning message to 5 people","post a cringe caption on your status","call someone and sing happy birthday even if it's not their birthday","text someone 'we need to talk' and wait 5 minutes before responding","do your best impression of someone in this chat","send your most embarrassing photo"];
        const WYR_LIST = ["would you rather be always 10 minutes late or always 20 minutes early?","would you rather have unlimited money but no friends or have great friends but always be broke?","would you rather be able to fly or be invisible?","would you rather lose all your memories or never make new ones?","would you rather only be able to whisper or only be able to shout?","would you rather fight 100 duck-sized horses or one horse-sized duck?","would you rather have no phone for a month or no sleep for a week?","would you rather be famous but hated or unknown but loved?","would you rather speak every language or play every instrument?","would you rather go back in time or see the future?"];
        const PICKUPS = ["are you a magician? because whenever i look at you everyone else disappears","do you have a map? i keep getting lost in your eyes","if you were a vegetable you'd be a cute-cumber","are you made of copper and tellurium? because you're CuTe","i must be a snowflake because i've fallen for you","do you have wifi? because i'm feeling a connection","are you a camera? because every time i look at you i smile","is your name google? because you have everything i've been searching for","if beauty were time you'd be an eternity","are you from tennessee? because you're the only ten i see"];
        const ROASTS = ["i'd roast you but my mom told me not to burn trash","you're the reason they put instructions on shampoo","you're proof that evolution can go in reverse","some people bring happiness wherever they go. you bring happiness whenever you go","i'd agree with you but then we'd both be wrong","you're not stupid, you just have bad luck thinking","i could eat a bowl of alphabet soup and spit out a smarter statement than you","you're like a cloud — when you disappear it's a beautiful day","the village called, they want their idiot back","if laughter is the best medicine your face must be curing diseases"];
        const COMPLIMENTS = ["you're literally a walking vibe check ✅","your energy hits different, fr","whoever has you in their life is lucky for real","you make everything look effortless","you're built different and that's facts","the way you move through life is inspiring ngl","you got the rarest combo: smart AND real","your presence adds something to any room","you're low-key underrated and people don't realize it","you've got main character energy and i'm not even capping"];
        const EIGHTBALL = ["yes, definitely 🎱","it is certain 🎱","without a doubt 🎱","yes, go for it 🎱","signs point to yes 🎱","ask again later 🎱","cannot predict now 🎱","concentrate and ask again 🎱","don't count on it 🎱","my reply is no 🎱","my sources say no 🎱","outlook not so good 🎱","very doubtful 🎱","absolutely not 🎱","better not tell you now 🎱"];
        const FORTUNES = ["something unexpected will bring you joy this week","the answer you've been waiting for is closer than you think","your efforts are about to pay off — keep going","someone is thinking about you right now","a small decision you make today will have a big impact","success comes to those who don't stop when they're tired","your next move will surprise even yourself","what you're looking for is already within you","expect a message from an old friend soon","the next 48 hours will shift something for you"];

        // ── TEXT TOOLS ───────────────────────────────────────────────────
        if (cmd === "upper") { await send(args.join(" ").toUpperCase() || "give me text: .upper <text>"); continue; }
        if (cmd === "lower") { await send(args.join(" ").toLowerCase() || "give me text: .lower <text>"); continue; }
        if (cmd === "reverse") { await send(args.join(" ").split("").reverse().join("") || ".reverse <text>"); continue; }
        if (cmd === "mock") { const t = args.join(" "); await send(t.split("").map((c,i) => i%2===0?c.toLowerCase():c.toUpperCase()).join("") || ".mock <text>"); continue; }
        if (cmd === "clap") { await send(args.join(" 👏 ") + " 👏" || ".clap <text>"); continue; }
        if (cmd === "aesthetic") {
          const fc = "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ";
          await send(args.join(" ").split("").map(c => { const i = "abcdefghijklmnopqrstuvwxyz".indexOf(c.toLowerCase()); return i>=0 ? fc[i] : c; }).join("") || ".aesthetic <text>");
          continue;
        }
        if (cmd === "leet") {
          const lm = {a:"4",e:"3",i:"1",o:"0",s:"5",t:"7",l:"1",b:"8",g:"9"};
          await send(args.join(" ").split("").map(c => lm[c.toLowerCase()]||c).join("") || ".leet <text>");
          continue;
        }
        if (cmd === "count") { const t = args.join(" "); await send(`chars: ${t.length}\nwords: ${t.split(/\s+/).filter(Boolean).length}\nlines: ${t.split("\n").length}` || ".count <text>"); continue; }
        if (cmd === "repeat") {
          const n = Math.min(parseInt(args[0])||2,10); const t = args.slice(1).join(" ");
          await send(t ? Array(n).fill(t).join("\n") : ".repeat <times> <text>"); continue;
        }
        if (cmd === "binary") { await send(args.join(" ").split("").map(c=>c.charCodeAt(0).toString(2).padStart(8,"0")).join(" ")||".binary <text>"); continue; }
        if (cmd === "hex") { await send(args.join(" ").split("").map(c=>c.charCodeAt(0).toString(16)).join(" ")||".hex <text>"); continue; }
        if (cmd === "base64") {
          const sub=args[0]; const t=args.slice(1).join(" ");
          if(sub==="encode") await send(Buffer.from(t).toString("base64"));
          else if(sub==="decode"){try{await send(Buffer.from(t,"base64").toString("utf8"));}catch{await send("invalid base64");}}
          else await send(".base64 encode <text> | .base64 decode <text>");
          continue;
        }
        if (cmd === "caesar") {
          const shift=parseInt(args[0])||3; const t=args.slice(1).join(" ");
          await send(t.split("").map(c=>{if(c.match(/[a-z]/))return String.fromCharCode((c.charCodeAt(0)-97+shift)%26+97);if(c.match(/[A-Z]/))return String.fromCharCode((c.charCodeAt(0)-65+shift)%26+65);return c;}).join("")||".caesar <shift> <text>");
          continue;
        }
        if (cmd === "pig") {
          const v="aeiou";
          await send(args.join(" ").split(" ").map(w=>{if(!w)return w;if(v.includes(w[0].toLowerCase()))return w+"yay";let i=0;while(i<w.length&&!v.includes(w[i].toLowerCase()))i++;return w.slice(i)+w.slice(0,i)+"ay";}).join(" ")||".pig <text>");
          continue;
        }
        if (cmd === "owoify") { await send(args.join(" ").replace(/[rl]/g,"w").replace(/[RL]/g,"W").replace(/n([aeiou])/g,"ny$1").replace(/N([aeiou])/g,"Ny$1").replace(/ove/g,"uv")||".owoify <text>"); continue; }
        if (cmd === "uwuify") { await send(args.join(" ").replace(/[rl]/g,"w").replace(/[RL]/g,"W").replace(/!/g," uwu!").replace(/\./g," uwu.")||".uwuify <text>"); continue; }
        if (cmd === "palindrome") { const t=args.join(" ").toLowerCase().replace(/[^a-z0-9]/g,""); await send(`"${args.join(" ")}" is${t===t.split("").reverse().join("")?"":" NOT"} a palindrome`); continue; }
        if (cmd === "wordcount") { await send(`${args.join(" ").split(/\s+/).filter(Boolean).length} words`); continue; }
        if (cmd === "charcount") { await send(`${args.join(" ").length} characters`); continue; }
        if (cmd === "vowels") { const t=args.join(" "); await send(`vowels: ${(t.match(/[aeiouAEIOU]/g)||[]).length} / ${t.length} chars`); continue; }
        if (cmd === "emojify") { const emojis=["😂","🔥","💯","👀","😭","✨","💀","🙏","😤","🫶"]; await send(args.join(" ").split(" ").map(w=>w+" "+emojis[Math.floor(Math.random()*emojis.length)]).join(" ")); continue; }

        // ── MATH / CALC ──────────────────────────────────────────────────
        if (cmd === "calc") {
          try { const expr=args.join("").replace(/[^0-9+\-*/.()%\s]/g,""); const result=Function('"use strict";return ('+expr+')')(); await send(`${expr} = ${result}`); }
          catch { await send("invalid expression — try: .calc 5 * (3 + 2)"); }
          continue;
        }
        if (cmd === "percent") {
          const [val,total]=args.map(Number);
          await send(!isNaN(val)&&!isNaN(total)?`${val} is ${((val/total)*100).toFixed(2)}% of ${total}`:".percent <value> <total>"); continue;
        }
        if (cmd === "tax") {
          const [amount,rate]=args.map(Number);
          if(!isNaN(amount)&&!isNaN(rate)){const tax=(amount*rate/100).toFixed(2);await send(`amount: ${amount}\ntax (${rate}%): ${tax}\ntotal: ${(+amount+ +tax).toFixed(2)}`);}
          else await send(".tax <amount> <rate%>"); continue;
        }
        if (cmd === "tip") {
          const [amount,pct]=args.map(Number);
          if(!isNaN(amount)&&!isNaN(pct)){const tip=(amount*pct/100).toFixed(2);await send(`bill: ${amount}\ntip (${pct}%): ${tip}\ntotal: ${(+amount+ +tip).toFixed(2)}`);}
          else await send(".tip <amount> <percent%>"); continue;
        }
        if (cmd === "split") {
          const [amount,people]=args.map(Number);
          await send(!isNaN(amount)&&!isNaN(people)&&people>0?`each person pays: ${(amount/people).toFixed(2)}`:".split <total> <people>"); continue;
        }
        if (cmd === "bmi") {
          const [w,h]=args.map(Number);
          if(!isNaN(w)&&!isNaN(h)&&h>0){const bmi=(w/(h*h)).toFixed(1);const cat=bmi<18.5?"underweight":bmi<25?"normal":bmi<30?"overweight":"obese";await send(`bmi: ${bmi} — ${cat}`);}
          else await send(".bmi <weight kg> <height m>"); continue;
        }
        if (cmd === "roman") {
          const n=parseInt(args[0]);
          if(isNaN(n)||n<1||n>3999){await send("give a number between 1 and 3999");continue;}
          const vals=[1000,900,500,400,100,90,50,40,10,9,5,4,1],syms=["M","CM","D","CD","C","XC","L","XL","X","IX","V","IV","I"];
          let r="",num=n; vals.forEach((v,i)=>{while(num>=v){r+=syms[i];num-=v;}});
          await send(`${n} = ${r}`); continue;
        }
        if (cmd === "random") {
          const [mn,mx]=args.map(Number);
          await send(!isNaN(mn)&&!isNaN(mx)?`🎲 ${Math.floor(Math.random()*(mx-mn+1))+mn}`:".random <min> <max>"); continue;
        }
        if (cmd === "temp") {
          const sub=args[0]?.toLowerCase(),val=parseFloat(args[1]);
          if(sub==="c")await send(`${val}°C = ${(val*9/5+32).toFixed(1)}°F`);
          else if(sub==="f")await send(`${val}°F = ${((val-32)*5/9).toFixed(1)}°C`);
          else await send(".temp c <celsius> | .temp f <fahrenheit>"); continue;
        }
        if (cmd === "sqrt") { const n=parseFloat(args[0]); await send(!isNaN(n)?`√${n} = ${Math.sqrt(n).toFixed(6)}`:".sqrt <number>"); continue; }
        if (cmd === "pow") { const [b,e]=args.map(Number); await send(!isNaN(b)&&!isNaN(e)?`${b}^${e} = ${Math.pow(b,e)}`:".pow <base> <exponent>"); continue; }
        if (cmd === "mod") { const [a,b]=args.map(Number); await send(!isNaN(a)&&!isNaN(b)?`${a} mod ${b} = ${a%b}`:".mod <a> <b>"); continue; }
        if (cmd === "round") { const n=parseFloat(args[0]); await send(!isNaN(n)?`${n} rounded = ${Math.round(n)}`:".round <number>"); continue; }
        if (cmd === "fibonacci") {
          const n=Math.min(parseInt(args[0])||10,25);
          let a=0,b=1,seq=[0];for(let i=1;i<n;i++){[a,b]=[b,a+b];seq.push(a);}
          await send(`fibonacci (${n} terms):\n${seq.join(", ")}`); continue;
        }
        if (cmd === "factorial") {
          const n=parseInt(args[0]);
          if(isNaN(n)||n<0||n>20){await send("number must be 0–20");continue;}
          let r=1;for(let i=2;i<=n;i++)r*=i;
          await send(`${n}! = ${r}`); continue;
        }
        if (cmd === "isprime") {
          const n=parseInt(args[0]);
          if(isNaN(n)){await send(".isprime <number>");continue;}
          if(n<2){await send(`${n} is not prime`);continue;}
          let prime=true;for(let i=2;i<=Math.sqrt(n);i++)if(n%i===0){prime=false;break;}
          await send(`${n} is${prime?"":" not"} prime`); continue;
        }
        if (cmd === "password") {
          const len=Math.min(parseInt(args[0])||12,32);
          const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
          let pwd="";for(let i=0;i<len;i++)pwd+=chars[Math.floor(Math.random()*chars.length)];
          await send(`🔑 ${pwd}`); continue;
        }
        if (cmd === "uuid") {
          const u="xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==="x"?r:(r&0x3|0x8)).toString(16);});
          await send(u); continue;
        }

        // ── FUN / GAMES ──────────────────────────────────────────────────
        if (cmd === "flip" || cmd === "coin") { await send(Math.random()>0.5?"heads 🪙":"tails 🪙"); continue; }
        if (cmd === "roll" || cmd === "dice") { const n=parseInt(args[0])||6; await send(`🎲 rolled: ${Math.floor(Math.random()*n)+1} (d${n})`); continue; }
        if (cmd === "ping") { await send("pong 🏓"); continue; }
        if (cmd === "joke") { await send(JOKES[Math.floor(Math.random()*JOKES.length)]); continue; }
        if (cmd === "fact") { await send("📚 " + FACTS[Math.floor(Math.random()*FACTS.length)]); continue; }
        if (cmd === "quote") { await send("💬 " + QUOTES[Math.floor(Math.random()*QUOTES.length)]); continue; }
        if (cmd === "truth") { await send("🫦 truth: " + TRUTHS[Math.floor(Math.random()*TRUTHS.length)]); continue; }
        if (cmd === "dare") { await send("😈 dare: " + DARES[Math.floor(Math.random()*DARES.length)]); continue; }
        if (cmd === "wyr") { await send("🤔 " + WYR_LIST[Math.floor(Math.random()*WYR_LIST.length)]); continue; }
        if (cmd === "pickup") { await send(PICKUPS[Math.floor(Math.random()*PICKUPS.length)]); continue; }
        if (cmd === "roast") { const target=args.join(" ")||"you"; await send(`🔥 ${target}: ${ROASTS[Math.floor(Math.random()*ROASTS.length)]}`); continue; }
        if (cmd === "compliment") { const target=args.join(" ")||"you"; await send(`✨ ${target}: ${COMPLIMENTS[Math.floor(Math.random()*COMPLIMENTS.length)]}`); continue; }
        if (cmd === "fortune") { await send("🔮 " + FORTUNES[Math.floor(Math.random()*FORTUNES.length)]); continue; }
        if (cmd === "8ball") {
          const q=args.join(" "); await send(q?`❓ ${q}\n\n${EIGHTBALL[Math.floor(Math.random()*EIGHTBALL.length)]}`:".8ball <question>"); continue;
        }
        if (cmd === "rps") {
          const choices=["rock","paper","scissors"]; const bot=choices[Math.floor(Math.random()*3)]; const u=args[0]?.toLowerCase();
          if(!choices.includes(u)){await send("pick: rock, paper, or scissors");continue;}
          const win=(u==="rock"&&bot==="scissors")||(u==="paper"&&bot==="rock")||(u==="scissors"&&bot==="paper");
          await send(`you: ${u}\nme: ${bot}\n${u===bot?"tie 🤝":win?"you win 🏆":"i win 😤"}`); continue;
        }
        if (cmd === "ship") {
          const names=args.join(" ").split(/\s+and\s+|\s*\+\s*|\s*&\s*/i);
          const n1=names[0]?.trim()||"you"; const n2=names[1]?.trim()||"them";
          const pct=Math.floor(Math.random()*101);
          const hearts=Math.round(pct/10); const bar="❤️".repeat(hearts)+"🖤".repeat(10-hearts);
          await send(`💘 ${n1} + ${n2}\n${bar}\n${pct}% compatible\n${pct>80?"soulmates fr 🔥":pct>60?"solid connection 💯":pct>40?"could work 🤔":pct>20?"it's complicated 😬":"yikes 💀"}`); continue;
        }
        if (cmd === "rate") { const thing=args.join(" ")||"that"; await send(`${thing}: ${Math.floor(Math.random()*101)}/100`); continue; }
        if (cmd === "rank") { const thing=args.join(" ")||"it"; const ranks=["S tier 🏆","A tier ⭐","B tier 👍","C tier 😐","D tier 😬","F tier 💀"]; await send(`${thing} → ${ranks[Math.floor(Math.random()*ranks.length)]}`); continue; }
        if (cmd === "choose") {
          const opts=args.join(" ").split(/\s*[\|\/,]\s*/).map(s=>s.trim()).filter(Boolean);
          await send(opts.length>=2?`i pick: ${opts[Math.floor(Math.random()*opts.length)]} 🎯`:"give options: .choose a | b | c"); continue;
        }
        if (cmd === "spin") { const wheel=["🍕pizza","🎮games","📚study","😴sleep","💪workout","🎵music","🎨art","🏃run","🧠think","🎬movie"]; await send(`🎡 spun: ${wheel[Math.floor(Math.random()*wheel.length)]}`); continue; }
        if (cmd === "slot") {
          const s=["🍒","🍋","🍊","💎","7️⃣","🔔"]; const r=[s[Math.floor(Math.random()*s.length)],s[Math.floor(Math.random()*s.length)],s[Math.floor(Math.random()*s.length)]];
          await send(`🎰 ${r.join(" | ")}\n${r[0]===r[1]&&r[1]===r[2]?"JACKPOT 🎉":r[0]===r[1]||r[1]===r[2]||r[0]===r[2]?"match! you win 🏆":"no match, try again 💀"}`); continue;
        }
        if (cmd === "rizz") { const pct=Math.floor(Math.random()*101); const rizzLabel=pct>80?"🔥 god-tier rizz":pct>60?"💪 decent rizz":pct>40?"😐 mid rizz":pct>20?"😬 low rizz":"💀 no rizz bro"; await send(`rizz level: ${pct}/100\n${rizzLabel}`); continue; }
        if (cmd === "sus") { const target=args.join(" ")||"you"; await send(`${target} is ${Math.floor(Math.random()*101)}% sus 🔴`); continue; }
        if (cmd === "vibe") { const vibes=["immaculate vibes ✨","good vibes 🔥","neutral vibes 😐","off vibes today 😬","no vibes detected 💀"]; await send(`vibe check: ${vibes[Math.floor(Math.random()*vibes.length)]}`); continue; }
        if (cmd === "chad") { const pct=Math.floor(Math.random()*101); const chadLabel=pct>80?"👑 absolute chad":pct>50?"💪 chad":"😐 normie"; await send(`chad level: ${pct}/100 ${chadLabel}`); continue; }
        if (cmd === "simp") { const target=args.join(" ")||"you"; await send(`${target} is ${Math.floor(Math.random()*101)}% simp 💔`); continue; }
        if (cmd === "npc") { const pct=Math.floor(Math.random()*101); const npcLabel=pct>70?"🤖 pure npc":pct>40?"😐 kinda npc":"🧠 main character"; await send(`npc rating: ${pct}% ${npcLabel}`); continue; }
        if (cmd === "based") { const pct=Math.floor(Math.random()*101); const basedLabel=pct>80?"🔥 extremely based":pct>50?"👍 based":"😐 cringe"; await send(`based meter: ${pct}/100 ${basedLabel}`); continue; }
        if (cmd === "ratio") { await send(`ratio + L + no rizz + fell off + who asked 💀`); continue; }
        if (cmd === "bruh") { await send("bruh 💀"); continue; }
        if (cmd === "oof") { await send("oof 😬"); continue; }
        if (cmd === "hype") { const hyp=["LET'S GOOOOO 🔥🔥🔥","W BEHAVIOR FR 💯","NO CAP THAT'S DIFFERENT 🏆","GOATED WITH THE SAUCE 🐐","DIFFERENT BREED REAL ONE ⭐"]; await send(hyp[Math.floor(Math.random()*hyp.length)]); continue; }
        if (cmd === "cringe") { const pct=Math.floor(Math.random()*101); const cringeLabel=pct>70?"💀 unforgivable":pct>40?"😬 kinda cringe":"👍 not cringe"; await send(`cringe level: ${pct}/100 ${cringeLabel}`); continue; }
        if (cmd === "salty") { const pct=Math.floor(Math.random()*101); const saltyLabel=pct>70?"very salty bro":pct>40?"a little salty":"not salty"; await send(`salty meter: ${pct}% 🧂 ${saltyLabel}`); continue; }
        if (cmd === "goat") { const target=args.join(" ")||"you"; await send(`${target} is the GOAT 🐐 no debate`); continue; }
        if (cmd === "hotdog") { await send(Math.random()>0.5?"it's a hotdog 🌭":"it's NOT a hotdog ❌"); continue; }
        if (cmd === "lucky") { const n=Math.floor(Math.random()*100)+1; await send(`🍀 your lucky number today: ${n}`); continue; }

        // ── SOCIAL ───────────────────────────────────────────────────────
        if (cmd === "gm") { await send("good morning ☀️ hope today hits different"); continue; }
        if (cmd === "gn") { await send("good night 🌙 rest up"); continue; }
        if (cmd === "hbd") { const name=args.join(" ")||"you"; await send(`happy birthday ${name} 🎂🎉 wishing you everything this year`); continue; }
        if (cmd === "gl") { await send("good luck 🍀 you got this"); continue; }
        if (cmd === "gg") { await send("GG 🏆 well played"); continue; }
        if (cmd === "greet") { await send("hey 👋 what's good?"); continue; }
        if (cmd === "hug") { const target=args.join(" ")||"you"; await send(`sending ${target} a hug 🤗`); continue; }
        if (cmd === "slap") { const target=args.join(" ")||"whoever"; await send(`slapping ${target} 👋💥 they deserved it`); continue; }
        if (cmd === "poke") { const target=args.join(" ")||"you"; await send(`poking ${target} 👉`); continue; }
        if (cmd === "kiss") { const target=args.join(" ")||"you"; await send(`kissing ${target} 😘`); continue; }
        if (cmd === "punch") { const target=args.join(" ")||"you"; await send(`punching ${target} 👊💥`); continue; }
        if (cmd === "highfive") { await send("✋ high five!"); continue; }
        if (cmd === "love") { const target=args.join(" ")||"you"; await send(`❤️ sending love to ${target}`); continue; }
        if (cmd === "wave") { await send("👋 hey!"); continue; }
        if (cmd === "salute") { await send("🫡 sir"); continue; }
        if (cmd === "bow") { await send("🙇 bowing down"); continue; }
        if (cmd === "cheer") { await send("🎉 cheers! 🥂"); continue; }
        if (cmd === "congrats") { const target=args.join(" ")||"you"; await send(`🏆 congrats ${target}! that's W behavior`); continue; }
        if (cmd === "rip") { const target=args.join(" ")||"it"; await send(`rip ${target} 😔🪦 gone but not forgotten`); continue; }
        if (cmd === "ily") { await send("ily too ❤️"); continue; }

        // ── UTILITY / INFO ───────────────────────────────────────────────
        if (cmd === "time") { await send(`🕐 ${new Date().toLocaleTimeString("en-US",{hour12:true,timeZone:"Africa/Lagos"})} (WAT)`); continue; }
        if (cmd === "date") { await send(`📅 ${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric",timeZone:"Africa/Lagos"})}`); continue; }
        if (cmd === "uptime") { const u=Math.floor((Date.now()-startTime)/1000); await send(`⏱ uptime: ${Math.floor(u/3600)}h ${Math.floor((u%3600)/60)}m ${u%60}s`); continue; }
        if (cmd === "age") {
          const d=new Date(args.join(" ")); if(isNaN(d)){await send(".age <date> e.g. .age 2000-01-15");continue;}
          const years=Math.floor((Date.now()-d)/(365.25*86400000));
          await send(`age: ${years} years old`); continue;
        }
        if (cmd === "countdown") {
          const n=parseInt(args[0])||5; await send(`⏳ ${Array.from({length:n},(_,i)=>n-i).join("... ")}... 🚀`); continue;
        }

        // ── NOTES & MEMORY ────────────────────────────────────────────────
        if (cmd === "note") {
          const content=args.join(" ");
          if(!content){await send(".note <text> to save | .notes to view | .delnote <id> to delete");continue;}
          if(!savedNotes[from])savedNotes[from]=[];
          const id=Date.now();
          savedNotes[from].push({id,text:content,time:new Date().toLocaleString()});
          writeJSON("notes.json",savedNotes);
          await send(`📝 note saved (#${savedNotes[from].length})`); continue;
        }
        if (cmd === "notes") {
          const ns=savedNotes[from]||[];
          await send(ns.length?`📝 your notes (${ns.length}):\n\n`+ns.map((n,i)=>`${i+1}. ${n.text}`).join("\n"):"no notes saved. use .note <text>"); continue;
        }
        if (cmd === "delnote") {
          const idx=(parseInt(args[0])||1)-1;
          const ns=savedNotes[from]||[];
          if(ns[idx]){ns.splice(idx,1);savedNotes[from]=ns;writeJSON("notes.json",savedNotes);await send("note deleted.");}
          else await send("note not found."); continue;
        }
        if (cmd === "todo") {
          const content=args.join(" ");
          if(!content){await send(".todo <task> to add | .todos to view | .done <id> to complete");continue;}
          if(!savedTodos[from])savedTodos[from]=[];
          savedTodos[from].push({text:content,done:false});
          writeJSON("todos.json",savedTodos);
          await send(`✅ todo added (#${savedTodos[from].length})`); continue;
        }
        if (cmd === "todos") {
          const ts=savedTodos[from]||[];
          await send(ts.length?`📋 todos:\n\n`+ts.map((t,i)=>`${t.done?"✅":"⬜"} ${i+1}. ${t.text}`).join("\n"):"no todos. use .todo <task>"); continue;
        }
        if (cmd === "done") {
          const idx=(parseInt(args[0])||1)-1;
          const ts=savedTodos[from]||[];
          if(ts[idx]){ts[idx].done=true;writeJSON("todos.json",savedTodos);await send(`✅ marked done: ${ts[idx].text}`);}
          else await send("todo not found."); continue;
        }
        if (cmd === "save") {
          const key=args[0]; const val=args.slice(1).join(" ");
          if(!key||!val){await send(".save <key> <value> | .get <key> | .keys");continue;}
          if(!savedKV[from])savedKV[from]={};
          savedKV[from][key]=val; writeJSON("kv.json",savedKV);
          await send(`saved: ${key} → ${val}`); continue;
        }
        if (cmd === "get") {
          const key=args[0];
          await send(key&&savedKV[from]?.[key]?`${key}: ${savedKV[from][key]}`:key?"not found.":".get <key>"); continue;
        }
        if (cmd === "keys") {
          const ks=savedKV[from]?Object.keys(savedKV[from]):[];
          await send(ks.length?`saved keys:\n${ks.join(", ")}`:"nothing saved. use .save <key> <value>"); continue;
        }

        // ── GROUP COMMANDS ────────────────────────────────────────────────
        if (cmd === "tagall") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try {
            const meta=await sock.groupMetadata(from);
            const mentions=meta.participants.map(p=>p.id);
            const tags=mentions.map(id=>`@${id.split("@")[0]}`).join(" ");
            await sock.sendMessage(from,{text:args.join(" ")||"attention everyone 📢\n\n"+tags,mentions});
          } catch(e){await send("couldn't tag all.");}
          continue;
        }
        if (cmd === "groupinfo") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          try {
            const meta=await sock.groupMetadata(from);
            await send(`📋 ${meta.subject}\n👥 ${meta.participants.length} members\n📝 ${meta.desc||"no description"}\n🔗 created: ${new Date(meta.creation*1000).toLocaleDateString()}`);
          } catch(e){await send("couldn't get group info.");}
          continue;
        }
        if (cmd === "link") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try { const code=await sock.groupInviteCode(from); await send(`🔗 https://chat.whatsapp.com/${code}`); }
          catch(e){await send("couldn't get link. need admin rights.");}
          continue;
        }
        if (cmd === "everyone" || cmd === "all") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try {
            const meta=await sock.groupMetadata(from);
            const mentions=meta.participants.map(p=>p.id);
            await sock.sendMessage(from,{text:args.join(" ")||"hey everyone 👋",mentions});
          } catch(e){await send("couldn't tag everyone.");}
          continue;
        }
        if (cmd === "hidetag") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try {
            const meta=await sock.groupMetadata(from);
            const mentions=meta.participants.map(p=>p.id);
            await sock.sendMessage(from,{text:args.join(" ")||"📢",mentions});
          } catch(e){await send("couldn't hidetag.");}
          continue;
        }

        // ── MISC ─────────────────────────────────────────────────────────
        if (cmd === "about") { await send(`mfg_bot 🤖\nbuilt by +${OWNER_NUMBER}\npowered by baileys + groq ai\nversion: 2.5 | 200+ commands`); continue; }
        if (cmd === "donate") { await send(`support the maker:\n+${OWNER_NUMBER}\nthanks 🙏`); continue; }
        if (cmd === "feedback") {
          const fb=args.join(" ");
          if(fb){ try{await sock.sendMessage(OWNER_JID,{text:`📩 feedback from ${from}:\n${fb}`});}catch(e){}; await send("feedback sent. thanks 🙏"); }
          else await send(".feedback <your message>"); continue;
        }
        if (cmd === "report") {
          const rp=args.join(" ");
          if(rp){ try{await sock.sendMessage(OWNER_JID,{text:`🚨 report from ${from}:\n${rp}`});}catch(e){}; await send("report sent."); }
          else await send(".report <what happened>"); continue;
        }
        if (cmd === "sticker" || cmd === "s") { await send("reply to an image with .s to get a sticker — feature coming soon"); continue; }
        if (cmd === "weather") { await send("weather command — connect an api key in settings to enable real weather"); continue; }
        if (cmd === "translate") { await send("translation — connect google translate api to enable this"); continue; }
        if (cmd === "define") { await send("dictionary — connect a dictionary api to enable this"); continue; }
        if (cmd === "news") { await send("news — connect a news api to enable this"); continue; }
        if (cmd === "crypto") { await send("crypto prices — connect coinmarketcap api to enable this"); continue; }
        if (cmd === "gif") { await send("gifs — connect giphy api to enable this"); continue; }

        // ── .list and .menu ───────────────────────────────────────────────
        if (cmd === "list") {
          const page = args[0]?.toLowerCase();
          const pages = {
            text: `📝 TEXT TOOLS\n.upper .lower .reverse .mock .clap\n.aesthetic .leet .count .repeat .binary\n.hex .base64 .caesar .pig .owoify\n.uwuify .palindrome .wordcount .charcount\n.vowels .emojify`,
            math: `🔢 MATH & CALC\n.calc .percent .tax .tip .split\n.bmi .roman .random .temp .sqrt\n.pow .mod .round .fibonacci .factorial\n.isprime .password .uuid .age`,
            fun: `🎮 FUN & GAMES\n.joke .fact .quote .truth .dare\n.wyr .pickup .roast .compliment .fortune\n.8ball .rps .ship .rate .rank\n.choose .spin .slot .flip .roll .dice`,
            vibe: `😤 VIBE CHECKS\n.rizz .sus .vibe .chad .simp\n.npc .based .ratio .bruh .oof\n.hype .cringe .salty .goat .hotdog .lucky`,
            social: `🤝 SOCIAL\n.gm .gn .hbd .gl .gg .greet\n.hug .slap .poke .kiss .punch\n.highfive .love .wave .salute .bow\n.cheer .congrats .rip .ily`,
            util: `🛠 UTILITY\n.time .date .uptime .age .countdown\n.note .notes .delnote .todo .todos .done\n.save .get .keys .ping .bot .stats`,
            group: `👥 GROUPS (owner)\n.tagall .groupinfo .link .everyone .hidetag`,
            ai: `🤖 AI & LEARNING\n.ai on|off|status|mode|reset|prompt\n.learnme .learnme view .learnme clear\n.style .vv`,
            owner: `👑 OWNER ONLY\n.broadcast all|group <msg>\n.send <number> <msg>\n.feedback .report .donate\n.bot prefix <symbol>`,
          };
          if (pages[page]) {
            await send(pages[page]);
          } else {
            await send(`📋 mfg_bot command list — 200+ commands\n\n.list text   — text manipulation\n.list math   — calculator & math\n.list fun    — games & jokes\n.list vibe   — vibe checks\n.list social — social commands\n.list util   — utility & notes\n.list group  — group commands\n.list ai     — AI & learning\n.list owner  — owner controls\n\nor type .menu for quick overview`);
          }
          continue;
        }
        if (cmd === "menu" || cmd === "help") {
          const topic = args[0]?.toLowerCase();
          if (topic === "ai") await send(".ai on | off | status | mode | reset | prompt | delay | typing");
          else if (topic === "broadcast") await send(".broadcast all <msg> | .broadcast group <msg>");
          else if (topic === "text") await send(".upper .lower .reverse .mock .clap .aesthetic .leet .count .repeat .binary .hex .base64 .caesar .pig .owoify");
          else if (topic === "math") await send(".calc .percent .tax .tip .split .bmi .roman .random .temp .sqrt .pow .fibonacci .factorial .isprime .password");
          else if (topic === "fun") await send(".joke .fact .quote .truth .dare .wyr .8ball .rps .ship .rate .choose .spin .slot .flip .roll");
          else await send(`mfg_bot 🤖 | 200+ commands\n\n.list — full command list by category\n.list text | math | fun | vibe | social | util | group | ai | owner\n\nstatus auto-send: anyone who says "send please" after your status gets it instantly 📲\n\nai: .ai on to activate | bot mirrors your style per contact automatically`);
          continue;
        }

        // Unknown command — fall through to AI or error
        if (settings.aiEnabled) {
          // fall through to AI below
        } else {
          await send(`unknown command. type .list for all 200+ commands`);
          continue;
        }
      }

      // ── Auto-Learn ──────────────────────────────────────────────────────
      if (userData[from]?.autoLearn && text.length > 10 && !text.startsWith(pfx)) {
        styleSamples.push(text);
        if (styleSamples.length > 100) styleSamples = styleSamples.slice(-100);
        writeJSON("style_samples.json", styleSamples);
      }

      // ── AI Reply — instant, no delay, no cancel flicker ────────────
      if (settings.aiEnabled && text.length > 1 && !text.startsWith(pfx)) {
        try {
          const reply = await askGroq(text, from);
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

// ─── Proactive Random Texting ─────────────────────────────────────────────────
function scheduleRandomText() {
  if (!settings.proactiveText) { setTimeout(scheduleRandomText, 30 * 60 * 1000); return; }
  const delay = (30 + Math.random() * 90) * 60 * 1000; // 30–120 minutes
  setTimeout(async () => {
    try {
      if (!isConnected || !settings.proactiveText) { scheduleRandomText(); return; }
      const eligible = allChats.filter(c =>
        c.id && !c.id.includes("broadcast") && !c.id.endsWith("@g.us") && c.id !== OWNER_JID
      );
      if (eligible.length === 0) { scheduleRandomText(); return; }
      const target = eligible[Math.floor(Math.random() * eligible.length)];
      const openers = [
        "wetin dey happen","omo i just remember you","how body","yo what's good","you dey?",
        "i just dey think about something","abeg gist me something","what you dey do",
        "yo","bro something just happen","guy how far","e don do sha","long time no talk",
        "you see that thing wey happen","bro check this out","omo you won't believe",
        "i dey bored fr","guy talk to me","abeg how e dey","omo nawa o"
      ];
      const msg = openers[Math.floor(Math.random() * openers.length)];
      await sock.sendMessage(target.id, { text: msg });
      // Save this to that contact's ownerMessages so it learns the style
      if (!userData[target.id]) userData[target.id] = {};
      if (!userData[target.id].ownerMessages) userData[target.id].ownerMessages = [];
      userData[target.id].ownerMessages.push(msg);
      setImmediate(() => writeJSON("users.json", userData));
      console.log(`[MFG_bot] Random text sent to ${target.id}: "${msg}"`);
    } catch (e) { console.log("[MFG_bot] Random text error:", e.message); }
    scheduleRandomText();
  }, delay);
}
scheduleRandomText();

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

// Pairing code — restarts the socket in phone-pairing mode (no QR conflict)
app.post("/api/pair", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "missing phone number" });
  if (isConnected) return res.status(400).json({ error: "already connected" });

  const clean = phone.replace(/[^0-9]/g, "");
  if (!clean) return res.status(400).json({ error: "invalid phone number" });

  // Store the phone so the next connectToWhatsApp() uses pairing mode
  pendingPairPhone = clean;
  hasQr = false; currentQr = null;

  // Create a Promise that resolves when the pairing code is ready (or times out)
  const codePromise = new Promise((resolve) => {
    pairCodeResolve = resolve;
    setTimeout(() => {
      if (pairCodeResolve) { pairCodeResolve({ success: false, error: "timeout — make sure bot is not already connected" }); pairCodeResolve = null; }
    }, 30000);
  });

  // Tear down the existing socket to force a fresh connection in pairing mode
  if (sock) {
    try { sock.ev.removeAllListeners(); sock.end(new Error("switching to pairing code")); } catch (e) {}
    sock = null;
  }
  connectToWhatsApp();

  const result = await codePromise;
  if (result.success) return res.json({ success: true, code: result.code });
  return res.status(500).json({ error: result.error });
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
    console.error(`[MFG_bot] Port ${PORT} in use — exiting so workflow can restart cleanly`);
    process.exit(1);
  } else {
    console.error("[MFG_bot] Server error:", err);
    process.exit(1);
  }
});
