---
name: Security toolkit routes
description: All 6 security tool API endpoints and the nuclei binary location
---

## Tools added to server.js (appended at end of file)

| Route | Tool | Notes |
|---|---|---|
| GET /api/geo/lookup?q= | Geolocation | Uses ip-api.com free API, auto-resolves domains |
| POST /api/tools/aimap | AI surface map | Native JS, probes 10+ AI endpoint paths |
| POST /api/tools/metatron | AI pentest | DNS+HTTP recon then Groq analysis |
| POST /api/tools/voidaccess | OSINT | NVD CVE + GitHub search + Groq summary |
| POST /api/tools/nuclei | Vuln scan | Real binary at bin/nuclei v3.11.0 |
| POST /api/tools/garak | LLM probe | Native JS implementation using Groq API |
| GET /api/telegram/status | Telegram | Reads data/tg_config.json |
| POST /api/telegram/set-token | Telegram | Verifies token via BotFather API |
| POST /api/telegram/send | Telegram | Sends via bot token |

## Frontend pages (client/src/pages/)
ToolsHubPage, GeolocationPage, AimapPage, VoidAccessPage, MetatronPage, NucleiPage, GarakPage, WhatsAppPage, SignalPage, TelegramPage

## Routes in App.jsx
/tools, /tools/geolocation, /tools/aimap, /tools/voidaccess, /tools/metatron, /tools/nuclei, /tools/garak, /whatsapp, /signal, /telegram

## Nuclei binary
At bin/nuclei v3.11.0 — downloaded from GitHub releases. Writes JSON output to /tmp/nuclei_out.json then reads and parses.
