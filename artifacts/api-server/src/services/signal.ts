/**
 * Signal CLI Manager — TypeScript port with reconnection fixes.
 *
 * Key fixes vs. original:
 * 1. TCP timeout increased from 12s → 45s (daemon can take time to bind)
 * 2. Exponential backoff on TCP drop (5s → 10s → 20s → 40s, capped at 60s)
 * 3. Keepalive ping every 30s to prevent silent TCP drops
 * 4. Longer initial wait before TCP connect: 3.5s → 8s
 * 5. More retry attempts on initial connect: 5 → 8
 */

import fs from "fs";
import path from "path";
import https from "https";
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import { EventEmitter } from "events";

// ─── Paths ────────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(
  process.env.SIGNAL_DATA_DIR ||
    path.join(process.cwd(), "data", "signal-service"),
);
const SIGNAL_CLI_DIR = path.join(DATA_DIR, "signal-cli");
const SIGNAL_DATA_DIR = path.join(DATA_DIR, "signal-data");
const VERSION_FILE = path.join(SIGNAL_CLI_DIR, "version.json");

// ─── Constants ────────────────────────────────────────────────────────────────
const DAEMON_PORT = 7583;
const GITHUB_LATEST =
  "https://api.github.com/repos/AsamK/signal-cli/releases/latest";
const FALLBACK_VER = "0.14.6";

// ─── State ────────────────────────────────────────────────────────────────────
const emitter = new EventEmitter();

export const signalStatus = {
  phase: "idle" as
    | "idle"
    | "downloading"
    | "starting"
    | "ready"
    | "reconnecting"
    | "error",
  version: null as string | null,
  registered: false,
  daemonPid: null as number | null,
  ready: false,
  error: null as string | null,
  restarts: 0,
  number: null as string | null,
};

let signalCliExe: string | null = null;
let daemonProc: ChildProcess | null = null;
let tcpSocket: net.Socket | null = null;
let rpcIdCounter = 1;
let lineBuffer = "";
const pendingRpc = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

// Keepalive interval
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
// Exponential backoff for reconnect
let reconnectAttempts = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(...args: unknown[]) {
  console.log("[Signal-CLI]", ...args);
}
function warn(...args: unknown[]) {
  console.log("[Signal-CLI] ⚠️", ...args);
}

