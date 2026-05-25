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

const CONFIG_FILE  = path.join(__dirname, "data", "tg_config.json");
const SESSION_FILE = path.join(__dirname, "data", "tg_session.json");

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

const TG_RATE    = 30;        // messages per minute (safe for userbot)
const TG_DELAY   = Math.ceil(60000 / TG_RATE);  // ms between messages

/**
 * Parse a VCF string into [{phone, name}]
 */
function parseVCF(vcfText) {
  const contacts = [];
  const cards    = vcfText.split(/END:VCARD/i);
  for (const card of cards) {
    const nameMatch  = card.match(/FN:(.*)/i);
    const phoneMatch = card.match(/TEL[^:]*:([\d+\s\-().]+)/i);
    if (phoneMatch) {
      let phone = phoneMatch[1].replace(/\s/g, "").replace(/[^\d+]/g, "");
      if (!phone.startsWith("+")) phone = "+" + phone;
      const name = nameMatch ? nameMatch[1].trim() : phone;
      if (phone.length >= 7) contacts.push({ phone, name });
    }
  }
  return contacts;
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

  tgCampaign = {
    active:    true,
    contacts,
    index:     0,
    message,
    sent:      0,
    failed:    0,
    startTime: Date.now(),
    timer:     null,
    onUpdate,
  };

  await onUpdate(`🚀 *Telegram Campaign Started*\n📋 Contacts: ${contacts.length}\n⏱ Rate: ${TG_RATE}/min\n🕐 Est. time: ~${Math.ceil(contacts.length / TG_RATE)} min\n\nSend *.tg stop* to cancel`);
  _sendNext();
}

async function _sendNext() {
  if (!tgCampaign.active) return;
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
    const entity = await tgClient.getInputEntity(phone);
    await tgClient.sendMessage(entity, { message: personalised });
    tgCampaign.sent++;

    // Milestone notifications every 50 or at 10%
    const total = contacts.length;
    if (tgCampaign.sent % 50 === 0 || (total >= 10 && tgCampaign.sent === Math.floor(total * 0.1))) {
      await onUpdate(`📊 Campaign progress: ${tgCampaign.sent}/${total} sent (${Math.round(tgCampaign.sent/total*100)}%)`);
    }
  } catch (err) {
    tgCampaign.failed++;
    // Only log every 10th failure to avoid spam
    if (tgCampaign.failed % 10 === 1) {
      await onUpdate(`⚠️ Failed to send to ${phone}: ${err.message}`);
    }
  }

  tgCampaign.timer = setTimeout(_sendNext, TG_DELAY);
}

function stopCampaign() {
  if (!tgCampaign.active) return false;
  clearTimeout(tgCampaign.timer);
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
};
