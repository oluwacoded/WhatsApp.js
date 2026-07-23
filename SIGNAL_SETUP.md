# MFG Signal Bot — Setup Guide

The Signal bot runs alongside your WhatsApp bot on Railway. It needs:
1. signal-cli-rest-api (a separate Railway service)
2. A phone number registered with Signal

---

## Step 1 — Get a phone number for Signal

You need a number that Signal can SMS a verification code to.

| Option | Cost | How |
|--------|------|-----|
| Google Voice | Free | voice.google.com — get a US number |
| TextNow | Free | textnow.com — virtual number |
| Second SIM | Varies | Any Nigerian SIM works |

The number format must include country code: `+12345678901` or `+2348012345678`

---

## Step 2 — Deploy signal-cli-rest-api on Railway

1. Go to [railway.app](https://railway.app) → New Project
2. Click **Deploy from Docker image**
3. Enter: `bbernhard/signal-cli-rest-api:latest`
4. Set environment variable in that service:
   ```
   MODE=normal
   ```
5. The service exposes port `8080` — note the Railway internal URL (e.g. `signal-cli.railway.internal:8080`)

> **Note:** If both services are in the same Railway project, use the internal hostname. Otherwise use the public URL.

---

## Step 3 — Register your Signal number with signal-cli

Once signal-cli-rest-api is running, register your number:

**Option A: Via captcha (recommended)**
```bash
# Request registration (replace with your number)
curl -X POST "https://YOUR_SIGNAL_CLI_URL/v1/register/+12345678901" \
  -H "Content-Type: application/json" \
  -d '{"use_voice": false}'
```

Signal will send an SMS verification code. Then verify:
```bash
curl -X POST "https://YOUR_SIGNAL_CLI_URL/v1/register/+12345678901/verify/123456" \
  -H "Content-Type: application/json"
```
Replace `123456` with the code you received.

**Option B: Link existing Signal account**
If you already have Signal on a phone and want to link it as a second device:
```bash
curl "https://YOUR_SIGNAL_CLI_URL/v1/qrcodelink?device_name=MFGBot"
# Scan the returned QR code in Signal app → Settings → Linked Devices → Link a Device
```

---

## Step 4 — Set environment variables in your main Railway service

Add these to your existing Railway service (where server.js runs):

```
SIGNAL_NUMBER=+12345678901
SIGNAL_CLI_URL=http://signal-cli.railway.internal:8080
```

Or if signal-cli is on a different project:
```
SIGNAL_CLI_URL=https://your-signal-cli-service.up.railway.app
```

---

## Step 5 — Redeploy

Push the code to GitHub. Railway will redeploy automatically.

The Signal bot starts automatically when `SIGNAL_NUMBER` is set. You'll see in logs:
```
[Signal] MFG Signal Bot starting
[Signal] Number:  +12345678901
[Signal] CLI URL: http://...
[Signal] ✅ WebSocket connected — receiving live messages
```

---

## Commands available on Signal

All work the same as WhatsApp:

```
.menu          — full command list
.joke          — random joke
.fact          — random fact
.quote         — motivational quote
.truth | .dare — party games
.8ball <q>     — magic 8-ball
.roast <name>  — savage roast
.flip | .roll | .slot — luck games
.riddle        — riddle game
.weather <city> — live weather
.define <word> — dictionary
.translate <lang> <text> — translation
.explain <topic> — simple explanation
.coin balance  — MFGC balance
.ticket        — boarding pass generator
.ai on|off     — toggle AI for this chat
.time | .date  — current time/date
.ping          — check bot is alive
```

---

## Troubleshooting

**Bot not responding:**
- Check `SIGNAL_NUMBER` and `SIGNAL_CLI_URL` are set in Railway env vars
- Check Railway logs for `[Signal]` prefix entries
- Verify signal-cli-rest-api service is running on Railway

**"Registration required" errors:**
- Complete Step 3 — number must be registered/linked before messages can be sent

**Bot responds on WhatsApp but not Signal:**
- The Signal bot runs as a child process — check for `[Signal] MFG Signal Bot starting` in your main service logs

**Messages from wrong number:**
- Signal uses the international format (e.g. `+2348012345678`) — make sure `SIGNAL_NUMBER` exactly matches the registered number including the `+` prefix
