---
name: Signal crash fix
description: Why signal-bot died immediately on connect and how it was fixed
---

## The Rule
In signal-bot.js main(), the catch block after `await manager.startDaemon()` MUST call `process.exit(1)`, not just log and return. The parent spawnSignalBot() in server.js only auto-restarts on non-zero exit codes.

## Why
When startDaemon() throws (binary not downloaded, number not registered, daemon crash), the catch block just logs and the process exits with code 0. The parent's exit handler had `if (code !== 0)` guard so code-0 exits were NOT restarted — bot died permanently.

## How to apply
- signal-bot.js main() catch: `process.exit(1)` after logging
- server.js spawnSignalBot exit handler: always restart (use longer delay for code 0 = unregistered case, 30s vs 15s for errors)
