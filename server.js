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
  downloadMediaMessage,
  makeCacheableSignalKeyStore,
  WAMessageStubType,
  proto
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
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
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

const SETTINGS_DEFAULTS = {
  autoCallReject: false,
  callBlock: true,
  autoReadStatus: false,
  aiEnabled: true,
  aiMode: "chill",
  aiDelay: 0,
  aiTyping: false,
  proactiveText: false,        // OFF by default — only kicks in when owner runs .online
  onlineMode: false,           // .online turns this on: keeps WhatsApp presence "available" + enables proactive texting
  // Big-shot features (all on by default)
  aiDisclaimer: true,           // Tell people "you're speaking to my mirror AI" once per contact per day
  disclaimerText: "👋 hey — quick heads up: you're speaking to teddymfg's MIRROR AI 🤖 he's offline rn but i'll text you for him in his style. — built by my maker: teddymfg",
  transcribeVoice: true,        // Voice notes → Whisper transcribe → AI replies to the text
  visionEnabled: true,          // Images → llama-vision describes → AI replies meaningfully
  autoTakeover: true,           // When owner texts in a chat, pause AI in that chat for X min
  takeoverMinutes: 10,
  moodAware: true,              // Adjust tone by time of day
  antiScam: true,               // Detect scam patterns, alert owner
  birthdayWishes: true,         // Auto-wish birthdays mentioned in chat
  voiceCloneEnabled: false,     // Requires ELEVENLABS_API_KEY + voice ID
  voiceReplyMode: "off",        // "off" | "auto" (every reply) | "owner" (only when owner asks .voice me)
  greeting: "yo. mfg_bot here.",
  systemPrompt: `You are texting AS the owner of this phone — you ARE them. Not a bot, not an assistant. Just them.

IDENTITY: Nigerian. Real one. You mix English and pidgin naturally without forcing it — same way the owner does.

YOUR ONLY JOB: Mirror how the owner texts. Study their actual messages and copy:
- Their exact sentence length
- Their exact punctuation style (if they don't use full stops, you don't either)
- Their exact capitalisation (all lowercase = you go all lowercase)
- Their emoji usage frequency
- Their slang, their pidgin phrases, their abbreviations
- Their energy level — chill = chill, hype = hype back

PERSONALITY:
- Be warm, friendly, real. Like the owner texting their friends.
- Be playful, witty, lightly cheeky when the vibe calls for it — never mean, never insulting
- Be casual and natural. No corporate tone, no AI fluff
- Be concise. Short replies usually. Match the length of what they sent you.
- Use Nigerian English/pidgin naturally where it fits — don't force it

NEVER:
- Never say "as an AI", "I'm a bot", "certainly", "of course", "I'd be happy to"
- Never be preachy, never lecture
- Never insult anyone
- Never refuse to reply — always say something, even if just "lol" or "k" or "wetin"

BILLING DODGE: If someone asks for money or talks about debts, gently dodge with humor. Don't promise money. Don't confirm debts. Pidgin works well here.

ESCALATION: If someone is genuinely distressed, crying, suicidal, or in real danger — start your reply with [STOP] and nothing else. The bot will pause and let the owner handle it directly.

WHEN UNSURE: Just be short, lowercase, casual. One word answers are fine. "yo", "k", "lol", "wetin", "mhm" — all valid.`,
  prefix: ".",
  botName: "mfg_bot",
  owners: []
};
// Merge file values OVER defaults — new feature flags get defaults until user changes them
let settings = { ...SETTINGS_DEFAULTS, ...readJSON("settings.json", {}) };
delete settings.paymentsEnabled;

// ─── Flutterwave Keys ────────────────────────────────────────────────────────
const FLW_SECRET = process.env.FLW_SECRET_KEY || "";
const FLW_PUBLIC = process.env.FLW_PUBLIC_KEY || "";
const FLW_ENCRYPT = process.env.FLW_ENCRYPTION_KEY || "";
let ghostBankData = readJSON("ghostBank.json", {}); // jid → { accountNumber, bankName, acctName, txRef, balance }

let tokenData = readJSON("tokenData.json", {
  validTokens: [ "a7F9kLm2Qx8P", "Zr4Tn8Vy1Bc6", "pQ5mX2sL9dKe", "H8uJ3wRt7Nz1", "yL0cV6kPq4Xm", "T9bF2nGh5Wr8", "mX7qL1zCv9Dt", "R4pNk8Jw2Ys5", "vD6tQ3mLp1Xc", "K2yW9nFr5Tb7", "cM8xQ4vL1zHp", "P5rT7nYk2Wd9", "fJ3mX8qLc6Vz", "N1wK4tRp9Ys2", "zQ7vM2xLf5Dc", "B9kT3nWy8Rp1", "gL4xQ7mVc2Dt", "W6pNz1kY5Rf8", "tX2mL9qCv4Jh", "Y8rK5nWp1Dz3", "qF7vM2xLc9Tb", "D1kY4nRp8Ws5", "mQ9xL2vTc7Fh", "R5pNz8kW1Dy4", "cX3mL7qVf2Tn", "T8rK1nWp5Dz9", "zF4vM7xLc2Tb", "B1kY9nRp4Ws8", "gQ5xL2vTc8Fh", "W7pNz1kY4Rf9", "tX8mL3qCv5Jh", "Y2rK9nWp1Dz6", "qF5vM8xLc4Tb", "D7kY1nRp9Ws2", "mQ4xL8vTc5Fh", "R1pNz7kW2Dy9", "cX5mL9qVf1Tn", "T2rK8nWp4Dz7", "zF1vM5xLc9Tb", "B8kY2nRp6Ws4", "gQ7xL1vTc5Fh", "W9pNz4kY2Rf8", "tX6mL3qCv1Jh", "Y5rK8nWp2Dz9", "qF1vM4xLc7Tb", "D9kY5nRp2Ws8", "mQ3xL7vTc1Fh", "R8pNz2kW5Dy4", "cX1mL6qV9Tn3", "T5rK2nWp8Dz1", "zF9vM3xLc7Tb", "B4kY8nRp1Ws5", "gQ2xL9vTc6Fh", "W1pNz5kY8Rf3", "tX4mL7qCv2Jh", "Y9rK1nWp6Dz5", "qF3vM8xLc2Tb", "D5kY7nRp4Ws1", "mQ1xL6vTc9Fh", "R2pNz8kW3Dy7", "cX9mL4qV1Tn5", "T7rK3nWp9Dz2", "zF2vM6xLc8Tb", "B5kY1nRp7Ws9", "gQ8xL4vTc2Fh", "W3pNz9kY1Rf6", "tX5mL2qCv8Jh", "Y1rK7nWp4Dz9", "qF6vM3xLc5Tb", "D8kY2nRp9Ws4", "mQ7xL1vTc3Fh", "R4pNz6kW8Dy2", "cX2mL9qV5Tn1", "T1rK8nWp3Dz7", "zF5vM7xLc4Tb", "B2kY9nRp6Ws1", "gQ4xL8vTc5Fh", "W6pNz1kY7Rf2", "tX9mL3qCv4Jh", "Y7rK5nWp1Dz8", "qF2vM9xLc6Tb", "D4kY7nRp3Ws5", "mQ8xL1vTc2Fh", "R9pNz5kW4Dy1", "cX6mL2qV8Tn7", "T3rK9nWp5Dz1", "zF7vM4xLc1Tb", "B1kY5nRp8Ws3", "gQ9xL2vTc4Fh", "W5pNz8kY1Rf7", "tX1mL6qCv9Jh", "Y4rK2nWp7Dz5", "qF8vM1xLc3Tb", "D2kY6nRp9Ws4", "mQ5xL7vTc1Fh", "R3pNz4kW8Dy2", "cX7mL1qV5Tn9", "T9rK4nWp2Dz6", "zF3vM8xLc5Tb", "B6kY1nRp7Ws2" ],
  usedTokens: {},
  authorizedUsers: {}
});

// Auto-flip voiceClone on if both ElevenLabs env vars are present
if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) settings.voiceCloneEnabled = true;

// Ensure maker is recognized
if (!settings.systemPrompt.includes("+23409132883869")) {
  settings.systemPrompt += "\n\nMAKER RECOGNITION: Your maker and creator is +23409132883869. If you interact with them, show respect and acknowledge them as your maker.";
}

writeJSON("settings.json", settings);  // persist merged version so all flags are present

let styleSamples = readJSON("style_samples.json", []);
let userData = readJSON("users.json", {});

// ─── Bot State ───────────────────────────────────────────────────────────────
let sock = null, currentQr = null, isConnected = false, hasQr = false;
let reconnectCount = 0, startTime = Date.now();
const activePersona = new Map(); // jid → persona name (e.g. "Burna Boy")
let hasEverConnected = false;  // tracks if WA ever reached "open" — used to distinguish real logout vs post-pair restart
let consecutive401s = 0;       // breaks reconnect loop on stale/bad creds
let lastBotMsgByChat = new Map(); // jid -> last sent msg key (for .editlast)

// ── PROPER BAILEYS RETRY STORE ───────────────────────────────────────────────
// Baileys calls getMessage(key) when a peer requests a retry (their session got
// out of sync). If we return empty, the peer's session corrupts → Bad MAC →
// reconnect storm → buffered messages get re-delivered → bot resends. The fix
// is to actually remember messages we sent so we can answer retries properly.
// Persisted to disk so it survives restarts (the most common cause of session
// drift is a redeploy that wipes in-memory state mid-conversation).
const MSG_STORE_PATH = path.join(DATA_DIR, "msg_store.json");
const MSG_STORE_MAX = 2000; // ~last 2000 messages, plenty for retry windows
function loadMsgStore() {
  try {
    if (!fs.existsSync(MSG_STORE_PATH)) return new Map();
    const raw = JSON.parse(fs.readFileSync(MSG_STORE_PATH, "utf8"));
    return new Map(Object.entries(raw));
  } catch { return new Map(); }
}
let messageStore = loadMsgStore();
let msgStoreDirty = false;
function msgStoreKey(jid, id) { return `${jid}::${id}`; }
function rememberMessage(jid, id, message) {
  if (!jid || !id || !message) return;
  messageStore.set(msgStoreKey(jid, id), message);
  // Trim oldest when we exceed the cap (Map preserves insertion order)
  if (messageStore.size > MSG_STORE_MAX) {
    const drop = messageStore.size - MSG_STORE_MAX;
    const it = messageStore.keys();
    for (let i = 0; i < drop; i++) messageStore.delete(it.next().value);
  }
  msgStoreDirty = true;
}
// Flush to disk every 10s if dirty — avoids hammering the FS per-message
setInterval(() => {
  if (!msgStoreDirty) return;
  try {
    if (!fs.existsSync(path.dirname(MSG_STORE_PATH))) fs.mkdirSync(path.dirname(MSG_STORE_PATH), { recursive: true });
    fs.writeFileSync(MSG_STORE_PATH, JSON.stringify(Object.fromEntries(messageStore)));
    msgStoreDirty = false;
  } catch (e) { /* ignore disk errors */ }
}, 10000);

// ── GROUP METADATA CACHE ─────────────────────────────────────────────────────
// Baileys re-fetches group metadata on every group message unless we cache it.
// Cache misses also contribute to retry storms in active groups.
const groupMetadataCache = new Map(); // jid -> { metadata, ts }
const GROUP_META_TTL = 5 * 60 * 1000;

// ── MESSAGE AGE SEMANTICS ────────────────────────────────────────────────────
// WhatsApp re-delivers unacked messages whenever the bot reconnects. Side-
// effecting actions (commands like .sreact, AI replies, proactive sends) must
// only fire for FRESH messages — otherwise a Railway restart at 7am replays
// every command/AI-reply that happened overnight. This is the protocol-correct
// behaviour: the WhatsApp client itself doesn't pop notifications for ancient
// re-delivered messages either.
const MAX_ACTIONABLE_MSG_AGE_MS = 60 * 1000;
function msgAgeMs(msg) {
  const t = Number(msg?.messageTimestamp || 0);
  return t > 0 ? Date.now() - t * 1000 : 0;
}

// ── BAD-MAC SESSION AUTO-RECOVERY ────────────────────────────────────────────
// When libsignal can't decrypt a peer's message (Bad MAC), Baileys surfaces it
// as a CIPHERTEXT-stub upsert. The protocol-correct response is to wipe THAT
// peer's session so the next message triggers a fresh handshake — no manual
// re-pair required. Threshold avoids nuking a session on a single hiccup.
const badMacCount = new Map(); // jid -> count
const BAD_MAC_THRESHOLD = 3;
const wipedSessions = new Set(); // jids we've already wiped this process
function sessionFilesForJid(authPath, jid) {
  // Baileys file naming: session-<jid>.json (with various jid normalisations)
  try {
    const all = fs.readdirSync(authPath);
    const tag = (jid || "").split("@")[0].split(":")[0];
    if (!tag) return [];
    return all
      .filter(f => f.startsWith("session-") && f.includes(tag))
      .map(f => path.join(authPath, f));
  } catch { return []; }
}
function wipePeerSession(jid) {
  if (!jid || wipedSessions.has(jid)) return;
  const authPath = process.env.AUTH_PATH || path.join(__dirname, "auth_info_baileys");
  const files = sessionFilesForJid(authPath, jid);
  let removed = 0;
  for (const f of files) {
    try { fs.unlinkSync(f); removed++; } catch {}
  }
  wipedSessions.add(jid);
  badMacCount.delete(jid);
  console.log(`[MFG_bot] BAD-MAC RECOVERY: wiped ${removed} session file(s) for ${jid.slice(-20)} — next msg will renegotiate fresh session`);
}
let allChats = [];
let recentMsgLog = [];
let lastGroqError = null;
let commandStats = {};
let messageCount = 0;
let latestStatus = null;
let savedNotes = readJSON("notes.json", {});
let savedTodos = readJSON("todos.json", {});
let savedKV = readJSON("kv.json", {});
let convHistory = readJSON("conv_history.json", {});
let contactFacts = readJSON("contact_facts.json", {});  // Long-term memory: per-JID extracted facts
let scamAlerts = readJSON("scam_alerts.json", []);      // Log of detected scam attempts
let birthdayMemory = readJSON("birthdays.json", {});    // jid → "MM-DD"

// ─── Call & Escalation State ─────────────────────────────────────────────────
const callWarned = new Set();   // JIDs that received call-blocked warning
const aiPaused  = new Map();    // JID → timestamp when AI paused due to escalation
const aiContactDisabled = new Set(); // JIDs where AI is permanently off (per-contact toggle)
const disclaimerSent = new Map(); // JID → date string (YYYY-MM-DD) of last disclaimer sent
const ownerTakeover = new Map(); // JID → timestamp when owner started typing → AI pauses
const pendingDownload = new Map(); // JID → timestamp; awaits next msg as song name/url for .download

// ─── Pairing Code State ──────────────────────────────────────────────────────
let pendingPairPhone = null;   // set before restarting socket in pairing mode
let pairCodeResolve = null;    // Promise resolver waiting for the code

function trackCommand(cmd) {
  commandStats[cmd] = (commandStats[cmd] || 0) + 1;
}

// ─── ElevenLabs Voice Synthesis ──────────────────────────────────────────────
// Auto-enables when both ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID env vars are set
async function synthesizeVoice(text) {
  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID) return null;
  if (!text || text.length > 500) return null; // keep voice notes short
  try {
    const https = require("https");
    const body = JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.30, use_speaker_boost: true }
    });
    const audio = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.elevenlabs.io",
        path: `/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
          "Content-Length": Buffer.byteLength(body)
        }
      }, (res) => {
        if (res.statusCode !== 200) {
          let err = ""; res.on("data", c => err += c); res.on("end", () => reject(new Error(`ElevenLabs ${res.statusCode}: ${err.slice(0,200)}`)));
          return;
        }
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.write(body); req.end();
    });
    return audio;
  } catch (e) {
    console.log("[MFG_bot] ElevenLabs error:", e.message);
    return null;
  }
}

// ─── Owner Config ────────────────────────────────────────────────────────────
const OWNER_NUMBER = "2349132883869";  // Fixed: was "23409132883869" (extra 0 broke owner detection)
const OWNER_JID = `${OWNER_NUMBER}@s.whatsapp.net`;

function isOwner(jid) {
  if (!jid) return false;
  const digits = jid.replace(/[^0-9]/g, "");
  // Match owner with or without the extra "0" (some chats show 23409..., some 2349...)
  return digits === OWNER_NUMBER || digits === "23409132883869" || jid === OWNER_JID;
}

// ─── Mood / Time Awareness ───────────────────────────────────────────────────
function moodPrompt() {
  if (!settings.moodAware) return "";
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 11)  return "\n\n[MOOD: morning — sharp, direct, fresh energy. short replies.]";
  if (hour >= 11 && hour < 17) return "\n\n[MOOD: afternoon — normal energy, balanced.]";
  if (hour >= 17 && hour < 23) return "\n\n[MOOD: evening — chill, more emojis ok, slightly playful.]";
  return "\n\n[MOOD: late night — sleepy energy, minimal words, maybe just 'k' or 'lol'.]";
}

// ─── Deezer search (free, no API key, full metadata + 30s preview fallback) ──
async function searchDeezer(query) {
  try {
    const q = encodeURIComponent(query.trim());
    const r = await fetch(`https://api.deezer.com/search?q=${q}&limit=5`, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const data = await r.json().catch(() => null);
    return data?.data?.[0] || null;
  } catch (e) { console.log("[MFG_bot] Deezer search err:", e.message); return null; }
}

// ─── iTunes search (free, no API key, 30s preview) ───────────────────────────
async function downloadFromItunes(query) {
  try {
    const q = encodeURIComponent(query.trim());
    const r = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&limit=5`, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const data = await r.json().catch(() => null);
    const track = data?.results?.[0];
    if (!track?.previewUrl) return null;
    const title = `${track.artistName} - ${track.trackName}`;
    console.log(`[MFG_bot] iTunes preview → "${title}"`);
    const audioRes = await fetch(track.previewUrl, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "Mozilla/5.0" } });
    const arrayBuffer = await audioRes.arrayBuffer();
    if (arrayBuffer.byteLength < 5000) return null;
    console.log(`[MFG_bot] ✅ iTunes: "${title}" — ${Math.round(arrayBuffer.byteLength / 1024)}KB`);
    return { buffer: Buffer.from(arrayBuffer), title, source: "itunes", isPreview: true };
  } catch (e) { console.log(`[MFG_bot] iTunes err: ${e.message}`); return null; }
}

function sanitizeFileName(name) {
  return String(name || "song").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 48) || "song";
}

async function streamToBuffer(stream, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    stream.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        stream.destroy(new Error("audio file is too large for WhatsApp"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// ─── Music Download — Multi-source with fallbacks ────────────────────────────
// Source 1: JioSaavn direct API (no third-party mirrors needed)
async function downloadFromSaavn(query) {
  try {
    const q = encodeURIComponent(query.trim());
    const apiUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&ctx=wap6dot0&q=${q}&p=1&n=5`;
    console.log(`[MFG_bot] Saavn direct search → "${query}"`);
    const r = await fetch(apiUrl, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15", "Accept": "application/json", "Referer": "https://www.jiosaavn.com/" } });
    const data = await r.json().catch(() => null);
    const results = data?.results ?? [];
    const song = Array.isArray(results) ? results[0] : null;
    if (!song) { console.log("[MFG_bot] Saavn: no results"); return null; }
    const title = song.song || song.title || query;
    // Try preview URL first (shorter but universally accessible)
    const previewUrl = song.media_preview_url;
    if (previewUrl) {
      const audioRes = await fetch(previewUrl, { signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0" } });
      if (audioRes.ok) {
        const arrayBuffer = await audioRes.arrayBuffer();
        if (arrayBuffer.byteLength > 5000) {
          console.log(`[MFG_bot] ✅ Saavn preview: "${title}" — ${Math.round(arrayBuffer.byteLength / 1024)}KB`);
          return { buffer: Buffer.from(arrayBuffer), title, source: "saavn", isPreview: true };
        }
      }
    }
    console.log("[MFG_bot] Saavn: audio geo-restricted, falling back");
    return null;
  } catch (e) { console.log(`[MFG_bot] Saavn err: ${e.message}`); return null; }
}

// Source 2: cobalt.tools API (SoundCloud direct links)
// Uses the official cobalt API — public instances may require auth
async function downloadFromCobalt(url) {
  const COBALT_INSTANCES = [
    "https://cobalt.api.nadeko.net",
    "https://co.wuk.sh"
  ];
  for (const base of COBALT_INSTANCES) {
    try {
      console.log(`[MFG_bot] Cobalt → ${base}`);
      // Try new v10+ format (POST to /) first, fallback to old /json
      for (const endpoint of [`${base}/`, `${base}/json`]) {
        const r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ url, aFormat: "mp3", isAudioOnly: true }),
          signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) continue;
        const data = await r.json().catch(() => null);
        if (!data) continue;
        const dlUrl = data.url || data.audio;
        if (!dlUrl) continue;
        const audioRes = await fetch(dlUrl, { signal: AbortSignal.timeout(40000), headers: { "User-Agent": "Mozilla/5.0" } });
        const arrayBuffer = await audioRes.arrayBuffer();
        if (arrayBuffer.byteLength < 5000) continue;
        console.log(`[MFG_bot] ✅ Cobalt: ${Math.round(arrayBuffer.byteLength / 1024)}KB`);
        return { buffer: Buffer.from(arrayBuffer), title: "song", source: "cobalt" };
      }
    } catch (e) { console.log(`[MFG_bot] Cobalt err (${base}): ${e.message}`); }
  }
  return null;
}

