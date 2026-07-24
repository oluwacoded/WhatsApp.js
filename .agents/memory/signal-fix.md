---
name: Signal Reconnection Fix
description: Root cause of Signal bot going offline immediately, and the fixes applied.
---

## Root cause
`signal-cli-manager.js` (original) had:
- TCP connect timeout: **12s** — daemon often takes longer to bind the port
- Reconnect on TCP drop: **fixed 5s delay** — no backoff, floods the daemon
- No keepalive — silent TCP drops not detected until next RPC call
- Initial wait before first TCP attempt: **3.5s** — too short for slow machines
- Retry attempts: **5** — insufficient

## Fixes applied (in `artifacts/api-server/src/services/signal.ts`)
1. TCP timeout: 12s → **45s**
2. Reconnect: fixed 5s → **exponential backoff** (5s→10s→20s→40s, max 60s), `reconnectAttempts` counter reset on success
3. Keepalive: **30s ping** via `getConfiguration` RPC after `subscribeReceive` success
4. Initial daemon wait: 3.5s → **8s**
5. Retry attempts: 5 → **8** (first 3 retries at 2s, remaining at 5s)
6. `subscribeReceive` failure no longer kills startup — bot continues with `ready:true`

**Why:** The daemon starts its JVM and binds the TCP port asynchronously. The 12s timeout was hit before the port opened on slower Railway dynos, causing immediate disconnect and infinite restart loops.

**How to apply:** Any change to the TCP connect logic in `signal.ts` should maintain all 5 fixes above. Test by starting daemon and watching it stay in `ready` phase for 2+ minutes.
