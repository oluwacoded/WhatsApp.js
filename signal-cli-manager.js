// ─────────────────────────────────────────────────────────────────────────────
// signal-cli-manager.js
// Downloads signal-cli binary, starts it as a local TCP JSON-RPC daemon, and
// provides send/receive helpers used by signal-bot.js.
//
// No side effects on require() — caller must call startDaemon() explicitly.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const fs           = require("fs");
const path         = require("path");
const https        = require("https");
const { spawn }    = require("child_process");
const net          = require("net");
const { EventEmitter } = require("events");

// ─── Paths ────────────────────────────────────────────────────────────────────
const DATA_DIR       = path.join(__dirname, "data");
const SIGNAL_CLI_DIR = path.join(DATA_DIR, "signal-cli");         // extracted binary
const SIGNAL_DATA_DIR = path.join(DATA_DIR, "signal-data");       // signal-cli config/keys
const VERSION_FILE   = path.join(SIGNAL_CLI_DIR, "version.json"); // tracks downloaded version
const SIGNAL_CLI_BIN = path.join(SIGNAL_CLI_DIR, "bin", "signal-cli");

// ─── Constants ────────────────────────────────────────────────────────────────
const DAEMON_PORT    = 7583;   // internal TCP port for JSON-RPC (not 8080 to avoid conflicts)
const GITHUB_LATEST  = "https://api.github.com/repos/AsamK/signal-cli/releases/latest";
const FALLBACK_VER   = "0.14.6"; // used if GitHub API is unreachable

// ─── State ────────────────────────────────────────────────────────────────────
const emitter = new EventEmitter();
const status  = {
  phase:        "idle",     // idle | downloading | starting | ready | error
  version:      null,
  registered:   false,
  daemonPid:    null,
  ready:        false,
  error:        null,
  restarts:     0,
};

let signalCliExe  = null;   // path to the binary
let daemonProc    = null;
let tcpSocket     = null;
let rpcIdCounter  = 1;
let lineBuffer    = "";
const pendingRpc  = new Map(); // id → { resolve, reject }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(...args)  { console.log("[Signal-CLI]",  ...args); }
function warn(...args) { console.log("[Signal-CLI] ⚠️", ...args); }

function httpsRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { "User-Agent": "mfg-signal-bot/1.0", ...opts.headers },
      timeout: 30000,
    }, (res) => {
      // Follow redirects (GitHub releases use them)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsRequest(res.headers.location, opts).then(resolve, reject);
      }
      if (opts.asStream) return resolve(res);
      let buf = "";
      res.on("data", d => buf += d);
      res.on("end", () => resolve(buf));
      res.on("error", reject);
    }).on("error", reject).on("timeout", function() { this.destroy(); reject(new Error("timeout")); });
  });
}

async function downloadToFile(url, dest) {
  return new Promise(async (resolve, reject) => {
    try {
      const stream = await httpsRequest(url, { asStream: true });
      if (stream.statusCode !== 200) {
        stream.resume();
        return reject(new Error(`HTTP ${stream.statusCode} for ${url}`));
      }
      const total = parseInt(stream.headers["content-length"] || "0");
      let got = 0;
      let lastReport = 0;
      stream.on("data", chunk => {
        got += chunk.length;
        const pct = total ? Math.round(got / total * 100) : 0;
        if (got - lastReport > 10 * 1024 * 1024) {
          log(`  ↓ ${Math.round(got / 1024 / 1024)}MB${total ? ` / ${Math.round(total/1024/1024)}MB (${pct}%)` : ""}...`);
          lastReport = got;
        }
      });
      const file = fs.createWriteStream(dest);
      stream.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
      file.on("error", reject);
      stream.on("error", reject);
    } catch (e) { reject(e); }
  });
}

