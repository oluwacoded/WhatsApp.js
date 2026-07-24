import { Router, type IRouter } from "express";
import {
  GetTelegramStatusResponse,
  ConnectTelegramBody,
  ConnectTelegramResponse,
  SubmitTelegramCodeBody,
  SubmitTelegramCodeResponse,
  SetupTelegramBody,
  SetupTelegramResponse,
} from "@workspace/api-zod";
import {
  getStatus,
  saveConfig,
  getConfig,
  setConnected,
  setAwaitingCode,
  setAwaitingPassword,
  disconnect,
  pending,
  saveSession,
  getSession,
} from "../services/telegram.js";

const router: IRouter = Router();

router.get("/telegram/status", (_req, res) => {
  const status = getStatus();
  const data = GetTelegramStatusResponse.parse({
    connected: status.connected,
    hasCredentials: status.hasCredentials,
    username: status.username,
    phone: status.phone,
  });
  res.json(data);
});

router.post("/telegram/setup", (req, res) => {
  try {
    const body = SetupTelegramBody.parse(req.body);
    saveConfig({ apiId: parseInt(body.apiId), apiHash: body.apiHash });
    res.json(SetupTelegramResponse.parse({ ok: true, message: "Telegram credentials saved" }));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, message: msg });
  }
});

router.post("/telegram/connect", async (req, res) => {
  try {
    const body = ConnectTelegramBody.parse(req.body);
    const config = getConfig();

    if (!config.apiId || !config.apiHash) {
      return res.status(400).json({ ok: false, message: "Telegram API credentials not set. Go to Setup tab first." });
    }

    saveConfig({ phone: body.phone });

    // Try to use saved session first
    const savedSession = getSession();

    if (savedSession) {
      // Attempt auto-reconnect with saved session
      try {
        // Dynamic import to avoid breaking if telegram package is missing
        const { TelegramClient } = await import("telegram").catch(() => null as never);
        const { StringSession } = await import("telegram/sessions/index.js").catch(() => null as never);

        if (TelegramClient && StringSession) {
          const session = new StringSession(savedSession);
          const client = new TelegramClient(session, config.apiId, config.apiHash, { connectionRetries: 3 });
          await client.connect();
          const me = await client.getMe();
          const uname = (me as Record<string, unknown>).username as string | null ?? body.phone;
          saveSession(client.session.save() as unknown as string);
          setConnected(true, uname);
          return res.json(ConnectTelegramResponse.parse({ ok: true, message: `Connected as ${uname}` }));
        }
      } catch {
        // Session expired — fall through to fresh login
        saveSession("");
      }
    }

    // Fresh login flow — notify client to expect a code
    setAwaitingCode(true);
    setConnected(false);

    // Fire off async login (won't wait for it here — code comes via /telegram/code)
    (async () => {
      try {
        const { TelegramClient } = await import("telegram").catch(() => null as never);
        const { StringSession } = await import("telegram/sessions/index.js").catch(() => null as never);

        if (!TelegramClient || !StringSession) {
          setAwaitingCode(false);
          return;
        }

        const session = new StringSession("");
        const client = new TelegramClient(session, config.apiId!, config.apiHash!, { connectionRetries: 5 });

        await client.start({
          phoneNumber: async () => body.phone,
          phoneCode: async () => {
            return new Promise<string>((resolve) => {
              pending.phoneCode = resolve;
            });
          },
          password: async () => {
            setAwaitingCode(false);
            setAwaitingPassword(true);
            return new Promise<string>((resolve) => {
              pending.password = resolve;
            });
          },
          onError: (err: Error) => {
            console.error("[TG] Login error:", err.message);
            setAwaitingCode(false);
            setAwaitingPassword(false);
            setConnected(false);
          },
        });

        const me = await client.getMe();
        const uname = (me as Record<string, unknown>).username as string | null ?? body.phone;
        saveSession(client.session.save() as unknown as string);
        saveConfig({ username: uname });
        setConnected(true, uname);
        setAwaitingCode(false);
        setAwaitingPassword(false);
      } catch (e) {
        console.error("[TG] Async connect error:", e);
        setAwaitingCode(false);
        setAwaitingPassword(false);
        setConnected(false);
      }
    })();

    res.json(ConnectTelegramResponse.parse({ ok: true, message: "Login started — check Telegram for a code, then submit it below" }));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, message: msg });
  }
});

router.post("/telegram/code", (req, res) => {
  try {
    const body = SubmitTelegramCodeBody.parse(req.body);

    if (body.type === "password") {
      if (!pending.password) {
        return res.status(400).json({ ok: false, message: "No 2FA prompt is pending" });
      }
      pending.password(body.code);
      pending.password = null;
      setAwaitingPassword(false);
      res.json(SubmitTelegramCodeResponse.parse({ ok: true, message: "2FA password submitted" }));
    } else {
      if (!pending.phoneCode) {
        return res.status(400).json({ ok: false, message: "No code prompt is pending" });
      }
      pending.phoneCode(body.code);
      pending.phoneCode = null;
      setAwaitingCode(false);
      res.json(SubmitTelegramCodeResponse.parse({ ok: true, message: "Code submitted" }));
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, message: msg });
  }
});

export default router;
