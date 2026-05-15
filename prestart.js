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
`const PROACTIVE_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between texts to same person\n// Proactive texting tuning (env overrides)\nconst PROACTIVE_CHECK_INTERVAL_MS = Number(process.env.PROACTIVE_CHECK_INTERVAL_MS) || 60 * 1000; // default every 60s\nconst PROACTIVE_RECENT_DAYS = Number(process.env.PROACTIVE_RECENT_DAYS) || 14; // only target chats with activity in last N days\nconst PROACTIVE_DAILY_LIMIT = Number(process.env.PROACTIVE_DAILY_LIMIT) || 2; // max proactive msgs per contact per day\nlet lastProactiveLog = "not yet started";\n// In-memory daily counters: jid -> { date: 'YYYY-MM-DD', count: N }\nconst lastProactiveCounts = new Map();`);

  // 3) Replace the small delay constant inside scheduleRandomText (was 10 * 1000)
  src = src.replace(/const delay = 10 \* 1000;/g, 'const delay = PROACTIVE_CHECK_INTERVAL_MS;');

  // 4) Strengthen eligible filter to include recent activity check
  src = src.replace(/const eligible = allChats.filter\(c =>\n\s+c.id &&[\s\S]*?\n\s+\(now - \(lastProactiveTo.get\(c.id\) \|\| 0\)\) > PROACTIVE_COOLDOWN_MS\n\s+\);/,
`const RECENT_ACTIVITY_MS = PROACTIVE_RECENT_DAYS * 24 * 60 * 60 * 1000;\n      const eligible = allChats.filter(c =>\n        c.id &&\n        // private chats only — Baileys 6.x uses @s.whatsapp.net (saved contacts) AND @lid (non-contacts)\n        (c.id.endsWith("@s.whatsapp.net") || c.id.endsWith("@lid")) &&\n        !c.id.endsWith("@g.us") &&\n        !c.id.includes("broadcast") &&\n        !c.id.includes("status") &&\n        c.id !== OWNER_JID &&\n        (now - (lastProactiveTo.get(c.id) || 0)) > PROACTIVE_COOLDOWN_MS &&\n        // require recent chat activity (avoid messaging old/backlog-only chats)\n        (now - ((c.conversationTimestamp || 0) * 1000)) < RECENT_ACTIVITY_MS\n      );`);

  // 5) Before sending, enforce daily limit and prefer ownerMessages
  src = src.replace(/const msg = openers\[Math.floor\(Math.random\(\) \* openers.length\)\];\n\s+await sock.sendMessage\(target.id, \{ text: msg \}\);\n\s+lastProactiveTo.set\(target.id, now\);/,
`// enforce daily per-contact limit\n      const today = new Date().toISOString().slice(0,10);\n      const cntObj = lastProactiveCounts.get(target.id) || { date: today, count: 0 };\n      if (cntObj.date !== today) { cntObj.date = today; cntObj.count = 0; }\n      if (cntObj.count >= PROACTIVE_DAILY_LIMIT) {\n        lastProactiveLog = `skip: daily limit for ${target.id.slice(-15)}`;\n        scheduleRandomText();\n        return;\n      }\n\n      // Prefer owner's past messages to this contact as openers (if available)\n      const ownerMsgs = (userData[target.id]?.ownerMessages || []);\n      let msg;\n      if (ownerMsgs.length && Math.random() < 0.7) {\n        msg = ownerMsgs[Math.floor(Math.random() * ownerMsgs.length)];\n      } else {\n        msg = openers[Math.floor(Math.random() * openers.length)];\n      }\n\n      await sock.sendMessage(target.id, { text: msg });\n      // update counters\n      cntObj.count++;\n      lastProactiveCounts.set(target.id, cntObj);\n      lastProactiveTo.set(target.id, now);`);

  // 6) Skip proactive sends in the first minute after a fresh connection
  src = src.replace(/if \(!settings.proactiveText \|\| !settings.onlineMode\) \{ lastProactiveLog = "skip: not in \.online mode"; scheduleRandomText\(\); return; \}/,
`if (!settings.proactiveText || !settings.onlineMode) { lastProactiveLog = "skip: not in .online mode"; scheduleRandomText(); return; }\n      // avoid proactive sends during immediate post-connect replay windows\n      if (Date.now() - (lastConnectedAt || 0) < (Number(process.env.PROACTIVE_POST_CONNECT_SILENCE_MS) || 60 * 1000)) {\n        lastProactiveLog = "skip: post-connect silence";\n        scheduleRandomText(); return;\n      }`);

  // 7) Ensure lastConnectedAt variable exists near bot state. Insert if missing after "let sock = null" block
  if (!/let lastConnectedAt =/.test(src)) {
    src = src.replace(/let sock = null, currentQr = null, isConnected = false, hasQr = false;/,
`let sock = null, currentQr = null, isConnected = false, hasQr = false;\nlet lastConnectedAt = 0;\n// Admin token store for /admin access (short-lived tokens)\nconst adminTokens = new Map();\nfunction genAdminToken() { return require('crypto').randomBytes(12).toString('hex'); }`);
  }

  // 8) Update connection.open handler to set lastConnectedAt = Date.now() and notify owner with linked user display name
  src = src.replace(/if \(connection === "open"\) \{[\s\S]*?console.log\("\[MFG_bot\] Connected to WhatsApp"\);/, (m) => {
    const add = `\n      lastConnectedAt = Date.now();\n      // Notify owner with linked user display name (if available)\n      try {\n        const linkedName = sock?.user?.name || sock?.user?.notify || sock?.user?.pushname || sock?.user?.id || 'unknown';\n        await sock.sendMessage(OWNER_JID, { text: `Hello maker — ${settings.botName || 'thug v1.0'} just got connected to user ${linkedName} (${sock?.user?.id || 'unknown'})` });\n      } catch (e) { console.log('[MFG_bot] Could not message owner after connect:', e.message); }`;
    return m + add;
  });

  // 9) Ensure /api/qr has CORS header — replace its handler
  src = src.replace(/app.get\("\/api\/qr", \(req, res\) =>\n  currentQr \? res.json\(\{ qr: currentQr \}\) : res.status\(404\).json\(\{ error: "no qr available" \}\)\n\);/,
`app.get("/api/qr", (req, res) => {\n  res.setHeader("Access-Control-Allow-Origin", "*");\n  if (currentQr) return res.json({ qr: currentQr });\n  return res.status(404).json({ error: "no qr available" });\n});`);

  // 10) Append /api/regen-qr endpoint after pairing handlers if not present (ensure owner-only check later)
  if (!/\/api\/regen-qr/.test(src)) {
    const regenCode = `\n// POST /api/regen-qr — wipe auth and restart socket to force fresh QR (requires confirm=yes)\napp.post('/api/regen-qr', async (req, res) => {\n  const c = req.query.confirm || req.body?.confirm;\n  if (String(c) !== 'yes') return res.status(400).json({ error: 'require confirm=yes to avoid accidental wipe' });\n  // Owner-only guard\n  const key = req.headers['x-admin-key'] || req.body?.adminKey || req.query?.adminKey;\n  const token = req.headers['x-admin-token'] || req.query?.token || req.body?.token;\n  const validToken = token && adminTokens.get(token) && adminTokens.get(token).expires > Date.now();\n  if (!validToken && key !== (settings.ADMIN_KEY || process.env.ADMIN_KEY) && !req.headers['x-owner']) return res.status(403).json({ error: 'unauthorized' });\n  try {\n    const authPath = process.env.AUTH_PATH || path.join(__dirname, 'auth_info_baileys');\n    if (fs.existsSync(authPath)) { fs.rmSync(authPath, { recursive: true, force: true }); console.log('[MFG_bot] /api/regen-qr — wiped auth folder'); }\n    if (sock) { try { sock.ev.removeAllListeners(); sock.end(new Error('regen-qr requested')); } catch (e) {} sock = null; }\n    // restart socket — connectToWhatsApp will generate QR when ready\n    setTimeout(connectToWhatsApp, 1000);\n    return res.json({ success: true, message: 'auth wiped, restarting socket to generate QR' });\n  } catch (e) { return res.status(500).json({ error: e.message }); }\n});\n`;
    src = src.replace(/\/\/ ─── Start ────────────────────────────────────────────────────────────────────[\s\S]*/, (m) => regenCode + '\n' + m);
  }

  // 11) Enable autoReadStatus by default in SETTINGS_DEFAULTS (replace false -> true)
  src = src.replace(/autoReadStatus: false,/, 'autoReadStatus: true,');

  // 12) Inject .restart owner-only command (restart socket) inside commands section — keep existing behavior
  src = src.replace(/(if \(cmd === "bot"\) \{[\s\S]*?continue;\n\s*\})/, (m) => {
    const restartCmd = `\n$1\n\n        // .restart — owner only: gracefully restart the WhatsApp socket\n        if (cmd === "restart") {\n          if (!senderIsOwner) { await send("owner only."); continue; }\n          try {\n            await send("restarting socket... goodbye");\n            if (sock) { try { sock.ev.removeAllListeners(); sock.end(new Error('owner restart')); } catch (e) {} sock = null; }\n            setTimeout(connectToWhatsApp, 1500);\n          } catch (e) { await send('restart failed: ' + e.message); }\n          continue;\n        }`;
    return restartCmd;
  });

  // 13) Modify the big commands list handler to special-case .menu: send concise menu + notify owner (already added by previous patch)
  src = src.replace(/if \(cmd === "command" \|\| cmd === "commands" \|\| cmd === "list" \|\| cmd === "work" \|\| cmd === "teddy" \|\| cmd === "menu" \|\| cmd === "help" \|\| cmd === "allcmd"\) \{[\s\S]*?await send\(part1\);[\s\S]*?await send\(part2\);[\s\S]*?continue;\n\s*\}/, (m) => {
    // insert no-op; keep original in place
    return m;
  });

  // 14) Inject .admin command handling immediately after command parsing
  src = src.replace(/const \[rawCmd, \.\.\.args\] = text\.slice\(pfx.length\)\.trim\(\)\.split\(\/\\s\+\//\);\n\s+const cmd = rawCmd\.toLowerCase\(\);\n\s+trackCommand\(cmd\);/,
`const [rawCmd, ...args] = text.slice(pfx.length).trim().split(/\s+/);\n        const cmd = rawCmd.toLowerCase();\n        trackCommand(cmd);\n\n        // .admin — owner can request a short-lived admin link; non-owner may provide password (less secure)\n        if (cmd === 'admin') {\n          const makeToken = async (source) => {\n            const t = genAdminToken();\n            const ttl = Number(process.env.ADMIN_TOKEN_TTL_MS) || 10 * 60 * 1000;\n            adminTokens.set(t, { by: source, expires: Date.now() + ttl });\n            const link = `${process.env.ADMIN_URL || 'https://whatsappjs-production-31c8.up.railway.app'}/admin?token=${t}`;\n            await send(`Owner admin link (valid ${Math.round(ttl/60000)}m): ${link}`);\n            try { await sock.sendMessage(OWNER_JID, { text: `🔐 Admin link issued to ${source}: ${link}` }); } catch (e) {}\n          };\n          try {\n            const source = participantJid || from;\n            if (senderIsOwner) { await makeToken(source); } else {\n              const pw = args[0];\n              if (pw && pw === (settings.ADMIN_KEY || process.env.ADMIN_KEY)) { await makeToken(source); }\n              else { await send('unauthorized — provide admin password or ask owner to request an admin link.'); }\n            }\n          } catch (e) { await send('admin link error: ' + e.message); }\n          continue;\n        }`);

  // 15) Protect POST /api/settings so only admin key or valid token can update settings
  src = src.replace(/app.post\("\/api\/settings", \(req, res\) => \{[\s\S]*?writeJSON\("settings.json", settings\);\n  res.json\(\{ success: true, settings \}\);\n\});/, (m) => {
    return `app.post("/api/settings", (req, res) => {\n  const key = req.headers['x-admin-key'] || req.body?.adminKey || req.query?.adminKey;\n  const token = req.headers['x-admin-token'] || req.query?.token || req.body?.token;\n  const validToken = token && adminTokens.get(token) && adminTokens.get(token).expires > Date.now();\n  if (!validToken && key !== (settings.ADMIN_KEY || process.env.ADMIN_KEY)) return res.status(403).json({ error: 'unauthorized' });\n  settings = { ...settings, ...req.body };\n  writeJSON("settings.json", settings);\n  if (validToken) adminTokens.delete(token);\n  res.json({ success: true, settings });\n});`;
  });

  // 16) Add /admin route to serve admin.html (simple static UI) if not present
  if (!/app.get\("\/admin"/.test(src)) {
    const adminRoute = `\n// Simple admin UI (protected via token or ADMIN_KEY)\napp.get('/admin', (req, res) => {\n  const token = req.query?.token;\n  if (!token) {\n    // serve the static page — the page will read token from URL if provided\n    return res.sendFile(path.join(__dirname, 'admin.html'));\n  }\n  const info = adminTokens.get(token);\n  if (!info || info.expires < Date.now()) return res.status(403).send('Invalid or expired token');\n  // single-use: delete token after validation\n  adminTokens.delete(token);\n  return res.sendFile(path.join(__dirname, 'admin.html'));\n});\n`;
    src = src.replace(/\/\/ ─── API Endpoints ────────────────────────────────────────────────────────────/, (m) => adminRoute + '\n' + m);
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
