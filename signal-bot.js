// ─────────────────────────────────────────────────────────────────────────────
// MFG Signal Bot — signal-bot.js
// Runs alongside the WhatsApp bot as a separate process.
// Requires signal-cli-rest-api running at SIGNAL_CLI_URL.
//
// Env vars needed:
//   SIGNAL_NUMBER    — the Signal phone number this bot is registered to
//                      (e.g. "+12015551234" — must be registered with signal-cli first)
//   SIGNAL_CLI_URL   — URL of the signal-cli REST API service
//                      (default: http://localhost:8080)
//   GEMINI_API_KEY   — same as WhatsApp bot
//   GROQ_API_KEY     — same as WhatsApp bot
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

// Global crash shield — keep the process alive
process.on("uncaughtException", (e) => console.error("[Signal] ⚠️ uncaughtException:", e?.message));
process.on("unhandledRejection", (r) => console.error("[Signal] ⚠️ unhandledRejection:", r?.message || r));

const fs   = require("fs");
const path = require("path");

// ─── Config ───────────────────────────────────────────────────────────────────
const SIGNAL_NUMBER  = process.env.SIGNAL_NUMBER;
const SIGNAL_CLI_URL = (process.env.SIGNAL_CLI_URL || "http://localhost:8080").replace(/\/$/, "");
const OWNER_NUMBER   = "2349132883869";
const DATA_DIR       = path.join(__dirname, "data");

if (!SIGNAL_NUMBER) {
  console.log("[Signal] SIGNAL_NUMBER env var not set — exiting");
  process.exit(0);
}

// ─── Shared persistence ────────────────────────────────────────────────────────
function readJSON(file, def) {
  try {
    const p = path.join(DATA_DIR, file);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {}
  return def;
}
function writeJSON(file, data) {
  try { fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2)); } catch {}
}

// Hot-reload shared data every 30s — picks up WhatsApp bot changes (persona edits, settings)
let settings       = {};
let contactPersonas = {};
let coinLedger     = {};
let signalConvHistory = readJSON("signal_conv_history.json", {});

function reloadSharedData() {
  const s = readJSON("settings.json", {});
  settings       = { aiEnabled: true, systemPrompt: "", moodAware: true, prefix: ".", ...s };
  contactPersonas = { ...readJSON("personas.json", {}) };
  coinLedger      = readJSON("coins.json", { balances: {}, symbol: "MFGC", name: "MFG Coin" });
}
reloadSharedData();
setInterval(reloadSharedData, 30000);

// ─── Mood prompt ─────────────────────────────────────────────────────────────
function moodPrompt() {
  if (!settings.moodAware) return "";
  const h = new Date().getHours();
  if (h >= 6  && h < 11) return "\n\n[MOOD: morning — sharp, direct, fresh energy. short replies.]";
  if (h >= 11 && h < 17) return "\n\n[MOOD: afternoon — normal energy, balanced.]";
  if (h >= 17 && h < 23) return "\n\n[MOOD: evening — chill, more emojis ok, slightly playful.]";
  return "\n\n[MOOD: late night — sleepy energy, minimal words.]";
}

// ─── Persona block (identical logic to WhatsApp bot) ─────────────────────────
function buildPersonaBlock(from) {
  const fromDigits = (from || "").replace(/[^0-9]/g, "");
  const personaKey = Object.keys(contactPersonas).find(k => k.replace(/[^0-9]/g, "") === fromDigits);
  const persona    = personaKey ? contactPersonas[personaKey] : null;
  if (!persona) return "";

  const sweetNamesStr = (persona.sweetNames || []).join(", ") || "babe, love, baby";
  const rel           = (persona.relationship || "").toLowerCase();
  const isRomantic    = /boyfriend|girlfriend|lover|partner|husband|wife|boo|bae|crush/.test(rel);

  return `\n\n${"═".repeat(44)}\n🚨 PERSONA MODE ACTIVE — OVERRIDES EVERYTHING ABOVE 🚨\n${"═".repeat(44)}\nYou are EXCLUSIVELY texting your ${persona.relationship}: ${persona.name}.\n\n✅ MANDATORY:\n${isRomantic
    ? `- You are their ${persona.relationship}. Be romantic, affectionate, loving — make them FEEL it.\n- Be warm, flirty, caring. Miss them, tease them gently. That is the vibe.\n`
    : `- Be warm, genuine, personal — you are their ${persona.relationship}.\n`
  }- Address them as "${persona.name}" or use pet names: ${sweetNamesStr}\n- Tone: ${persona.tone || "warm, loving, caring, genuine Nigerian energy"}\n- Context: ${persona.context}\n- Every message must feel like it comes from someone who genuinely cares about ${persona.name}.\n\n❌ FORBIDDEN:\n- NEVER identify as AI, bot, assistant, or mirror\n- NEVER be cold, generic, robotic, or formal\n- NEVER break character\n- NEVER mention any other person in your personal life\n${"═".repeat(44)}`;
}

