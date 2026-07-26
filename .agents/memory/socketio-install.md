---
name: Socket.io install workaround
description: How to install socket.io when npm is blocked by Replit firewall
---

## The Rule
Never run `npm install` from the workspace root — Replit's package firewall blocks baileys, which triggers a 403 and aborts the whole install even when installing unrelated packages.

## Why
The workspace package.json includes baileys which is blocked by the Replit security policy. npm install tries to install ALL missing packages, hits baileys, and fails.

## How to apply
1. Create `/tmp/sockinstall/package.json` with just `{"dependencies":{"socket.io":"^4.8.1"}}`
2. Run `npm install` there (no baileys in that package.json — succeeds)
3. Copy ALL packages from `/tmp/sockinstall/node_modules/` to workspace `node_modules/`
   - socket.io, engine.io, engine.io-parser, socket.io-adapter, socket.io-parser, base64id, @socket.io/*, ws, cors
4. Client packages (tone, react-router-dom, etc.) install fine from `client/` directory since no blocked packages there
