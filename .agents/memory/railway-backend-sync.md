---
name: Railway backend sync
description: Durable constraints for syncing backend changes into the Railway repository
---

The Railway repository’s existing `client/` frontend is the source of truth for the product design and must remain unchanged when porting backend behavior.

**Why:** The Railway frontend and the Replit artifact histories are unrelated; directly merging the Replit branch risks replacing the live design and exposing runtime data.

**How to apply:** Base backend-only work on the current Railway `origin/main`, keep credentials, sessions, contacts, and generated runtime files out of Git, configure `DATA_DIR` for the persistent Railway volume, and register every `/api/*` route before the final SPA catch-all.