// ─── AI call (Gemini → Groq fallback, same model chain as WhatsApp bot) ──────
async function callAI(userText, from) {
  const history    = (signalConvHistory[from] || []).slice(-14);
  const sysBase    = settings.systemPrompt || `You are texting AS the owner of this phone — you ARE them. Not a bot, not an assistant. Just them.\n\nIDENTITY: Nigerian. Real one. Mix English and pidgin naturally.\n\nNEVER say you are an AI. Never refuse to reply. Short, casual replies.`;
  const personaBlk = buildPersonaBlock(from);
  const systemMsg  = sysBase + moodPrompt() + personaBlk;

  // ── Gemini ────────────────────────────────────────────────────────────────
  if (process.env.GEMINI_API_KEY) {
    try {
      const contents = [
        ...history.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        { role: "user", parts: [{ text: userText }] }
      ];
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemMsg }] },
            contents,
            generationConfig: { maxOutputTokens: 150, temperature: 0.92 }
          })
        }
      );
      const d     = await r.json();
      const reply = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (reply) {
        signalConvHistory[from] = [...history, { role: "user", content: userText }, { role: "assistant", content: reply }].slice(-20);
        setImmediate(() => writeJSON("signal_conv_history.json", signalConvHistory));
        return reply;
      }
    } catch (e) { console.log("[Signal] Gemini err:", e.message); }
  }

  // ── Groq fallback ─────────────────────────────────────────────────────────
  if (process.env.GROQ_API_KEY) {
    try {
      const messages = [
        { role: "system", content: systemMsg },
        ...history,
        { role: "user", content: userText }
      ];
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, max_tokens: 150, temperature: 0.9 })
      });
      const d     = await r.json();
      const reply = d?.choices?.[0]?.message?.content?.trim();
      if (reply) {
        signalConvHistory[from] = [...history, { role: "user", content: userText }, { role: "assistant", content: reply }].slice(-20);
        setImmediate(() => writeJSON("signal_conv_history.json", signalConvHistory));
        return reply;
      }
    } catch (e) { console.log("[Signal] Groq err:", e.message); }
  }

  return null;
}

// ─── Signal API helpers ───────────────────────────────────────────────────────
async function sendSignalMessage(to, message) {
  try {
    const r = await fetch(`${SIGNAL_CLI_URL}/v2/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, number: SIGNAL_NUMBER, recipients: [to] })
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      console.log("[Signal] Send failed:", r.status, err.slice(0, 100));
    } else {
      console.log(`[Signal] → +${to.replace(/[^0-9]/g,"").slice(-7)}: ${message.slice(0, 50)}`);
    }
  } catch (e) { console.log("[Signal] Send error:", e.message); }
}

// ─── Weather helper ───────────────────────────────────────────────────────────
async function getWeather(city) {
  try {
    const r = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=%l:+%c+%t+%h+humidity`, {
      headers: { "User-Agent": "MFGBot/1.0" }
    });
    return (await r.text()).trim();
  } catch { return null; }
}