function ensureDirs() {
  [DATA_DIR, SIGNAL_CLI_DIR, SIGNAL_DATA_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { "User-Agent": "mfg-signal-bot/1.0" },
        timeout: 30000,
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return httpsGet(res.headers.location).then(resolve, reject);
        }
        let buf = "";
        res.on("data", (d) => (buf += d));
        res.on("end", () => resolve(buf));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

function downloadToFile(url: string, dest: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const doGet = (u: string): Promise<void> =>
        new Promise((res2, rej2) => {
          const r = https.get(
            u,
            { headers: { "User-Agent": "mfg-signal-bot/1.0" } },
            (stream) => {
              if (
                stream.statusCode &&
                stream.statusCode >= 300 &&
                stream.statusCode < 400 &&
                stream.headers.location
              ) {
                return doGet(stream.headers.location).then(res2, rej2);
              }
              if (!stream.statusCode || stream.statusCode !== 200) {
                stream.resume();
                return rej2(new Error(`HTTP ${stream.statusCode}`));
              }
              const file = fs.createWriteStream(dest);
              stream.pipe(file);
              file.on("finish", () => {
                file.close();
                res2();
              });
              file.on("error", rej2);
              stream.on("error", rej2);
            },
          );
          r.on("error", rej2);
        });
      await doGet(url);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

function runCliCommand(args: string[], timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!signalCliExe) return reject(new Error("signal-cli not downloaded yet"));
    const proc = spawn(signalCliExe, ["--config", SIGNAL_DATA_DIR, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    proc.stdout?.on("data", (d) => (out += d));
    proc.stderr?.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`signal-cli timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else
        reject(
          new Error(`signal-cli exit ${code}: ${(err + out).trim().slice(0, 400)}`),
        );
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

// ─── 1. Download ──────────────────────────────────────────────────────────────
export async function ensureSignalCli(): Promise<string> {
  if (signalCliExe && fs.existsSync(signalCliExe)) return signalCliExe;

  ensureDirs();

  if (fs.existsSync(VERSION_FILE)) {
    try {
      const { version, exe } = JSON.parse(
        fs.readFileSync(VERSION_FILE, "utf8"),
      );
      const binPath = exe || path.join(SIGNAL_CLI_DIR, "bin", "signal-cli");
      if (fs.existsSync(binPath)) {
        signalCliExe = binPath;
        signalStatus.version = version;
        log(`Using cached binary v${version}`);
        return signalCliExe;
      }
    } catch {}
  }

  signalStatus.phase = "downloading";
  let version = FALLBACK_VER;
  let downloadUrl = `https://github.com/AsamK/signal-cli/releases/download/v${FALLBACK_VER}/signal-cli-${FALLBACK_VER}-Linux-native.tar.gz`;

  try {
    const releaseJson = await httpsGet(GITHUB_LATEST);
    const release = JSON.parse(releaseJson);
    version = (release.tag_name || `v${FALLBACK_VER}`).replace(/^v/, "");
    const assets: Array<{ name: string; browser_download_url: string }> =
      release.assets || [];
    const asset =
      assets.find(
        (a) => a.name.includes("Linux-native") && a.name.endsWith(".tar.gz"),
      ) ||
      assets.find(
        (a) => a.name.includes("Linux-x86_64") && a.name.endsWith(".tar.gz"),
      );
    if (asset) downloadUrl = asset.browser_download_url;
    log(`Latest release: v${version}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    warn(`GitHub API unreachable (${msg}), using fallback v${FALLBACK_VER}`);
  }

  const tarPath = path.join(DATA_DIR, `signal-cli-${version}.tar.gz`);
  log(`Downloading signal-cli v${version}...`);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  await downloadToFile(downloadUrl, tarPath);
  log("Download complete. Extracting...");

  if (fs.existsSync(SIGNAL_CLI_DIR))
    fs.rmSync(SIGNAL_CLI_DIR, { recursive: true, force: true });
  fs.mkdirSync(SIGNAL_CLI_DIR, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("tar", ["-xzf", tarPath, "-C", SIGNAL_CLI_DIR], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)),
    );
    proc.on("error", reject);
  });

  try {
    fs.unlinkSync(tarPath);
  } catch {}

  let foundBin: string | null = null;
  const clientBin = path.join(SIGNAL_CLI_DIR, "signal-cli-client");
  if (fs.existsSync(clientBin)) foundBin = clientBin;
  if (!foundBin) {
    const rootBin = path.join(SIGNAL_CLI_DIR, "signal-cli");
    if (fs.existsSync(rootBin)) foundBin = rootBin;
  }
  if (!foundBin) {
    for (const entry of fs.readdirSync(SIGNAL_CLI_DIR)) {
      const candidate = path.join(SIGNAL_CLI_DIR, entry, "bin", "signal-cli");
      if (fs.existsSync(candidate)) {
        foundBin = candidate;
        break;
      }
    }
  }

  if (!foundBin)
    throw new Error(
      `Binary not found after extraction. Dir: ${fs.readdirSync(SIGNAL_CLI_DIR).join(", ")}`,
    );

  fs.chmodSync(foundBin, "755");
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ version, exe: foundBin }));
  signalCliExe = foundBin;
  signalStatus.version = version;
  log(`✅ signal-cli v${version} ready`);
  return signalCliExe;
}

// ─── 2. Registration ──────────────────────────────────────────────────────────
export async function registerNumber(
  number: string,
  captchaToken?: string,
): Promise<{ ok: boolean; message: string }> {
  await ensureSignalCli();
  ensureDirs();
  log(`Registering ${number}...`);
  const args = ["-a", number, "register"];
  if (captchaToken) args.push("--captcha", captchaToken.trim());
  try {
    await runCliCommand(args, 45000);
    signalStatus.number = number;
    log("✅ Registration SMS sent");
    return { ok: true, message: "Verification SMS sent to your number" };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    warn("Register error:", msg);
    if (msg.includes("captcha")) throw new Error("CAPTCHA_REQUIRED");
    throw e;
  }
}

export async function verifyNumber(
  number: string,
  code: string,
): Promise<{ ok: boolean }> {
  await ensureSignalCli();
  log(`Verifying ${number} with code ${code}...`);
  await runCliCommand(
    ["-a", number, "verify", code.replace(/\s/g, "")],
    20000,
  );
  signalStatus.registered = true;
  signalStatus.number = number;
  log("✅ Number verified!");
  return { ok: true };
}

// ─── 3. JSON-RPC ──────────────────────────────────────────────────────────────
function rpcSend(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
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

function handleRpcLine(line: string) {
  line = line.trim();
  if (!line) return;
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id != null && pendingRpc.has(msg.id as number)) {
    const { resolve, reject } = pendingRpc.get(msg.id as number)!;
    pendingRpc.delete(msg.id as number);
    if (msg.error)
      reject(
        new Error(
          (msg.error as Record<string, string>).message ||
            JSON.stringify(msg.error),
        ),
      );
    else resolve(msg.result);
    return;
  }
  if (
    msg.method === "receive" &&
    (msg.params as Record<string, unknown>)?.envelope
  ) {
    emitter.emit("message", (msg.params as Record<string, unknown>).envelope);
  }
}

function startKeepalive(number: string) {
  if (keepaliveInterval) clearInterval(keepaliveInterval);
  // Send a ping every 30s to keep the TCP connection alive
  keepaliveInterval = setInterval(async () => {
    if (!tcpSocket || !tcpSocket.writable) {
      clearInterval(keepaliveInterval!);
      keepaliveInterval = null;
      return;
    }
    try {
      // Use getConfiguration as a lightweight keepalive ping
      await rpcSend("getConfiguration", { account: number });
    } catch {
      // Ignore keepalive errors — TCP close handler will trigger reconnect
    }
  }, 30000);
}

export async function connectTcp(number: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();

    // FIX 1: Increase timeout from 12s → 45s
    const connectTimeout = setTimeout(() => {
      if (!signalStatus.ready) {
        sock.destroy();
        reject(new Error("TCP connection timed out (45s)"));
      }
    }, 45000);

    sock.connect(DAEMON_PORT, "127.0.0.1", async () => {
      clearTimeout(connectTimeout);
      tcpSocket = sock;
      reconnectAttempts = 0; // Reset backoff on successful connect
      log(`✅ TCP JSON-RPC connected on port ${DAEMON_PORT}`);
      try {
        await rpcSend("subscribeReceive", { account: number });
        signalStatus.ready = true;
        signalStatus.phase = "ready";
        log("✅ Subscribed — Signal bot is live!");
        // FIX 3: Start keepalive pings
        startKeepalive(number);
        resolve();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        warn("subscribeReceive error:", msg, "— will still try to send");
        signalStatus.ready = true;
        signalStatus.phase = "ready";
        startKeepalive(number);
        resolve();
      }
    });

    sock.on("data", (chunk) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      lines.forEach(handleRpcLine);
    });

    sock.on("close", () => {
      tcpSocket = null;
      signalStatus.ready = false;
      if (keepaliveInterval) {
        clearInterval(keepaliveInterval);
        keepaliveInterval = null;
      }
      if (
        signalStatus.phase === "ready" ||
        signalStatus.phase === "starting" ||
        signalStatus.phase === "reconnecting"
      ) {
        signalStatus.phase = "reconnecting";
        // FIX 2: Exponential backoff (5s → 10s → 20s → 40s, max 60s)
        reconnectAttempts++;
        const delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 60000);
        log(`TCP closed — reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})...`);
        setTimeout(() => connectTcp(number).catch(() => {}), delay);
      }
    });

    sock.on("error", (e) => {
      clearTimeout(connectTimeout);
      if (!signalStatus.ready) {
        reject(e);
      } else {
        warn("TCP error:", e.message);
      }
    });
  });
}

let daemonNumber: string | null = null;

export async function startDaemon(number: string): Promise<void> {
  daemonNumber = number;
  signalStatus.number = number;
  await ensureSignalCli();
  ensureDirs();

  signalStatus.phase = "starting";
  log(
    `Starting signal-cli daemon for ${number} (TCP 127.0.0.1:${DAEMON_PORT})...`,
  );

  if (daemonProc) {
    try {
      daemonProc.kill();
    } catch {}
    daemonProc = null;
  }

  daemonProc = spawn(
    signalCliExe!,
    [
      "--config",
      SIGNAL_DATA_DIR,
      "-a",
      number,
      "daemon",
      "--tcp",
      `127.0.0.1:${DAEMON_PORT}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  signalStatus.daemonPid = daemonProc.pid ?? null;
  daemonProc.stdout?.on("data", (d) =>
    process.stdout.write(`[signal-cli] ${d}`),
  );
  daemonProc.stderr?.on("data", (d) => {
    const s = d.toString().trim();
    if (s && !s.includes("Sending keep alive") && !s.includes("keepalive")) {
      process.stderr.write(`[signal-cli] ${s}\n`);
    }
  });

  daemonProc.on("exit", (code) => {
    signalStatus.daemonPid = null;
    signalStatus.ready = false;
    if (keepaliveInterval) {
      clearInterval(keepaliveInterval);
      keepaliveInterval = null;
    }
    if (code === 1 && !signalStatus.registered) {
      signalStatus.phase = "error";
      signalStatus.error =
        "Number not registered — register via the dashboard first";
      log(
        "⚠️ Daemon exited — number may not be registered yet. Waiting 30s before retry...",
      );
      setTimeout(() => startDaemon(number), 30000);
    } else {
      signalStatus.restarts++;
      log(`Daemon exited (code ${code}). Restarting in 10s...`);
      setTimeout(() => startDaemon(number), 10000);
    }
  });

  daemonProc.on("error", (e) => {
    warn("Daemon spawn error:", e.message);
    signalStatus.error = e.message;
    signalStatus.phase = "error";
    setTimeout(() => startDaemon(number), 15000);
  });

  // FIX 4: Give daemon more time to bind: 3.5s → 8s
  await new Promise((r) => setTimeout(r, 8000));

  // FIX 5: More retry attempts: 5 → 8, with longer waits
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await connectTcp(number);
      return;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < 8) {
        const delay = attempt <= 3 ? 2000 : 5000;
        log(
          `TCP connect attempt ${attempt} failed (${msg}), retrying in ${delay / 1000}s...`,
        );
        await new Promise((r) => setTimeout(r, delay));
      } else {
        warn(
          `Could not connect to daemon after ${attempt} attempts: ${msg}`,
        );
      }
    }
  }
}