function runCliCommand(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(signalCliExe, [
      "--config", SIGNAL_DATA_DIR,
      ...args
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    proc.stdout.on("data", d => { out += d; });
    proc.stderr.on("data", d => { err += d; });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`signal-cli timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`signal-cli exit ${code}: ${(err + out).trim().slice(0, 400)}`));
    });
    proc.on("error", e => { clearTimeout(timer); reject(e); });
  });
}

// ─── 1. Download ──────────────────────────────────────────────────────────────
async function ensureSignalCli() {
  // Already downloaded and found?
  if (signalCliExe && fs.existsSync(signalCliExe)) return signalCliExe;

  // Check persisted state from a previous run
  if (fs.existsSync(VERSION_FILE)) {
    try {
      const { version, exe } = JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
      const binPath = exe || SIGNAL_CLI_BIN; // exe field added in newer versions
      if (fs.existsSync(binPath)) {
        signalCliExe = binPath;
        status.version = version;
        log(`Using cached binary v${version} (${binPath})`);
        return signalCliExe;
      }
    } catch {}
  }

  // ── Fetch latest version from GitHub ──────────────────────────────────────
  log("Fetching latest signal-cli release info...");
  status.phase = "downloading";
  let version = FALLBACK_VER;
  // Linux-native = full GraalVM standalone binary (supports link/register/daemon)
  // Linux-client = JSON-RPC client only (needs a running daemon — NOT what we want)
  // Linux-x86_64 = old name for the bundled-JRE tarball (pre-v0.14)
  let downloadUrl = `https://github.com/AsamK/signal-cli/releases/download/v${FALLBACK_VER}/signal-cli-${FALLBACK_VER}-Linux-native.tar.gz`;

  try {
    const releaseJson = await httpsRequest(GITHUB_LATEST);
    const release = JSON.parse(releaseJson);
    version = (release.tag_name || `v${FALLBACK_VER}`).replace(/^v/, "");
    const assets = release.assets || [];
    // Prefer: Linux-native > Linux-x86_64 (old bundled-JRE) — never use Linux-client
    const asset = assets.find(a => a.name.includes("Linux-native") && a.name.endsWith(".tar.gz"))
                || assets.find(a => a.name.includes("Linux-x86_64") && a.name.endsWith(".tar.gz"));
    if (asset) downloadUrl = asset.browser_download_url;
    log(`Latest release: v${version} — ${downloadUrl.split("/").pop()}`);
  } catch (e) {
    warn(`GitHub API unreachable (${e.message}), using fallback v${FALLBACK_VER}`);
  }

  // ── Download ───────────────────────────────────────────────────────────────
  const tarName = `signal-cli-${version}-Linux-x86_64.tar.gz`;
  const tarPath = path.join(DATA_DIR, tarName);
  log(`Downloading signal-cli v${version} (~90MB, this is a one-time step)...`);
  log(`URL: ${downloadUrl}`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  await downloadToFile(downloadUrl, tarPath);
  log("Download complete. Extracting...");

  // ── Extract ────────────────────────────────────────────────────────────────
  // Clean up any partial/stale extraction before re-extracting
  if (fs.existsSync(SIGNAL_CLI_DIR)) {
    try { fs.rmSync(SIGNAL_CLI_DIR, { recursive: true, force: true }); } catch {}
  }
  fs.mkdirSync(SIGNAL_CLI_DIR, { recursive: true });

  // Extract WITHOUT --strip-components so we handle both formats:
  //   Old (≤0.13.x): tarball has signal-cli-X.X.X/bin/signal-cli inside
  //   New (≥0.14.x): tarball is a single flat binary called signal-cli-client
  await new Promise((resolve, reject) => {
    const proc = spawn("tar", ["-xzf", tarPath, "-C", SIGNAL_CLI_DIR], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    proc.on("close", code => code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)));
    proc.on("error", reject);
  });

  // Cleanup tar
  try { fs.unlinkSync(tarPath); } catch {}

  // ── Find the binary wherever it landed ─────────────────────────────────────
  let foundBin = null;

  // New format (v0.14.x): single file "signal-cli-client" at root of SIGNAL_CLI_DIR
  const clientBin = path.join(SIGNAL_CLI_DIR, "signal-cli-client");
  if (fs.existsSync(clientBin)) foundBin = clientBin;

  // New format variant: just "signal-cli" at root
  if (!foundBin) {
    const rootBin = path.join(SIGNAL_CLI_DIR, "signal-cli");
    if (fs.existsSync(rootBin)) foundBin = rootBin;
  }

  // Old format: versioned subdirectory containing bin/signal-cli
  if (!foundBin) {
    for (const entry of fs.readdirSync(SIGNAL_CLI_DIR)) {
      const candidate = path.join(SIGNAL_CLI_DIR, entry, "bin", "signal-cli");
      if (fs.existsSync(candidate)) { foundBin = candidate; break; }
    }
  }

  if (!foundBin) {
    const contents = fs.readdirSync(SIGNAL_CLI_DIR).join(", ") || "(empty)";
    throw new Error(`Binary not found after extraction. Dir contents: ${contents}`);
  }

  fs.chmodSync(foundBin, "755");
  log(`Binary found at: ${foundBin}`);

  // Persist state — store the actual binary path for future runs
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ version, exe: foundBin }));
  signalCliExe = foundBin;
  status.version = version;
  log(`✅ signal-cli v${version} ready`);
  return signalCliExe;
}