// ─── Command handler ──────────────────────────────────────────────────────────
const JOKES = [
  "Why did the scarecrow win an award? He was outstanding in his field 😂",
  "I told my computer I needed a break. Now it won't stop sending me Kit-Kat ads 😭",
  "My wife told me I had to stop acting like a flamingo. I had to put my foot down 🦩",
  "Why don't scientists trust atoms? Because they make up everything 💀",
  "What do you call cheese that isn't yours? Nacho cheese 🧀",
  "Why did the bicycle fall over? Because it was two-tired 🚲",
  "I'm reading a book about anti-gravity. It's impossible to put down 📚"
];
const FACTS = [
  "Honey never spoils — archaeologists found 3000-year-old honey in Egyptian tombs that was still edible.",
  "A group of flamingos is called a 'flamboyance'.",
  "Nigeria is the most populous Black nation on Earth with over 220 million people.",
  "The human brain processes images 60,000 times faster than text.",
  "Octopuses have three hearts, blue blood, and can edit their own RNA.",
  "The shortest war in history lasted 38–45 minutes — between Britain and Zanzibar in 1896.",
  "Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid."
];
const QUOTES = [
  `"The secret of success is to do the common thing uncommonly well." — John Rockefeller`,
  `"It does not matter how slowly you go as long as you do not stop." — Confucius`,
  `"Success is not final; failure is not fatal: it is the courage to continue that counts." — Churchill`,
  `"The only way to do great work is to love what you do." — Steve Jobs`,
  `"A person who never made a mistake never tried anything new." — Einstein`
];
const TRUTHS = [
  "What is your biggest fear?",
  "What is the last lie you told?",
  "What is something you've never told anyone?",
  "What was your most embarrassing moment?",
  "Do you have a secret crush right now?",
  "What is the worst thing you've ever done and gotten away with?",
  "What habit are you most ashamed of?"
];
const DARES = [
  "Send a voice note singing a song for 15 seconds",
  "Text your last contact 'thinking of you'",
  "Screenshot your screen and send it",
  "Do 15 push-ups right now and report back",
  "Send a selfie without any filter",
  "Tell me a secret you've never told anyone"
];

const signalAiDisabled = new Set(); // per-number AI off

