/**
 * telegram_bot.js — Telegram MTProto userbot for MFG_bot
 * Controls: bulk campaigns, status reports, all via WhatsApp .tg commands
 */

const { TelegramClient } = require("telegram");
const { StringSession }  = require("telegram/sessions");
const { NewMessage }     = require("telegram/events");
const input              = require("input");
const fs                 = require("fs");
const path               = require("path");

const TG_DATA_DIR  = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(TG_DATA_DIR)) fs.mkdirSync(TG_DATA_DIR, { recursive: true });
const CONFIG_FILE  = path.join(TG_DATA_DIR, "tg_config.json");
const SESSION_FILE = path.join(TG_DATA_DIR, "tg_session.json");

// ─── helpers ───────────────────────────────────────────────────────────────

function readJSON(file, def = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return def; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── state ─────────────────────────────────────────────────────────────────

let tgClient   = null;
let tgConfig   = readJSON(CONFIG_FILE, {});
let tgSession  = readJSON(SESSION_FILE, { session: "" });

// Pending login resolvers — filled by interactive WhatsApp commands
const pending = {
  phoneCode: null,   // resolve fn waiting for .tg code <xxx>
  password:  null,   // resolve fn waiting for .tg 2fa <xxx>
};

// Campaign state
let tgCampaign = {
  active:     false,
  contacts:   [],    // [{ phone, name }]
  index:      0,
  message:    "",
  sent:       0,
  failed:     0,
  startTime:  null,
  timer:      null,
  runId:      0,
  floodWait:  0,
};

// ─── getters ───────────────────────────────────────────────────────────────

function getConfig() { return tgConfig; }
function isConnected() { return tgClient && tgClient.connected; }

function getApiId() {
  if (process.env.TG_API_ID) return parseInt(process.env.TG_API_ID);
  if (tgConfig.apiId)        return parseInt(tgConfig.apiId);
  // Re-read from disk in case the file was written after module load
  try { const d = JSON.parse(fs.readFileSync(CONFIG_FILE,"utf8")); if (d.apiId) { tgConfig = d; return parseInt(d.apiId); } } catch {}
  return 0;
}
function getApiHash() {
  if (process.env.TG_API_HASH) return process.env.TG_API_HASH;
  if (tgConfig.apiHash)        return tgConfig.apiHash;
  try { const d = JSON.parse(fs.readFileSync(CONFIG_FILE,"utf8")); if (d.apiHash) { tgConfig = d; return d.apiHash; } } catch {}
  return "";
}

// ─── save helpers ──────────────────────────────────────────────────────────

function saveConfig(patch) {
  tgConfig = { ...tgConfig, ...patch };
  writeJSON(CONFIG_FILE, tgConfig);
}

function saveSession(str) {
  tgSession.session = str;
  writeJSON(SESSION_FILE, tgSession);
}

// ─── connect ───────────────────────────────────────────────────────────────

/**
 * Start (or re-connect) the Telegram client.
 * If no session exists, kicks off the interactive login flow that is
 * driven by .tg code / .tg 2fa commands from WhatsApp.
 *
 * @param {function} notifyOwner  async fn(text) — sends a WA message to the owner
 * @param {string}   phone        owner's Telegram phone number, e.g. "+2349132883869"
 */
async function connect(notifyOwner, phone) {
  const apiId   = getApiId();
  const apiHash = getApiHash();

  if (!apiId || !apiHash) {
    await notifyOwner("❌ Telegram not configured. Send:\n.tg setup <API_ID>\n\nGet your API ID from: my.telegram.org/apps");
    return { ok: false, reason: "missing credentials" };
  }

  const session = new StringSession(tgSession.session || "");
  tgClient = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true,
  });

  try {
    await tgClient.start({
      phoneNumber: async () => phone,
      phoneCode:   async () => {
        await notifyOwner("📲 Telegram sent you a login code.\nSend: .tg code <the 5-digit code>");
        return await new Promise(resolve => { pending.phoneCode = resolve; });
      },
      password: async () => {
        await notifyOwner("🔐 2FA enabled on your Telegram. Send your cloud password:\n.tg 2fa <your_password>");
        return await new Promise(resolve => { pending.password = resolve; });
      },
      onError: (err) => {
        notifyOwner(`❌ Telegram login error: ${err.message}`);
      },
    });

    // Save session so next restart skips login
    saveSession(tgClient.session.save());
    await notifyOwner("✅ Telegram connected! Your session is saved — no re-login needed on restarts.\n\nAvailable commands:\n.tg status — connection info\n.tg campaign — start bulk campaign\n.tg me — your Telegram info");
    return { ok: true };
  } catch (err) {
    tgClient = null;
    await notifyOwner(`❌ Telegram connection failed: ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

/**
 * Auto-reconnect on startup if a saved session exists.
 */
async function autoConnect(notifyOwner) {
  if (!tgSession.session) return;
  const apiId   = getApiId();
  const apiHash = getApiHash();
  if (!apiId || !apiHash) return;

  const session = new StringSession(tgSession.session);
  tgClient = new TelegramClient(session, apiId, apiHash, { connectionRetries: 3 });

  try {
    await tgClient.connect();
    console.log("[TG] Auto-reconnected from saved session");
  } catch (err) {
    console.log("[TG] Auto-connect failed:", err.message);
    tgClient = null;
  }
}

// ─── resolve pending login prompts ─────────────────────────────────────────

function resolveCode(code) {
  if (pending.phoneCode) { pending.phoneCode(code); pending.phoneCode = null; return true; }
  return false;
}

function resolve2FA(password) {
  if (pending.password) { pending.password(password); pending.password = null; return true; }
  return false;
}

// ─── me / status ───────────────────────────────────────────────────────────

async function getMe() {
  if (!isConnected()) return null;
  try { return await tgClient.getMe(); } catch { return null; }
}

// ─── campaign ──────────────────────────────────────────────────────────────

const TG_RATE = 4; // server-side estimate; actual pacing is randomized 15–30s
const MIN_SEND_DELAY_MS = 15_000;
const MAX_SEND_DELAY_MS = 30_000;

function campaignIsCurrent(runId) {
  return tgCampaign.active && tgCampaign.runId === runId;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse a VCF string into [{phone, name}]
 */
function parseVCF(vcfText) {
  const contacts = new Map();
  const cards    = vcfText.split(/END:VCARD/i);
  for (const card of cards) {
    const nameMatch  = card.match(/FN:(.*)/i);
    for (const phoneMatch of card.matchAll(/TEL[^:]*:([\d+\s\-().]+)/gi)) {
      const digits = phoneMatch[1].replace(/\D/g, "");
      // VCF imports for this campaign are intentionally limited to valid
      // North American +1 numbers and are deduplicated server-side.
      if (digits.length !== 11 || !digits.startsWith("1")) continue;
      const phone = `+1${digits.slice(1)}`;
      if (!contacts.has(phone)) {
        contacts.set(phone, {
          phone,
          name: nameMatch ? nameMatch[1].trim() : phone,
        });
      }
    }
  }
  return [...contacts.values()];
}

/**
 * Start a Telegram campaign.
 * @param {string[]} phones    array of phone numbers with country code
 * @param {string}   message   message text
 * @param {function} onUpdate  fn(update) called with progress / errors
 */
async function startCampaign(contacts, message, onUpdate) {
  if (!isConnected()) { await onUpdate("❌ Telegram not connected. Send .tg connect first."); return; }
  if (tgCampaign.active) { await onUpdate("⚠️ A campaign is already running. Send .tg stop to cancel it first."); return; }

  const uniqueContacts = [];
  const seen = new Set();
  for (const contact of contacts) {
    const rawPhone = String(contact?.phone || "").trim();
    if (!rawPhone) continue;
    const phone = rawPhone.startsWith("@")
      ? rawPhone.toLowerCase()
      : rawPhone.replace(/[^\d+]/g, "");
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    uniqueContacts.push({
      ...contact,
      phone,
      name: String(contact?.name || phone),
    });
  }
  if (!uniqueContacts.length) {
    await onUpdate("❌ No valid contacts were supplied.");
    return;
  }

  const runId = (tgCampaign.runId || 0) + 1;
  tgCampaign = {
    active:    true,
    contacts:  uniqueContacts,
    index:     0,
    message,
    sent:      0,
    failed:    0,
    startTime: Date.now(),
    timer:     null,
    onUpdate,
    runId,
    floodWait: 0,
  };

  await onUpdate(`🚀 *Telegram Campaign Started*\n📋 Contacts: ${uniqueContacts.length}\n⏱ Rate: ${TG_RATE}/min maximum\n🕐 Est. time: ~${Math.ceil(uniqueContacts.length / TG_RATE)} min\n\nSend *.tg stop* to cancel`);
  _sendNext(runId);
}

async function _sendNext(runId = tgCampaign.runId) {
  if (!campaignIsCurrent(runId)) return;
  const { contacts, index, message, onUpdate } = tgCampaign;

  if (index >= contacts.length) {
    // Done
    tgCampaign.active = false;
    const elapsed = Math.round((Date.now() - tgCampaign.startTime) / 60000);
    await onUpdate(`✅ *Telegram Campaign Complete*\n✔️ Sent: ${tgCampaign.sent}\n❌ Failed: ${tgCampaign.failed}\n⏱ Time: ~${elapsed} min`);
    return;
  }

  const { phone, name } = contacts[index];
  tgCampaign.index++;

  // Personalize message
  const personalised = message.replace(/\{name\}/gi, name);

  try {
    // Delay before lookup as well as between messages, including the first
    // message after start. This prevents an initial burst.
    const delay = Math.floor(Math.random() * (MAX_SEND_DELAY_MS - MIN_SEND_DELAY_MS + 1)) + MIN_SEND_DELAY_MS;
    await sleep(delay);
    if (!campaignIsCurrent(runId)) return;

    const entity = await tgClient.getInputEntity(phone);
    if (!campaignIsCurrent(runId)) return;
    await tgClient.sendMessage(entity, { message: personalised });
    tgCampaign.sent++;

    // Milestone notifications every 50 or at 10%
    const total = contacts.length;
    if (tgCampaign.sent % 50 === 0 || (total >= 10 && tgCampaign.sent === Math.floor(total * 0.1))) {
      await onUpdate(`📊 Campaign progress: ${tgCampaign.sent}/${total} sent (${Math.round(tgCampaign.sent/total*100)}%)`);
    }
  } catch (err) {
    if (!campaignIsCurrent(runId)) return;
    const errorText = err?.errorMessage || err?.message || String(err);
    const isThrottle = /FLOOD_WAIT|PEER_FLOOD|SLOWMODE_WAIT|TOO_MANY_REQUESTS|RATE_LIMIT/i.test(errorText) || Number.isFinite(err?.seconds);
    if (isThrottle) {
      const waitSeconds = Number(err?.seconds) || 60;
      tgCampaign.floodWait = waitSeconds;
      tgCampaign.active = false;
      clearTimeout(tgCampaign.timer);
      await onUpdate(`⏹ Telegram throttled this account (${errorText}). Campaign stopped; no automatic retry.`);
      return;
    }
    tgCampaign.failed++;
    // Only log every 10th failure to avoid spam
    if (tgCampaign.failed % 10 === 1) {
      await onUpdate(`⚠️ Failed to send to ${phone}: ${errorText}`);
    }
  }

  if (campaignIsCurrent(runId)) {
    tgCampaign.timer = setTimeout(() => _sendNext(runId), 0);
  }
}

function stopCampaign() {
  if (!tgCampaign.active) return false;
  clearTimeout(tgCampaign.timer);
  tgCampaign.runId = (tgCampaign.runId || 0) + 1;
  tgCampaign.active = false;
  return true;
}

function getCampaignStatus() {
  if (!tgCampaign.active) return null;
  const total   = tgCampaign.contacts.length;
  const done    = tgCampaign.sent + tgCampaign.failed;
  const elapsed = Math.round((Date.now() - tgCampaign.startTime) / 60000);
  const remain  = Math.ceil((total - done) / TG_RATE);
  return {
    total, sent: tgCampaign.sent, failed: tgCampaign.failed,
    elapsed, remain,
    percent: Math.round(done / total * 100),
  };
}

// ─── disconnect ────────────────────────────────────────────────────────────

async function disconnect() {
  stopCampaign();
  if (tgClient) {
    try { await tgClient.disconnect(); } catch {}
    tgClient = null;
  }
}

// ─── exports ───────────────────────────────────────────────────────────────

module.exports = {
  connect, autoConnect, disconnect,
  isConnected, getMe, getConfig, getApiId, getApiHash,
  saveConfig,
  resolveCode, resolve2FA,
  startCampaign, stopCampaign, getCampaignStatus, parseVCF,
  _getClient: () => tgClient,
};
