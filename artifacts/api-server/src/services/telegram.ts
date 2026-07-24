/**
 * Telegram service — manages connection state for the Telegram MTProto userbot.
 * Credentials and session are persisted to disk.
 */

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "telegram-service");
const CONFIG_FILE = path.join(DATA_DIR, "tg_config.json");
const SESSION_FILE = path.join(DATA_DIR, "tg_session.json");

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON<T>(file: string, def: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  return def;
}
function writeJSON(file: string, data: unknown) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── State ────────────────────────────────────────────────────────────────────
export interface TgConfig {
  apiId?: number;
  apiHash?: string;
  phone?: string;
  username?: string;
}

export interface TgSession {
  session: string;
}

export interface TgState {
  connected: boolean;
  hasCredentials: boolean;
  username: string | null;
  phone: string | null;
  awaitingCode: boolean;
  awaitingPassword: boolean;
}

let config: TgConfig = {};
let session: TgSession = { session: "" };

// In-memory connection state (gramjs would be imported dynamically if needed)
let connected = false;
let username: string | null = null;
let awaitingCode = false;
let awaitingPassword = false;

// Pending login resolvers (filled by /telegram/code endpoint)
export const pending: {
  phoneCode: ((code: string) => void) | null;
  password: ((pw: string) => void) | null;
} = {
  phoneCode: null,
  password: null,
};

// ─── Load from disk ────────────────────────────────────────────────────────────
export function loadConfig() {
  ensureDirs();
  config = readJSON<TgConfig>(CONFIG_FILE, {});
  session = readJSON<TgSession>(SESSION_FILE, { session: "" });
}

export function saveConfig(patch: Partial<TgConfig>) {
  config = { ...config, ...patch };
  ensureDirs();
  writeJSON(CONFIG_FILE, config);
}

export function getConfig(): TgConfig {
  return { ...config };
}

export function hasCredentials(): boolean {
  return !!(config.apiId && config.apiHash);
}

export function getStatus(): TgState {
  return {
    connected,
    hasCredentials: hasCredentials(),
    username: username ?? config.username ?? null,
    phone: config.phone ?? null,
    awaitingCode,
    awaitingPassword,
  };
}

// ─── Session management ───────────────────────────────────────────────────────
export function saveSession(str: string) {
  session.session = str;
  ensureDirs();
  writeJSON(SESSION_FILE, session);
}

export function getSession(): string {
  return session.session || "";
}

// ─── Connection state setters (called by route handlers after gramjs ops) ─────
export function setConnected(val: boolean, uname?: string) {
  connected = val;
  if (uname !== undefined) username = uname;
  if (val) {
    awaitingCode = false;
    awaitingPassword = false;
  }
}

export function setAwaitingCode(val: boolean) {
  awaitingCode = val;
}

export function setAwaitingPassword(val: boolean) {
  awaitingPassword = val;
}

export function disconnect() {
  connected = false;
  username = null;
  awaitingCode = false;
  awaitingPassword = false;
  pending.phoneCode = null;
  pending.password = null;
}

// Initialise on module load
loadConfig();