async function handleCommand(cmd, args, from) {
  const SYM   = coinLedger.symbol  || "MFGC";
  const CNAME = coinLedger.name    || "MFG Coin";
  const rand  = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ── MENU ──────────────────────────────────────────────────────────────────
  if (cmd === "menu" || cmd === "help" || cmd === "list" || cmd === "commands") {
    return (
      `┌─────────────────────────────┐\n` +
      `│  🤖 MFG Signal Bot          │\n` +
      `│  Powered by Gemini AI       │\n` +
      `└─────────────────────────────┘\n\n` +
      `*📊 DATA & TOOLS*\n` +
      `› .weather <city>\n› .define <word>\n› .translate <lang> <text>\n› .summarize — paste long text\n› .explain <topic>\n› .time | .date\n\n` +
      `*🎮 GAMES & FUN*\n` +
      `› .joke | .fact | .quote\n› .truth | .dare | .8ball <q>\n› .roast <name> | .compliment <name>\n› .flip | .roll | .slot\n› .riddle | .ship <a> & <b>\n\n` +
      `*🪙 MFGC COIN*\n` +
      `› .coin balance — check balance\n› .coin send <num> <amt>\n\n` +
      `*✈️ TICKET*\n` +
      `› .ticket — boarding pass generator\n\n` +
      `*⚙️ CONTROLS*\n` +
      `› .ai on|off — toggle AI replies\n› .ping | .uptime | .menu`
    );
  }

  // ── STATUS ─────────────────────────────────────────────────────────────────
  if (cmd === "ping")   return `🏓 pong! Signal bot is alive 🟢`;
  if (cmd === "uptime") {
    const u = Math.floor((Date.now() - signalStartTime) / 1000);
    return `⏱ Signal bot uptime: ${Math.floor(u/3600)}h ${Math.floor((u%3600)/60)}m ${u%60}s`;
  }
  if (cmd === "time")  return `🕐 ${new Date().toLocaleTimeString("en-US", { hour12: true, timeZone: "Africa/Lagos" })} (WAT)`;
  if (cmd === "date")  return `📅 ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Africa/Lagos" })}`;

  // ── AI TOGGLE ──────────────────────────────────────────────────────────────
  if (cmd === "ai") {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "off") { signalAiDisabled.add(from); return `🔇 AI replies OFF for this chat`; }
    if (sub === "on")  { signalAiDisabled.delete(from); return `🤖 AI replies ON`; }
    return `🤖 AI is ${signalAiDisabled.has(from) ? "OFF" : "ON"}\n\n.ai on | .ai off`;
  }

  // ── GAMES ──────────────────────────────────────────────────────────────────
  if (cmd === "joke")       return `😂 ${rand(JOKES)}`;
  if (cmd === "fact")       return `💡 *Fact:* ${rand(FACTS)}`;
  if (cmd === "quote")      return `✨ ${rand(QUOTES)}`;
  if (cmd === "truth")      return `🎭 *Truth:* ${rand(TRUTHS)}`;
  if (cmd === "dare")       return `🎲 *Dare:* ${rand(DARES)}`;
  if (cmd === "flip")       return `🪙 ${Math.random() < 0.5 ? "*HEADS* 👆" : "*TAILS* 👇"}`;
  if (cmd === "roll") {
    const sides = parseInt(args[0]) || 6;
    return `🎲 You rolled *${Math.floor(Math.random() * sides) + 1}* (d${sides})`;
  }
  if (cmd === "8ball") {
    const ans = ["Absolutely yes 🎱","Without a doubt 🎱","Most likely 🎱","Signs point to yes 🎱",
                 "Reply hazy, try again 🎱","Cannot predict now 🎱","My sources say no 🎱","Outlook not so good 🎱","Very doubtful 🎱"];
    const q = args.join(" ");
    return `🎱 *${q || "your question"}*\n\n${rand(ans)}`;
  }
  if (cmd === "slot") {
    const icons = ["🍒","🍋","🍊","⭐","💎","🎰","🔔","🍇"];
    const s = () => icons[Math.floor(Math.random() * icons.length)];
    const r1 = s(), r2 = s(), r3 = s();
    const win = r1 === r2 && r2 === r3;
    return `🎰  ${r1}  ${r2}  ${r3}\n\n${win ? "🎉 *JACKPOT! You won!*" : "😔 No luck — try again!"}`;
  }
  if (cmd === "roast") {
    const t = args.join(" ") || "you";
    return `🔥 ${t} is so slow they'd lose a race to a sleeping snail. Even Google Maps says "destination: irrelevant" 💀`;
  }
  if (cmd === "compliment") {
    const t = args.join(" ") || "You";
    return `💕 ${t} is genuinely one of the most amazing people — the world is way better with them in it ✨`;
  }
  if (cmd === "ship") {
    const pct = Math.floor(Math.random() * 101);
    const names = args.join(" ").replace(/ (and|&|vs|with) /i, " + ");
    const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));
    const verdict = pct >= 80 ? "Perfect match 💍" : pct >= 60 ? "Strong connection 💕" : pct >= 40 ? "Could work with effort 🤞" : "Ehh... 😬";
    return `💘 *Ship result*\n${names || "them"}\n\n${bar} ${pct}%\n${verdict}`;
  }
  if (cmd === "riddle") {
    const riddles = [
      ["I speak without a mouth and hear without ears. I have no body but I come alive with wind. What am I?", "An echo"],
      ["The more you take, the more you leave behind. What am I?", "Footsteps"],
      ["I have cities, but no houses live there. I have mountains, but no trees grow there. I have water, but no fish swim there. What am I?", "A map"],
      ["What gets wetter the more it dries?", "A towel"]
    ];
    const [r, a] = rand(riddles);
    signalRiddles.set(from, a);
    return `🧩 *Riddle:*\n\n${r}\n\n_Reply .answer to reveal the answer_`;
  }
  if (cmd === "answer") {
    const ans = signalRiddles.get(from);
    if (!ans) return "No active riddle. Try .riddle first";
    signalRiddles.delete(from);
    return `💡 *Answer:* ${ans}`;
  }

  // ── DATA ───────────────────────────────────────────────────────────────────
  if (cmd === "weather") {
    const city = args.join(" ");
    if (!city) return "usage: .weather <city>\nexample: .weather Lagos";
    const w = await getWeather(city);
    return w ? `🌤 *Weather*\n${w}` : "Couldn't fetch weather right now, try again";
  }
  if (cmd === "define") {
    const word = args[0];
    if (!word) return "usage: .define <word>";
    try {
      const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      const d = await r.json();
      if (!Array.isArray(d)) return `No definition found for "${word}"`;
      const def = d[0]?.meanings?.[0]?.definitions?.[0];
      const phonetic = d[0]?.phonetic || "";
      return def ? `📖 *${word}* ${phonetic}\n\n${def.definition}${def.example ? `\n\n_"${def.example}"_` : ""}` : `No definition found for "${word}"`;
    } catch { return "Dictionary lookup failed, try again"; }
  }
  if (cmd === "translate" || cmd === "tr") {
    const lang = args[0];
    const text = args.slice(1).join(" ");
    if (!lang || !text) return "usage: .translate <language> <text>\nexample: .translate yoruba how are you";
    const reply = await callAI(`Translate this to ${lang}. Reply with ONLY the translation, nothing else: "${text}"`, from + "_translate");
    return reply ? `🌐 *${lang}:*\n${reply}` : "Translation failed, try again";
  }
  if (cmd === "summarize" || cmd === "sum" || cmd === "tldr") {
    const text = args.join(" ");
    if (!text || text.length < 20) return "Paste the text after .summarize\nexample: .summarize <long text here>";
    const reply = await callAI(`Summarize this in 3 bullet points, short and clear:\n\n${text}`, from + "_summarize");
    return reply ? `📋 *Summary:*\n${reply}` : "Couldn't summarize, try again";
  }
  if (cmd === "explain" || cmd === "eli5") {
    const topic = args.join(" ");
    if (!topic) return "usage: .explain <topic>";
    const reply = await callAI(`Explain this simply in 2-3 short sentences like talking to a friend: ${topic}`, from + "_explain");
    return reply ? `📚 *${topic}:*\n${reply}` : "Couldn't explain, try again";
  }

  // ── COIN ───────────────────────────────────────────────────────────────────
  if (cmd === "coin" || cmd === "balance" || cmd === "bal") {
    const sub = (args[0] || "").toLowerCase();
    const fromDigits = from.replace(/[^0-9]/g, "");
    const bal = coinLedger.balances?.[fromDigits] || coinLedger.balances?.[`${fromDigits}@s.whatsapp.net`] || 0;
    const wlt = coinLedger.wallets?.[fromDigits] || coinLedger.wallets?.[`${fromDigits}@s.whatsapp.net`];

    if (sub === "send") {
      return `💸 Coin transfers on Signal: send via WhatsApp with .coin send <num> <amt>`;
    }
    return (
      `💰 *${CNAME} (${SYM}) Balance*\n\n` +
      `👤 +${fromDigits}\n` +
      `💎 *${bal.toLocaleString()} ${SYM}*\n\n` +
      (wlt ? `🌐 Wallet: \`${wlt.slice(0,6)}...${wlt.slice(-4)}\`` : `⚠️ No Trust Wallet linked yet`)
    );
  }

  // ── TICKET ─────────────────────────────────────────────────────────────────
  if (cmd === "ticket" || cmd === "flyticket") {
    if (signalPendingTicket.has(from)) {
      return "✈️ You already have a ticket wizard open!\n\nAnswer the current question or type .ticketcancel to start over.";
    }
    signalPendingTicket.set(from, { step: 1, data: {} });
    return (
      `✈️ *FLIGHT TICKET GENERATOR*\n\n` +
      `I'll create your boarding pass in 7 steps.\n\n` +
      `*Step 1 of 7*\n` +
      `👤 What is the *PASSENGER full name?*\n_(e.g. JOHN DOE)_`
    );
  }
  if (cmd === "ticketcancel") {
    if (signalPendingTicket.has(from)) {
      signalPendingTicket.delete(from);
      return "❌ Ticket wizard cancelled.";
    }
    return "No active ticket wizard.";
  }

  return null; // not handled — fall through to AI
}

