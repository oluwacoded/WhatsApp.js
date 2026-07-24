/**
 * WhatsApp proxy routes — forwards requests to the configured WhatsApp backend.
 * The backend URL is read from the WHATSAPP_BACKEND_URL env var, or falls back
 * to a "not configured" response so the frontend can prompt the user.
 */

import { Router, type IRouter } from "express";
import {
  GetWhatsappStatusResponse,
  GetQrResponse,
  GetSettingsResponse,
  PairWhatsappResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function getBackendUrl(): string | null {
  return process.env.WHATSAPP_BACKEND_URL?.replace(/\/$/, "") || null;
}

async function proxyGet(path: string): Promise<unknown> {
  const base = getBackendUrl();
  if (!base) throw new Error("WHATSAPP_BACKEND_URL not configured");
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  return res.json();
}

async function proxyPost(path: string, body: unknown): Promise<unknown> {
  const base = getBackendUrl();
  if (!base) throw new Error("WHATSAPP_BACKEND_URL not configured");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(95000),
  });
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  return res.json();
}

router.get("/status", async (_req, res) => {
  try {
    const data = await proxyGet("/api/status");
    const parsed = GetWhatsappStatusResponse.parse(data);
    res.json(parsed);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Return a safe offline status if backend is unreachable
    res.json(GetWhatsappStatusResponse.parse({
      connected: false,
      hasQr: false,
      uptime: null,
      messageCount: null,
      chatCount: null,
      aiEnabled: null,
    }));
    void msg; // suppress unused warning
  }
});

router.get("/qr", async (_req, res) => {
  try {
    const data = await proxyGet("/api/qr");
    res.json(GetQrResponse.parse(data));
  } catch {
    res.json(GetQrResponse.parse({ qr: null }));
  }
});

router.get("/settings", async (_req, res) => {
  try {
    const data = await proxyGet("/api/settings");
    res.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(503).json({ error: msg });
  }
});

router.post("/settings", async (req, res) => {
  try {
    const data = await proxyPost("/api/settings", req.body);
    res.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(503).json({ error: msg });
  }
});

router.post("/set-system-prompt", async (req, res) => {
  try {
    const data = await proxyPost("/api/set-system-prompt", req.body);
    res.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(503).json({ error: msg });
  }
});

router.post("/logout", async (_req, res) => {
  try {
    const data = await proxyPost("/api/logout", {});
    res.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(503).json({ error: msg });
  }
});

router.post("/pair", async (req, res) => {
  try {
    const data = await proxyPost("/api/pair", req.body);
    res.json(PairWhatsappResponse.parse(data));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(503).json({ ok: false, code: null, error: msg });
  }
});

export default router;