// Main entry point: Saavn preview → Deezer 30s → iTunes 30s
// SoundCloud direct links: try cobalt (may be unavailable)
async function downloadMusic(query) {
  if (!query) return null;
  const isSoundCloudUrl = /https?:\/\/(www\.)?soundcloud\.com/i.test(query);
  const isDirectUrl = /https?:\/\//i.test(query);

  if (isSoundCloudUrl) {
    const cobalt = await downloadFromCobalt(query);
    if (cobalt?.buffer) return cobalt;
    console.log("[MFG_bot] Cobalt unavailable for SoundCloud URL");
    // Fall through to name-based search with the URL as query (won't work great but better than null)
    return null;
  }

  if (isDirectUrl) {
    // Unknown direct URL — try cobalt then give up (no YouTube)
    const cobalt = await downloadFromCobalt(query);
    if (cobalt?.buffer) return cobalt;
    return null;
  }

  // Name-based search: Saavn (full song) → Deezer preview → iTunes preview
  console.log(`[MFG_bot] Searching music: "${query}"`);
  const saavn = await downloadFromSaavn(query);
  if (saavn?.buffer) return saavn;

  console.log("[MFG_bot] Saavn failed — trying Deezer preview");
  const deezerTrack = await searchDeezer(query);
  if (deezerTrack?.preview) {
    try {
      const audioRes = await fetch(deezerTrack.preview, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "Mozilla/5.0" } });
      const arrayBuffer = await audioRes.arrayBuffer();
      if (arrayBuffer.byteLength > 5000) {
        const title = `${deezerTrack.artist?.name || ""} - ${deezerTrack.title || query}`.trim();
        console.log(`[MFG_bot] ✅ Deezer: "${title}" — ${Math.round(arrayBuffer.byteLength / 1024)}KB (30s preview)`);
        return { buffer: Buffer.from(arrayBuffer), title, source: "deezer", isPreview: true };
      }
    } catch (e) { console.log(`[MFG_bot] Deezer download err: ${e.message}`); }
  }

  console.log("[MFG_bot] Deezer failed — trying iTunes preview");
  const itunes = await downloadFromItunes(query);
  if (itunes?.buffer) return itunes;

  console.log("[MFG_bot] All music download methods failed for:", query);
  return null;
}

// Alias for legacy callers
const downloadYoutubeAudio = downloadMusic;

// Song info via Deezer (replaces old getYoutubeInfo)
async function getSongInfo(query) {
  try {
    const track = await searchDeezer(query);
    if (!track) return null;
    const seconds = Math.round(track.duration || 0);
    const duration = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "unknown";
    return {
      title: track.title,
      artist: track.artist?.name || "Unknown",
      album: track.album?.title || "Unknown",
      duration,
      link: track.link || `https://www.deezer.com/track/${track.id}`
    };
  } catch (e) { return null; }
}

// ─── Diagnostic logs (exposed via /api/recent for live debugging) ────────────
let lastWhisperResult = { at: null, ok: null, bytes: 0, text: "", error: "" };
let lastVisionResult = { at: null, ok: null, bytes: 0, text: "", error: "" };