// ─── Ticket wizard (Signal) ───────────────────────────────────────────────────
const signalPendingTicket = new Map();
const signalRiddles       = new Map();
let   signalStartTime     = Date.now();

const TICKET_QUESTIONS = [
  null,
  "👤 *PASSENGER full name?*\n_(e.g. JOHN DOE)_",
  "🛫 *Flying FROM which city?*\n_(e.g. Lagos, Abuja)_",
  "🛬 *Flying TO which city?*\n_(e.g. London, Dubai)_",
  "✈️ *Airline name?*\n_(e.g. Air Peace, Arik Air)_",
  "📅 *Travel DATE?*\n_(e.g. 25 July 2026)_",
  "⏰ *Departure TIME?*\n_(e.g. 08:30, 14:15)_",
  "💰 *Ticket PRICE in Naira?*\n_(e.g. 45000)_"
];

function generateBoardingPass(d) {
  const fromCode = (d.from || "???").substring(0, 3).toUpperCase();
  const toCode   = (d.to   || "???").substring(0, 3).toUpperCase();
  return [
    ``,
    `✈️ *BOARDING PASS*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `👤 *PASSENGER*`,
    `${d.passenger}`,
    ``,
    `🛫 *FROM*          🛬 *TO*`,
    `${fromCode} — ${d.from}   ${toCode} — ${d.to}`,
    ``,
    `✈️  *AIRLINE:*  ${d.airline}`,
    `🔢  *FLIGHT:*   ${d.flightNum}`,
    `💺  *SEAT:*     ${d.seat}`,
    `🚪  *GATE:*     ${d.gate}`,
    ``,
    `📅  *DATE:*     ${d.date}`,
    `⏰  *DEPARTS:*  ${d.time}`,
    ``,
    `💰  *PRICE:*    ₦${(d.price || 0).toLocaleString()}`,
    `🎫  *TICKET:*   ${d.ticketId}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `✅ *VALID BOARDING PASS*`,
    `_Generated by MFG Signal Bot_`,
    ``
  ].join("\n");
}

