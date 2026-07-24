# MFG Signal Bot — Setup Guide

The Signal bot runs **inside your existing Railway service** alongside the WhatsApp bot.
No second service. No Docker. No Java to install. The bot downloads everything itself.

---

## Step 1 — Get a phone number for Signal

You need a number Signal can send a one-time SMS verification code to.

| Option | Cost | How |
|--------|------|-----|
| **Google Voice** | Free | [voice.google.com](https://voice.google.com) — sign in with Google, pick any US number |
| **TextNow** | Free | [textnow.com](https://textnow.com) — free virtual US number |
| **Second SIM** | Varies | Any Nigerian SIM or other country number works |

Format: always use full international format with `+` — e.g. `+12025551234` or `+2348012345678`

---

## Step 2 — Set one environment variable on Railway

In your existing Railway service (the one running `server.js`):

```
SIGNAL_NUMBER = +12025551234
```

That's the **only** env var needed. `SIGNAL_CLI_URL` is no longer required.

---

## Step 3 — Redeploy

Push to GitHub → Railway auto-deploys.

On the **first deploy with SIGNAL_NUMBER set**, the bot will:
1. Download signal-cli (~90MB, self-contained binary with Java bundled) — takes ~60–90s
2. Start it as a local daemon inside the same service
3. Log: `[Signal-CLI] ✅ signal-cli vX.X.X ready`

Subsequent deploys reuse the cached binary (instant).

> **Check logs for:** `[Signal-CLI] ✅ signal-cli vX.X.X ready` then `[Signal-CLI] Starting daemon...`

---

## Step 4 — Register your Signal number (one-time)

Once the bot is deployed, register your number by calling the API.

Replace `YOUR_RAILWAY_URL` with your Railway service URL (e.g. `https://your-bot.up.railway.app`):

**Step 4a — Request SMS code:**
```bash
curl -X POST "https://YOUR_RAILWAY_URL/api/signal/register" \
  -H "Content-Type: application/json" \
  -d '{"number": "+12025551234"}'
```

Signal will send an SMS to your number with a 6-digit code.

**Step 4b — Verify with the code:**
```bash
curl -X POST "https://YOUR_RAILWAY_URL/api/signal/verify" \
  -H "Content-Type: application/json" \
  -d '{"number": "+12025551234", "code": "123456"}'
```

Replace `123456` with the actual code you received.

After verification, the Signal bot restarts automatically and is ready to receive messages.

---

## Step 5 — Test it

Open Signal on your phone, send a message to your new Signal number.

The bot will reply with the same AI persona and commands as WhatsApp. 🎉

---

## Commands available on Signal

```
.menu           — full command list
.ai on|off      — toggle AI replies for this chat
.weather <city> — live weather
.define <word>  — dictionary
.translate <lang> <text>
.explain <topic>
.summarize <text>
.joke | .fact | .quote
.truth | .dare
.8ball <question>
.roast <name> | .compliment <name>
.flip | .roll | .slot
.riddle | .answer
.ship <a> and <b>
.coin balance   — MFGC balance
.ticket         — flight boarding pass generator
.time | .date
.ping | .uptime
```

---

## Check Signal bot status

```bash
curl "https://YOUR_RAILWAY_URL/api/signal/status"
```

Returns: phase (idle/downloading/starting/ready/error), version, daemon PID, etc.

---

## Troubleshooting

**"Number not registered" — daemon exits immediately:**
- Complete Step 4 first — the number must be registered/verified before the daemon will run

**Registration fails with "captcha required":**
- Signal sometimes requires a captcha token for new registrations, especially on cloud IPs
- Solution: link an existing Signal account instead of registering fresh:
  ```bash
  # This returns a QR code URL — scan it in Signal app
  # Settings → Linked Devices → Link a Device
  curl "https://YOUR_RAILWAY_URL/api/signal/link-device"
  ```
  *(Task #7 — admin command registration — will make this easier)*

**Bot not responding on Signal but WhatsApp works:**
- Check Railway logs for `[Signal]` prefix lines
- Look for `[Signal-CLI] ✅ Subscribed — Signal bot is live!`
- If you see `[signal-cli]` errors, the number may need re-registration

**Download takes too long:**
- First deploy only — subsequent deploys skip the download (binary cached in `data/signal-cli/`)
- If Railway volume is not configured, binary re-downloads on every deploy

**Messages from `SIGNAL_NUMBER` env var not matching:**
- Use exact international format: `+12025551234` (not `12025551234`)
