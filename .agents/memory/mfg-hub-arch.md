---
name: MFG Hub Architecture
description: How the unified bot hub is structured — frontend, backends, routing.
---

## Overview
Single pnpm monorepo. Two artifacts:
- `artifacts/mfg-hub` — React/Vite frontend at `/` (dark cyber aesthetic, wouter routing)
- `artifacts/api-server` — TypeScript Express backend at `/api/*`

## Frontend pages
- `/` — Hub home: status cards for all 3 bots + Voice Changer
- `/whatsapp` — WhatsApp: backend URL config + CONNECTION/SETTINGS/COMMANDS tabs
- `/telegram` — Telegram: STATUS/SETUP/CONNECT tabs
- `/signal` — Signal: STATUS/REGISTER/LINK tabs
- `/voice-changer` — Real-time pitch shifter (Tone.js, client-side only)

## Backend services
- **WhatsApp**: `src/routes/whatsapp.ts` — proxies to `WHATSAPP_BACKEND_URL` env var (Railway). Baileys blocked on Replit.
- **Signal**: `src/routes/signal.ts` + `src/services/signal.ts` — runs signal-cli natively. No external npm needed (all built-in Node.js).
- **Telegram**: `src/routes/telegram.ts` + `src/services/telegram.ts` — uses `telegram` (gramjs) package. Dynamic import so server doesn't crash if missing.

## API codegen
OpenAPI spec at `lib/api-spec/openapi.yaml`. Run `pnpm --filter @workspace/api-spec run codegen` to regenerate hooks in `lib/api-client-react/` and Zod schemas in `lib/api-zod/`.

**Why:** Frontend Telegram/Signal hooks call the local api-server; WhatsApp uses direct fetch to configurable URL stored in localStorage key `wa_backend_url`.
