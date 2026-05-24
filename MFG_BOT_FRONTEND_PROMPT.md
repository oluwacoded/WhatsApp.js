# MFG Bot — Complete Frontend Rebuild Prompt

Use this prompt verbatim to rebuild the exact frontend control panel for a WhatsApp bot backend built with Node.js + Baileys. Every feature, API endpoint, safety behaviour, and style detail is documented below.

---

## OVERVIEW

Build a single-page HTML control panel (no frameworks, pure HTML + CSS + vanilla JS, all in one file: `client/dist/index.html`) that serves as the dashboard for a WhatsApp automation bot. The page is served statically by an Express server on port 5000.

**Visual theme:** Dark UI. Black/near-black background, WhatsApp green accent (`#25d366`), red for danger, amber for warnings. Rounded cards. Mobile-responsive.

**Bot name displayed:** MFG Bot  
**Subtitle:** Control Panel — teddymfg

---

## COLOUR TOKENS (CSS variables on `:root`)

```css
--bg:      #0d0d0f   /* page background */
--surface: #16181c   /* card background */
--border:  #2a2d35
--accent:  #25d366   /* WhatsApp green */
--accent2: #128c50
--danger:  #e74c3c
--warn:    #f39c12
--text:    #e8eaed
--muted:   #8b9099
--radius:  12px
```

---

## LAYOUT

- Fixed `<header>` at top with: green robot emoji logo circle (36px), bot name + subtitle, and a live status pill on the right.
- `<div class="page">` centred, max-width 900px, padding 28px 20px.
- Cards are `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: 12px`, `padding: 24px`, `margin-bottom: 20px`.
- A fixed `<div id="toast">` at the bottom-center of screen for transient notifications (green border for ok, red for err, auto-dismisses after 3.5s).

---

## HEADER

```html
<header>
  <div class="logo">🤖</div>   <!-- green circle, 36px -->
  <div>
    <h1>MFG Bot</h1>
    <p>Control Panel — teddymfg</p>
  </div>
  <div class="header-right">
    <div class="pulse offline" id="pulse-dot"></div>   <!-- animated dot -->
    <div id="status-badge" class="offline">Offline</div>
  </div>
</header>
```

**Pulse dot states:**
- `.pulse` (no extra class) = green, pulsing glow animation → Connected
- `.pulse.qr` = amber, pulsing → Waiting for QR scan
- `.pulse.offline` = red, no animation → Disconnected

**Badge states:** `class=""` = Online (green bg), `class="qr"` = Waiting QR (amber), `class="offline"` = Offline (red)

---

## SECTION 1 — LIVE STATS CARD (always visible)

Four stat tiles in a responsive grid (`repeat(auto-fit, minmax(120px,1fr))`):

| ID | Label |
|---|---|
| `#s-uptime` | Uptime (S) |
| `#s-msgs` | Messages |
| `#s-chats` | Chats |
| `#s-ai` | AI Mode |

Stat tile style: dark bg, green large number (28px bold), small muted uppercase label.

**Polling:** Call `GET /api/status` every 5 seconds and on page load.

Response shape:
```json
{
  "connected": true,
  "hasQr": false,
  "uptime": 342,
  "messageCount": 17,
  "chatCount": 5,
  "aiEnabled": true
}
```

Uptime formatter: show `Xs` if < 60s, `Xm` if < 1h, `Xh Ym` otherwise.

---

## SECTION 2 — CONNECTED BANNER (show only when `connected: true`)

```html
<div id="connected-section">  <!-- class="show" when connected, "" otherwise -->
  <div class="card">
    <div class="connected-banner">  <!-- green-tinted bg, green border -->
      <div class="icon">✅</div>
      <div>
        <h2>Bot is Live</h2>
        <p>Your WhatsApp bot is online and accepting commands.</p>
      </div>
    </div>
    <div class="danger-row">
      <button class="danger" onclick="doLogout()">Logout & Re-pair</button>
      <button class="muted" onclick="pollStatus()">Refresh</button>
    </div>
  </div>
</div>
```

---