// ─── Message processor ────────────────────────────────────────────────────────
const TRIVIAL_MSGS = new Set([
  "ok","k","okay","lol","haha","hahaha","lmao","😂","👍","🙏","😅","💀","🤣","😭",
  "hmm","mhm","yh","yeah","yep","nope","no","yes","sure","nice","cool","true","facts",
  "bruh","bro","🔥","👏","😊","🫡","💯","🤙","ight","aiight","k lol","😆","✅","👌"
]);

async function processSignalMessage(envelope) {
  try {
    const dm   = envelope?.dataMessage;
    if (!dm) return;
    const text = (dm.message || "").trim();
    const from = envelope.source || envelope.sourceNumber || "";
    if (!from || !text) return;
    // Skip own messages
    const fromDigits = from.replace(/[^0-9]/g, "");
    const ownDigits  = SIGNAL_NUMBER.replace(/[^0-9]/g, "");
    if (fromDigits === ownDigits) return;

    console.log(`[Signal] ← +${fromDigits.slice(-7)}: ${text.slice(0, 70)}`);

    // ── Ticket wizard step ─────────────────────────────────────────────────
    if (signalPendingTicket.has(from) && !text.startsWith(".")) {
      const wizard = signalPendingTicket.get(from);
      const step   = wizard.step;
      const d      = wizard.data;

      if (step === 1) { d.passenger = text.toUpperCase(); wizard.step = 2; }
      else if (step === 2) { d.from = text; wizard.step = 3; }
      else if (step === 3) { d.to   = text; wizard.step = 4; }
      else if (step === 4) { d.airline = text; wizard.step = 5; }
      else if (step === 5) { d.date    = text; wizard.step = 6; }
      else if (step === 6) { d.time    = text; wizard.step = 7; }
      else if (step === 7) {
        d.price    = parseInt(text.replace(/[^0-9]/g, "")) || 0;
        d.ticketId = `TKT-S${Date.now().toString(36).toUpperCase().slice(-5)}`;
        d.flightNum = (d.airline || "XX").substring(0, 2).toUpperCase().replace(/[^A-Z]/g, "X") + Math.floor(Math.random() * 9000 + 1000);
        d.seat      = `${Math.floor(Math.random() * 30 + 1)}${["A","B","C","D","E","F"][Math.floor(Math.random()*6)]}`;
        d.gate      = `${["A","B","C","D"][Math.floor(Math.random()*4)]}${Math.floor(Math.random()*20+1)}`;
        signalPendingTicket.delete(from);
        await sendSignalMessage(from, generateBoardingPass(d));
        await new Promise(r => setTimeout(r, 400));
        await sendSignalMessage(from,
          `✅ *Boarding pass generated!*\n\n🎫 Ref: *${d.ticketId}*\n✈️ *${d.from} → ${d.to}*\n📅 *${d.date}* at *${d.time}*\n\n_.ticket_ to generate another`
        );
        return;
      }

      if (wizard.step <= 7) {
        signalPendingTicket.set(from, wizard);
        await sendSignalMessage(from, `✅ Got it!\n\n*Step ${wizard.step} of 7*\n${TICKET_QUESTIONS[wizard.step]}`);
      }
      return;
    }

    // ── Trivial skip ──────────────────────────────────────────────────────
    if (text.length < 12 && TRIVIAL_MSGS.has(text.toLowerCase())) {
      console.log("[Signal] skip:trivial");
      return;
    }

    // ── Commands ──────────────────────────────────────────────────────────
    const pfx = settings.prefix || ".";
    if (text.startsWith(pfx)) {
      const [rawCmd, ...args] = text.slice(pfx.length).trim().split(/\s+/);
      const cmd    = rawCmd.toLowerCase();
      const result = await handleCommand(cmd, args, from);
      if (result) { await sendSignalMessage(from, result); return; }
      // unrecognised command — fall through to AI
    }

    // ── AI reply ──────────────────────────────────────────────────────────
    if (!settings.aiEnabled || signalAiDisabled.has(from)) return;

    // Human-like delay
    const delay = Math.floor(Math.random() * 1500) + 1500;
    await new Promise(r => setTimeout(r, delay));

    const aiReply = await callAI(text, from);
    if (aiReply) await sendSignalMessage(from, aiReply);
  } catch (e) { console.log("[Signal] processMessage err:", e.message); }
}