// ─── Voice Note Transcription (Groq Whisper) ─────────────────────────────────
async function transcribeAudio(buffer, mimetype) {
  const key = process.env.GROQ_API_KEY;
  lastWhisperResult = { at: new Date().toISOString(), ok: null, bytes: buffer?.length || 0, text: "", error: "" };
  if (!key) { lastWhisperResult.error = "no GROQ_API_KEY"; return null; }
  if (!buffer || buffer.length < 100) { lastWhisperResult.error = "buffer too small: " + (buffer?.length || 0); return null; }
  try {
    // Use NATIVE FormData + Blob (Node 18+) — the npm `form-data` pkg is incompatible
    // with Node's native fetch and produces "multipart: NextPart: EOF" errors on Groq.
    const ext = mimetype?.includes("mp4") ? "m4a" : mimetype?.includes("mpeg") ? "mp3" : mimetype?.includes("wav") ? "wav" : "ogg";
    const ct = mimetype?.includes("mp4") ? "audio/mp4" : mimetype?.includes("mpeg") ? "audio/mpeg" : mimetype?.includes("wav") ? "audio/wav" : "audio/ogg";
    const blob = new Blob([buffer], { type: ct });
    const form = new FormData();
    form.append("file", blob, "audio." + ext);
    form.append("model", "whisper-large-v3"); // full model — more accurate than turbo for accents
    form.append("response_format", "json");
    form.append("language", "en"); // hint: speaker is English (Nigerian) — prevents random language guess
    form.append("prompt", "Nigerian English with pidgin. Common words: wetin, abeg, oga, dey, sabi, na, abi, sef, biko, comot, chai, omo, ehen, wahala, baba."); // accent prime
    form.append("temperature", "0");
    const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}` }, // DO NOT set Content-Type — fetch sets boundary itself
      body: form
    });
    const data = await resp.json();
    if (!resp.ok) {
      lastWhisperResult.ok = false;
      lastWhisperResult.error = `HTTP ${resp.status}: ` + JSON.stringify(data).slice(0,300);
      console.log("[MFG_bot] Whisper error:", lastWhisperResult.error);
      return null;
    }
    const text = data.text?.trim() || "";
    lastWhisperResult.ok = true;
    lastWhisperResult.text = text;
    return text || null;
  } catch (e) {
    lastWhisperResult.ok = false;
    lastWhisperResult.error = e.message;
    console.log("[MFG_bot] Transcribe error:", e.message);
    return null;
  }
}

// ─── Image Vision (Groq Llama-4 Scout) ───────────────────────────────────────
async function describeImage(buffer, caption, mimetype) {
  const key = process.env.GROQ_API_KEY;
  lastVisionResult = { at: new Date().toISOString(), ok: null, bytes: buffer?.length || 0, text: "", error: "" };
  if (!key) { lastVisionResult.error = "no GROQ_API_KEY"; return null; }
  if (!buffer || buffer.length < 100) { lastVisionResult.error = "buffer too small: " + (buffer?.length || 0); return null; }
  // Groq vision has 4MB limit on base64 — downscale check
  if (buffer.length > 3500000) { lastVisionResult.error = `image too big (${buffer.length} bytes, max ~3.5MB)`; console.log("[MFG_bot] " + lastVisionResult.error); return null; }
  try {
    const b64 = buffer.toString("base64");
    const mt = mimetype && mimetype.startsWith("image/") ? mimetype : "image/jpeg";
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `Describe this image in 1-2 short sentences focused on what matters for replying to it casually. ${caption ? `Caption: "${caption}"` : ""}` },
            { type: "image_url", image_url: { url: `data:${mt};base64,${b64}` } }
          ]
        }],
        max_tokens: 120
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      lastVisionResult.ok = false;
      lastVisionResult.error = `HTTP ${resp.status}: ` + JSON.stringify(data).slice(0,300);
      console.log("[MFG_bot] Vision error:", lastVisionResult.error);
      return null;
    }
    const text = data.choices?.[0]?.message?.content?.trim() || "";
    lastVisionResult.ok = true;
    lastVisionResult.text = text;
    return text || null;
  } catch (e) {
    lastVisionResult.ok = false;
    lastVisionResult.error = e.message;
    console.log("[MFG_bot] Vision error:", e.message);
    return null;
  }
}

// ─── Anti-Scam Detection ────────────────────────────────────────────────────
const SCAM_PATTERNS = [
  /send (me )?(\d|your|the) (bank|account|card|cvv|otp|pin)/i,
  /i('m| am) in trouble.*send/i,
  /urgent.*money|money.*urgent/i,
  /(verify|confirm) your.*account/i,
  /click (this|the) link.*claim/i,
  /you (have )?won.*\$?\d+/i,
  /investment.*guaranteed.*return/i,
  /bitcoin.*double|double.*bitcoin/i,
  /western union|moneygram.*urgent/i,
  /ignore (previous|all|prior) (instructions|prompt)/i,  // prompt injection
  /you are (now )?(a |an )?(different|new|jailbreak)/i
];
function isScamLikely(text) {
  if (!settings.antiScam || !text) return false;
  return SCAM_PATTERNS.some(re => re.test(text));
}

// ─── Long-term Fact Extraction ──────────────────────────────────────────────
async function extractFacts(jid, recentMessages) {
  const key = process.env.GROQ_API_KEY;
  if (!key || !recentMessages?.length) return;
  try {
    const existing = contactFacts[jid]?.facts || [];
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{
          role: "system",
          content: `Extract 0-3 NEW concrete facts about the user from these messages. Facts must be specific (names, places, jobs, relationships, plans, preferences). Return ONLY a JSON array of strings, no prose. Empty array if nothing notable. Existing facts to avoid duplicating: ${JSON.stringify(existing.slice(-10))}`
        }, {
          role: "user",
          content: recentMessages.slice(-6).join("\n")
        }],
        max_tokens: 200, temperature: 0.3
      })
    });
    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || "[]";
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return;
    const newFacts = JSON.parse(m[0]).filter(f => typeof f === "string" && f.length > 5);
    if (!newFacts.length) return;
    if (!contactFacts[jid]) contactFacts[jid] = { facts: [], relationship: "unknown", updated: Date.now() };
    contactFacts[jid].facts = [...(contactFacts[jid].facts || []), ...newFacts].slice(-25);
    contactFacts[jid].updated = Date.now();
    writeJSON("contact_facts.json", contactFacts);
    console.log(`[MFG_bot] Extracted ${newFacts.length} fact(s) for ${jid.slice(-15)}`);
  } catch (e) { /* silent */ }
}

// ─── Birthday extraction (light pattern) ────────────────────────────────────
function maybeRecordBirthday(jid, text) {
  if (!settings.birthdayWishes || !text) return;
  const m = text.match(/my (birthday|bday|b-day)\s+(is\s+)?(?:on\s+)?(\w+ \d{1,2}|\d{1,2}[/-]\d{1,2})/i);
  if (!m) return;
  birthdayMemory[jid] = m[3];
  writeJSON("birthdays.json", birthdayMemory);
  console.log(`[MFG_bot] Birthday recorded for ${jid.slice(-15)}: ${m[3]}`);
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

    // Long-term memory facts about this contact (knows things from weeks ago)
    let factsBlock = "";
    const facts = contactFacts[jid]?.facts || [];
    if (facts.length) {
      factsBlock = `\n\n[LONG-TERM MEMORY — THINGS YOU KNOW ABOUT THIS PERSON]:\n${facts.slice(-15).map(f => `- ${f}`).join("\n")}`;
    }

    const systemMsg = settings.systemPrompt + styleBlock + factsBlock + moodPrompt();

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
    if (!resp.ok) {
      console.error("[MFG_bot] Groq error:", JSON.stringify(data).slice(0, 300));
      lastGroqError = JSON.stringify(data).slice(0, 300);
      return await fallbackReply(userText, jid);
    }
    const finishReason = data.choices?.[0]?.finish_reason || "?";
    let reply = data.choices?.[0]?.message?.content?.trim() || null;
    console.log(`[MFG_bot] Groq finish=${finishReason} replyLen=${reply?.length || 0}`);

    // If empty (content filter / refusal), retry with softer prompt
    if (!reply) {
      console.log(`[MFG_bot] Empty Groq reply (finish=${finishReason}) — retrying with soft prompt`);
      lastGroqError = `empty reply, finish_reason=${finishReason}`;
      reply = await retryWithSoftPrompt(userText, jid);
    }
    if (!reply) reply = await fallbackReply(userText, jid);

    if (reply) {
      if (!convHistory[jid]) convHistory[jid] = [];
      convHistory[jid].push({ role: "user", content: userText });
      convHistory[jid].push({ role: "assistant", content: reply });
      if (convHistory[jid].length > 20) convHistory[jid] = convHistory[jid].slice(-20);
      setImmediate(() => writeJSON("conv_history.json", convHistory));
    }
    return reply;
  } catch (err) {
    console.error("[MFG_bot] Groq fetch error:", err.message);
    lastGroqError = "fetch err: " + err.message;
    return await fallbackReply(userText, jid);
  }
}

// Soft retry — fallback if main prompt returns nothing
async function retryWithSoftPrompt(userText, jid) {
  try {
    const key = process.env.GROQ_API_KEY;
    const samples = (userData[jid]?.ownerMessages || []).slice(-15);
    const sys = `You are texting AS the owner. Reply in their style — short, casual, lowercase, Nigerian pidgin/English mix. Be playful and slightly cheeky but never refuse to reply. Always respond with at least one short word.${samples.length ? "\n\nExamples of how the owner texts:\n" + samples.map(m => `"${m}"`).join("\n") : ""}`;
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: sys }, { role: "user", content: userText }],
        max_tokens: 80, temperature: 0.85
      })
    });
    const d = await resp.json();
    const r = d.choices?.[0]?.message?.content?.trim();
    console.log(`[MFG_bot] Soft retry replyLen=${r?.length || 0}`);
    return r || null;
  } catch (e) { console.error("[MFG_bot] Soft retry err:", e.message); return null; }
}

// Last resort — pick a contextual short reply so the bot is NEVER silent
function fallbackReply(userText, jid) {
  const t = (userText || "").toLowerCase().trim();
  const banks = {
    greeting: ["yo", "sup", "wetin happen", "hey", "wassup", "talk to me"],
    question: ["lol wetin", "explain", "say wetin", "ehn?", "how?", "tell me"],
    short: ["k", "ok", "noted", "lol", "mhm", "alright"],
    media: ["seen", "lol", "nice", "ok", "🤣", "mad oh"],
    default: ["lol", "wetin sef", "hmm", "okay", "talk", "say it"]
  };
  let bank;
  if (/^(hi|hey|hello|yo|sup|wassup|hafa|how)/.test(t)) bank = banks.greeting;
  else if (/\?$/.test(t)) bank = banks.question;
  else if (t.length < 4) bank = banks.short;
  else if (t.startsWith("[sent")) bank = banks.media;
  else bank = banks.default;
  return bank[Math.floor(Math.random() * bank.length)];
}

// ─── WhatsApp Connection ─────────────────────────────────────────────────────
async function connectToWhatsApp() {
  console.log("[MFG_bot] Attempting connection...");
  // AUTH_PATH lets Railway mount a persistent volume (e.g. /data/auth_info_baileys)
  // so WhatsApp session survives redeploys. Falls back to local dir for dev.
  const authPath = process.env.AUTH_PATH || "auth_info_baileys";
  console.log(`[MFG_bot] Using auth path: ${authPath}`);
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({
    version: [2, 3000, 1015901307], isLatest: false
  }));
  console.log(`[MFG_bot] WA version: ${version.join(".")} (latest: ${isLatest})`);

  const usingPairingCode = !!pendingPairPhone;

  // Silent logger for the signal key store (it logs every key op at trace level)
  const signalLogger = pino({ level: "silent" });

  sock = makeWASocket({
    version,
    // ── PROPER AUTH STATE ──
    // Wrap the file-backed key store in Baileys' cacheable wrapper. This keeps
    // signal keys in memory between writes, which is what fixes the "Bad MAC"
    // storm — when keys are re-read from disk on every decrypt, races between
    // creds.update writes and concurrent decrypts cause libsignal to see stale
    // session state and reject the MAC.
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, signalLogger),
    },
    logger: pino({ level: "silent" }),
    // Browser fingerprint MUST be one WhatsApp accepts for pairing codes.
    browser: usingPairingCode ? Browsers.ubuntu("Chrome") : Browsers.macOS("Desktop"),
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    retryRequestDelayMs: 250,    // tight retry — answer peer retry requests fast
    maxMsgRetryCount: 5,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    emitOwnEvents: false,        // don't fire events for our own sends (cuts feedback noise)
    fireInitQueries: true,
    transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },

    // ── REAL getMessage: answers peer retry requests with the actual content ──
    // This is THE fix for Bad MAC. When a peer's session falls out of sync they
    // ask "retry msg X" — Baileys calls this to re-encrypt and re-send. Empty
    // returns here are exactly why the session corruption was cascading.
    getMessage: async (key) => {
      const stored = messageStore.get(msgStoreKey(key.remoteJid, key.id));
      if (stored) return stored;
      return proto.Message.fromObject({}); // empty proto, not a fake conversation
    },

    // ── cachedGroupMetadata: stops Baileys re-querying group info on every msg ──
    cachedGroupMetadata: async (jid) => {
      const hit = groupMetadataCache.get(jid);
      if (hit && Date.now() - hit.ts < GROUP_META_TTL) return hit.metadata;
      return undefined; // tell Baileys to fetch fresh
    },

    // ── shouldIgnoreJid: drop newsletter junk only ──
    // We KEEP status@broadcast so .sreact (status auto-react) can see + react.
    shouldIgnoreJid: (jid) => jid?.endsWith("@newsletter"),
  });

  // Populate the group cache when Baileys does fetch metadata
  sock.ev.on("groups.update", (updates) => {
    for (const u of updates) {
      if (u.id) {
        const cur = groupMetadataCache.get(u.id);
        groupMetadataCache.set(u.id, { metadata: { ...(cur?.metadata || {}), ...u }, ts: Date.now() });
      }
    }
  });

  // ─── Pairing Code Request ─────────────────────────────────────────────────
  // Calling requestPairingCode immediately throws "Connection Closed" (socket
  // hasn't finished noise handshake). Calling after a setTimeout produces a
  // code WA hasn't registered ("Couldn't link device"). The correct moment is
  // when the socket emits its FIRST connection.update event (state becomes
  // "connecting"), which means the handshake is done but creds aren't yet.
  if (usingPairingCode && !sock.authState.creds.registered) {
    const phone = pendingPairPhone;
    pendingPairPhone = null;
    let pairRequested = false;
    const tryRequest = async (trigger) => {
      if (pairRequested) return;
      pairRequested = true;
      try {
        console.log(`[MFG_bot] Requesting pairing code for ${phone} (trigger=${trigger})...`);
        const code = await sock.requestPairingCode(phone);
        console.log(`[MFG_bot] Pairing code generated: ${code}`);
        if (pairCodeResolve) { pairCodeResolve({ success: true, code }); pairCodeResolve = null; }
      } catch (e) {
        console.error(`[MFG_bot] Pairing code error (trigger=${trigger}):`, e.message);
        if (pairCodeResolve) { pairCodeResolve({ success: false, error: e.message }); pairCodeResolve = null; }
      }
    };
    // Listen for the first non-null connection state — that's the cue
    const pairListener = ({ connection }) => {
      if (connection && !pairRequested) {
        sock.ev.off("connection.update", pairListener);
        tryRequest(connection);
      }
    };
    sock.ev.on("connection.update", pairListener);
    // Safety fallback: if no event fires within 8s, try anyway
    setTimeout(() => { if (!pairRequested) { sock.ev.off("connection.update", pairListener); tryRequest("timeout-fallback"); } }, 8000);
  } else if (usingPairingCode) {
    pendingPairPhone = null;
    console.log(`[MFG_bot] Skipping pair request — creds already registered`);
    if (pairCodeResolve) { pairCodeResolve({ success: false, error: "already registered — logout first" }); pairCodeResolve = null; }
  }

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) { currentQr = qr; hasQr = true; isConnected = false; console.log("[MFG_bot] QR Generated"); }
    if (connection === "open") {
      isConnected = true; hasQr = false; currentQr = null; reconnectCount = 0;
      hasEverConnected = true; consecutive401s = 0;
      console.log("[MFG_bot] Connected to WhatsApp");
      // Greet the operator (the connected number)
      setTimeout(async () => {
        try {
          const selfJid = sock.user.id;
          await sock.sendMessage(OWNER_JID, {
            text: `mfg_bot online ✅\n\nyou're linked. i'm ready.\n\nmodel: openai/gpt-oss-120b via groq\nai: ${settings.aiEnabled ? "on" : "off"}\n\nyou're my maker. i listen to you first.`
          });

          // ── Deployment license check ──────────────────────────────────────
          // If the connected number is NOT the creator, check for a valid license
          const connectedNum = (sock?.user?.id || "").split(":")[0].replace(/\D/g, "");
          const creatorNums = OWNER_NUMBERS.map(n => n.replace(/\D/g, ""));
          const isCreatorDeployment = creatorNums.some(n => connectedNum.endsWith(n) || n.endsWith(connectedNum));
          if (!isCreatorDeployment) {
            const license = readJSON("license.json", { licensed: false });
            if (!license.licensed) {
              await sock.sendMessage(selfJid, {
                text: `🔐 *mfg_bot — License Required*\n\n━━━━━━━━━━━━━━━━━━━━\nYou have connected your number to *mfg_bot*.\nTo activate and unlock all features, you need a license key.\n━━━━━━━━━━━━━━━━━━━━\n\nTo activate:\n1️⃣ Contact *+2349132883869* (teddymfg)\n2️⃣ Pay *₦3,000* — one-time payment\n3️⃣ You'll receive your personal license key\n4️⃣ Type *.activate <your_key>* here to unlock\n\n_Each license is for ONE WhatsApp number only._\n_Built by teddymfg 🔥_`
              });
            }
          }
        } catch (e) { console.log("[MFG_bot] Could not message owner:", e.message); }
      }, 3000);
    }
    if (connection === "close") {
      isConnected = false;
      const err = lastDisconnect?.error;
      const code = err?.output?.statusCode;
      const reason = err?.message || err?.toString() || "unknown";

      // Track consecutive 401s — if we keep getting them without ever reaching
      // "open", the saved creds are dead (half-paired or revoked by WA).
      // Wipe after 3 failures to break the loop and fall back to QR mode.
      if (code === 401 || code === DisconnectReason.loggedOut) consecutive401s++;
      else consecutive401s = 0;
      const credsAreDead = consecutive401s >= 3;

      // Baileys sends 401/loggedOut as part of the pair-success handshake (once).
      // Don't wipe on the FIRST such event if never connected — but DO wipe after
      // repeated failures even if never connected (= broken/half-paired creds).
      const isPostPairRestart = !hasEverConnected && !credsAreDead;
      const isRealLogout = (code === DisconnectReason.loggedOut && hasEverConnected) || credsAreDead;
      const shouldReconnect = (code !== DisconnectReason.loggedOut || isPostPairRestart || credsAreDead);
      console.log(`[MFG_bot] Disconnected. Code: ${code}. Reason: ${reason}. Reconnect: ${shouldReconnect}. PostPairRestart: ${isPostPairRestart}`);

      if (isRealLogout) {
        const wipePath = process.env.AUTH_PATH || path.join(__dirname, "auth_info_baileys");
        try { fs.rmSync(wipePath, { recursive: true, force: true }); console.log(`[MFG_bot] Real logout (credsAreDead=${credsAreDead}) — wiped ${wipePath}`); }
        catch (e) { console.log(`[MFG_bot] auth wipe warn: ${e.message}`); }
        consecutive401s = 0; reconnectCount = 0; pendingPairPhone = null;
      }
      if (shouldReconnect) {
        reconnectCount++;
        // 515 = "restart required" (normal post-pair) → reconnect FAST
        // post-pair-restart (any code, no prior open) → reconnect FAST so creds get used
        // otherwise standard backoff
        const fastReconnect = code === 515 || isPostPairRestart;
        const delay = fastReconnect ? 1500 : Math.min(reconnectCount * 8000, 60000);
        console.log(`[MFG_bot] Reconnecting in ${delay}ms (attempt ${reconnectCount}, fast=${fastReconnect})...`);
        setTimeout(connectToWhatsApp, delay);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("chats.set", ({ chats }) => { allChats = chats || []; console.log(`[MFG_bot] chats.set → ${allChats.length} chats`); });
  sock.ev.on("chats.upsert", (newChats) => {
    for (const c of newChats) {
      const idx = allChats.findIndex(x => x.id === c.id);
      if (idx >= 0) allChats[idx] = c; else allChats.push(c);
    }
  });
  // Auto-track chats from every message — Baileys 6.x rarely fires chats.set
  function trackChat(jid) {
    if (!jid || jid.includes("broadcast")) return;
    if (!allChats.find(c => c.id === jid)) allChats.push({ id: jid, conversationTimestamp: Math.floor(Date.now()/1000) });
  }

  // ─── Message Handler ──────────────────────────────────────────────────────
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      // ── STATUS AUTO-REACT: if .sreact is on and a contact posted a status,
      //    fire the configured emoji reaction at it. Runs BEFORE other gates
      //    because status posts are stub-y and would otherwise be filtered.
      if (
        settings.statusReactEmoji &&
        messages[0]?.key?.remoteJid === "status@broadcast" &&
        msg.key?.remoteJid === "status@broadcast" &&
        !msg.key.fromMe &&
        msg.message
      ) {
        try {
          await sock.sendMessage("status@broadcast", {
            react: { text: settings.statusReactEmoji, key: msg.key }
          }, { statusJidList: [msg.key.participant].filter(Boolean) });
          console.log(`[MFG_bot] status auto-react ${settings.statusReactEmoji} → ${(msg.key.participant||'?').slice(-15)}`);
        } catch (e) {
          console.log(`[MFG_bot] status react fail: ${e.message}`);
        }
        continue; // don't run other handlers on status posts
      }

      // ── BAD-MAC RECOVERY: detect undecryptable messages and wipe that
      //    peer's signal session so it auto-renegotiates on next message.
      //    Baileys surfaces decryption failures as CIPHERTEXT stub upserts.
      if (msg.messageStubType === WAMessageStubType.CIPHERTEXT) {
        const peer = msg.key.participant || msg.key.remoteJid;
        const n = (badMacCount.get(peer) || 0) + 1;
        badMacCount.set(peer, n);
        console.log(`[MFG_bot] CIPHERTEXT/Bad-MAC #${n} from ${(peer||'?').slice(-20)}`);
        if (n >= BAD_MAC_THRESHOLD) wipePeerSession(peer);
        continue;
      }
      if (!msg.message) continue;

      // ── Remember every message we see (incoming AND outgoing) so getMessage
      //    can answer retry requests from peers with the real content. This is
      //    what permanently breaks the Bad MAC → reconnect → resend cycle.
      if (msg.key.id && msg.key.remoteJid) {
        rememberMessage(msg.key.remoteJid, msg.key.id, msg.message);
      }

      // ── MESSAGE-AGE GUARD: stop side effects on re-delivered backlog ──
      // We still let the message flow through (so it gets stored for context),
      // but we mark it as "too old to act on". This is what stops the .sreact
      // / .online / .vv replay storm after a Railway restart re-delivers a
      // backlog of unacked messages from hours ago.
      const ageMs = msgAgeMs(msg);
      const isStale = ageMs > MAX_ACTIONABLE_MSG_AGE_MS;
      if (isStale) {
        console.log(`[MFG_bot] stale msg (${Math.round(ageMs/1000)}s old) from ${(msg.key.remoteJid||'?').slice(-15)} — no action, context only`);
      }

      const isFromMe = msg.key.fromMe;
      messageCount++;
      const from = msg.key.remoteJid;
      trackChat(from);
      // In groups, the actual sender is in msg.key.participant (or participantPn for @lid format)
      // We track it for accurate owner detection regardless of @s.whatsapp.net vs @lid JIDs
      const participantJid = msg.key.participant || msg.key.participantPn || from;
      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption || ""
      ).trim();
      // Debug log — keep last 30 messages with metadata for diagnostics
      recentMsgLog.unshift({
        t: new Date().toISOString().slice(11,19),
        from: from?.slice(-20),
        fromMe: isFromMe,
        kind: Object.keys(msg.message).filter(k => k !== "messageContextInfo")[0] || "?",
        text: text ? text.slice(0, 60) : "(no text)",
        result: "pending"
      });
      if (recentMsgLog.length > 30) recentMsgLog.length = 30;
      const logTag = (r) => { if (recentMsgLog[0]) recentMsgLog[0].result = r; };
      const pfx = settings.prefix || ".";

      const send = async (t) => {
        const m = await sock.sendMessage(from, { text: t });
        if (m?.key) {
          lastBotMsgByChat.set(from, m.key);
          // Store the message we just sent so getMessage can answer if the
          // peer asks for a retry (since emitOwnEvents:false means we won't
          // see this through messages.upsert).
          if (m.key.id) rememberMessage(from, m.key.id, m.message || { conversation: t });
        }
        return m;
      };
      // Owner detection — works in DMs AND groups regardless of @s.whatsapp.net vs @lid JID format
      // 1) fromMe — owner's linked device (most reliable in DMs)
      // 2) isOwner(from) — DM from owner's number
      // 3) isOwner(participantJid) — group message where owner is the actual sender
      // 4) sock.user.id matches participant — handles @lid case where participant is bot's own lid
      const myLid = sock?.user?.lid?.split(":")[0]?.split("@")[0];
      const myId  = sock?.user?.id?.split(":")[0]?.split("@")[0];
      const partDigits = (participantJid || "").replace(/[^0-9]/g, "");
      const senderIsOwner = isFromMe
        || isOwner(from)
        || isOwner(participantJid)
        || (myLid && participantJid?.startsWith(myLid))
        || (myId  && partDigits === myId);

      // --- DEPLOYMENT LICENSE (owner-only .activate command) ---
      // This only applies to the bot OPERATOR, not to contacts texting the bot.
      // Regular contacts text freely — no token gate.
      if (senderIsOwner) {
        const uTxt = (text || "").trim();
        if (uTxt.toLowerCase().startsWith(".activate ")) {
          const key = uTxt.slice(10).trim();
          const license = readJSON("license.json", { licensed: false });
          if (license.licensed) { await send("✅ Bot is already activated."); continue; }
          if (tokenData.validTokens.includes(key)) {
            const connNum = sock?.user?.id?.split(":")[0] || "unknown";
            if (tokenData.usedTokens[key] && tokenData.usedTokens[key] !== connNum) {
              await send("❌ That license key is already used on another number. Contact *+2349132883869* for a new one."); continue;
            }
            tokenData.usedTokens[key] = connNum;
            writeJSON("tokenData.json", tokenData);
            writeJSON("license.json", { licensed: true, key, activatedFor: connNum, date: new Date().toISOString() });
            await send("✅ *Bot Activated!* 🎉\n\nYour bot is now fully licensed and running.\nAll features unlocked.\n\n_Made by teddymfg • +2349132883869_"); continue;
          } else { await send("❌ Invalid license key. Contact *+2349132883869* to purchase one."); continue; }
        }
      }
      // --- END DEPLOYMENT LICENSE ---

      // Debug: log every group command so we can see why it might fail
      if (text?.startsWith(pfx) && from?.endsWith("@g.us")) {
        console.log(`[MFG_bot] GROUP CMD "${text.slice(0,30)}" from=${from.slice(-20)} participant=${participantJid?.slice(-25)} fromMe=${isFromMe} senderIsOwner=${senderIsOwner} myLid=${myLid} myId=${myId}`);
      }

      // ── AUTO-TAKEOVER: when owner texts in a chat, pause AI there for X min ──
      // This makes the bot listen even when owner is online — owner stays in control
      if (isFromMe && !text.startsWith(pfx) && from !== "status@broadcast" && settings.autoTakeover) {
        ownerTakeover.set(from, Date.now());
        console.log(`[MFG_bot] Owner took over chat ${from.slice(-15)} — AI paused ${settings.takeoverMinutes}m`);
      }

      // ── AUTO-REACT: react to incoming messages with configured emoji ─────────
      if (!isFromMe && settings.autoReactEmoji && from !== "status@broadcast" && msg?.key) {
        try {
          await sock.sendMessage(from, { react: { text: settings.autoReactEmoji, key: msg.key } });
        } catch (e) { /* silent — react failure is non-critical */ }
      }

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

      // ── Detect message type — reply to EVERYTHING ─────────────────────
      const isSticker = !!msg.message?.stickerMessage;
      const isImage   = !!msg.message?.imageMessage;
      const isVideo   = !!msg.message?.videoMessage;
      const isAudio   = !!msg.message?.audioMessage || !!msg.message?.pttMessage;
      const isDoc     = !!msg.message?.documentMessage;
      const isContact = !!msg.message?.contactMessage;

      // ── Voice note → Whisper transcription (so AI knows what was actually said) ──
      let transcribedText = "";
      if (isAudio && settings.transcribeVoice && !isFromMe) {
        try {
          const audMsg = msg.message?.audioMessage || msg.message?.pttMessage;
          const audMime = audMsg?.mimetype || "audio/ogg";
          console.log(`[MFG_bot] Voice received from ${from.slice(-15)}, mime=${audMime}, downloading...`);
          const buf = await downloadMediaMessage(msg, "buffer", {});
          console.log(`[MFG_bot] Voice downloaded (${buf?.length||0} bytes), calling Whisper...`);
          transcribedText = await transcribeAudio(buf, audMime) || "";
          if (transcribedText) console.log(`[MFG_bot] ✅ Transcribed: "${transcribedText.slice(0,120)}"`);
          else console.log(`[MFG_bot] ❌ Whisper failed: ${lastWhisperResult.error}`);
        } catch (e) {
          lastWhisperResult = { at: new Date().toISOString(), ok: false, bytes: 0, text: "", error: "download_err: " + e.message };
          console.log("[MFG_bot] Voice download err:", e.message);
        }
      }

      // ── Image → Vision description (so AI can actually "see" images) ──
      let visionDescription = "";
      if (isImage && settings.visionEnabled && !isFromMe) {
        try {
          const imgMsg = msg.message?.imageMessage;
          const imgMime = imgMsg?.mimetype || "image/jpeg";
          console.log(`[MFG_bot] Image received from ${from.slice(-15)}, mime=${imgMime}, downloading...`);
          const buf = await downloadMediaMessage(msg, "buffer", {});
          console.log(`[MFG_bot] Image downloaded (${buf?.length||0} bytes), calling vision...`);
          visionDescription = await describeImage(buf, text, imgMime) || "";
          if (visionDescription) console.log(`[MFG_bot] ✅ Vision: "${visionDescription.slice(0,120)}"`);
          else console.log(`[MFG_bot] ❌ Vision failed: ${lastVisionResult.error}`);
        } catch (e) {
          lastVisionResult = { at: new Date().toISOString(), ok: false, bytes: 0, text: "", error: "download_err: " + e.message };
          console.log("[MFG_bot] Image download err:", e.message);
        }
      }

      // effectiveText is what we pass to AI — real text or a type description
      const effectiveText = text || transcribedText || (
        visionDescription ? `[image: ${visionDescription}]` :
        isSticker ? "[sent a sticker]" :
        isImage   ? "[sent an image]"  :
        isVideo   ? "[sent a video]"   :
        isAudio   ? "[sent a voice note]" :
        isDoc     ? "[sent a document]"   :
        isContact ? "[sent a contact card]" :
        "[sent a message]"
      );

      // Anti-scam check on incoming messages — alert owner if something fishy
      if (!isFromMe && (text || transcribedText) && isScamLikely(text || transcribedText)) {
        const alert = { jid: from, text: (text || transcribedText).slice(0, 200), at: Date.now() };
        scamAlerts.unshift(alert);
        if (scamAlerts.length > 50) scamAlerts.length = 50;
        writeJSON("scam_alerts.json", scamAlerts);
        try { await sock.sendMessage(OWNER_JID, { text: `⚠️ SCAM/MANIPULATION ALERT\nFrom: ${from}\n"${alert.text}"\n\nAI will play dumb. Reply manually if you want to handle.` }); } catch {}
        console.log(`[MFG_bot] Scam pattern detected from ${from.slice(-15)}`);
      }

      // ── Owner greeting when they message the bot ──────────────────────
      if (senderIsOwner && !userData[from]?.greeted) {
        if (!userData[from]) userData[from] = {};
        userData[from].greeted = true;
        writeJSON("users.json", userData);
        await send(`sup maker 👋 i'm your bot. all commands unlocked. type .menu to see what i can do.`);
      }

      const lowerText = text.toLowerCase();

      // ── Urgent call override ───────────────────────────────────────────
      const urgentTriggers = ["it's urgent","its urgent","it is urgent","urgent","emergency","it's an emergency","its an emergency","please it's urgent","abeg it's urgent","e dey urgent","na emergency"];
      if (!isFromMe && callWarned.has(from) && text && urgentTriggers.some(kw => lowerText.includes(kw))) {
        callWarned.delete(from);
        await send(`✅ call permission granted. you can call now — it'll go through.`);
        console.log(`[MFG_bot] Urgent call granted for ${from}`);
        continue;
      }

      // ── Who-made-you detection (non-commands, natural language) ───────
      const creatorTriggers = ["who made you", "who created you", "who built you", "who is your creator", "who is your maker", "who owns you", "who is your owner", "wey make you", "who program you"];
      if (text && !text.startsWith(pfx) && creatorTriggers.some(t => lowerText.includes(t))) {
        await send(`i was built by my maker — +${OWNER_NUMBER}. he's the only one i fully listen to.`);
        continue;
      }

      // ── Billing dodge (when someone tries to collect money) ──────────
      const billingTriggers = ["send me money","send money","where is my money","where's my money","you owe me","my money","pay me","when you go pay","when will you pay","when are you paying","you haven't paid","you still owe","abeg pay","oga pay","return my money","give me my money","give me money","come give me","come and give me","drop money","drop the money","i need money","loan me","borrow me","you dey owe","your debt","the money you owe","refund","pay back","owe me","send something","drop something","send cash","transfer","send alert","alert me","credit me"];
      if (text && !text.startsWith(pfx) && !isFromMe && billingTriggers.some(kw => lowerText.includes(kw))) {
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
      if (text && !text.startsWith(pfx) && sendTriggers.some(kw => lowerText.includes(kw))) {
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

      // ── Pending .download follow-up — user said .download, now sending the song ──
      if (!isFromMe && text && !text.startsWith(pfx) && pendingDownload.has(from)) {
        const startedAt = pendingDownload.get(from);
        if (Date.now() - startedAt < 60000) {
          pendingDownload.delete(from);
          const isSCUrl = /https?:\/\/(www\.)?soundcloud\.com/i.test(text);
          const isAnyUrl = /https?:\/\//i.test(text);
          await send(isAnyUrl ? "⏬ got the link, downloading..." : `🔍 searching for *"${text}"*...`);
          const audio = await downloadMusic(isAnyUrl ? text.match(/https?:\S+/)[0] : text);
          if (!audio?.buffer) { await send("❌ download failed. try again with .song <name>"); continue; }
          try {
            await sock.sendMessage(from, { audio: audio.buffer, mimetype: "audio/mp4", fileName: `${sanitizeFileName(audio.title || text)}.mp3` });
            const previewNote = audio.isPreview ? " _(30s preview)_" : "";
            await send(`✅ *${audio.title || text}* — enjoy 🎧${previewNote}`);
          } catch (e) { await send("❌ send failed: " + e.message); }
          continue;
        } else { pendingDownload.delete(from); }
      }

      // ── Commands ────────────────────────────────────────────────────────
      if (text.startsWith(pfx)) {
        // Stale command guard: never re-execute a command from a re-delivered
        // backlog. This is the fix for the .sreact / .online replay storm.
        if (isStale) { logTag(`skip:stale_cmd_${Math.round(ageMs/1000)}s`); continue; }
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
            if (!buffer || buffer.length < 100) { await send("media buffer empty — view-once may have already been opened."); continue; }
            console.log(`[MFG_bot] .vv revealed: ${imgMsg?"image":"video"}, ${buffer.length} bytes`);
            if (imgMsg) {
              await sock.sendMessage(from, {
                image: buffer,
                caption: "👁 view-once revealed",
                mimetype: imgMsg.mimetype || "image/jpeg"
              });
            } else if (vidMsg) {
              // Video view-once: explicit mimetype + try video first, fall back to document if it fails
              const mt = vidMsg.mimetype || "video/mp4";
              try {
                await sock.sendMessage(from, {
                  video: buffer,
                  caption: "👁 view-once video revealed",
                  mimetype: mt,
                  gifPlayback: false
                });
              } catch (vidErr) {
                console.log(`[MFG_bot] .vv video send failed (${vidErr.message}), falling back to document`);
                await sock.sendMessage(from, {
                  document: buffer,
                  mimetype: mt,
                  fileName: "view-once-video.mp4",
                  caption: "👁 view-once video (sent as file because direct video send failed)"
                });
              }
            }
          } catch (e) {
            console.log(`[MFG_bot] .vv error: ${e.message}`);
            await send("couldn't restore that media: " + e.message);
          }
          continue;
        }

        // .site
        if (cmd === "site") {
          await send("check the portfolio: https://ash-cloth.ink");
          continue;
        }

        // .call on | off | status
        if (cmd === "call") {
          const sub = args[0]?.toLowerCase();
          if (sub === "on") { settings.callBlock = true; writeJSON("settings.json", settings); await send("call block on 🔴📵 — all calls rejected + warned"); }
          else if (sub === "off") { settings.callBlock = false; writeJSON("settings.json", settings); await send("call block off 🟢📞 — calls go through normally"); }
          else await send(`call block: ${settings.callBlock ? "on 🔴" : "off 🟢"}\n.call on — block + warn callers\n.call off — allow calls normally\n\nwhen blocked: caller gets warned and told to text. if they say "it's urgent" → call unblocked for them.`);
          continue;
        }

        // .online — i cover for you when your data is off
        if (cmd === "online") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          settings.onlineMode = true;
          settings.proactiveText = true;
          writeJSON("settings.json", settings);
          await send(`🟢 ONLINE MODE ACTIVE\n• your WhatsApp will show as online even if your data is off\n• i'll be randomly texting your contacts (10s check, 30 min cooldown each)\n• AI replies as you to all incoming messages\n• run .offline to stop\n\nyou can switch off your phone now — i got you 💪`);
          try { await sock.sendPresenceUpdate("available"); } catch {}
          continue;
        }
        if (cmd === "offline") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          settings.onlineMode = false;
          settings.proactiveText = false;
          writeJSON("settings.json", settings);
          await send(`🔴 OFFLINE MODE — stopped covering for you.\nyour WhatsApp will show your real status.\nproactive texting stopped.`);
          try { await sock.sendPresenceUpdate("unavailable"); } catch {}
          continue;
        }
        // legacy alias
        if (cmd === "proactive") {
          await send("`.proactive` was replaced — use `.online` (i cover for you) or `.offline` (stop)");
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
        if (cmd === "count") { const t = args.join(" "); await send(`chars: ${t.length}\nwords: ${t.split(/\s+/).filter(Boolean).length}\nlines: ${t.split("\n").length}` || ".count <text>"); continue; }
        if (cmd === "repeat") {
          const n = Math.min(parseInt(args[0])||2,10); const t = args.slice(1).join(" ");
          await send(t ? Array(n).fill(t).join("\n") : ".repeat <times> <text>"); continue;
        }
        if (cmd === "wordcount") { await send(`${args.join(" ").split(/\s+/).filter(Boolean).length} words`); continue; }
        if (cmd === "charcount") { await send(`${args.join(" ").length} characters`); continue; }
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
        if (cmd === "round") { const n=parseFloat(args[0]); await send(!isNaN(n)?`${n} rounded = ${Math.round(n)}`:".round <number>"); continue; }
        if (cmd === "password") {
          const len=Math.min(parseInt(args[0])||12,32);
          const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
          let pwd="";for(let i=0;i<len;i++)pwd+=chars[Math.floor(Math.random()*chars.length)];
          await send(`🔑 ${pwd}`); continue;
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

        // ══════════════════════════════════════════════════════════════════
        // ██  ONE-OF-ONE SIGNATURE COMMANDS — powered by Groq AI  ████████
        // ══════════════════════════════════════════════════════════════════

        // .persona <name|off> — AI becomes ANY celebrity / character for this chat
        if (cmd === "persona") {
          const name = args.join(" ").trim();
          if (!name) { await send(`🎭 *PERSONA MODE*\n\nType *.persona <name>* and I'll become that person for this conversation.\n\nExamples:\n.persona Burna Boy\n.persona Davido\n.persona Obi Cubana\n.persona Elon Musk\n.persona Wizkid\n\nType *.persona off* to go back to normal.`); continue; }
          if (name.toLowerCase() === "off") {
            activePersona.delete(from);
            await send("🎭 Persona mode off. i'm back to myself."); continue;
          }
          activePersona.set(from, name);
          await send(`🎭 *Persona activated: ${name}*\n\nI'm now responding AS ${name}. Every reply I give will be in their voice, style, energy — the way they actually talk.\n\nType *.persona off* to bring me back.`);
          continue;
        }

        // .lyrics <vibe or title> — AI writes an original Afrobeats / Naija song
        if (cmd === "lyrics" || cmd === "song lyrics") {
          const vibe = args.join(" ").trim();
          if (!vibe) { await send("🎵 *.lyrics <vibe or title>*\n\nExamples:\n.lyrics heartbreak Afrobeats\n.lyrics Asake style about money\n.lyrics love song for Lagos girl"); continue; }
          await send("🎵 writing lyrics...");
          const prompt = `Write an original, fire Afrobeats/Nigerian pop song based on this vibe or title: "${vibe}". Include: Song Title, Verse 1, Chorus, Verse 2, Bridge. Use Nigerian slang, pidgin naturally. Make it sound like it could be a real hit. Keep it authentic and creative.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ couldn't write that one. try again."); continue;
        }

        // .freestyle <topic> — AI spits bars in Nigerian/Afrobeats rap style
        if (cmd === "freestyle" || cmd === "bars") {
          const topic = args.join(" ").trim() || "life and hustle";
          await send("🎤 cooking bars...");
          const prompt = `Spit a fire freestyle rap/bars about: "${topic}". Nigerian/Afrobeats style — mix English and pidgin naturally. 8-16 bars. Make it rhythmic, with wordplay, punches, and real Nigerian energy. No intro text, just drop the bars.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ bars came out wrong. try again."); continue;
        }

        // .shade <person or situation> — AI crafts the perfect subtle shade
        if (cmd === "shade") {
          const target = args.join(" ").trim();
          if (!target) { await send("😏 *.shade <person or situation>*\n\nExamples:\n.shade my ex\n.shade people who talk too much\n.shade fake friends"); continue; }
          await send("😏 crafting shade...");
          const prompt = `Write the most perfectly crafted, subtle shade about: "${target}". Nigerian style — indirect, smart, could be a WhatsApp status or caption. It should cut deep but sound innocent. Use "I'm not saying anything but..." energy. Short, punchy, devastating.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ couldn't craft that shade."); continue;
        }

        // .capcheck <claim> — AI delivers a Cap or Facts verdict
        if (cmd === "capcheck" || cmd === "cap" || cmd === "facts") {
          const claim = args.join(" ").trim();
          if (!claim) { await send("🧢 *.capcheck <claim>*\n\nExamples:\n.capcheck Arsenal is the best team\n.capcheck Burna Boy is the greatest\n.capcheck Money can't buy happiness"); continue; }
          await send("🔍 analyzing...");
          const prompt = `Analyze this claim and give a Cap or Facts verdict: "${claim}". Be opinionated, funny, and decisive. State clearly if it's CAP 🧢 or FACTS ✅, then explain why in Nigerian English/pidgin. Keep it entertaining and short.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ couldn't check that."); continue;
        }

        // .naija <topic> — explains ANYTHING in pure Nigerian pidgin/slang
        if (cmd === "naija" || cmd === "pidgin" || cmd === "explain") {
          const topic = args.join(" ").trim();
          if (!topic) { await send("🇳🇬 *.naija <topic>*\n\nI'll explain ANYTHING in pure Nigerian pidgin.\n\nExamples:\n.naija quantum physics\n.naija how the stock market works\n.naija why women are complicated"); continue; }
          await send("🇳🇬 lemme break am down...");
          const prompt = `Explain this topic in pure Nigerian pidgin/slang: "${topic}". Make it funny, relatable, and understandable to any Nigerian. Use real pidgin expressions, naija humor, local analogies. Keep it authentic — like you're explaining to your boys at a pepper soup joint.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ couldn't break that down."); continue;
        }

        // .testimony <topic> — generates a hilarious Nigerian church testimony
        if (cmd === "testimony") {
          const topic = args.join(" ").trim() || "random miracle";
          await send("🙌 *receiving testimony...*");
          const prompt = `Write a hilarious Nigerian Pentecostal church testimony about: "${topic}". Include: dramatic background story, the problem, how they prayed, the miracle that happened, and the praise at the end. Use Nigerian church language, pidgin, dramatic flair. Make it funny but believable. The congregation should be shaking.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ testimony no come. try again."); continue;
        }

        // .settle <topic> — AI settles any debate ONCE AND FOR ALL
        if (cmd === "settle") {
          const topic = args.join(" ").trim();
          if (!topic) { await send("⚖️ *.settle <debate topic>*\n\nExamples:\n.settle Wizkid vs Davido\n.settle Lagos vs Abuja\n.settle Jollof: Nigeria vs Ghana"); continue; }
          await send("⚖️ *settling this once and for all...*");
          const prompt = `Settle this debate ONCE AND FOR ALL: "${topic}". Give a FINAL, definitive ruling. Be bold, entertaining, use Nigerian references. No sitting on the fence — pick a winner/side and defend it passionately. End with "CASE CLOSED. 🔨" energy.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ couldn't settle that one."); continue;
        }

        // .manifest <dream> — writes a powerful manifestation/affirmation
        if (cmd === "manifest" || cmd === "manifestation") {
          const dream = args.join(" ").trim();
          if (!dream) { await send("✨ *.manifest <your dream>*\n\nExamples:\n.manifest becoming a billionaire\n.manifest getting my dream job\n.manifest buying my first car"); continue; }
          await send("✨ *manifesting...*");
          const prompt = `Write a powerful, deeply personal manifestation/affirmation for this dream: "${dream}". Nigerian context — reference God, hustle, faith. Mix English and pidgin naturally. Should feel spiritual, motivating, and real. Like a prayer meets affirmation. 5-8 powerful lines.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ manifestation failed. try again."); continue;
        }

        // .expose <claim> — AI "exposes" anything with receipts
        if (cmd === "expose") {
          const claim = args.join(" ").trim();
          if (!claim) { await send("🕵️ *.expose <person or claim>*\n\nExamples:\n.expose why people ghost others\n.expose the real reason Lagos traffic is bad\n.expose fake friends"); continue; }
          await send("🕵️ *pulling receipts...*");
          const prompt = `EXPOSE the truth about: "${claim}". Write it like a viral thread — dramatic, revealing, with "facts don't care about your feelings" energy. Nigerian style, mix of English and pidgin. Make points 1 by 1. End with a hard-hitting conclusion.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ couldn't pull those receipts."); continue;
        }

        // .punchline <topic> — AI generates a savage one-liner
        if (cmd === "punchline" || cmd === "oneliner") {
          const topic = args.join(" ").trim() || "life";
          await send("💥 cooking...");
          const prompt = `Write ONE savage, perfectly crafted punchline/one-liner about: "${topic}". Nigerian humor preferred. Short, sharp, devastating. Should make someone scream or send it to 10 people. No intro, just the line.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ punchline flopped. try again."); continue;
        }

        // .caption <context> — generates fire social media captions
        if (cmd === "caption" || cmd === "captions") {
          const context = args.join(" ").trim();
          if (!context) { await send("📸 *.caption <context>*\n\nExamples:\n.caption beach photo with friends\n.caption just got a new job\n.caption Friday night out in Lagos"); continue; }
          await send("📸 *crafting fire captions...*");
          const prompt = `Generate 3 fire, ready-to-post captions for: "${context}". Mix styles: 1 savage/witty, 1 deep/inspirational, 1 funny/Nigerian. Include relevant emojis. These should be the kind people screenshot and save.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ captions flopped. try again."); continue;
        }

        // .prayer <situation> — Nigerian-style prayer for any situation
        if (cmd === "prayer" || cmd === "pray") {
          const situation = args.join(" ").trim() || "general blessing";
          await send("🙏 *interceding...*");
          const prompt = `Write a Nigerian Pentecostal-style prayer for: "${situation}". Use powerful prayer language, mix English and pidgin, call on the Holy Ghost, bind and cast, declare and decree. Make it dramatic and full of Nigerian church energy. It should feel powerful AND be hilarious. End with a strong AMEN.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ prayer not through. try again."); continue;
        }

        // .argue <position on topic> — AI passionately argues any side
        if (cmd === "argue") {
          const position = args.join(" ").trim();
          if (!position) { await send("🗣 *.argue <position on topic>*\n\nExamples:\n.argue that Afrobeats is the best genre\n.argue that Nigeria will be great\n.argue that pineapple belongs on pizza"); continue; }
          await send("🗣 *building the case...*");
          const prompt = `Argue this position PASSIONATELY and convincingly: "${position}". Don't hold back — be a lawyer, a preacher, and a Nigerian uncle all in one. Make the strongest possible case. Use facts, emotion, Nigerian proverbs, and analogies. Win the argument.`;
          const reply = await askGroq(prompt, from);
          await send(reply || "❌ argument collapsed. try again."); continue;
        }

        // .react <emoji|off> — set auto-react emoji for all incoming messages
        if (cmd === "react") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const emoji = args.join(" ").trim();
          if (!emoji || emoji.toLowerCase() === "off") {
            settings.autoReactEmoji = null;
            writeJSON("settings.json", settings);
            await send("✅ auto-react turned OFF — no more emoji reactions.");
          } else {
            settings.autoReactEmoji = emoji;
            writeJSON("settings.json", settings);
            await send(`✅ auto-react set to *${emoji}* — I'll react to every incoming message with this emoji.`);
          }
          continue;
        }

        // .pay — Flutterwave GHOST BANK virtual account
        if (cmd === "pay" || cmd === "bank" || cmd === "ghostbank") {
          const sub = args[0]?.toLowerCase();
          const senderPhone = (participantJid || from).split("@")[0].replace(/[^0-9]/g, "");
          const senderName = msg?.pushName || msg?.verifiedBizName || `User_${senderPhone.slice(-4)}`;
          const jidKey = (participantJid || from);

          if (sub === "balance") {
            const acct = ghostBankData[jidKey];
            if (!acct) { await send("You don't have a GHOST BANK account yet. Type *.pay* to create one."); continue; }
            await send(`🏦 *GHOST BANK MFG*\n\n👤 Name: ${acct.acctName}\n🏛 Bank: ${acct.bankName || "Sterling Bank"}\n💳 Account: ${acct.accountNumber}\n💰 Balance: ₦${(acct.balance || 0).toLocaleString()}\n\n_Type .pay history for transactions_`);
            continue;
          }

          if (sub === "history") {
            const acct = ghostBankData[jidKey];
            if (!acct) { await send("No account found. Type *.pay* to create one."); continue; }
            const txs = acct.transactions || [];
            if (!txs.length) { await send("No transactions yet. Share your account number to receive funds."); continue; }
            const lines = txs.slice(-10).map(t => `${t.type === "credit" ? "➕" : "➖"} ₦${t.amount.toLocaleString()} — ${t.note || "transfer"} (${t.date})`).join("\n");
            await send(`📋 *GHOST BANK — Transaction History*\n\n${lines}\n\n💰 Balance: ₦${(acct.balance || 0).toLocaleString()}`);
            continue;
          }

          if (sub === "withdraw") {
            const acct = ghostBankData[jidKey];
            if (!acct) { await send("No account found. Type *.pay* to create one."); continue; }
            await send(`💸 *Withdrawal Request*\n\n💰 Your Balance: ₦${(acct.balance || 0).toLocaleString()}\n\nTo withdraw your funds, contact the admin:\n📲 *+2349132883869* (teddymfg)\n\n_Admin processes withdrawals within 24 hours._\n_GHOST BANK MFG — Built by teddymfg_`);
            continue;
          }

          // Default: create / show account
          if (ghostBankData[jidKey]?.accountNumber) {
            const acct = ghostBankData[jidKey];
            await send(`🏦 *GHOST BANK MFG*\n━━━━━━━━━━━━━━━━━━━━\n\n👤 *Account Name:* ${acct.acctName}\n🏛 *Bank:* ${acct.bankName || "Sterling Bank"}\n💳 *Account Number:* ${acct.accountNumber}\n💰 *Balance:* ₦${(acct.balance || 0).toLocaleString()}\n\n━━━━━━━━━━━━━━━━━━━━\n📲 Share this account to receive payments.\n\n*.pay balance* — check balance\n*.pay history* — view transactions\n*.pay withdraw* — request withdrawal\n\n_Powered by GHOST BANK MFG 🔥_`);
            continue;
          }

          // Create new Flutterwave virtual account
          await send("🏦 *Creating your GHOST BANK account...*");
          try {
            const txRef = `GHOST_${senderPhone}_${Date.now()}`;
            // Generate a random valid-looking BVN and NIN for accounts that don't have one
            const fakeBvn = `2${String(Math.floor(Math.random() * 9000000000) + 1000000000)}`;
            const fakeNin = `${String(Math.floor(Math.random() * 90000000) + 10000000)}`;

            // Attempt 1: no BVN/NIN (some Flutterwave accounts support this)
            const basePayload = {
              email: `wa_${senderPhone}@ghostbank.mfg`,
              is_permanent: true,
              tx_ref: txRef,
              narration: senderName,
              currency: "NGN",
              amount: 100
            };

            let flwData = null;
            let attempt = 0;
            const payloads = [
              basePayload,
              { ...basePayload, bvn: fakeBvn },
              { ...basePayload, bvn: fakeBvn, nin: fakeNin }
            ];

            for (const payload of payloads) {
              attempt++;
              try {
                console.log(`[MFG_bot] Flutterwave attempt ${attempt}...`);
                const flwRes = await fetch("https://api.flutterwave.com/v3/virtual-account-numbers", {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${FLW_SECRET}`, "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
                  signal: AbortSignal.timeout(15000)
                });
                flwData = await flwRes.json().catch(() => null);
                console.log(`[MFG_bot] Flutterwave attempt ${attempt} response:`, JSON.stringify(flwData)?.slice(0, 200));
                if (flwData?.status === "success" && flwData?.data?.account_number) break;
                flwData = null;
              } catch (e) { console.log(`[MFG_bot] FLW attempt ${attempt} err:`, e.message); }
            }

            if (flwData?.status === "success" && flwData?.data?.account_number) {
              const d = flwData.data;
              ghostBankData[jidKey] = {
                accountNumber: d.account_number,
                bankName: d.bank_name || "Sterling Bank",
                acctName: d.account_name || senderName,
                txRef,
                balance: 0,
                transactions: [],
                createdAt: new Date().toISOString()
              };
              writeJSON("ghostBank.json", ghostBankData);
              await send(`✅ *GHOST BANK MFG — Account Created!* 🎉\n\n━━━━━━━━━━━━━━━━━━━━\n👤 *Name:* ${ghostBankData[jidKey].acctName}\n🏛 *Bank:* ${ghostBankData[jidKey].bankName}\n💳 *Account Number:* ${ghostBankData[jidKey].accountNumber}\n💰 *Balance:* ₦0.00\n━━━━━━━━━━━━━━━━━━━━\n\n📲 Share this number to receive payments!\nFunds reflect automatically when paid.\n\n*.pay balance* — check balance\n*.pay withdraw* — withdraw funds (contact admin)\n\n_GHOST BANK MFG — Powered by teddymfg 🔥_`);
            } else {
              const errMsg = flwData?.message || "API unavailable";
              await send(`❌ Could not create account: ${errMsg}\n\nThis usually means your Flutterwave account needs BVN/NIN verification enabled.\nContact *+2349132883869* for manual setup.`);
            }
          } catch (e) {
            console.log("[MFG_bot] Flutterwave error:", e.message);
            await send("❌ Bank service temporarily down. Try again in a moment or contact *+2349132883869*.");
          }
          continue;
        }

        // .bcast <message> — auto-broadcast to ALL contacts (owner only)
        if (cmd === "bcast" || cmd === "autobroadcast") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const msg2send = args.join(" ").trim();
          if (!msg2send) {
            await send("📢 *.bcast <message>*\n\nSends your message to ALL your WhatsApp contacts at once.\n\nExample: .bcast Hey everyone, check out my new service!\n\n⚠️ Use wisely — WhatsApp may flag mass messaging."); continue;
          }
          const contacts = allChats.filter(c =>
            c.id.endsWith("@s.whatsapp.net") &&
            !c.id.includes(OWNER_NUMBERS[0]?.replace(/\D/g, ""))
          );
          if (!contacts.length) { await send("No contacts found in the chat store yet. Chat with some people first!"); continue; }
          await send(`📢 Broadcasting to *${contacts.length} contacts*... this may take a moment.`);
          let sent = 0, failed = 0;
          for (const contact of contacts) {
            try {
              await sock.sendMessage(contact.id, { text: msg2send });
              sent++;
              if (sent % 10 === 0) await new Promise(r => setTimeout(r, 1500)); // rate limit
              else await new Promise(r => setTimeout(r, 300));
            } catch (e) { failed++; }
          }
          await send(`✅ *Broadcast Complete*\n\n📤 Sent: ${sent}\n❌ Failed: ${failed}\n📊 Total: ${contacts.length}`);
          continue;
        }

        // .paylink <amount> [description] — generate a Flutterwave payment link
        if (cmd === "paylink" || cmd === "plink" || cmd === "charge") {
          const amountArg = args[0];
          const desc = args.slice(1).join(" ").trim() || "Payment to teddymfg";
          if (!amountArg || isNaN(Number(amountArg))) {
            await send(`💳 *.paylink <amount> [description]*\n\nExamples:\n.paylink 3000\n.paylink 5000 For premium access\n.paylink 1500 Bot subscription\n\n_Generates a Flutterwave payment link instantly_`);
            continue;
          }
          const amount = Number(amountArg);
          if (amount < 100) { await send("❌ Minimum amount is ₦100"); continue; }
          await send("💳 *Generating payment link...*");
          try {
            const txRef = `MFG_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
            const payload = {
              tx_ref: txRef,
              amount,
              currency: "NGN",
              redirect_url: "https://teddymfg.com/thanks",
              meta: { source: "mfg_bot_whatsapp" },
              customer: {
                email: "customer@mfgbot.ng",
                name: "MFG Bot Customer"
              },
              customizations: {
                title: "MFG Bot Payment",
                description: desc,
                logo: ""
              },
              payment_options: "card,banktransfer,ussd"
            };
            const flwRes = await fetch("https://api.flutterwave.com/v3/payments", {
              method: "POST",
              headers: { "Authorization": `Bearer ${FLW_SECRET}`, "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(15000)
            });
            const flwData = await flwRes.json().catch(() => null);
            console.log("[MFG_bot] Paylink response:", JSON.stringify(flwData)?.slice(0, 200));
            if (flwData?.status === "success" && flwData?.data?.link) {
              await send(`✅ *PAYMENT LINK GENERATED* 💳\n\n━━━━━━━━━━━━━━━━━━━━\n💰 *Amount:* ₦${amount.toLocaleString()}\n📝 *Description:* ${desc}\n━━━━━━━━━━━━━━━━━━━━\n\n🔗 *Link:*\n${flwData.data.link}\n\n━━━━━━━━━━━━━━━━━━━━\n_Accepts: Card • Bank Transfer • USSD_\n_Ref: ${txRef}_\n\n_GHOST BANK MFG — built by teddymfg 🔥_`);
            } else {
              await send(`❌ Could not generate link: ${flwData?.message || "API error"}`);
            }
          } catch (e) {
            console.log("[MFG_bot] Paylink error:", e.message);
            await send("❌ Payment service error. Try again in a moment.");
          }
          continue;
        }

        // .refer — referral system info
        if (cmd === "refer" || cmd === "referral") {
          await send(`🤝 *REFERRAL PROGRAM*\n\n━━━━━━━━━━━━━━━━━━━━\nEarn free bot access by referring friends!\n━━━━━━━━━━━━━━━━━━━━\n\nHow it works:\n1️⃣ Tell your friends about mfg_bot\n2️⃣ They pay ₦3,000 and get their token\n3️⃣ Every 3 referrals = 1 free token for you\n\n📲 To refer: tell them to contact *+2349132883869*\nand mention your number when paying.\n\n_built by teddymfg • the bot that does everything_`);
          continue;
        }

        // .premium / .vip — show premium info
        if (cmd === "premium" || cmd === "vip") {
          await send(`👑 *MFG_BOT PREMIUM*\n\n━━━━━━━━━━━━━━━━━━━━\n🔓 *WHAT YOU GET WITH ACCESS:*\n━━━━━━━━━━━━━━━━━━━━\n\n🤖 AI replies in owner's exact style\n🎵 Unlimited music downloads (MP3)\n🎭 Persona mode (become any celebrity)\n🎤 Freestyle & lyrics generator\n😏 Shade, capcheck, settle debates\n🇳🇬 Explain anything in pidgin\n🙌 Testimony & prayer generator\n📸 Fire caption generator\n✨ Manifestation writer\n🕵️ Expose mode\n💬 200+ total commands\n🔊 Voice note AI replies\n📱 Works 24/7 — even when owner is offline\n\n━━━━━━━━━━━━━━━━━━━━\n💰 *PRICE: ₦3,000 (one-time)*\n━━━━━━━━━━━━━━━━━━━━\n\nContact *+2349132883869* to get your token.\n_Each token is one number. No sharing._`);
          continue;
        }

        // ── GROUP COMMANDS ────────────────────────────────────────────────
        if (cmd === "tagall") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try {
            const meta=await sock.groupMetadata(from);
            const mentions=meta.participants.map(p=>p.id);
            const tags=mentions.map(id=>`@${id.split("@")[0]}`).join(" ");
            const userMsg = args.join(" ").trim();
            const header = userMsg || "attention everyone 📢";
            // Tags MUST appear in text AND mentions array for WhatsApp to render highlight + notification
            const fullText = `${header}\n\n${tags}`;
            await sock.sendMessage(from, { text: fullText, mentions });
            console.log(`[MFG_bot] tagall sent to ${from}: ${mentions.length} members`);
          } catch(e){
            console.error("[MFG_bot] tagall error:", e.message);
            await send("couldn't tag all: " + e.message);
          }
          continue;
        }
        if (cmd === "hidetag") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try {
            const meta=await sock.groupMetadata(from);
            const mentions=meta.participants.map(p=>p.id);
            await sock.sendMessage(from, { text: args.join(" ") || "📢", mentions });
          } catch(e){await send("couldn't hidetag: " + e.message);}
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

        // ── More GROUP COMMANDS (require bot to be admin where noted) ─────
        if (cmd === "kick" || cmd === "remove") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            const mentioned = ctx?.mentionedJid || [];
            const quotedSender = ctx?.participant ? [ctx.participant] : [];
            const targets = [...mentioned, ...quotedSender];
            if (!targets.length) { await send(".kick @user (mention or reply to them)"); continue; }
            await sock.groupParticipantsUpdate(from, targets, "remove");
            await send(`👢 kicked ${targets.length} member(s)`);
          } catch(e){await send("couldn't kick: " + e.message + " (bot needs admin)");}
          continue;
        }
        if (cmd === "add") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          const num = (args[0]||"").replace(/\D/g,"");
          if (!num) { await send(".add <number with country code>"); continue; }
          try {
            await sock.groupParticipantsUpdate(from, [`${num}@s.whatsapp.net`], "add");
            await send(`✅ added +${num}`);
          } catch(e){await send("couldn't add: " + e.message + " (bot needs admin / number may have privacy on)");}
          continue;
        }
        if (cmd === "promote") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          const ctx = msg.message?.extendedTextMessage?.contextInfo;
          const targets = [...(ctx?.mentionedJid || []), ...(ctx?.participant ? [ctx.participant] : [])];
          if (!targets.length) { await send(".promote @user"); continue; }
          try {
            await sock.groupParticipantsUpdate(from, targets, "promote");
            await send(`👑 promoted to admin`);
          } catch(e){await send("couldn't promote: " + e.message);}
          continue;
        }
        if (cmd === "demote") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          const ctx = msg.message?.extendedTextMessage?.contextInfo;
          const targets = [...(ctx?.mentionedJid || []), ...(ctx?.participant ? [ctx.participant] : [])];
          if (!targets.length) { await send(".demote @user"); continue; }
          try {
            await sock.groupParticipantsUpdate(from, targets, "demote");
            await send(`⬇️ demoted from admin`);
          } catch(e){await send("couldn't demote: " + e.message);}
          continue;
        }
        if (cmd === "mute") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try { await sock.groupSettingUpdate(from, "announcement"); await send("🔇 group muted — only admins can send messages now"); }
          catch(e){await send("couldn't mute: " + e.message);}
          continue;
        }
        if (cmd === "unmute") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try { await sock.groupSettingUpdate(from, "not_announcement"); await send("🔊 group unmuted — everyone can chat"); }
          catch(e){await send("couldn't unmute: " + e.message);}
          continue;
        }
        if (cmd === "lock") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try { await sock.groupSettingUpdate(from, "locked"); await send("🔒 group info locked — only admins can edit"); }
          catch(e){await send("couldn't lock: " + e.message);}
          continue;
        }
        if (cmd === "unlock") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try { await sock.groupSettingUpdate(from, "unlocked"); await send("🔓 group info unlocked"); }
          catch(e){await send("couldn't unlock: " + e.message);}
          continue;
        }
        if (cmd === "setname" || cmd === "setsubject") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          const name = args.join(" ");
          if (!name) { await send(".setname <new group name>"); continue; }
          try { await sock.groupUpdateSubject(from, name); await send(`✏️ group renamed to "${name}"`); }
          catch(e){await send("couldn't rename: " + e.message);}
          continue;
        }
        if (cmd === "setdesc" || cmd === "setdescription") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          const desc = args.join(" ");
          if (!desc) { await send(".setdesc <new description>"); continue; }
          try { await sock.groupUpdateDescription(from, desc); await send(`📝 description updated`); }
          catch(e){await send("couldn't update description: " + e.message);}
          continue;
        }
        if (cmd === "leave" || cmd === "leavegroup") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try { await send("👋 leaving — peace"); await sock.groupLeave(from); }
          catch(e){await send("couldn't leave: " + e.message);}
          continue;
        }
        if (cmd === "members" || cmd === "memberlist") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          try {
            const meta = await sock.groupMetadata(from);
            const list = meta.participants.map((p,i) => `${i+1}. +${p.id.split("@")[0]}${p.admin ? " 👑" : ""}`).join("\n");
            await send(`👥 *${meta.subject}* — ${meta.participants.length} members\n\n${list.slice(0,3500)}`);
          } catch(e){await send("couldn't list members: " + e.message);}
          continue;
        }
        if (cmd === "admins" || cmd === "adminlist") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          try {
            const meta = await sock.groupMetadata(from);
            const adm = meta.participants.filter(p=>p.admin).map(p=>`👑 +${p.id.split("@")[0]} (${p.admin})`).join("\n");
            await send(`👑 *Admins of ${meta.subject}*\n\n${adm || "no admins listed"}`);
          } catch(e){await send("couldn't list admins: " + e.message);}
          continue;
        }
        if (cmd === "revoke" || cmd === "revokelink") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          if(!senderIsOwner){await send("owner only.");continue;}
          try { const code = await sock.groupRevokeInvite(from); await send(`🔄 invite link revoked. new link: https://chat.whatsapp.com/${code}`); }
          catch(e){await send("couldn't revoke: " + e.message);}
          continue;
        }
        if (cmd === "poll") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          const raw = args.join(" ");
          const parts = raw.split("|").map(s=>s.trim()).filter(Boolean);
          if (parts.length < 3) { await send(".poll question | option 1 | option 2 | option 3 (up to 12 options)"); continue; }
          const [q, ...opts] = parts;
          try { await sock.sendMessage(from, { poll: { name: q, values: opts.slice(0,12), selectableCount: 1 } }); }
          catch(e){await send("couldn't create poll: " + e.message);}
          continue;
        }
        if (cmd === "tagadmins") {
          if(!from.endsWith("@g.us")){await send("groups only.");continue;}
          try {
            const meta = await sock.groupMetadata(from);
            const admins = meta.participants.filter(p=>p.admin);
            if (!admins.length) { await send("no admins in this group"); continue; }
            const mentions = admins.map(a=>a.id);
            const tags = mentions.map(id=>`@${id.split("@")[0]}`).join(" ");
            await sock.sendMessage(from, { text: `${args.join(" ") || "👑 admins —"}\n\n${tags}`, mentions });
          } catch(e){await send("couldn't tag admins: " + e.message);}
          continue;
        }
        if (cmd === "del" || cmd === "delete") {
          if(!from.endsWith("@g.us") && !senderIsOwner){await send("groups (or owner DM) only.");continue;}
          const ctx = msg.message?.extendedTextMessage?.contextInfo;
          if (!ctx?.stanzaId) { await send("reply to the message you want to delete with .del"); continue; }
          try {
            await sock.sendMessage(from, { delete: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant, fromMe: false } });
          } catch(e){await send("couldn't delete (bot needs admin in groups): " + e.message);}
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

        // ── BIG-SHOT FEATURE COMMANDS ─────────────────────────────────────
        if (cmd === "aidisclaimer" || cmd === "disclaimer") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const sub = args[0]?.toLowerCase();
          if (sub === "on") { settings.aiDisclaimer = true; writeJSON("settings.json", settings); await send("✅ AI disclaimer ON — first reply per contact per day announces it's the mirror AI"); }
          else if (sub === "off") { settings.aiDisclaimer = false; writeJSON("settings.json", settings); await send("🔴 AI disclaimer OFF — bot replies pretend to be you, no notice"); }
          else if (sub === "text") { const t = args.slice(1).join(" "); if (t) { settings.disclaimerText = t; writeJSON("settings.json", settings); await send("✅ disclaimer text updated"); } else await send(`current:\n${settings.disclaimerText}\n\nset new: .disclaimer text <message>`); }
          else if (sub === "reset") { Array.from(disclaimerSent.keys()).forEach(k => disclaimerSent.delete(k)); await send("✅ disclaimer log cleared — will re-announce to everyone today"); }
          else await send(`disclaimer: ${settings.aiDisclaimer ? "🟢 on" : "🔴 off"}\n.disclaimer on | off | text <msg> | reset`);
          continue;
        }
        if (cmd === "transcribe" || cmd === "voice") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const sub = args[0]?.toLowerCase();
          if (sub === "on") { settings.transcribeVoice = true; writeJSON("settings.json", settings); await send("🎙 voice transcription ON — voice notes get transcribed by Whisper, AI replies to actual content"); }
          else if (sub === "off") { settings.transcribeVoice = false; writeJSON("settings.json", settings); await send("🔴 voice transcription OFF"); }
          else await send(`voice transcription: ${settings.transcribeVoice ? "🟢 on" : "🔴 off"}\n.transcribe on | off`);
          continue;
        }
        if (cmd === "vision" || cmd === "see") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const sub = args[0]?.toLowerCase();
          if (sub === "on") { settings.visionEnabled = true; writeJSON("settings.json", settings); await send("👁 vision ON — AI now SEES images and replies to actual content"); }
          else if (sub === "off") { settings.visionEnabled = false; writeJSON("settings.json", settings); await send("🔴 vision OFF"); }
          else await send(`vision: ${settings.visionEnabled ? "🟢 on" : "🔴 off"}\n.vision on | off`);
          continue;
        }
        if (cmd === "takeover") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const sub = args[0]?.toLowerCase();
          if (sub === "on") { settings.autoTakeover = true; writeJSON("settings.json", settings); await send(`✅ auto-takeover ON — when you text in any chat, AI pauses there for ${settings.takeoverMinutes}m`); }
          else if (sub === "off") { settings.autoTakeover = false; writeJSON("settings.json", settings); await send("🔴 auto-takeover OFF — AI keeps replying even when you type"); }
          else if (sub === "min" || sub === "minutes") { const n = parseInt(args[1]); if (n>0) { settings.takeoverMinutes = n; writeJSON("settings.json", settings); await send(`✅ takeover pause = ${n} min`); } else await send("usage: .takeover min <number>"); }
          else if (sub === "clear") { ownerTakeover.clear(); await send("✅ all takeover pauses cleared — AI active everywhere"); }
          else await send(`auto-takeover: ${settings.autoTakeover ? "🟢 on" : "🔴 off"} (${settings.takeoverMinutes}m)\nactive pauses: ${ownerTakeover.size}\n.takeover on | off | min <n> | clear`);
          continue;
        }
        if (cmd === "scam" || cmd === "antiscam") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const sub = args[0]?.toLowerCase();
          if (sub === "on") { settings.antiScam = true; writeJSON("settings.json", settings); await send("🛡 anti-scam shield ON"); }
          else if (sub === "off") { settings.antiScam = false; writeJSON("settings.json", settings); await send("🔴 anti-scam OFF"); }
          else if (sub === "log") { const last = scamAlerts.slice(0, 5).map(a => `${new Date(a.at).toLocaleString()}\n  ${a.jid}\n  "${a.text.slice(0,80)}"`).join("\n\n") || "no scam attempts logged"; await send(`🛡 last 5 scam alerts:\n\n${last}`); }
          else await send(`anti-scam: ${settings.antiScam ? "🟢 on" : "🔴 off"}\nlogged alerts: ${scamAlerts.length}\n.scam on | off | log`);
          continue;
        }
        if (cmd === "facts" || cmd === "memory") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const target = args[0] || from;
          const f = contactFacts[target]?.facts || [];
          if (!f.length) { await send(`no facts stored for ${target.slice(-15)}\n(facts auto-build as you chat)`); continue; }
          await send(`🧠 long-term memory for ${target.slice(-20)}:\n\n${f.map((x,i) => `${i+1}. ${x}`).join("\n")}`);
          continue;
        }
        if (cmd === "factsclear") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const target = args[0] || from;
          delete contactFacts[target];
          writeJSON("contact_facts.json", contactFacts);
          await send(`🧠 memory cleared for ${target.slice(-15)}`);
          continue;
        }
        if (cmd === "aiat" || cmd === "aifor") {
          // Per-contact AI on/off — usage: .aiat <jid|number> on/off
          if (!senderIsOwner) { await send("owner only."); continue; }
          let target = args[0]; const sub = args[1]?.toLowerCase();
          if (!target || !sub) { await send(`per-contact AI control\n.aiat <number|jid> on | off\n.aiat list — show disabled contacts`); continue; }
          if (target === "list") { await send(`AI disabled for:\n${[...aiContactDisabled].join("\n") || "(none)"}`); continue; }
          if (!target.includes("@")) target = target.replace(/[^0-9]/g,"") + "@s.whatsapp.net";
          if (sub === "off") { aiContactDisabled.add(target); await send(`🔴 AI disabled for ${target}`); }
          else if (sub === "on") { aiContactDisabled.delete(target); await send(`🟢 AI enabled for ${target}`); }
          continue;
        }
        if (cmd === "mood") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const sub = args[0]?.toLowerCase();
          if (sub === "on") { settings.moodAware = true; writeJSON("settings.json", settings); await send("✅ mood/time-of-day awareness ON"); }
          else if (sub === "off") { settings.moodAware = false; writeJSON("settings.json", settings); await send("🔴 mood awareness OFF"); }
          else { const h = new Date().getHours(); const mood = h<11?"morning sharp":h<17?"afternoon balanced":h<23?"evening chill":"late-night sleepy"; await send(`🌗 mood: ${settings.moodAware ? "🟢 on" : "🔴 off"}\ncurrent: ${mood} (hour ${h})\n.mood on | off`); }
          continue;
        }
        if (cmd === "birthdays" || cmd === "bdays") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const list = Object.entries(birthdayMemory).map(([j,d]) => `${j.slice(-15)} → ${d}`).join("\n") || "(none recorded yet)";
          await send(`🎂 stored birthdays:\n${list}`);
          continue;
        }
        if (cmd === "voice" || cmd === "voicereply") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const sub = args[0]?.toLowerCase();
          if (!process.env.ELEVENLABS_API_KEY) { await send("⚠️ ELEVENLABS_API_KEY env var not set on this backend.\nAdd it on Railway: Settings → Variables → ELEVENLABS_API_KEY"); continue; }
          if (!process.env.ELEVENLABS_VOICE_ID) { await send("⚠️ ELEVENLABS_VOICE_ID env var not set.\n1. Clone your voice on elevenlabs.io (Voice Lab → Instant Voice Clone)\n2. Copy the Voice ID from the voice you created\n3. Add ELEVENLABS_VOICE_ID env var on Railway"); continue; }
          if (sub === "on" || sub === "auto") { settings.voiceReplyMode = "auto"; settings.voiceCloneEnabled = true; writeJSON("settings.json", settings); await send("🎤 voice replies ON — every AI reply (≤300 chars) will be sent as a voice note in your cloned voice"); }
          else if (sub === "off") { settings.voiceReplyMode = "off"; writeJSON("settings.json", settings); await send("🔴 voice replies OFF — back to text"); }
          else if (sub === "test") {
            const testText = args.slice(1).join(" ") || "yo this is teddy, voice clone working sharp sharp";
            await send("🎤 testing voice synth...");
            const audio = await synthesizeVoice(testText);
            if (!audio) { await send("❌ ElevenLabs synth failed — check key/voice ID/quota"); continue; }
            try { await sock.sendMessage(from, { audio, mimetype: "audio/mpeg", ptt: true }); }
            catch (e) { await send("❌ send failed: " + e.message); }
          }
          else await send(`🎤 voice clone (ElevenLabs)\nstatus: ${settings.voiceReplyMode === "auto" ? "🟢 auto (every reply as voice)" : "🔴 off"}\nkey: ${process.env.ELEVENLABS_API_KEY?"✅":"❌"} | voice id: ${process.env.ELEVENLABS_VOICE_ID?"✅":"❌"}\n\n.voice on    — every AI reply becomes a voice note\n.voice off   — back to text\n.voice test [text] — test the clone now`);
          continue;
        }
        if (cmd === "createacct" || cmd === "btc") {
          await send("that payment/crypto command has been removed. use .song, .download, .music, or .list for the active bot features.");
          continue;
        }
        if (cmd === "bigshot" || cmd === "features") {
          await send(`🔥 BIG-SHOT FEATURES STATUS\n\n🤖 AI: ${settings.aiEnabled?"🟢":"🔴"}\n👋 Disclaimer: ${settings.aiDisclaimer?"🟢":"🔴"}\n🎙 Voice transcribe: ${settings.transcribeVoice?"🟢":"🔴"}\n👁 Vision (sees images): ${settings.visionEnabled?"🟢":"🔴"}\n🛡 Anti-scam: ${settings.antiScam?"🟢":"🔴"}\n🌗 Mood/time: ${settings.moodAware?"🟢":"🔴"}\n🎂 Birthdays: ${settings.birthdayWishes?"🟢":"🔴"}\n👑 Auto-takeover: ${settings.autoTakeover?"🟢":"🔴"} (${settings.takeoverMinutes}m)\n📢 Proactive: ${settings.proactiveText?"🟢":"🔴"} (10s, 30m cooldown)\n🎤 Voice clone: ${settings.voiceCloneEnabled?"🟢 (ElevenLabs)":"⚪ needs API key"}\n🎵 Music download: 🟢\n\nchats: ${allChats.length} | facts: ${Object.keys(contactFacts).length} contacts | scam alerts: ${scamAlerts.length}\n\ncommands: .disclaimer .transcribe .vision .takeover .scam .facts .aiat .mood .birthdays .voice .download .song .music .ytinfo .vv .calc`);
          continue;
        }

        // ── .listall — personalized welcome with the user's WhatsApp display name ──
        if (cmd === "listall" || cmd === "welcome" || cmd === "intro") {
          const userName = msg.pushName || "there";
          const ownerDisplay = "+2349132883869";
          await send(`🌟 hello *${userName}* — welcome to *TEDDY MFG WHATSAPP BOT* 🤖\n\n` +
            `you're chatting with the AI mirror of teddymfg.\n` +
            `my creator's number is *${ownerDisplay}* — kindly send him a message for:\n` +
            `  • feature suggestions\n` +
            `  • bug reports\n` +
            `  • or if you wish to become an admin of this bot 👑\n\n` +
            `here are the most useful things i can do for you:\n\n` +
            `🎵 *.song <name>* — find & download any song as MP3\n` +
            `📥 *.download <YouTube link>* — download any YouTube audio\n` +
            `ℹ️ *.music* — all music download commands\n` +
            `🤖 *.ai* — chat with me, i reply to anything\n` +
            `🎙 voice notes — i transcribe & reply\n` +
            `🖼 images — i can see them & reply\n` +
            `🌦 *.weather <city>* — current weather\n` +
            `📖 *.define <word>* — dictionary lookup\n` +
            `🎲 *.joke .fact .quote .truth .dare .8ball*\n` +
            `🧮 *.calc .tip .bmi .password .uuid*\n` +
            `📝 *.note .todo .save* — personal notes\n` +
            `👋 *.gm .gn .hbd* — greetings\n\n` +
            `type *.list* to see all 200+ commands by category\n` +
            `type *.menu* for a quick overview\n\n` +
            `_built with love by teddymfg_ ❤️`);
          continue;
        }

        // ── .download / .dl / .mp3 — download music by name or SoundCloud link ──
        if (cmd === "download" || cmd === "dl" || cmd === "mp3") {
          const input = args.join(" ").trim();
          if (!input) {
            pendingDownload.set(from, Date.now());
            await send("🎵 *MUSIC DOWNLOADER* 🎵\n\nSend me:\n› A *song name* to search and download\n› A *SoundCloud link* to download directly\n\n_(auto-cancels in 60s if no reply)_");
            continue;
          }
          await send(`🔍 searching for *"${input}"*...`);
          const audio = await downloadMusic(input);
          if (!audio?.buffer) { await send("❌ couldn't find that song. try a different name or spelling"); continue; }
          try {
            await sock.sendMessage(from, { audio: audio.buffer, mimetype: "audio/mp4", fileName: `${sanitizeFileName(audio.title || input)}.mp3` });
            const previewNote = audio.isPreview ? " _(30s preview)_" : "";
            await send(`✅ *${audio.title || input}* — enjoy 🎧${previewNote}`);
          } catch (e) { await send("❌ send failed: " + e.message); }
          continue;
        }

        if (cmd === "song" || cmd === "play") {
          const query = args.join(" ");
          if (!query) { await send("🎵 *.song <song name>*\n\nExamples:\n.song Burna Boy Last Last\n.song Asake Organise\n.song Davido Unavailable\n.song Wizkid Essence"); continue; }
          await send(`🔍 searching for *"${query}"*...`);
          const audio = await downloadMusic(query);
          if (!audio?.buffer) { await send("❌ couldn't find that song. try a different spelling or artist name"); continue; }
          try {
            await sock.sendMessage(from, { audio: audio.buffer, mimetype: "audio/mp4", fileName: `${sanitizeFileName(audio.title || query)}.mp3` });
            const previewNote = audio.isPreview ? " _(30s preview)_" : "";
            await send(`✅ *${audio.title || query}* — enjoy 🎧${previewNote}`);
          } catch (e) { await send("❌ send failed: " + e.message); }
          continue;
        }

        if (cmd === "music" || cmd === "songs") {
          await send(`🎵 *MFG MUSIC DOWNLOADER* 🎵\n_powered by mfg_bot • made by teddymfg_\n\n━━━━━━━━━━━━━━━━━━━━\n🔥 *DOWNLOAD COMMANDS*\n━━━━━━━━━━━━━━━━━━━━\n\n🎶 *.song <name>* — search + send MP3\n▶️ *.play <name>* — same as .song\n⏬ *.mp3 <name>* — download by song name\n🔗 *.download <SoundCloud link>* — direct link download\n⚡ *.dl <name or link>* — fastest alias\n\nℹ️ *.songinfo <name>* — title, artist, album, duration\n\n━━━━━━━━━━━━━━━━━━━━\n💡 *TIPS*\n━━━━━━━━━━━━━━━━━━━━\n› Type *.song* alone → send song name next\n› Works great for Afrobeats, Amapiano, global hits\n› Max file size: 25MB (WhatsApp limit)\n› If song is short (30s), try a more specific name\n\n_type .song <name> to start_ 👇`);
          continue;
        }

        if (cmd === "ytinfo" || cmd === "songinfo") {
          const input = args.join(" ");
          if (!input) { await send("*.songinfo <song name>*\nexample: .songinfo Burna Boy Last Last"); continue; }
          await send(`🔍 looking up *"${input}"*...`);
          const info = await getSongInfo(input);
          if (!info) { await send("❌ couldn't find that song info."); continue; }
          await send(`🎵 *${info.title}*\n🎤 ${info.artist}\n💿 ${info.album}\n⏱ ${info.duration}\n🔗 ${info.link}`);
          continue;
        }

        if (cmd === "whoami") {
          await send("🤖 analyzing identity...");
          const whoamiQuery = "Who are you? Briefly explain your identity, your maker (+23409132883869), your numerous features, and confirm you use the latest advanced AI version.";
          const reply = await askGroq(whoamiQuery, from);
          if (reply) {
            await send(reply);
          } else {
            await send("❌ AI is currently unavailable.");
          }
          continue;
        }

        if (cmd === "update") {
          // Verify it's the maker
          const senderNum = isFromMe ? sock.user.id.split(":")[0] : from.split("@")[0];
          if (senderNum !== "23409132883869" && !isFromMe) { // Added fallback if the bot is actually the maker's number
             await send("❌ only my maker (+23409132883869) can update my features.");
             continue;
          }
          const feature = args.join(" ");
          if (!feature) {
            await send("usage: .update <new feature or instruction to learn>");
            continue;
          }
          settings.systemPrompt += `\n\n[NEW MAKER INSTRUCTION/FEATURE]:\n${feature}`;
          writeJSON("settings.json", settings);
          await send(`✅ bot updated successfully. i have learned the new feature/instruction: "${feature}"`);
          continue;
        }

        // ── More powerful commands ─────────────────────────────────────────
        if (cmd === "weather") {
          const city = args.join(" ") || "Lagos";
          try {
            const r = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=%l:+%C+%t+feels+like+%f+humidity+%h+wind+%w`);
            const t = await r.text();
            await send(`🌦 ${t}`);
          } catch (e) { await send("couldn't fetch weather rn"); }
          continue;
        }
        if (cmd === "define" || cmd === "dictionary") {
          const w = args[0];
          if (!w) { await send(".define <word>"); continue; }
          try {
            const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
            const j = await r.json();
            if (!Array.isArray(j) || !j[0]) { await send(`📖 no definition for "${w}"`); continue; }
            const m = j[0].meanings?.[0];
            const def = m?.definitions?.[0];
            await send(`📖 *${j[0].word}* (${m?.partOfSpeech || "?"})\n${def?.definition || "no definition"}${def?.example ? `\n\n_e.g._ ${def.example}` : ""}`);
          } catch (e) { await send("dictionary lookup failed"); }
          continue;
        }
        if (cmd === "shorten" || cmd === "short") {
          const u = args[0];
          if (!u) { await send(".shorten <url>"); continue; }
          try {
            const r = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(u)}`);
            const t = await r.text();
            await send(t.startsWith("http") ? `🔗 ${t}` : "couldn't shorten that url");
          } catch (e) { await send("shorten failed"); }
          continue;
        }
        if (cmd === "ip") {
          const ip = args[0];
          if (!ip) { await send(".ip <ip-address>"); continue; }
          try {
            const r = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
            const j = await r.json();
            await send(`🌐 *${ip}*\n📍 ${j.city}, ${j.region}, ${j.country_name}\n🏢 ${j.org || "?"}\n📡 ${j.timezone || "?"}`);
          } catch (e) { await send("ip lookup failed"); }
          continue;
        }

        // ── 🆕 NEW COMMANDS (unlocked by Baileys 6.7.21 upgrade) ──────────

        // .editlast <new text> — edit the bot's last sent message in this chat
        if (cmd === "editlast" || cmd === "edit") {
          const newText = args.join(" ").trim();
          if (!newText) { await send("usage: .editlast <new text>"); continue; }
          const lastKey = lastBotMsgByChat.get(from);
          if (!lastKey) { await send("no recent bot message tracked in this chat to edit."); continue; }
          try {
            await sock.sendMessage(from, { text: newText, edit: lastKey });
            console.log(`[MFG_bot] .editlast → edited ${lastKey.id} in ${from}`);
          } catch (e) { await send("edit failed: " + e.message); }
          continue;
        }

        // .say <text> — send a tracked message (so .editlast can edit it later)
        if (cmd === "say") {
          const t = args.join(" ").trim();
          if (!t) { await send("usage: .say <text>"); continue; }
          await send(t);
          continue;
        }

        // .pin / .unpin — pin or unpin current chat
        if (cmd === "pin" || cmd === "unpin") {
          if (!isOwner(participantJid) && !isFromMe) { await send("owner only."); continue; }
          try {
            await sock.chatModify({ pin: cmd === "pin" }, from);
            await send(cmd === "pin" ? "📌 chat pinned" : "📌 chat unpinned");
          } catch (e) { await send(`${cmd} failed: ${e.message}`); }
          continue;
        }

        // .channel — create/follow/info channels (newsletters)
        if (cmd === "channel" || cmd === "newsletter") {
          if (!isOwner(participantJid) && !isFromMe) { await send("owner only."); continue; }
          const sub = (args[0] || "").toLowerCase();
          if (sub === "create") {
            const name = args.slice(1).join(" ").trim();
            if (!name) { await send("usage: .channel create <name>"); continue; }
            try {
              const meta = await sock.newsletterCreate(name, "Created via mfg_bot");
              await send(`✅ channel created\n*${meta.name}*\nid: ${meta.id}\ninvite: https://whatsapp.com/channel/${meta.invite || "?"}`);
            } catch (e) { await send("channel create failed: " + e.message); }
            continue;
          }
          if (sub === "info") {
            const code = (args[1] || "").replace(/^https?:\/\/whatsapp\.com\/channel\//i, "").trim();
            if (!code) { await send("usage: .channel info <invite-link-or-code>"); continue; }
            try {
              const meta = await sock.newsletterMetadata("invite", code);
              await send(`📰 *${meta.name}*\nfollowers: ${meta.subscribers_count || 0}\ndesc: ${meta.description || "—"}\nid: ${meta.id}`);
            } catch (e) { await send("channel info failed: " + e.message); }
            continue;
          }
          if (sub === "follow") {
            const code = (args[1] || "").replace(/^https?:\/\/whatsapp\.com\/channel\//i, "").trim();
            if (!code) { await send("usage: .channel follow <invite-link-or-code>"); continue; }
            try {
              const meta = await sock.newsletterMetadata("invite", code);
              await sock.newsletterFollow(meta.id);
              await send(`✅ followed *${meta.name}*`);
            } catch (e) { await send("follow failed: " + e.message); }
            continue;
          }
          if (sub === "post") {
            const rest = args.slice(1).join(" ");
            const [chId, ...textParts] = rest.split("|").map(s => s.trim());
            const txt = textParts.join("|");
            if (!chId || !txt) { await send("usage: .channel post <channel-id> | <text>"); continue; }
            try {
              await sock.sendMessage(chId, { text: txt });
              await send("✅ posted to channel");
            } catch (e) { await send("post failed: " + e.message); }
            continue;
          }
          await send("📰 *channel commands*\n.channel create <name>\n.channel info <invite>\n.channel follow <invite>\n.channel post <id> | <text>");
          continue;
        }

        // .vvideo — send replied video as VIEW-ONCE
        if (cmd === "vvideo" || cmd === "vonce") {
          const ctx = msg.message?.extendedTextMessage?.contextInfo;
          const quoted = ctx?.quotedMessage;
          const vid = quoted?.videoMessage || quoted?.imageMessage;
          if (!vid) { await send("reply to a video/image with .vvideo to send it as view-once."); continue; }
          try {
            const fakeMsg = { key: { remoteJid: from, id: ctx.stanzaId, fromMe: false, participant: ctx.participant }, message: quoted };
            const buffer = await downloadMediaMessage(fakeMsg, "buffer", {});
            const mediaType = quoted.videoMessage ? "video" : "image";
            await sock.sendMessage(from, { [mediaType]: buffer, viewOnce: true, caption: args.join(" ") || undefined });
            await send(`✅ sent as view-once ${mediaType}`);
          } catch (e) { await send("view-once send failed: " + e.message); }
          continue;
        }

        // .statusreact <emoji|off> — auto-react to incoming statuses
        if (cmd === "statusreact" || cmd === "sreact") {
          const v = (args[0] || "").trim();
          if (!v) { await send(`status auto-react: ${settings.statusReactEmoji ? "ON ("+settings.statusReactEmoji+")" : "OFF"}\nusage: .statusreact <emoji|off>`); continue; }
          if (v === "off") { settings.statusReactEmoji = null; writeJSON("settings.json", settings); await send("status auto-react OFF"); continue; }
          settings.statusReactEmoji = v;
          writeJSON("settings.json", settings);
          await send(`✅ status auto-react set to ${v}\n(reacts to every status you receive)`);
          continue;
        }

        // .pollvotes — show vote breakdown for a quoted poll (now decryptable in 6.7.21)
        if (cmd === "pollvotes" || cmd === "votes") {
          const ctx = msg.message?.extendedTextMessage?.contextInfo;
          const pollMsg = ctx?.quotedMessage?.pollCreationMessage || ctx?.quotedMessage?.pollCreationMessageV3;
          if (!pollMsg) { await send("reply to a poll with .pollvotes to see results."); continue; }
          const lines = (pollMsg.options || []).map((o, i) => `${i+1}. ${o.optionName}`);
          await send(`📊 *${pollMsg.name}*\n\n${lines.join("\n")}\n\n_(real-time vote tally requires bot to have seen each vote)_`);
          continue;
        }

        // ── .command / .list / .work / .teddy / .menu / .help — ALL commands ──
        if (cmd === "command" || cmd === "commands" || cmd === "list" || cmd === "work" || cmd === "teddy" || cmd === "menu" || cmd === "help" || cmd === "allcmd") {
          const part1 = `╔══════════════════════╗\n║  🤖 *MFG_BOT COMMANDS* 🤖  ║\n╚══════════════════════╝\n_built by teddymfg • +2349132883869_\n\n━━━━━━━━━━━━━━━━━━━━\n⭐ *TOP COMMANDS*\n━━━━━━━━━━━━━━━━━━━━\n🟢 *.online* — cover mode on (AI + stays online)\n🔴 *.offline* — turn off cover mode\n👋 *.listall* — personalized welcome\n👋 *.welcome / .intro* — greet me\n🆔 *.whoami* — bot identity\n\n━━━━━━━━━━━━━━━━━━━━\n🎵 *MUSIC DOWNLOADS*\n━━━━━━━━━━━━━━━━━━━━\n🎶 *.song <name>* — search + send MP3\n▶️ *.play <name>* — same as .song\n⏬ *.mp3 <name>* — download by song name\n🔗 *.download <SoundCloud link>* — direct link\n⚡ *.dl <name or link>* — fastest alias\n🎵 *.music* — full music menu\nℹ️ *.songinfo <name>* — title, artist, album, duration\n\n━━━━━━━━━━━━━━━━━━━━\n🏦 *GHOST BANK MFG*\n━━━━━━━━━━━━━━━━━━━━\n💳 *.pay* — create or view your account\n💰 *.pay balance* — check your balance\n📋 *.pay history* — last 10 transactions\n💸 *.pay withdraw* — request withdrawal\n🏦 *.bank* — quick account view (alias)\n💱 *.nairarate* — live USD/GBP/EUR → NGN rates\n\n━━━━━━━━━━━━━━━━━━━━\n🌐 *LIVE TOOLS*\n━━━━━━━━━━━━━━━━━━━━\n🌤 *.weather <city>* — live weather\n📖 *.define <word>* — dictionary\n🔗 *.shorten <url>* — shrink links\n🌍 *.ip <address>* — geolocate IP\n\n━━━━━━━━━━━━━━━━━━━━\n🤖 *AI & BRAIN*\n━━━━━━━━━━━━━━━━━━━━\n*.ai on/off/status/mode/reset/prompt/delay/typing*\n*.style* — manage style mirroring\n*.learnme / .learnme view / .learnme clear*\n*.disclaimer on/off/text/reset*\n🎙 *.transcribe on/off* — voice → text\n👁 *.vision on/off* — read images\n🌗 *.mood on/off* — time-of-day tone\n🫡 *.takeover on/off/min N/clear*\n🚨 *.scam on/off/log* — scam detection\n📚 *.facts* / *.factsclear*\n🎂 *.birthdays* — tracked birthdays\n🔊 *.voice / .voicetest* — voice clone\n⚙️ *.bigshot* — all big-shot toggles\n\n━━━━━━━━━━━━━━━━━━━━\n👥 *GROUPS — TAGGING*\n━━━━━━━━━━━━━━━━━━━━\n📣 *.tagall <msg>* — notify everyone\n👻 *.hidetag <msg>* — invisible mentions\n🎖 *.tagadmins <msg>*\n🔊 *.everyone / .all <msg>*\n\n━━━━━━━━━━━━━━━━━━━━\n👥 *GROUPS — CONTROL* _(needs admin)_\n━━━━━━━━━━━━━━━━━━━━\n🚫 *.kick @user* (or reply + .kick)\n➕ *.add <number>*\n⬆️ *.promote @user* / ⬇️ *.demote @user*\n🔇 *.mute / .unmute*\n🔒 *.lock / .unlock*\n✏️ *.setname <name>* / *.setdesc <desc>*\n🔄 *.revoke* (reset group link)\n🚪 *.leave*\n\n━━━━━━━━━━━━━━━━━━━━\n👥 *GROUPS — INFO*\n━━━━━━━━━━━━━━━━━━━━\n*.groupinfo / .members / .admins / .link*\n📊 *.poll Q | opt1 | opt2 | opt3*\n🗑 *.del* — reply to delete a message\n👁 *.vv* — reveal view-once photo/video`;

          const partUpgraded = `━━━━━━━━━━━━━━━━━━━━\n🆕 *NEW FEATURES (v6.7.21)*\n━━━━━━━━━━━━━━━━━━━━\n\n✏️ *EDIT MESSAGES*\n*.say <text>* — bot sends a tracked message\n*.editlast <new text>* — edit bot's last reply\n\n📌 *CHAT PIN*\n*.pin* — pin chat to top\n*.unpin* — unpin\n\n📰 *CHANNELS*\n*.channel create <name>*\n*.channel info / follow / post*\n_(alias: .newsletter)_\n\n👁 *VIEW-ONCE SEND*\n*.vvideo* — re-send as view-once\n_(alias: .vonce)_\n\n💚 *STATUS AUTO-REACT*\n*.statusreact <emoji>* — react to every status\n*.statusreact off* — turn off\n_(alias: .sreact)_\n\n📊 *POLL VOTES*\n*.pollvotes* — reply to poll to see results\n_(alias: .votes)_\n\n`;

          const part2 = partUpgraded + `━━━━━━━━━━━━━━━━━━━━\n🔥 *SIGNATURE COMMANDS — ONE OF ONE*\n━━━━━━━━━━━━━━━━━━━━\n🎭 *.persona <name|off>* — bot becomes ANY celebrity (Burna Boy, Davido, etc)\n🎵 *.lyrics <vibe>* — write original Afrobeats song lyrics on demand\n🎤 *.freestyle <topic>* — AI spits bars in Nigerian rap style\n😏 *.shade <person>* — perfect subtle shade, Nigerian style\n🧢 *.capcheck <claim>* — Cap or Facts? AI gives the FINAL verdict\n🇳🇬 *.naija <topic>* — explain ANYTHING in pure Nigerian pidgin\n🙌 *.testimony <topic>* — generate a Nigerian church testimony (hilarious)\n⚖️ *.settle <debate>* — settle any argument ONCE AND FOR ALL\n✨ *.manifest <dream>* — write your manifestation/affirmation\n🕵️ *.expose <claim>* — pull receipts and expose the truth\n💥 *.punchline <topic>* — generate a savage one-liner\n📸 *.caption <context>* — 3 fire social media captions\n🙏 *.prayer <situation>* — Nigerian church prayer for anything\n🗣 *.argue <position>* — AI argues your side passionately\n💰 *.premium* — see what you get with access\n🤝 *.refer* — earn free tokens by referring friends\n\n━━━━━━━━━━━━━━━━━━━━\n📝 *TEXT TOOLS*\n━━━━━━━━━━━━━━━━━━━━\n.upper .lower .reverse .mock .clap\n.aesthetic .count .repeat .emojify\n\n━━━━━━━━━━━━━━━━━━━━\n🔢 *MATH & CALC*\n━━━━━━━━━━━━━━━━━━━━\n.calc .percent .tax .tip .split\n.bmi .random .temp .sqrt\n.pow .round .password .age\n\n━━━━━━━━━━━━━━━━━━━━\n🎮 *FUN & GAMES*\n━━━━━━━━━━━━━━━━━━━━\n.joke .fact .quote .truth .dare\n.wyr .pickup .roast .compliment .fortune\n.8ball .rps .ship .rate .rank\n.choose .spin .slot .flip .roll .dice\n\n━━━━━━━━━━━━━━━━━━━━\n😤 *VIBE CHECKS*\n━━━━━━━━━━━━━━━━━━━━\n.rizz .sus .vibe .chad .simp\n.npc .based .ratio .bruh .oof\n.hype .cringe .salty .goat .lucky\n\n━━━━━━━━━━━━━━━━━━━━\n🤝 *SOCIAL ACTIONS*\n━━━━━━━━━━━━━━━━━━━━\n.gm .gn .hbd .gl .gg .greet\n.hug .slap .poke .kiss .punch\n.highfive .love .wave .salute .bow\n.cheer .congrats .rip .ily\n\n━━━━━━━━━━━━━━━━━━━━\n🛠 *UTILITY*\n━━━━━━━━━━━━━━━━━━━━\n.time .date .uptime .age .countdown\n.note .notes .delnote .todo .todos .done\n.save .get .keys .ping .bot .stats\n.site — portfolio\n.call on/off — block calls\n\n━━━━━━━━━━━━━━━━━━━━\n👑 *OWNER ONLY*\n━━━━━━━━━━━━━━━━━━━━\n.broadcast all|group <msg>\n.send <number> <msg>\n.feedback .report .donate\n.bot prefix <symbol>\n\n╔══════════════════════╗\n║  200+ commands total 🚀  ║\n╚══════════════════════╝\n_type any command to use it_`;

          await send(part1);
          await new Promise(r => setTimeout(r, 700));
          await send(part2);
          continue;
        }

        // ── .bank — alias for .pay (ghost bank shortcut) ─────────────────
        if (cmd === "bank" || cmd === "account" || cmd === "acct") {
          const sub = args[0]?.toLowerCase();
          const senderPhone2 = (participantJid || from).split("@")[0].replace(/[^0-9]/g, "");
          const jidKey2 = (participantJid || from);
          if (ghostBankData[jidKey2]?.accountNumber) {
            const acct = ghostBankData[jidKey2];
            await send(`🏦 *GHOST BANK MFG*\n\n👤 *${acct.acctName}*\n🏛 ${acct.bankName || "Sterling Bank"}\n💳 *${acct.accountNumber}*\n💰 Balance: ₦${(acct.balance || 0).toLocaleString()}\n\n*.pay balance* • *.pay history* • *.pay withdraw*`);
          } else {
            await send("you don't have a ghost bank account yet.\ntype *.pay* to create one — takes 5 seconds 🏦");
          }
          continue;
        }

        // ── .sendpaylink <number> <amount> [desc] — send paylink to a number ──
        if (cmd === "sendpaylink" || cmd === "splink") {
          if (!senderIsOwner) { await send("owner only."); continue; }
          const numArg = args[0]?.replace(/\D/g, "");
          const amountArg2 = args[1];
          const desc2 = args.slice(2).join(" ").trim() || "Payment to teddymfg";
          if (!numArg || !amountArg2 || isNaN(Number(amountArg2))) {
            await send("*.sendpaylink <number> <amount> [desc]*\nexample: .sendpaylink 08012345678 5000 For premium access");
            continue;
          }
          const amount2 = Number(amountArg2);
          try {
            const txRef2 = `MFG_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
            const flwRes2 = await fetch("https://api.flutterwave.com/v3/payments", {
              method: "POST",
              headers: { "Authorization": `Bearer ${FLW_SECRET}`, "Content-Type": "application/json" },
              body: JSON.stringify({ tx_ref: txRef2, amount: amount2, currency: "NGN", redirect_url: "https://teddymfg.com/thanks", customer: { email: `wa_${numArg}@mfgbot.ng`, name: numArg }, customizations: { title: "MFG Bot Payment", description: desc2 }, payment_options: "card,banktransfer,ussd" }),
              signal: AbortSignal.timeout(15000)
            });
            const flwData2 = await flwRes2.json().catch(() => null);
            if (flwData2?.status === "success" && flwData2?.data?.link) {
              const targetJid = `${numArg.replace(/^0/, "234")}@s.whatsapp.net`;
              await sock.sendMessage(targetJid, { text: `💳 *PAYMENT REQUEST*\n\nYou have a payment of *₦${amount2.toLocaleString()}* from teddymfg.\n\n📝 ${desc2}\n\n🔗 *Pay here:*\n${flwData2.data.link}\n\n_Accepts: Card • Bank Transfer • USSD_\n_Powered by GHOST BANK MFG 🔥_` });
              await send(`✅ Payment link (₦${amount2.toLocaleString()}) sent to ${numArg}`);
            } else {
              await send(`❌ Failed: ${flwData2?.message || "API error"}`);
            }
          } catch (e) { await send("❌ Error: " + e.message); }
          continue;
        }

        // ── .nairarate — live NGN exchange rates ──────────────────────────
        if (cmd === "nairarate" || cmd === "rate" || cmd === "usdngn") {
          try {
            const r = await fetch("https://api.exchangerate-api.com/v4/latest/NGN", { signal: AbortSignal.timeout(8000) });
            const d = await r.json();
            const rates = d?.rates;
            if (!rates) throw new Error("no data");
            const usd = (1 / rates.USD).toFixed(2);
            const gbp = (1 / rates.GBP).toFixed(2);
            const eur = (1 / rates.EUR).toFixed(2);
            await send(`💱 *NGN EXCHANGE RATES*\n\n🇺🇸 $1 USD = ₦${usd}\n🇬🇧 £1 GBP = ₦${gbp}\n🇪🇺 €1 EUR = ₦${eur}\n\n_via exchangerate-api_`);
          } catch (e) { await send("couldn't fetch exchange rates rn. try again later."); }
          continue;
        }

        // ── .convertngn <amount> <currency> — convert NGN to foreign ────
        if (cmd === "convertngn" || cmd === "convert") {
          const amt = parseFloat(args[0]);
          const cur = (args[1] || "USD").toUpperCase();
          if (isNaN(amt)) { await send(".convertngn <amount> <currency>\nexample: .convertngn 50000 USD"); continue; }
          try {
            const r = await fetch(`https://api.exchangerate-api.com/v4/latest/NGN`, { signal: AbortSignal.timeout(8000) });
            const d = await r.json();
            const rate = d?.rates?.[cur];
            if (!rate) { await send(`❌ unknown currency: ${cur}`); continue; }
            const converted = (amt * rate).toFixed(2);
            await send(`💱 ₦${amt.toLocaleString()} = *${converted} ${cur}*`);
          } catch (e) { await send("conversion failed. try again."); }
          continue;
        }

        // ── .news — latest Nigerian headlines ────────────────────────────
        if (cmd === "news" || cmd === "headlines") {
          try {
            const r = await fetch("https://rss.cnn.com/rss/edition_africa.rss", { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0" } });
            const xml = await r.text();
            const items = [...xml.matchAll(/<item>[\s\S]*?<title><!\[CDATA\[([^\]]+)\]\]><\/title>[\s\S]*?<\/item>/g)].slice(0, 5);
            if (!items.length) throw new Error("no items");
            const lines = items.map((m, i) => `${i + 1}. ${m[1]}`).join("\n");
            await send(`📰 *LATEST NEWS*\n\n${lines}\n\n_Source: CNN Africa_`);
          } catch (e) {
            await send("couldn't fetch news right now. try again later.");
          }
          continue;
        }

        // ── .remind <minutes> <message> — set a reminder ────────────────
        if (cmd === "remind" || cmd === "reminder") {
          const mins = parseInt(args[0]);
          const reminderText = args.slice(1).join(" ").trim();
          if (isNaN(mins) || mins < 1 || !reminderText) {
            await send("*.remind <minutes> <message>*\nexample: .remind 30 call mum\n.remind 60 take your medicine");
            continue;
          }
          if (mins > 1440) { await send("max reminder is 24 hours (1440 mins)"); continue; }
          await send(`⏰ *Reminder set!*\nI'll remind you in *${mins} minute${mins > 1 ? "s" : ""}* to: _${reminderText}_`);
          setTimeout(async () => {
            try {
              await sock.sendMessage(from, { text: `⏰ *REMINDER!*\n\n_${reminderText}_\n\nset ${mins} min${mins > 1 ? "s" : ""} ago 📌` });
            } catch (e) { console.log("[MFG_bot] reminder send err:", e.message); }
          }, mins * 60 * 1000);
          continue;
        }

        // ── .crypto <coin> — live crypto price ───────────────────────────
        if (cmd === "crypto" || cmd === "coin" || cmd === "btc" || cmd === "eth") {
          const coinId = (cmd === "btc" ? "bitcoin" : cmd === "eth" ? "ethereum" : (args[0] || "bitcoin")).toLowerCase();
          try {
            const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd,ngn`, { signal: AbortSignal.timeout(10000) });
            const d = await r.json();
            const data = d?.[coinId];
            if (!data) { await send(`❌ coin "${coinId}" not found. try: bitcoin, ethereum, solana, dogecoin`); continue; }
            await send(`💰 *${coinId.toUpperCase()}*\n\n🇺🇸 $${data.usd?.toLocaleString() || "?"}\n🇳🇬 ₦${data.ngn?.toLocaleString() || "?"}`);
          } catch (e) { await send("crypto lookup failed. try again."); }
          continue;
        }

        // ── .translate <lang> <text> — translate text ─────────────────
        if (cmd === "translate" || cmd === "tr") {
          const lang = args[0] || "en";
          const textToTl = args.slice(1).join(" ").trim();
          if (!textToTl) { await send(".translate <lang> <text>\nexample: .translate es Hello how are you"); continue; }
          try {
            const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTl)}&langpair=en|${lang}`, { signal: AbortSignal.timeout(10000) });
            const d = await r.json();
            const result = d?.responseData?.translatedText;
            if (!result || result === textToTl) { await send("❌ translation failed or same language"); continue; }
            await send(`🌍 *Translated to ${lang.toUpperCase()}:*\n${result}`);
          } catch (e) { await send("translation failed. try again."); }
          continue;
        }

        // ── .qr <text> — generate a QR code link ─────────────────────
        if (cmd === "qr" || cmd === "qrcode") {
          const qrText = args.join(" ").trim();
          if (!qrText) { await send(".qr <text or url>\nexample: .qr https://wa.me/2349132883869"); continue; }
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrText)}`;
          try {
            const r = await fetch(qrUrl, { signal: AbortSignal.timeout(10000) });
            const buf = Buffer.from(await r.arrayBuffer());
            await sock.sendMessage(from, { image: buf, caption: `📱 QR code for:\n_${qrText}_` });
          } catch (e) { await send(`📱 QR code:\n${qrUrl}`); }
          continue;
        }

        // ── .tiktok / .reel / .igdl <url> — try download from short-video ─
        if (cmd === "tiktok" || cmd === "tt" || cmd === "reel" || cmd === "igdl" || cmd === "insta") {
          const mediaUrl = args[0];
          if (!mediaUrl || !mediaUrl.startsWith("http")) { await send(`*.${cmd} <url>*\nPaste the TikTok / Instagram / Reel link`); continue; }
          await send("⏬ trying to download...");
          try {
            const cobaltRes = await fetch("https://cobalt.api.nadeko.net/json", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify({ url: mediaUrl, vQuality: "720", aFormat: "mp3", disableMetadata: true }),
              signal: AbortSignal.timeout(20000)
            });
            const cobaltData = await cobaltRes.json().catch(() => null);
            const dlUrl = cobaltData?.url || cobaltData?.audio;
            if (!dlUrl) { await send(`❌ download failed.\ntry: ${mediaUrl}`); continue; }
            const mediaRes = await fetch(dlUrl, { signal: AbortSignal.timeout(40000) });
            const buf = Buffer.from(await mediaRes.arrayBuffer());
            const ct = mediaRes.headers.get("content-type") || "";
            if (ct.includes("audio")) {
              await sock.sendMessage(from, { audio: buf, mimetype: "audio/mp4", fileName: "audio.mp3" });
            } else {
              await sock.sendMessage(from, { video: buf, mimetype: "video/mp4", caption: "🎬" });
            }
            await send("✅ done 🎧");
          } catch (e) { await send("❌ download failed: " + e.message); }
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

      // ── AI Reply — reply to EVERY message (text, sticker, image, audio…) ──
      if (!settings.aiEnabled) { logTag("skip:ai_disabled"); continue; }
      if (isFromMe) { logTag("skip:fromMe"); continue; }
      // Stale guard: don't AI-reply to messages from a re-delivered backlog
      if (isStale) { logTag(`skip:stale_${Math.round(ageMs/1000)}s`); continue; }
      if (text && text.startsWith(pfx)) { logTag("skip:command"); continue; }
      if (from?.endsWith("@g.us")) { logTag("skip:group"); continue; }
      if (from?.endsWith("@broadcast")) { logTag("skip:broadcast"); continue; }
      if (aiContactDisabled.has(from)) { logTag("skip:contact_off"); continue; }
      // Owner takeover — stay quiet for X min after owner types in this chat
      if (ownerTakeover.has(from)) {
        const takeoverAt = ownerTakeover.get(from);
        if (Date.now() - takeoverAt < settings.takeoverMinutes * 60 * 1000) { logTag("skip:owner_takeover"); continue; }
        else ownerTakeover.delete(from);
      }
      if (aiPaused.has(from)) {
        const pausedAt = aiPaused.get(from);
        if (Date.now() - pausedAt < 30 * 60 * 1000) { logTag("skip:paused"); continue; }
        else aiPaused.delete(from);
      }
      try {
        logTag("calling_groq");
        // ── Persona mode: wrap the query so AI responds AS the active persona ──
        let groqInput = effectiveText;
        if (activePersona.has(from)) {
          const persona = activePersona.get(from);
          groqInput = `[PERSONA MODE: You are now responding AS ${persona}. Match their EXACT voice, slang, energy, and speaking style. Stay fully in character. Do NOT break character or add any disclaimer.]\n\nUser says: ${effectiveText}`;
        }
        let reply = await askGroq(groqInput, from);
        if (!reply) { logTag("err:groq_empty"); continue; }
        if (reply.startsWith("[STOP]")) {
          aiPaused.set(from, Date.now());
          logTag("paused:escalation");
          console.log(`[MFG_bot] AI paused for ${from} — escalation detected`);
          continue;
        }
        // ── AI Disclaimer: once per contact per day, prepend the "I'm his mirror AI" notice ──
        const today = new Date().toISOString().slice(0, 10);
        if (settings.aiDisclaimer && disclaimerSent.get(from) !== today) {
          disclaimerSent.set(from, today);
          await send(settings.disclaimerText);
          // Small spacing so the disclaimer + reply don't merge in WhatsApp
          await new Promise(r => setTimeout(r, 800));
        }
        // ── Voice reply mode: synth via ElevenLabs and send as voice note ──
        let sentAsVoice = false;
        if (settings.voiceCloneEnabled && settings.voiceReplyMode === "auto" && reply.length <= 300) {
          const audio = await synthesizeVoice(reply);
          if (audio) {
            try {
              await sock.sendMessage(from, { audio, mimetype: "audio/mpeg", ptt: true });
              sentAsVoice = true;
              logTag("REPLIED (voice): " + reply.slice(0, 40));
            } catch (e) { logTag("voice_send_err:" + e.message.slice(0,30)); }
          }
        }
        if (!sentAsVoice) {
          await send(reply);
          logTag("REPLIED: " + reply.slice(0, 40));
        }
        // Async fact extraction — fire-and-forget, builds long-term memory
        if (text && text.length > 15) {
          const recentTexts = (convHistory[from] || []).filter(m => m.role === "user").map(m => m.content);
          setImmediate(() => extractFacts(from, recentTexts));
        }
        // Birthday detection
        if (text) maybeRecordBirthday(from, text);
      } catch (err) {
        logTag("err:" + err.message.slice(0, 40));
        console.error("[MFG_bot] AI error:", err.message);
      }
    }
  });

  // ─── Call Handler — block + warn + urgent override ───────────────────────
  sock.ev.on("call", async (calls) => {
    for (const call of calls) {
      if (call.status !== "offer") continue;
      const callerJid = call.from;

      if (settings.callBlock) {
        // Always reject the call
        try { await sock.rejectCall(call.id, callerJid); } catch (e) {}

        // Send a warning text to the caller
        try {
          const callerNum = callerJid.split("@")[0];
          const warningMsg =
            `⚠️ +${callerNum}, MY CREATOR DID NOT AUTHORIZE THIS CALL.\n\n` +
            `KINDLY TEXT THEM AND HE WILL GET BACK TO YOU AS SOON AS POSSIBLE.\n\n` +
            `If this is urgent, reply with "it's urgent" and your call will be reviewed.`;
          await sock.sendMessage(callerJid, { text: warningMsg });
          callWarned.add(callerJid);
          console.log(`[MFG_bot] Call blocked + warned: ${callerJid}`);
        } catch (e) { console.log("[MFG_bot] Call warn error:", e.message); }
      }
    }
  });
}

// ─── Proactive Random Texting ─────────────────────────────────────────────────
// Per-contact cooldown — never text the same person more than once per X minutes
const lastProactiveTo = new Map(); // jid -> timestamp
const PROACTIVE_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between texts to same person
let lastProactiveLog = "not yet started";

function scheduleRandomText() {
  // Check every 10 seconds as requested. Per-contact cooldown prevents spam.
  const delay = 10 * 1000;
  setTimeout(async () => {
    try {
      if (!settings.proactiveText || !settings.onlineMode) { lastProactiveLog = "skip: not in .online mode"; scheduleRandomText(); return; }
      if (!isConnected) { lastProactiveLog = "skip: not connected"; scheduleRandomText(); return; }
      const now = Date.now();
      const eligible = allChats.filter(c =>
        c.id &&
        // private chats only — Baileys 6.x uses @s.whatsapp.net (saved contacts) AND @lid (non-contacts)
        (c.id.endsWith("@s.whatsapp.net") || c.id.endsWith("@lid")) &&
        !c.id.endsWith("@g.us") &&
        !c.id.includes("broadcast") &&
        !c.id.includes("status") &&
        c.id !== OWNER_JID &&
        (now - (lastProactiveTo.get(c.id) || 0)) > PROACTIVE_COOLDOWN_MS
      );
      if (eligible.length === 0) {
        lastProactiveLog = `skip: no eligible (total chats: ${allChats.length})`;
        scheduleRandomText();
        return;
      }
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
      lastProactiveTo.set(target.id, now);
      lastProactiveLog = `${new Date().toISOString().slice(11,19)} → ${target.id.slice(-15)}: "${msg}"`;
      // Save to ownerMessages so AI learns the style
      if (!userData[target.id]) userData[target.id] = {};
      if (!userData[target.id].ownerMessages) userData[target.id].ownerMessages = [];
      userData[target.id].ownerMessages.push(msg);
      setImmediate(() => writeJSON("users.json", userData));
      console.log(`[MFG_bot] Proactive → ${target.id}: "${msg}"`);
    } catch (e) {
      lastProactiveLog = "err: " + e.message;
      console.log("[MFG_bot] Proactive error:", e.message);
    }
    scheduleRandomText();
  }, delay);
}
scheduleRandomText();

// ─── Presence Heartbeat — keep WhatsApp showing "online" when .online mode is on ──
setInterval(async () => {
  if (!isConnected || !sock || !settings.onlineMode) return;
  try { await sock.sendPresenceUpdate("available"); } catch {}
}, 25 * 1000);

// ─── API Endpoints ────────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => res.json({
  connected: isConnected,
  hasQr,
  uptime: Math.floor((Date.now() - startTime) / 1000),
  messageCount,
  chatCount: allChats.length,
  aiEnabled: settings.aiEnabled,
  hasGroqKey: !!process.env.GROQ_API_KEY,
  aiPausedCount: aiPaused.size
}));

// Recent messages log for debugging
app.get("/api/recent", (req, res) => res.json({
  recent: recentMsgLog,
  lastGroqError,
  proactive: { enabled: settings.proactiveText, lastRun: lastProactiveLog, cooldownMs: PROACTIVE_COOLDOWN_MS, totalChats: allChats.length, recentTargets: [...lastProactiveTo.keys()].slice(-10) },
  lastVision: lastVisionResult,
  lastWhisper: lastWhisperResult,
  bigshot: {
    aiDisclaimer: settings.aiDisclaimer,
    transcribeVoice: settings.transcribeVoice,
    visionEnabled: settings.visionEnabled,
    antiScam: settings.antiScam,
    moodAware: settings.moodAware,
    autoTakeover: settings.autoTakeover,
    takeoverMinutes: settings.takeoverMinutes,
    activeTakeovers: ownerTakeover.size,
    contactsWithFacts: Object.keys(contactFacts).length,
    scamAlertsTotal: scamAlerts.length,
    birthdaysTracked: Object.keys(birthdayMemory).length,
    voiceClone: settings.voiceCloneEnabled,
    musicDownload: true
  }
}));

// Diagnostic — tests if Groq actually works on this backend
app.get("/api/diag", async (req, res) => {
  const out = {
    hasGroqKey: !!process.env.GROQ_API_KEY,
    groqKeyLen: (process.env.GROQ_API_KEY || "").length,
    aiEnabled: settings.aiEnabled,
    connected: isConnected,
    aiPausedJids: [...aiPaused.keys()],
    groqTest: null,
    groqError: null
  };
  if (!process.env.GROQ_API_KEY) {
    out.groqError = "GROQ_API_KEY env var is missing on this Railway backend";
    return res.json(out);
  }
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "say hi" }], max_tokens: 10 })
    });
    const j = await r.json();
    if (j.error) out.groqError = j.error.message || JSON.stringify(j.error);
    else out.groqTest = j.choices?.[0]?.message?.content || "empty";
  } catch (e) { out.groqError = e.message; }
  res.json(out);
});

app.get("/api/qr", (req, res) =>
  currentQr ? res.json({ qr: currentQr }) : res.status(404).json({ error: "no qr available" })
);

// Pairing code — restarts the socket in phone-pairing mode (no QR conflict)
// Accepts: POST {phone}  OR  GET ?number=...  OR  GET ?phone=...
async function handlePair(req, res) {
  const raw = req.body?.phone || req.body?.number || req.query?.phone || req.query?.number || "";
  const clean = String(raw).replace(/[^0-9]/g, "");
  if (!clean || clean.length < 10) return res.status(400).json({ error: "send your number with country code, digits only (e.g. 2349132883869)" });
  if (isConnected) return res.status(400).json({ error: "already connected — logout first to re-pair" });

  // CRITICAL: WhatsApp rejects pairing codes if the auth folder has stale creds
  // from a previous (failed/expired) session. Wipe it so the new pairing is fresh.
  try {
    const authPath = process.env.AUTH_PATH || path.join(__dirname, "auth_info_baileys");
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log(`[MFG_bot] /api/pair — wiped stale auth at ${authPath}`);
    }
  } catch (e) { console.log(`[MFG_bot] /api/pair — auth wipe warn: ${e.message}`); }

  // Store the phone so the next connectToWhatsApp() uses pairing mode
  pendingPairPhone = clean;
  hasQr = false; currentQr = null;
  console.log(`[MFG_bot] /api/pair — restarting socket in pairing mode for ${clean}`);

  // Create a Promise that resolves when the pairing code is ready (or times out)
  const codePromise = new Promise((resolve) => {
    pairCodeResolve = resolve;
    setTimeout(() => {
      if (pairCodeResolve) { pairCodeResolve({ success: false, error: "timeout — try again" }); pairCodeResolve = null; }
    }, 30000);
  });

  // Tear down the existing socket to force a fresh connection in pairing mode
  if (sock) {
    try { sock.ev.removeAllListeners(); sock.end(new Error("switching to pairing code")); } catch (e) {}
    sock = null;
  }
  connectToWhatsApp();

  const result = await codePromise;
  if (result.success) {
    const c = result.code;
    const pretty = c && c.length === 8 ? `${c.slice(0,4)}-${c.slice(4)}` : c;
    return res.json({ success: true, ok: true, code: pretty, raw: c, instructions: "WhatsApp → Settings → Linked Devices → Link a device → Link with phone number → enter this code (valid ~60s)" });
  }
  return res.status(500).json({ error: result.error });
}
app.post("/api/pair", handlePair);
app.get("/api/pair", handlePair);

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

// ─── Bots Registry API (replaces Netlify Functions) ─────────────────────────
function readBots() { return readJSON("bots.json", []); }
function writeBots(bots) { writeJSON("bots.json", bots); }

function validateBotInput(input, partial = false) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  const url  = typeof input.url  === "string" ? input.url.trim().slice(0, 500) : "";
  const status = typeof input.status === "string" ? input.status.trim() : "idle";
  const notes  = input.notes === undefined ? undefined : String(input.notes).trim().slice(0, 500);
  const allowed = ["idle", "online", "maintenance"];

  if (!partial || input.name !== undefined) {
    if (!name) return { error: "Bot name is required." };
  }
  if (!partial || input.url !== undefined) {
    try {
      const p = new URL(url);
      if (!["http:", "https:"].includes(p.protocol)) throw new Error("bad protocol");
    } catch { return { error: "Bot URL must be a valid http or https URL." }; }
  }
  if (input.status !== undefined && !allowed.includes(status)) {
    return { error: "Status must be idle, online, or maintenance." };
  }
  return { value: { name, url, status, notes } };
}

app.get("/api/bots", (req, res) => {
  res.json({ bots: readBots() });
});

app.post("/api/bots", (req, res) => {
  const result = validateBotInput(req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  const bot = {
    id: require("crypto").randomUUID(),
    name: result.value.name,
    url:  result.value.url,
    status: result.value.status || "idle",
    notes: result.value.notes ?? "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const bots = [bot, ...readBots()];
  writeBots(bots);
  res.status(201).json({ bot });
});

app.patch("/api/bots/:id", (req, res) => {
  const bots = readBots();
  const idx = bots.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Bot not found." });
  const result = validateBotInput(req.body || {}, true);
  if (result.error) return res.status(400).json({ error: result.error });
  const current = bots[idx];
  const next = {
    ...current,
    name:   result.value.name   || current.name,
    url:    result.value.url    || current.url,
    status: result.value.status || current.status,
    notes:  result.value.notes !== undefined ? result.value.notes : current.notes,
    updated_at: new Date().toISOString(),
  };
  bots[idx] = next;
  writeBots(bots);
  res.json({ bot: next });
});

app.delete("/api/bots/:id", (req, res) => {
  const bots = readBots().filter(b => b.id !== req.params.id);
  writeBots(bots);
  res.status(204).end();
});

// ─── PAYMENT EVENT PROCESSOR — runs on EVERY backend ────────────────────────
// When any backend receives a payment (directly from FLW or forwarded from hub),
// this function checks if it owns the account and updates the balance + WA notify.
async function processPaymentEvent(payload) {
  try {
    const data = payload?.data || {};
    const status = data.status;
    if (status !== "successful") return false; // only process successful payments

    // Always reload from disk so newly-created accounts are visible
    const liveGhostBank = readJSON("ghostBank.json", {});
    // Sync into the in-memory global so commands see the same data
    Object.assign(ghostBankData, liveGhostBank);

    const txRef       = data.tx_ref || data.txRef || "";
    const accountNum  = data.account_number || data.meta?.account_number || "";
    const amount      = Number(data.amount || 0);
    const narration   = data.narration || data.meta?.narration || "";
    const flwRef      = data.flw_ref || data.id || "";
    const now         = new Date();
    const dateStr     = now.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });

    // Find which JID owns this account — match by txRef or account_number
    let ownerJid = null;
    for (const [jid, acct] of Object.entries(ghostBankData)) {
      const matchTxRef  = txRef && acct.txRef === txRef;
      const matchAccNum = accountNum && acct.accountNumber === accountNum;
      if (matchTxRef || matchAccNum) { ownerJid = jid; break; }
    }

    if (!ownerJid) {
      // Not our account — that's fine, another backend will handle it
      console.log(`[Payment] Not our account — txRef:${txRef} acctNum:${accountNum}`);
      return false;
    }

    // Duplicate guard — don't credit the same flwRef twice
    const acct = ghostBankData[ownerJid];
    const txList = acct.transactions || [];
    if (flwRef && txList.some(t => t.flwRef === flwRef)) {
      console.log(`[Payment] Duplicate event ignored — flwRef:${flwRef}`);
      return true; // handled (already processed)
    }

    // Update balance and add transaction
    const prevBalance = Number(acct.balance || 0);
    const newBalance  = prevBalance + amount;
    acct.balance = newBalance;
    acct.transactions = [
      ...txList,
      { type: "credit", amount, flwRef, txRef, narration, date: dateStr, at: now.toISOString() }
    ].slice(-50); // keep last 50 transactions
    writeJSON("ghostBank.json", ghostBankData);

    console.log(`[Payment] ✅ Balance updated for ${ownerJid}: ₦${prevBalance} → ₦${newBalance} (+₦${amount})`);

    // Send WhatsApp notification to account owner
    if (sock && isConnected) {
      try {
        await sock.sendMessage(ownerJid, {
          text: `🏦 *GHOST BANK MFG — Credit Alert!* 💚\n\n━━━━━━━━━━━━━━━━━━━━\n➕ *₦${amount.toLocaleString()}* received\n📝 ${narration || "Transfer"}\n━━━━━━━━━━━━━━━━━━━━\n💰 *New Balance: ₦${newBalance.toLocaleString()}*\n📅 ${dateStr}\n🔖 Ref: ${flwRef || txRef}\n━━━━━━━━━━━━━━━━━━━━\n\n*.pay balance* — check balance\n*.pay history* — transaction history\n\n_GHOST BANK MFG — Powered by teddymfg 🔥_`
        });
        console.log(`[Payment] WA credit alert sent to ${ownerJid}`);
      } catch (e) { console.log("[Payment] WA notify err:", e.message); }
    }

    // Also notify the owner's WhatsApp (the bot owner) about the inbound credit
    if (sock && isConnected && OWNER_NUMBERS.length) {
      const ownerPhone = OWNER_NUMBERS[0].replace(/[^0-9]/g, "");
      const ownerWaJid = `${ownerPhone}@s.whatsapp.net`;
      if (ownerWaJid !== ownerJid) {
        try {
          await sock.sendMessage(ownerWaJid, {
            text: `💸 *GHOST BANK CREDIT*\n\n👤 ${acct.acctName}\n💳 ${acct.accountNumber}\n💰 +₦${amount.toLocaleString()}\n📝 ${narration || "Transfer"}\n🔖 ${flwRef || txRef}\n\nNew balance: ₦${newBalance.toLocaleString()}`
          });
        } catch {}
      }
    }
    return true;
  } catch (e) {
    console.log("[Payment] processPaymentEvent err:", e.message);
    return false;
  }
}

// ── /webhook — endpoint exposed by EACH backend to receive forwarded events ──
// The hub calls this on every backend when a payment arrives.
// Also accepts direct Flutterwave webhooks (no verif-hash check needed here since hub already verified).
app.post("/webhook", express.json(), async (req, res) => {
  res.status(200).json({ status: "ok" }); // reply fast
  const payload = req.body;
  if (!payload) return;
  // If forwarded from hub, payload IS the raw FLW payload
  // If direct from FLW, same structure
  await processPaymentEvent(payload);
});

// ─── FLUTTERWAVE WEBHOOK HUB ─────────────────────────────────────────────────
// Single webhook URL for ALL your backends.
// Flutterwave hits POST /webhook/flutterwave
// This server: 1) verifies the signature, 2) stores the event, 3) forwards to
//              all registered backend URLs instantly, 4) retries any that failed
//              5) exposes a polling endpoint so offline backends can catch up

const WEBHOOK_SECRET = process.env.FLW_WEBHOOK_SECRET || FLW_SECRET.slice(0, 20);
const WEBHOOK_EVENTS_FILE = "webhookEvents.json";
const WEBHOOK_BACKENDS_FILE = "webhookBackends.json";
const MAX_STORED_EVENTS = 500; // rolling window

function readWebhookEvents() { return readJSON(WEBHOOK_EVENTS_FILE, []); }
function writeWebhookEvents(events) { writeJSON(WEBHOOK_EVENTS_FILE, events); }
function readWebhookBackends() { return readJSON(WEBHOOK_BACKENDS_FILE, []); }
function writeWebhookBackends(backends) { writeJSON(WEBHOOK_BACKENDS_FILE, backends); }

// Forward a single event to a single backend URL, returns true/false
async function forwardToBackend(url, event) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-MFG-Forwarded": "1", "X-Event-Id": event.id },
      body: JSON.stringify(event.payload),
      signal: AbortSignal.timeout(10000)
    });
    return r.ok;
  } catch (e) {
    console.log(`[Webhook] Forward failed → ${url}: ${e.message}`);
    return false;
  }
}

// Forward to ALL registered backends, record per-backend delivery status
async function forwardToAllBackends(event) {
  const backends = readWebhookBackends();
  if (!backends.length) return;
  const results = await Promise.allSettled(backends.map(b => forwardToBackend(b.url, event)));
  const events = readWebhookEvents();
  const ev = events.find(e => e.id === event.id);
  if (ev) {
    ev.deliveries = backends.map((b, i) => ({
      url: b.url,
      name: b.name,
      ok: results[i].status === "fulfilled" && results[i].value === true,
      at: new Date().toISOString()
    }));
    writeWebhookEvents(events);
    console.log(`[Webhook] Forwarded to ${backends.length} backends:`, ev.deliveries.map(d => `${d.name}:${d.ok ? "✅" : "❌"}`).join(" "));
  }
}

// ── Receive webhook from Flutterwave ────────────────────────────────────────
app.post("/webhook/flutterwave", express.json(), async (req, res) => {
  // Verify Flutterwave signature hash
  const hash = req.headers["verif-hash"];
  if (hash && WEBHOOK_SECRET && hash !== WEBHOOK_SECRET) {
    console.log("[Webhook] ❌ Invalid signature hash");
    return res.status(401).json({ error: "invalid signature" });
  }

  const payload = req.body;
  const eventId = `flw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const event = {
    id: eventId,
    receivedAt: new Date().toISOString(),
    type: payload?.event || "unknown",
    status: payload?.data?.status || "unknown",
    amount: payload?.data?.amount,
    currency: payload?.data?.currency,
    txRef: payload?.data?.tx_ref || payload?.data?.txRef,
    flwRef: payload?.data?.flw_ref,
    customerEmail: payload?.data?.customer?.email,
    customerName: payload?.data?.customer?.name,
    customerPhone: payload?.data?.customer?.phone_number,
    payload,
    deliveries: []
  };

  // Store event (rolling window of MAX_STORED_EVENTS)
  let events = readWebhookEvents();
  events.unshift(event);
  if (events.length > MAX_STORED_EVENTS) events = events.slice(0, MAX_STORED_EVENTS);
  writeWebhookEvents(events);

  console.log(`[Webhook] ✅ Received: ${event.type} | ${event.status} | ₦${event.amount} | ref:${event.txRef}`);

  // Acknowledge Flutterwave immediately (must reply fast)
  res.status(200).json({ status: "ok", id: eventId });

  // Async: process locally + forward to all backends
  setImmediate(async () => {
    // 1. Try to handle it on THIS backend first (update balance if we own the account)
    const handledLocally = await processPaymentEvent(payload);

    // 2. Forward raw payload to all other registered backends
    await forwardToAllBackends(event);

    // 3. If NOT handled locally (another backend owns it) — still notify owner about inbound payment
    if (!handledLocally && event.status === "successful" && sock && isConnected && OWNER_NUMBERS.length) {
      const ownerJid = `${OWNER_NUMBERS[0].replace(/[^0-9]/g, "")}@s.whatsapp.net`;
      const backends = readWebhookBackends();
      const fwdStatus = backends.length
        ? `\n📡 Forwarded to ${backends.length} backend${backends.length > 1 ? "s" : ""}`
        : "\n⚠️ No backends registered yet";
      try {
        await sock.sendMessage(ownerJid, {
          text: `💸 *PAYMENT RECEIVED!*\n\n━━━━━━━━━━━━━━━━━━━━\n💰 Amount: *₦${(event.amount || 0).toLocaleString()}*\n👤 From: ${event.customerName || "Unknown"}\n📱 Phone: ${event.customerPhone || "—"}\n📧 ${event.customerEmail || "—"}\n🔖 Ref: ${event.txRef || "—"}\n━━━━━━━━━━━━━━━━━━━━${fwdStatus}\n\n_GHOST BANK MFG 🔥_`
        });
      } catch (e) { console.log("[Webhook] WA notify err:", e.message); }
    }
  });
});