## SECTION 3 — QR CODE PANEL (show only when `hasQr: true` and not connected)

```html
<div id="qr-section">  <!-- class="show" to reveal -->
  <div class="card">
    <div class="card-title">Scan QR Code</div>
    <div id="qr-canvas-wrap">
      <img id="qr-img" src="" alt="QR Code" />  <!-- 240x240, white bg, rounded -->
      <p>Open WhatsApp → Settings → Linked Devices → Link a Device → scan this code</p>
    </div>
    <div class="divider">or use phone number pairing below</div>
  </div>
</div>
```

**QR image source:** `GET /api/qr/image?t={timestamp}` — the server returns a PNG of the current QR code. Append a timestamp query param to bust cache every refresh.

When `hasQr` becomes true, call `renderQr()` which sets `img.src = "/api/qr/image?t=" + Date.now()`.

---

## SECTION 4 — PAIRING WIZARD (show when NOT connected)

A 3-step numbered wizard card:

**Step 1 — Get a number ready**  
Text: "Your bot needs its own WhatsApp number — a second SIM, virtual number, or any number that has WhatsApp installed. This is the number the bot will use to send and receive messages."

**Step 2 — Enter the bot's phone number**  
Text: "Include country code, digits only. Example: 2349012345678 for a Nigerian number."  
Input: `type="tel"`, id `phone-input`, placeholder `2349012345678`, maxlength 15.  
Button: "Get Pairing Code" → calls `requestPairingCode()`

**Step 3 — Enter the code in WhatsApp**  
Text: "After you click 'Get Pairing Code', an 8-digit code will appear below. Open WhatsApp on the bot's phone and enter it."

**Pairing code box** (hidden initially, `class="code-box"`, shown with `class="code-box show"`):

```
[small muted text] "Your pairing code — valid for ~60 seconds"
[42px bold green monospace code display]  id="pairing-code-display"

Steps list (numbered):
  1. Open WhatsApp on the bot's phone
  2. Tap ⋮ (menu) → Linked Devices
  3. Tap Link a Device
  4. Tap "Link with phone number instead"
  5. Enter the code above exactly as shown
  6. Done — bot is now live ✅

[note] "Once linked, the bot runs independently. You don't need the phone nearby — it handles everything on its own."
```

**API call:** `POST /api/pair` body `{ phone: "2349012345678" }` → response `{ code: "ABCD-1234" }` or `{ error: "..." }`

While requesting: disable button, show spinner + "Requesting..." text.  
On success: display code, show code-box, toast success, auto-poll status at 5s, 12s, 25s intervals.

---

## SECTION 5 — AUTO-MESSAGE CAMPAIGN (show ONLY when bot is connected)

```html
<div id="campaign-section">  <!-- class="show" when connected -->
```

Card title: `📣 Auto-Message Campaign`

**4 tabs:** Contacts · Send · Templates · Progress  
Tab bar: flex row, dark bg pill, active tab gets surface bg + border.

---

### TAB 1 — CONTACTS

**File upload drop zone** (dashed border, click or drag & drop):
- Accepts `.csv`, `.txt`, `.vcf` (phone contacts export)
- Shows `📁` icon, "Click to upload or drag & drop" text
- On hover/drag: border turns green, slight green bg tint
- Hidden `<input type="file" id="file-input" accept=".csv,.txt,.vcf">`

**Three mode buttons below drop zone:**
- `🔄 Replace All` — replaces existing contacts entirely
- `➕ Add to Existing` — merges with existing contacts
- `🗑 Clear All` — deletes all contacts (confirms first)

**File upload API:** `POST /api/contacts/upload?mode=replace|merge` (multipart/form-data, field name `file`)  
Response: `{ saved: 213, contacts: [...] }`

**Manual paste section** (divider "or paste manually"):
- `<textarea id="contacts-raw">` placeholder shows example formats
- Formats accepted (one per line):
  - Just a number: `2349012345678`
  - Name + number: `John, 2348034567890`
  - Number + name: `2347011223344, Mary`
