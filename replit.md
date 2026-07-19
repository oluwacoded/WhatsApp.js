# MFG_bot Hub

Multi-instance WhatsApp AI twin bot manager — replies as the owner in friendly Nigerian style, mirrors their texting patterns, runs on Railway.

## Run & Operate
- Local: `node server.js` on port 5000
- Build frontend: `cd client && npm run build` (output in `client/dist/`, served by Express)
- Push to GitHub via Contents API + `GITHUB_TOKEN` secret → triggers Railway auto-deploy
- Required env: `GROQ_API_KEY`, `PORT` (default 5000), `AUTH_PATH` (Railway only — set to `/data/auth_info_baileys` with mounted volume)

## Stack
- Node 18, Express, **baileys 6.7.16** (NOT @whiskeysockets), Groq llama-3.3-70b-versatile
- React 18 + Vite 4 + Tailwind dark dashboard
- Crypto polyfill MUST be the first require in server.js
- Dockerfile-based Railway deployment

## Where things live
- `server.js` — single-file backend, ~1400 lines (handler at ~360, AI block ~1130, scheduler ~1216, API endpoints ~1262)
- `client/src/App.jsx` — bot list (DEFAULT_BOTS) + REMOVED_IDS purge logic
- `client/src/hooks/useBotApi.js` — status polling with 3-poll debounce
- `data/settings.json` — per-instance saved settings (gitignored — overrides code defaults at runtime)
- `RAILWAY_VOLUME_SETUP.md` — persistent QR session instructions

## Architecture decisions
- **AUTH_PATH env var** lets Railway mount a persistent volume so WhatsApp session survives redeploys (otherwise QR scan needed every push)
- **chats.set rarely fires on Baileys 6.x** — `trackChat()` populates `allChats` from every incoming message instead
- **Per-contact 30-min cooldown** on proactive texting prevents WhatsApp spam-ban
- **askGroq has 3-tier fallback**: main prompt → soft retry → contextual hardcoded reply, so AI is never silent
- **Empty-Groq-reply was caused by toxic prompt** triggering content moderation — replaced with friendly mirror prompt

## Product
- Bot dashboard: Local + Railway Bot (production-3797 — single active backend)
- 200+ commands (`.ai`, `.ping`, `.tagall`, `.hidetag`, `.broadcast`, `.proactive`, `.send`, `.style`, `.menu`, etc.)
- AI replies to ALL messages (text/sticker/image/audio) with Nigerian friendly tone
- Style mirroring per-contact + global samples
- Proactive random texting every 10s check, 30-min per-contact cooldown
- Call blocking + "it's urgent" override
- Owner JID: 23409132883869
- Diagnostic endpoints: `/api/status`, `/api/diag`, `/api/recent` (recent now exposes `bigshot` flags)

## Big-shot features (all on by default — toggle via WhatsApp commands)
- **AI disclaimer** (`.disclaimer on/off/text/reset`) — first reply per contact per day announces "you're speaking to teddymfg's MIRROR AI"
- **Voice transcription** (`.transcribe on/off`) — voice notes → Groq Whisper-large-v3-turbo → AI replies to actual content (needs `form-data` npm pkg)
- **Vision** (`.vision on/off`) — images → Groq llama-3.2-11b-vision-preview → AI describes & replies meaningfully
- **Auto-takeover** (`.takeover on/off/min N/clear`) — when owner texts in any chat, AI pauses there for N minutes; owner stays in control even when online
- **Per-contact AI toggle** (`.aiat <jid> on/off/list`) — disable AI for specific contacts permanently
- **Anti-scam shield** (`.scam on/off/log`) — pattern-based scam + prompt-injection detection, alerts owner via DM
- **Long-term memory** (`.facts <jid?>`/`.factsclear`) — auto-extracts facts from conversations into `data/contact_facts.json`, injected into system prompt
- **Mood/time awareness** (`.mood on/off`) — system prompt adjusts tone by hour of day (morning sharp / evening chill / late-night sleepy)
- **Birthday tracking** (`.birthdays`) — extracts mentioned birthdays into `data/birthdays.json`
- **Status overview** (`.bigshot`) — shows all big-shot feature toggles in one message
- **Voice clone hooks** (`voiceCloneEnabled`) — needs `ELEVENLABS_API_KEY` + voice ID
- **Payments hooks** (`.pay`) — needs `PAYSTACK_SECRET` or `FLUTTERWAVE_SECRET`

## User preferences
- Bot personality: friendly Nigerian who mirrors owner style — NOT toxic/savage
- Random/proactive texting is the killer feature — keep it working
- Wants minimal QR-scanning friction (use Railway volume)
- Single active Railway backend: whatsappjs-production-3797 (https://whatsappjs-production-3797.up.railway.app)

## Gotchas
- `data/` directory is gitignored — Railway loses settings.json on first deploy and recreates from code defaults
- Every code push triggers Railway redeploy → kills WhatsApp session UNLESS AUTH_PATH volume is set
- Killing port 5000 before workflow restart: `fuser -k 5000/tcp`
- Large file pushes via curl fail with "argument list too long" — use Node `https` module instead
- Tag mentions need BOTH the `@JID` text AND the `mentions` array — text-only or array-only doesn't render

## Pointers
- GitHub: oluwacoded/WhatsApp.js
- Railway service: whatsappjs-production-3797 (https://whatsappjs-production-3797.up.railway.app)
- Groq docs: https://console.groq.com/docs
- Baileys docs: https://baileys.wiki