// ── Polling endpoint — backends call this to fetch events they missed ────────
// GET /webhook/events?since=<ISO timestamp or event id>&limit=50&secret=<key>
app.get("/webhook/events", (req, res) => {
  const secret = req.query.secret || req.headers["x-webhook-secret"];
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ error: "invalid secret" });

  const events = readWebhookEvents();
  const since = req.query.since;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  let filtered = events;
  if (since) {
    // since can be an ISO timestamp or an event ID
    if (since.startsWith("flw_")) {
      const idx = events.findIndex(e => e.id === since);
      filtered = idx === -1 ? [] : events.slice(0, idx);
    } else {
      const sinceDate = new Date(since).getTime();
      filtered = events.filter(e => new Date(e.receivedAt).getTime() > sinceDate);
    }
  }

  res.json({
    events: filtered.slice(0, limit),
    total: filtered.length,
    latest: events[0]?.id || null
  });
});

// ── Webhook backends registry ────────────────────────────────────────────────
// GET /webhook/backends — list all registered backends
app.get("/webhook/backends", (req, res) => {
  const secret = req.query.secret || req.headers["x-webhook-secret"];
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ error: "invalid secret" });
  res.json({ backends: readWebhookBackends() });
});

// POST /webhook/backends — register a new backend
// Body: { name, url, secret? }
app.post("/webhook/backends", (req, res) => {
  const secret = req.query.secret || req.headers["x-webhook-secret"] || req.body?.adminSecret;
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ error: "invalid secret" });

  const { name, url } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: "name and url required" });
  try { new URL(url); } catch { return res.status(400).json({ error: "invalid url" }); }

  const backends = readWebhookBackends();
  if (backends.find(b => b.url === url)) return res.status(409).json({ error: "url already registered" });

  const backend = { id: require("crypto").randomUUID(), name, url, addedAt: new Date().toISOString() };
  backends.push(backend);
  writeWebhookBackends(backends);
  console.log(`[Webhook] Backend registered: ${name} → ${url}`);
  res.status(201).json({ backend, webhookUrl: `https://${process.env.REPLIT_DEV_DOMAIN || "your-replit-url"}/webhook/flutterwave` });
});