- `💾 Save Pasted` button → `POST /api/contacts` body `{ raw: "..." }`
- Contact count display: `id="contacts-count"`

**Hint text:** "Use `{name}` in your message — the bot replaces it with each person's name."

**WhatsApp Broadcast Group creation** (bottom of contacts tab, after a border-top divider):
- Section title: `📢 Create WhatsApp Group from Contacts`
- Description: "Creates a WhatsApp group with all your saved contacts instantly. Max 256 members."
- Input: group name, placeholder "Group name (e.g. MFG Broadcast)"
- Button: `📢 Create Group` → `POST /api/broadcast/create` body `{ name: "..." }`
- Response display div `id="broadcast-result"`: shows green success or red error message

**Load contacts on tab switch:** `GET /api/contacts` → response `{ contacts: [{name, phone}, ...] }`  
Populate textarea and count displays.

---

### TAB 2 — SEND (CAMPAIGN)

- `<textarea id="camp-message">` min-height 160px, placeholder: "Hey {name}! 👋 I just wanted to reach out..."
- Safety notice (hint text): "🛡 Account-safe mode: Verifies each number is on WhatsApp before sending, simulates typing, sends in random batches of 2–4 with 30–90s gaps, then a 3–6 min cooldown. Hard cap: 1,000 msgs/day."
- `▶ Start Campaign` button (id `start-btn`) → calls `startCampaign()`
- `⏹ Stop` button (id `stop-btn`, hidden by default, red bg) → calls `stopCampaign()`
- Contact count display: `id="camp-contacts-count"` (e.g. "213 contacts loaded")

**Start API:** `POST /api/campaign/start` body `{ message: "Hey {name}!..." }`  
Response: `{ started: true, total: 213 }` or `{ error: "..." }`

On success: disable start-btn, show stop-btn, switch to Progress tab, start polling campaign status every 2s.

**Stop API:** `POST /api/campaign/stop`

---

### TAB 3 — TEMPLATES

**Save new template form** (dark-bg panel with label "SAVE NEW TEMPLATE"):
- `<input id="tmpl-name">` placeholder "Template name (e.g. Promo Blast)"
- `<textarea id="tmpl-text">` placeholder "Hey {name}! 👋 Check out our new offer..."
- `💾 Save Template` button → `POST /api/templates` body `{ name, text }`

**Templates list** `id="templates-list"`:
- Each template renders as a "chip" card: name (green bold), preview text (truncated), `Use` button + `✕` delete button
- `Use` → loads text into campaign editor, switches to Send tab, shows toast "Template loaded ✅"
- `✕` → `DELETE /api/templates/{id}`, then reload list
- Load on tab switch: `GET /api/templates` → `{ templates: [{id, name, text}, ...] }`

---

### TAB 4 — PROGRESS

**Stats row** (flex, wrapping):
```
Total: [id=p-total]   Sent: [id=p-sent, green]   Failed: [id=p-failed, red]
Skipped: [id=p-skipped, muted]   Not on WA: [id=p-notwa, amber]   Status: [id=p-status]
```

**Daily cap bar** `id="p-dailycap"` (small muted text):  
Shows: "Daily cap: X / 1000 sent today — Y remaining"  
Turns red when < 20 remaining.

**Progress bar:** dark bg track, green fill, animated width transition.  
ID: `p-bar`, width = `((sent + failed) / total * 100)%`

**Current action line** `id="p-current"`:
- While checking: `🔍 Verifying WhatsApp: [name]`
- While sending: `📤 Sending to: [name]`
- During cooldown: empty

**Cooldown banner** `id="p-cooldown"` (hidden by default):  
Amber-tinted bg, amber border, amber text:  
`⏸ Cooldown active — waiting [Xm Ys] before next batch to protect your WhatsApp account.`  
`id="p-cooldown-secs"` updates live with countdown (minutes + seconds format).

**Campaign log** `id="camp-log"` (monospace, scrollable, max-height 180px):  
One row per event, colour-coded:
- `✓ [name]` — green → sent
- `✗ [name] — [error]` — red → failed
- `↷ [name] — Not on WhatsApp` — muted italic → skipped
- `⏸ [cooldown message]` — amber italic → cooldown
- `★ Finished — X sent, Y failed, Z not on WhatsApp` — green bold → done
- `• [text]` — muted → stopped/other

