---
name: Baileys Package Blocked on Replit
description: Replit's package firewall blocks the baileys npm package (403 Forbidden).
---

## Problem
`baileys` is blocked by Replit's package firewall with `ERR_PNPM_FETCH_403`. This means the WhatsApp bot (Baileys-based) cannot run inside the Replit environment.

## Solution
- WhatsApp bot runs externally (e.g. Railway deployment of `server.js`)
- `artifacts/api-server/src/routes/whatsapp.ts` proxies all `/api/status`, `/api/qr`, `/api/settings`, `/api/pair`, `/api/logout` requests to `WHATSAPP_BACKEND_URL` env var
- Frontend stores the backend URL in `localStorage` key `wa_backend_url` and calls it directly for browser-to-backend flows (avoids CORS issues when api-server proxy is not needed)

**Why:** Replit restricts certain packages that could be used for automated messaging. The WhatsApp page in the hub still works — users just point it at their Railway URL.

**How to apply:** Never attempt to install `baileys`, `@whiskeysockets/baileys`, or `@adiwajshing/baileys` in any workspace package. Route all WhatsApp functionality through the external backend.
