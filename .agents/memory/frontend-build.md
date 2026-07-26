---
name: Frontend build setup
description: How to build the client frontend correctly
---

## The Rule
Build with `client/node_modules/.bin/vite build` from the `client/` directory. Never use global `vite` or `npx vite` (downloads wrong version).

## Why
Vite is installed locally in client/node_modules, not globally. The workspace package.json has `"build": "cd client && npm run build"` which calls `vite build` via the local install.

## Required packages in client/
- tone (for VoiceChangerPage.jsx)
- All others in client/package.json

## Navigation pattern
App.jsx uses `window.location.pathname` matching (NOT react-router-dom). New pages must use `window.location.href = '/path'` for navigation. Do NOT import react-router-dom — it's not in client/package.json.