// ─── 2. Registration ──────────────────────────────────────────────────────────
async function registerNumber(number) {
  await ensureSignalCli();
  if (!fs.existsSync(SIGNAL_DATA_DIR)) fs.mkdirSync(SIGNAL_DATA_DIR, { recursive: true });
  log(`Registering ${number} with Signal...`);
  try {
    await runCliCommand(["-a", number, "register", "--no-device-name"], 45000);
    log("✅ Registration SMS sent");
    return { ok: true, message: "Verification SMS sent to your number" };
  } catch (e) {
    // Some builds use different flags — try without the flag
    try {
      await runCliCommand(["-a", number, "register"], 45000);
      log("✅ Registration SMS sent");
      return { ok: true, message: "Verification SMS sent" };
    } catch (e2) {
      warn("Register error:", e2.message);
      throw new Error(e2.message.includes("captcha") ? "Signal requires captcha — see SIGNAL_SETUP.md for the captcha bypass" : e2.message);
    }
  }
}

async function verifyNumber(number, code) {
  await ensureSignalCli();
  log(`Verifying ${number} with code ${code}...`);
  await runCliCommand(["-a", number, "verify", code.replace(/\s/g, "")], 20000);
  status.registered = true;
  log("✅ Number verified! Signal account is ready.");
  return { ok: true };
}

// ─── 3. JSON-RPC daemon ───────────────────────────────────────────────────────
function rpcSend(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!tcpSocket || !tcpSocket.writable) {
      return reject(new Error("Signal daemon TCP not connected"));
    }
    const id = rpcIdCounter++;
    pendingRpc.set(id, { resolve, reject });
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    tcpSocket.write(line);
    setTimeout(() => {
      if (pendingRpc.has(id)) {
        pendingRpc.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }
    }, 15000);
  });
}

function handleRpcLine(line) {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  // Reply to a pending call
  if (msg.id != null && pendingRpc.has(msg.id)) {
    const { resolve, reject } = pendingRpc.get(msg.id);
    pendingRpc.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }

  // Unsolicited: incoming message notification
  if (msg.method === "receive" && msg.params?.envelope) {
    emitter.emit("message", msg.params.envelope);
  }
}

async function connectTcp(number) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();

    sock.connect(DAEMON_PORT, "127.0.0.1", async () => {
      tcpSocket = sock;
      log(`✅ TCP JSON-RPC connected on port ${DAEMON_PORT}`);
      // Subscribe to receive messages
      try {
        await rpcSend("subscribeReceive", { account: number });
        status.ready = true;
        status.phase = "ready";
        log("✅ Subscribed — Signal bot is live!");
        resolve();
      } catch (e) {
        warn("subscribeReceive error:", e.message, "— will still try to send");
        status.ready = true;
        status.phase = "ready";
        resolve();
      }
    });

    sock.on("data", chunk => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop();
      lines.forEach(handleRpcLine);
    });

    sock.on("close", () => {
      tcpSocket = null;
      status.ready = false;
      if (status.phase === "ready" || status.phase === "starting") {
        status.phase = "reconnecting";
        log("TCP closed — reconnecting in 5s...");
        setTimeout(() => connectTcp(number).catch(() => {}), 5000);
      }
    });

    sock.on("error", e => {
      if (!status.ready) {
        reject(e); // reject on initial connect failure
      } else {
        warn("TCP error:", e.message);
      }
    });

    setTimeout(() => {
      if (!status.ready) {
        sock.destroy();
        reject(new Error("TCP connection timed out"));
      }
    }, 12000);
  });
}

let daemonNumber = null;

