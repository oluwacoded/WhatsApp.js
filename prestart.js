const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SERVER_PATH = path.join(__dirname, 'server.js');
const BACKUP_PATH = path.join(__dirname, 'server.js.bak');

function safeWrite(file, content) {
  fs.writeFileSync(file, content, 'utf8');
}

function backup(orig, backup) {
  try {
    if (!fs.existsSync(backup)) fs.copyFileSync(orig, backup);
  } catch (e) { console.error('backup failed:', e.message); }
}

function patchServer() {
  let src = fs.readFileSync(SERVER_PATH, 'utf8');

  // 1) Ensure CORS is enabled after express app creation
  src = src.replace(/const app = express\(\);/, `const app = express();\n// Enable CORS for frontend access to /api endpoints (esp. /api/qr)\ntry { const cors = require('cors'); app.use(cors()); } catch (e) { /* cors not installed */ }`);

  // 2) Add proactive configuration & counters after PROACTIVE_COOLDOWN_MS declaration
  src = src.replace(/const PROACTIVE_COOLDOWN_MS = 30 \* 60 \* 1000; \/\/ 30 min between texts to same person\nlet lastProactiveLog = "not yet started";/,
`const PROACTIVE_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between texts to same person
// Proactive texting tuning (env overrides)
const PROACTIVE_CHECK_INTERVAL_MS = Number(process.env.PROACTIVE_CHECK_INTERVAL_MS) || 60 * 1000; // default every 60s
const PROACTIVE_RECENT_DAYS = Number(process.env.PROACTIVE_RECENT_DAYS) || 14; // only target chats with activity in last N days
const PROACTIVE_DAILY_LIMIT = Number(process.env.PROACTIVE_DAILY_LIMIT) || 2; // max proactive msgs per contact per day
let lastProactiveLog = "not yet started";
// In-memory daily counters: jid -> { date: 'YYYY-MM-DD', count: N }
const lastProactiveCounts = new Map();`);

  // 3) Replace the small delay constant inside scheduleRandomText (was 10 * 1000)
  src = src.replace(/const delay = 10 \* 1000;/g, 'const delay = PROACTIVE_CHECK_INTERVAL_MS;');

  // 4) Strengthen eligible filter to include recent activity check
  src = src.replace(/const eligible = allChats.filter\(c =>\n\s+c.id &&[\s\S]*?\n\s+\(now - \(lastProactiveTo.get\(c.id\) \|\| 0\)\) > PROACTIVE_COOLDOWN_MS\n\s+\);/,
`const RECENT_ACTIVITY_MS = PROACTIVE_RECENT_DAYS * 24 * 60 * 60 * 1000;
      const eligible = allChats.filter(c =>
        c.id &&
        // private chats only — Baileys 6.x uses @s.whatsapp.net (saved contacts) AND @lid (non-contacts)
        (c.id.endsWith("@s.whatsapp.net") || c.id.endsWith("@lid")) &&
        !c.id.endsWith("@g.us") &&
        !c.id.includes("broadcast") &&
        !c.id.includes("status") &&
        c.id !== OWNER_JID &&
        (now - (lastProactiveTo.get(c.id) || 0)) > PROACTIVE_COOLDOWN_MS &&
        // require recent chat activity (avoid messaging old/backlog-only chats)
        (now - ((c.conversationTimestamp || 0) * 1000)) < RECENT_ACTIVITY_MS
      );`);

  // 5) Before sending, enforce daily limit and prefer ownerMessages
  src = src.replace(/const msg = openers\[Math.floor\(Math.random\(\) \* openers.length\)\];\n\s+await sock.sendMessage\(target.id, \{ text: msg \}\);\n\s+lastProactiveTo.set\(target.id, now\);/,
`// enforce daily per-contact limit
      const today = new Date().toISOString().slice(0,10);
      const cntObj = lastProactiveCounts.get(target.id) || { date: today, count: 0 };
      if (cntObj.date !== today) { cntObj.date = today; cntObj.count = 0; }
      if (cntObj.count >= PROACTIVE_DAILY_LIMIT) {
        lastProactiveLog = `skip: daily limit for ${target.id.slice(-15)}`;
        scheduleRandomText();
        return;
      }

      // Prefer owner's past messages to this contact as openers (if available)
      const ownerMsgs = (userData[target.id]?.ownerMessages || []);
      let msg;
      if (ownerMsgs.length && Math.random() < 0.7) {
        msg = ownerMsgs[Math.floor(Math.random() * ownerMsgs.length)];
      } else {
        msg = openers[Math.floor(Math.random() * openers.length)];
      }

      await sock.sendMessage(target.id, { text: msg });
      // update counters
      cntObj.count++;
      lastProactiveCounts.set(target.id, cntObj);
      lastProactiveTo.set(target.id, now);`);

  // 6) Skip proactive sends in the first minute after a fresh connection
  // Find the place where scheduleRandomText checks isConnected; insert an additional guard
  src = src.replace(/if \(!settings.proactiveText \|\| !settings.onlineMode\) \{ lastProactiveLog = "skip: not in \.online mode"; scheduleRandomText\(\); return; \}/,
`if (!settings.proactiveText || !settings.onlineMode) { lastProactiveLog = "skip: not in .online mode"; scheduleRandomText(); return; }
      // avoid proactive sends during immediate post-connect replay windows
      if (Date.now() - (lastConnectedAt || 0) < (Number(process.env.PROACTIVE_POST_CONNECT_SILENCE_MS) || 60 * 1000)) {
        lastProactiveLog = "skip: post-connect silence";
        scheduleRandomText(); return;
      }`);

  // 7) Ensure lastConnectedAt variable exists near bot state. Insert if missing after "let sock = null" block
  if (!/let lastConnectedAt =/.test(src)) {
    src = src.replace(/let sock = null, currentQr = null, isConnected = false, hasQr = false;/,
`let sock = null, currentQr = null, isConnected = false, hasQr = false;
let lastConnectedAt = 0;`);
  }

  // 8) Update connection.open handler to set lastConnectedAt = Date.now()
  src = src.replace(/if \(connection === "open"\) \{[\s\S]*?console.log\("\[MFG_bot\] Connected to WhatsApp"\);/, (m) => {
    return m + '\n      lastConnectedAt = Date.now();';
  });

  // 9) Ensure /api/qr has CORS header — replace its handler
  src = src.replace(/app.get\("\/api\/qr", \(req, res\) =>\n  currentQr \? res.json\(\{ qr: currentQr \}\) : res.status\(404\).json\(\{ error: "no qr available" \}\)\n\);/,
`app.get("/api/qr", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (currentQr) return res.json({ qr: currentQr });
  return res.status(404).json({ error: "no qr available" });
});`);

  // 10) Append /api/regen-qr endpoint after pairing handlers if not present
  if (!/\/api\/regen-qr/.test(src)) {
    const regenCode = `\n// POST /api/regen-qr — wipe auth and restart socket to force fresh QR (requires confirm=yes)\napp.post('/api/regen-qr', async (req, res) => {\n  const c = req.query.confirm || req.body?.confirm;\n  if (String(c) !== 'yes') return res.status(400).json({ error: 'require confirm=yes to avoid accidental wipe' });\n  try {\n    const authPath = process.env.AUTH_PATH || path.join(__dirname, 'auth_info_baileys');\n    if (fs.existsSync(authPath)) { fs.rmSync(authPath, { recursive: true, force: true }); console.log('[MFG_bot] /api/regen-qr — wiped auth folder'); }\n    if (sock) { try { sock.ev.removeAllListeners(); sock.end(new Error('regen-qr requested')); } catch (e) {} sock = null; }\n    // restart socket — connectToWhatsApp will generate QR when ready\n    setTimeout(connectToWhatsApp, 1000);\n    return res.json({ success: true, message: 'auth wiped, restarting socket to generate QR' });\n  } catch (e) { return res.status(500).json({ error: e.message }); }\n});\n`;
    // place near end before Start or append
    src = src.replace(/\/\/ ─── Start ────────────────────────────────────────────────────────────────────[\s\S]*/, (m) => regenCode + '\n' + m);
  }

  return src;
}

try {
  if (!fs.existsSync(SERVER_PATH)) {
    console.error('server.js not found — aborting patch');
    process.exit(1);
  }
  backup(SERVER_PATH, BACKUP_PATH);
  const patched = patchServer();
  safeWrite(SERVER_PATH, patched);
  console.log('server.js patched successfully. launching server...');

  // start the original server
  const child = spawn(process.execPath, [SERVER_PATH], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code));
} catch (e) {
  console.error('prestart failed:', e.message);
  process.exit(1);
}