// ─── Signal receive — WebSocket with polling fallback ─────────────────────────
async function startReceiving() {
  // Try WebSocket first (signal-cli-rest-api supports it)
  try {
    const ws = require("ws"); // available as transitive dep via baileys
    const wsUrl = `${SIGNAL_CLI_URL.replace(/^http/, "ws")}/v1/receive/${encodeURIComponent(SIGNAL_NUMBER)}`;
    console.log("[Signal] Connecting WebSocket:", wsUrl);

    const connect = () => {
      const socket = new ws.WebSocket(wsUrl);
      socket.on("open", () => console.log("[Signal] ✅ WebSocket connected — receiving live messages"));
      socket.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          processSignalMessage(parsed.envelope || parsed);
        } catch {}
      });
      socket.on("close", (code) => {
        console.log(`[Signal] WebSocket closed (${code}), retrying in 15s...`);
        setTimeout(connect, 15000);
      });
      socket.on("error", (e) => {
        console.log("[Signal] WebSocket error:", e.message, "— falling back to polling");
        socket.terminate();
        startPolling();
      });
    };
    connect();
  } catch (wsErr) {
    console.log("[Signal] ws module not available, using polling:", wsErr.message);
    startPolling();
  }
}

async function startPolling() {
  console.log("[Signal] 📡 Starting polling loop (every 3s)...");
  const poll = async () => {
    try {
      const r = await fetch(`${SIGNAL_CLI_URL}/v1/receive/${encodeURIComponent(SIGNAL_NUMBER)}`, {
        signal: AbortSignal.timeout(5000)
      });
      if (r.ok) {
        const msgs = await r.json();
        const list = Array.isArray(msgs) ? msgs : [];
        for (const m of list) await processSignalMessage(m.envelope || m);
      }
    } catch { /* signal-cli not reachable yet — silent */ }
    setTimeout(poll, 3000);
  };
  poll();
}

// ─── Start ────────────────────────────────────────────────────────────────────
console.log(`[Signal] ═══════════════════════════════════`);
console.log(`[Signal] MFG Signal Bot starting`);
console.log(`[Signal] Number:  ${SIGNAL_NUMBER}`);
console.log(`[Signal] CLI URL: ${SIGNAL_CLI_URL}`);
console.log(`[Signal] ═══════════════════════════════════`);
startReceiving();