**Status label logic:**
- Running + checking: "Checking WA… 🔍"
- Running + cooldown: "Cooling Down ⏸"
- Running (sending): "Running ▶"
- Finished: "Finished ✅"
- Idle: "Idle"

**Poll:** `GET /api/campaign/status` every 2s while running.

Campaign status response shape:
```json
{
  "running": true,
  "total": 213,
  "sent": 6,
  "failed": 0,
  "skipped": 2,
  "notOnWA": 2,
  "current": "Don Mikky",
  "checking": false,
  "cooldown": true,
  "cooldownEndsAt": "2026-05-24T10:45:30.000Z",
  "dailySent": 6,
  "dailyCap": 1000,
  "log": [
    { "status": "cooldown", "text": "Batch done — cooling down 4m to protect your account" },
    { "status": "sent", "phone": "2347086857975", "name": "Don Mikky" }
  ],
  "startedAt": "2026-05-24T10:42:00.000Z",
  "stoppedAt": null,
  "message": "Hey {name}!..."
}
```

When `running` becomes false: clear poll interval, re-enable start-btn, hide stop-btn.

---

## SECTION 6 — SESSION CONTROL CARD (show only when connected)

```html
<div class="card" id="danger-card" style="display:none;">  <!-- display:block when connected -->
  <div class="card-title">Session Control</div>
  <div class="danger-row">
    <button class="danger" onclick="doLogout()">🔓 Logout & Reset</button>
    <button class="muted" onclick="pollStatus()">↺ Refresh Status</button>
  </div>
  <p style="font-size:12px;color:var(--muted);margin-top:12px;">
    Logout wipes the current session. You'll need to re-pair with WhatsApp after.
  </p>
</div>
```

**Logout:** Confirms with `confirm()`, then `POST /api/logout`, toasts success, hides code-box, polls status after 2s.

---

## COMPLETE API SURFACE

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/status` | Live bot stats + connection state |
| GET | `/api/qr/image` | PNG of current WhatsApp QR code |
| POST | `/api/pair` | Request 8-digit pairing code |
| POST | `/api/logout` | Disconnect + wipe session |
| GET | `/api/contacts` | Get all saved contacts |
| POST | `/api/contacts` | Save pasted contacts (raw text) |
| POST | `/api/contacts/upload?mode=replace\|merge` | Upload .csv/.txt/.vcf file |
| DELETE | `/api/contacts` | Clear all contacts |
| POST | `/api/broadcast/create` | Create WA group from contacts |
| GET | `/api/templates` | List saved message templates |
| POST | `/api/templates` | Save a new template |
| DELETE | `/api/templates/:id` | Delete a template by ID |
| POST | `/api/campaign/start` | Start bulk message campaign |
| POST | `/api/campaign/stop` | Stop running campaign |
| GET | `/api/campaign/status` | Live campaign progress |

---

## CAMPAIGN SAFETY BEHAVIOUR (backend logic — document here so the UI is accurate)

The backend implements all of these — the frontend only displays the state:

1. **WhatsApp number verification** — before sending to each contact, calls `sock.onWhatsApp(phone)`. If not registered on WhatsApp, contact is marked as skipped (not on WA), no send attempt is made. This prevents failed-send flags.

2. **Typing simulation** — `sock.sendPresenceUpdate('composing', jid)` → wait 2–5s → `sock.sendPresenceUpdate('paused', jid)` → send message. Mimics human typing behaviour.

3. **Per-message random delay** — 30–90 seconds between each message (randomised).

4. **Random batch size** — 2–4 messages per batch (re-randomised each batch).

5. **Batch cooldown** — 3–6 minutes after completing each batch (re-randomised each cooldown).

6. **Daily hard cap** — maximum 1,000 messages per calendar day. Resets at midnight. Tracked in `data/daily_sends.json` as `{ date: "YYYY-MM-DD", count: N }`. Campaign stops automatically when cap is reached.

---

## VISIBILITY RULES (state machine)

| Element | Connected | hasQr + !connected | Offline |
|---|---|---|---|
| `#connected-section` | show | hide | hide |
| `#qr-section` | hide | show | hide |
| `#pair-section` | hide | show (alongside QR) | show |
| `#campaign-section` | show | hide | hide |
| `#danger-card` | show | hide | hide |
| pulse-dot | green pulse | amber pulse | red static |
| badge text | Online | Waiting QR | Offline |

