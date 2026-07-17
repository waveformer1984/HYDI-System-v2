# Archived: `api/ws/route.js` placeholder

Moved here 2026-07-17 while reviewing `ISSUES_FOUND.md` #34 (the remaining
ambiguous unbridged `api/**` routes, `ROADMAP.md` P1 item 6).

This file never implemented a WebSocket endpoint — it returned a static
JSON body describing hardcoded `ws://localhost:3005/ws/*` URLs that don't
correspond to any real listener in this codebase today (the port and path
scheme match an old standalone dev server, not the current app). No other
file `require()`s or `import`s it, no route table lists it, and no client
(mobile or otherwise) calls `/api/ws/route`. Confirmed dead before moving.

Kept for reference rather than deleted, matching the convention already
established by `archive/dead-keymaker-and-break-glass-prototypes/`. If a
real WebSocket endpoint is ever needed, build it fresh against the current
architecture rather than resurrecting this placeholder.
