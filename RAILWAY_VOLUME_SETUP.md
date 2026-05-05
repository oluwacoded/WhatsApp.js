# Railway Persistent QR — One-Time Setup

This stops the "scan QR after every code update" problem **permanently**.

## How it works
The WhatsApp session files (in `auth_info_baileys/`) get wiped every time Railway redeploys. A **Persistent Volume** keeps them across deploys.

## Setup (do this ONCE per Railway service — Bot 1 and Bot 2)

For **each** Railway service (`whatsappjs-production-6831` and `whatsappjs-production`):

### 1. Add a Volume
1. Open Railway dashboard → click the service
2. Click **Settings** tab
3. Scroll to **Volumes** section → click **+ New Volume**
4. **Mount Path:** `/data`
5. Click **Create**

### 2. Set the AUTH_PATH env var
1. Still in the service, click the **Variables** tab
2. Click **+ New Variable**
3. **Name:** `AUTH_PATH`
4. **Value:** `/data/auth_info_baileys`
5. Click **Add**

### 3. Redeploy ONCE
The service will redeploy automatically when you add the variable.
- Wait for it to come up
- Open the dashboard → scan the QR ONE final time
- That's it — from now on, every code update keeps the session alive

## Verify it worked
After scanning + redeploying once more:
```
curl https://whatsappjs-production-6831.up.railway.app/api/status
```
Should still show `"connected":true` even right after a deploy.

## Notes
- Volume costs apply on Railway (very small — pennies/month for a few MB of session files)
- If you ever want a clean slate, delete the volume and redeploy
- Local development still uses `auth_info_baileys/` in the project root (no volume needed)