// ─── 4. Link existing account ──────────────────────────────────────────────────
let linkProc: ChildProcess | null = null;
export const linkState = {
  state: "idle" as "idle" | "linking" | "waiting_scan" | "linked" | "error",
  uri: null as string | null,
  error: null as string | null,
  number: null as string | null,
};

export async function linkDevice(
  deviceName = "MFG Bot",
): Promise<{ uri: string }> {
  await ensureSignalCli();
  ensureDirs();

  if (linkProc) {
    try {
      linkProc.kill();
    } catch {}
    linkProc = null;
  }
  Object.assign(linkState, {
    state: "linking",
    uri: null,
    error: null,
    number: null,
  });

  return new Promise((resolve, reject) => {
    linkProc = spawn(
      signalCliExe!,
      ["--config", SIGNAL_DATA_DIR, "link", "--name", deviceName],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let resolved = false;

    const failTimeout = setTimeout(() => {
      if (!resolved) {
        try {
          linkProc?.kill();
        } catch {}
        linkState.state = "error";
        linkState.error = "Timed out waiting for link URI";
        reject(new Error(linkState.error));
      }
    }, 30000);

    const tryResolveUri = (line: string) => {
      line = line.trim();
      if (
        (line.startsWith("tsdevice:/") || line.startsWith("sgnl://")) &&
        !resolved
      ) {
        resolved = true;
        clearTimeout(failTimeout);
        linkState.uri = line;
        linkState.state = "waiting_scan";
        log("Link URI ready — waiting for user to scan...");
        resolve({ uri: line });
      }
    };

    linkProc.stdout?.on("data", (d) => tryResolveUri(d.toString()));
    linkProc.stderr?.on("data", (d) => {
      const s = d.toString().trim();
      if (s) tryResolveUri(s);
    });

    linkProc.on("close", async (code) => {
      linkProc = null;
      if (code === 0) {
        linkState.state = "linked";
        try {
          const out = await runCliCommand(["listAccounts"], 10000).catch(
            () => "",
          );
          const match = out.match(/(\+\d{7,15})/);
          if (match) linkState.number = match[1];
        } catch {}
        if (!linkState.number && fs.existsSync(SIGNAL_DATA_DIR)) {
          const dirs = fs
            .readdirSync(SIGNAL_DATA_DIR)
            .filter((f) => /^\+\d/.test(f));
          if (dirs.length > 0) linkState.number = dirs[0];
        }
        emitter.emit("linked", linkState.number);
      } else if (!resolved) {
        linkState.state = "error";
        linkState.error = `Link exited with code ${code}`;
        reject(new Error(linkState.error));
      } else {
        linkState.state = code === 0 ? "linked" : "error";
      }
    });

    linkProc.on("error", (e) => {
      clearTimeout(failTimeout);
      linkState.state = "error";
      linkState.error = e.message;
      if (!resolved) reject(e);
    });
  });
}

// ─── 5. Message sending ──────────────────────────────────────────────────────
export async function sendMessage(to: string, text: string): Promise<void> {
  try {
    await rpcSend("send", {
      account: daemonNumber,
      recipient: [to],
      message: text,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    warn("sendMessage error:", msg);
  }
}

export function onMessage(
  callback: (envelope: Record<string, unknown>) => void,
) {
  emitter.on("message", callback);
}

export function getStatus() {
  return { ...signalStatus };
}

export { DAEMON_PORT };