async function startDaemon(number) {
  daemonNumber = number;
  await ensureSignalCli();
  if (!fs.existsSync(SIGNAL_DATA_DIR)) fs.mkdirSync(SIGNAL_DATA_DIR, { recursive: true });

  status.phase = "starting";
  log(`Starting signal-cli daemon for ${number} (TCP 127.0.0.1:${DAEMON_PORT})...`);

  // Kill any existing daemon on that port
  if (daemonProc) { try { daemonProc.kill(); } catch {} daemonProc = null; }

  daemonProc = spawn(signalCliExe, [
    "--config", SIGNAL_DATA_DIR,
    "-a", number,
    "daemon",
    "--tcp", `127.0.0.1:${DAEMON_PORT}`,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  status.daemonPid = daemonProc.pid;
  daemonProc.stdout.on("data", d => process.stdout.write(`[signal-cli] ${d}`));
  daemonProc.stderr.on("data", d => {
    const s = d.toString().trim();
    // Filter noisy keepalive logs
    if (s && !s.includes("Sending keep alive") && !s.includes("keepalive")) {
      process.stderr.write(`[signal-cli] ${s}\n`);
    }
  });

  daemonProc.on("exit", (code) => {
    status.daemonPid = null;
    status.ready = false;
    if (code === 1 && status.registered === false) {
      status.phase = "error";
      status.error = "Number not registered — run /api/signal/register first";
      log("⚠️ Daemon exited — number may not be registered yet. Waiting 30s before retry...");
      setTimeout(() => startDaemon(number), 30000);
    } else {
      status.restarts++;
      log(`Daemon exited (code ${code}). Restarting in 10s...`);
      setTimeout(() => startDaemon(number), 10000);
    }
  });

  daemonProc.on("error", e => {
    warn("Daemon spawn error:", e.message);
    status.error = e.message;
    status.phase = "error";
    setTimeout(() => startDaemon(number), 15000);
  });

  // Give daemon time to bind port before we connect
  await new Promise(r => setTimeout(r, 3500));

  // Connect with retry (daemon might take slightly longer to start)
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await connectTcp(number);
      return; // success
    } catch (e) {
      if (attempt < 5) {
        log(`TCP connect attempt ${attempt} failed (${e.message}), retrying in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      } else {
        warn(`Could not connect to daemon after ${attempt} attempts: ${e.message}`);
        // Don't throw — daemon might still start, TCP reconnect will handle it
      }
    }
  }
}

// ─── 3b. Link existing Signal account ────────────────────────────────────────
// Uses "signal-cli link" which outputs a tsdevice:// URI for the user to scan
// in their existing Signal app → Settings → Linked Devices → Link a Device.
// No separate phone number or SMS needed.

let linkProc   = null;
const linkState = { state: "idle", uri: null, error: null, number: null };
// state: idle | linking | waiting_scan | linked | error

async function linkDevice(deviceName = "MFG Bot") {
  await ensureSignalCli();
  if (!fs.existsSync(SIGNAL_DATA_DIR)) fs.mkdirSync(SIGNAL_DATA_DIR, { recursive: true });

  // Kill any previous link attempt
  if (linkProc) { try { linkProc.kill(); } catch {} linkProc = null; }
  Object.assign(linkState, { state: "linking", uri: null, error: null, number: null });

  return new Promise((resolve, reject) => {
    linkProc = spawn(signalCliExe, [
      "--config", SIGNAL_DATA_DIR,
      "link",
      "--name", deviceName,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let resolved = false;

    const failTimeout = setTimeout(() => {
      if (!resolved) {
        try { linkProc?.kill(); } catch {}
        linkState.state = "error";
        linkState.error = "Timed out waiting for link URI";
        reject(new Error(linkState.error));
      }
    }, 30000);

    const tryResolveUri = (line) => {
      line = line.trim();
      // URI format: "tsdevice://" (old) or "sgnl://linkdevice?" (new v0.14.x)
      if ((line.startsWith("tsdevice:/") || line.startsWith("sgnl://")) && !resolved) {
        resolved = true;
        clearTimeout(failTimeout);
        linkState.uri   = line;
        linkState.state = "waiting_scan";
        log("Link QR URI ready — waiting for user to scan...");
        resolve({ uri: line });
      }
    };

    linkProc.stdout.on("data", d => tryResolveUri(d.toString()));
    linkProc.stderr.on("data", d => {
      const s = d.toString().trim();
      if (s) tryResolveUri(s);   // URI sometimes comes on stderr
    });

    linkProc.on("close", async (code) => {
      linkProc = null;
      if (code === 0) {
        linkState.state = "linked";
        log("✅ Device linked! Discovering linked number...");
        try {
          const out = await runCliCommand(["listAccounts"], 10000).catch(() => "");
          const match = out.match(/(\+\d{7,15})/);
          if (match) { linkState.number = match[1]; log("Linked as:", match[1]); }
        } catch {}
        emitter.emit("linked", linkState.number);
      } else if (!resolved) {
        linkState.state = "error";
        linkState.error = `Link exited with code ${code}`;
        reject(new Error(linkState.error));
      } else {
        // User didn't scan in time or cancelled
        linkState.state = code === 0 ? "linked" : "error";
      }
    });

    linkProc.on("error", e => {
      clearTimeout(failTimeout);
      linkState.state = "error";
      linkState.error = e.message;
      if (!resolved) reject(e);
    });
  });
}

function getLinkStatus() {
  return { ...linkState };
}

function onLinked(cb) {
  emitter.once("linked", cb);
}

// ─── 4. Public API ────────────────────────────────────────────────────────────
async function sendMessage(to, text) {
  try {
    await rpcSend("send", {
      account:   daemonNumber,
      recipient: [to],
      message:   text,
    });
  } catch (e) {
    warn("sendMessage error:", e.message);
  }
}

function onMessage(callback) {
  emitter.on("message", callback);
}

function getStatus() {
  return { ...status };
}

// ─── 5. Ensure dirs exist ─────────────────────────────────────────────────────
[DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

module.exports = {
  ensureSignalCli,
  registerNumber,
  verifyNumber,
  linkDevice,
  getLinkStatus,
  onLinked,
  startDaemon,
  sendMessage,
  onMessage,
  getStatus,
  DAEMON_PORT,
};