---

## ADDITIONAL UI BEHAVIOURS

- **Toast** `function toast(msg, type)` — `type="ok"` (green) or `type="err"` (red). Fixed bottom-center, auto-hides after 3.5s.
- **Spinner** — `<span class="spin"></span>` inline-block circle border animation, used inside buttons during loading.
- **Divider** — horizontal rule with centered text label, achieved with flex + pseudo-element borders.
- **Enter key on phone input** — triggers `requestPairingCode()`.
- **Status poll on load** — `pollStatus()` called immediately + `setInterval(pollStatus, 5000)`.
- **Campaign poll** — `setInterval(pollCampaign, 2000)` only while `running: true`. Also runs once when switching to Progress tab.
- **loadContacts()** called on page load and when switching to Contacts tab.
- **loadTemplates()** called when switching to Templates tab.
- **HTML escaping** — all user-generated content (template names/text) must be escaped with a helper: `replace /&/g → &amp;`, `< → &lt;`, `> → &gt;`, `" → &quot;`.

---

## FILE UPLOAD FLOW (detailed)

```javascript
async function uploadContactFile(file) {
  // 1. Show loading state on drop zone
  const fd = new FormData();
  fd.append("file", file);
  // 2. POST to /api/contacts/upload?mode=replace (or merge)
  const r = await fetch("/api/contacts/upload?mode=" + uploadMode, { method: "POST", body: fd });
  const d = await r.json();
  // 3. Update count displays, reload contacts, show toast
}
```

The `uploadMode` variable toggles between `"replace"` and `"merge"` depending on which button was clicked.

---

## RESPONSIVE BREAKPOINTS

```css
@media (max-width: 600px) {
  .pairing-code { font-size: 30px; letter-spacing: 5px; }
  .stat-val { font-size: 22px; }
}
```

Stats grid uses `auto-fit minmax(120px, 1fr)` so it wraps naturally on small screens.

---

## FONT STACK

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
```

Monospace (pairing code, campaign log): `"Courier New", monospace`

---

## HOW TO SERVE

This file lives at `client/dist/index.html`. The Express backend serves it as a static file:

```javascript
app.use(express.static(path.join(__dirname, "client/dist")));
```

No build step required — it's a plain HTML file with inline CSS and JS.

---

## SUMMARY OF EVERY FEATURE (checklist)

- [x] Live status header with animated pulse dot + badge (3 states)
- [x] Live stats card: uptime, messages, chats, AI mode (polls every 5s)
- [x] Connected banner (green, shows "Bot is Live")
- [x] QR code display (fetched as PNG from server, auto-renders when available)
- [x] Pairing wizard (3 steps) with phone number input + 8-digit code display
- [x] Pairing code instructions panel with step-by-step guide
- [x] Auto-dismiss toast notifications (ok/err)
- [x] Campaign section (4 tabs, visible only when connected)
- [x] Contacts tab: drag-and-drop file upload (.csv/.txt/.vcf), Replace/Add/Clear modes, manual paste textarea, contact count
- [x] WhatsApp broadcast group creation from saved contacts
- [x] Send tab: message editor with {name} personalisation, safety notice, Start/Stop buttons
- [x] Templates tab: save/load/delete named message templates, one-click load into editor
- [x] Progress tab: total/sent/failed/skipped/notOnWA counters, daily cap tracker, progress bar, current action line, live cooldown countdown, colour-coded campaign log
- [x] Session control card: Logout & Reset + Refresh buttons
- [x] Full mobile responsiveness
