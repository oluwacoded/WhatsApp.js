import { Router, type IRouter } from "express";
import {
  GetSignalStatusResponse,
  RegisterSignalBody,
  RegisterSignalResponse,
  VerifySignalBody,
  VerifySignalResponse,
  LinkSignalDeviceResponse,
  GetSignalLinkStatusResponse,
} from "@workspace/api-zod";
import {
  getStatus,
  registerNumber,
  verifyNumber,
  linkDevice,
  linkState,
  startDaemon,
  ensureSignalCli,
} from "../services/signal.js";

const router: IRouter = Router();

router.get("/signal/status", (_req, res) => {
  const status = getStatus();
  const data = GetSignalStatusResponse.parse({
    phase: status.phase,
    ready: status.ready,
    registered: status.registered,
    version: status.version,
    restarts: status.restarts,
    error: status.error,
    number: status.number,
  });
  res.json(data);
});

router.post("/signal/register", async (req, res) => {
  try {
    const body = RegisterSignalBody.parse(req.body);
    const result = await registerNumber(body.number, body.captcha ?? undefined);
    res.json(RegisterSignalResponse.parse({ ok: result.ok, message: result.message }));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "CAPTCHA_REQUIRED") {
      res.status(400).json({ ok: false, message: "CAPTCHA required — get token from https://signalcaptchas.org/registration/generate.html" });
    } else {
      res.status(500).json({ ok: false, message: msg });
    }
  }
});

router.post("/signal/verify", async (req, res) => {
  try {
    const body = VerifySignalBody.parse(req.body);
    await verifyNumber(body.number, body.code);
    // Auto-start daemon after verification
    startDaemon(body.number).catch((e: unknown) => {
      console.error("[Signal] Auto-start after verify failed:", e instanceof Error ? e.message : e);
    });
    res.json(VerifySignalResponse.parse({ ok: true, message: "Verified! Starting daemon..." }));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, message: msg });
  }
});

router.post("/signal/link-device", async (_req, res) => {
  try {
    // Kick off ensureSignalCli so the binary is ready before linking
    await ensureSignalCli();
    const result = await linkDevice("MFG Bot");
    res.json(LinkSignalDeviceResponse.parse({ ok: true, uri: result.uri }));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, uri: null, message: msg });
  }
});

router.get("/signal/link-status", (_req, res) => {
  const data = GetSignalLinkStatusResponse.parse({
    state: linkState.state,
    uri: linkState.uri,
    number: linkState.number,
    error: linkState.error,
  });
  res.json(data);
});

export default router;