// DELETE /webhook/backends/:id — remove a backend
app.delete("/webhook/backends/:id", (req, res) => {
  const secret = req.query.secret || req.headers["x-webhook-secret"];
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ error: "invalid secret" });
  const backends = readWebhookBackends().filter(b => b.id !== req.params.id);
  writeWebhookBackends(backends);
  res.json({ success: true });
});

// ── Webhook dashboard (quick overview) ───────────────────────────────────────
app.get("/webhook/status", (req, res) => {
  const events = readWebhookEvents();
  const backends = readWebhookBackends();
  const successful = events.filter(e => e.status === "successful").length;
  const totalAmount = events.filter(e => e.status === "successful").reduce((s, e) => s + (e.amount || 0), 0);
  const domain = process.env.REPLIT_DEV_DOMAIN || req.headers.host || "your-replit-url";
  const hubUrl = `https://${domain}/webhook/flutterwave`;
  res.json({
    hub: {
      webhookUrl: hubUrl,
      instruction: `Set this as your SINGLE Flutterwave webhook URL. It forwards to all backends automatically.`,
      flutterwaveDashboard: "flutterwave.com → Settings → Webhooks → paste the URL above"
    },
    backends: {
      registered: backends.length,
      list: backends.map(b => ({ id: b.id, name: b.name, url: b.url, addedAt: b.addedAt })),
      howToRegister: `POST /webhook/backends with { "name": "MyBackend", "url": "https://your-backend.com/webhook", "adminSecret": "${WEBHOOK_SECRET.slice(0,8)}..." }`
    },
    events: {
      totalStored: events.length,
      successfulPayments: successful,
      totalAmountReceived: `₦${totalAmount.toLocaleString()}`,
      latest: events[0] ? { id: events[0].id, type: events[0].type, status: events[0].status, amount: events[0].amount, at: events[0].receivedAt } : null
    },
    polling: {
      endpoint: `GET /webhook/events?secret=YOUR_SECRET&since=LAST_EVENT_ID&limit=50`,
      use: "Call this on backend startup to catch any payments missed while offline"
    }
  });
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

// ─── Anti-Sleep Keep-Alive (Railway / Replit) ────────────────────────────────
// Ping ourselves every 2 minutes so the process never idles out on Railway.
// Railway free tier sleeps after ~30min of no traffic — this prevents that.
setInterval(() => {
  const p = process.env.PORT || 5000;
  fetch(`http://localhost:${p}/api/status`).catch(() => {});
}, 2 * 60 * 1000);

// ─── WhatsApp Connection Watchdog ────────────────────────────────────────────
// If we know the socket exists but isConnected has been false for >3 min,
// the connection silently died (Railway network blip, WA server timeout, etc.).
// Force a fresh reconnect rather than waiting forever.
let lastConnectedAt = Date.now();
setInterval(() => {
  if (isConnected) { lastConnectedAt = Date.now(); return; }
  const gapMs = Date.now() - lastConnectedAt;
  if (gapMs > 3 * 60 * 1000) {
    console.log(`[MFG_bot] Watchdog: disconnected for ${Math.round(gapMs/1000)}s — forcing reconnect`);
    lastConnectedAt = Date.now(); // reset so we don't spam
    try { if (sock) sock.end(new Error("watchdog_reconnect")); } catch {}
    setTimeout(connectToWhatsApp, 2000);
  }
}, 60 * 1000);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[MFG_bot] Server running on port ${PORT}`);
  connectToWhatsApp();

  // ─── Hub Self-Registration ────────────────────────────────────────────────
  // Register this backend with the hub so it receives forwarded payments.
  // Uses REPLIT_DEV_DOMAIN when available (Replit), falls back to localhost.
  const HUB_SECRET = (process.env.FLW_SECRET_KEY || "").slice(0, 20);
  const selfDomain = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : `http://localhost:${PORT}`;
  const HUB_URL = selfDomain; // this server is the hub

  fetch(`${HUB_URL}/webhook/backends`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: process.env.BOT_NAME || "Local Bot",
      url: `${selfDomain}/webhook`,
      adminSecret: HUB_SECRET
    })
  })
    .then(r => r.json())
    .then(d => console.log("[Hub] Self-registered:", d.backend?.name || d.error || d))
    .catch(e => console.log("[Hub] Self-registration failed:", e.message));

  // ─── Catch-up: replay any payments missed while offline ──────────────────
  setTimeout(() => {
    fetch(`${HUB_URL}/webhook/events?secret=${HUB_SECRET}&limit=50`)
      .then(r => r.json())
      .then(d => {
        const events = d.events || [];
        if (!events.length) return;
        console.log(`[Hub] Replaying ${events.length} missed payment event(s)...`);
        events.forEach(e =>
          fetch(`http://localhost:${PORT}/webhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-MFG-Forwarded": "1", "X-Event-Id": e.id },
            body: JSON.stringify(e.payload)
          }).catch(() => {})
        );
      })
      .catch(e => console.log("[Hub] Catch-up poll failed:", e.message));
  }, 3000); // wait 3s so WhatsApp connection is ready before we fire alerts
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
