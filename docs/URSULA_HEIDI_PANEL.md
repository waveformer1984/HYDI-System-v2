# Heidi chat panel in Ursula

Every Ursula page has a Heidi chat panel in the bottom-right corner. It is
open by default. ✕ closes it to a small **H** button, and that choice is
remembered on this browser until you reopen it.

It talks to the real heidi-core, so it does everything the phone chat does:
- conversations continue across reloads (the open conversation is remembered);
- long-term memory;
- `system report`, `tasks`, `task approve <id>`, `trace <id>` and `memory …`;
- tool calls, shown as small ⚙ chips above the answer.

## How it connects

```
browser (Ursula on this PC)
  └─ /api/heidi/chat                    → heidi-core POST /chat-tools  (streamed)
  └─ /api/heidi/conversations/:id/messages → heidi-core GET /conversations/:id/messages
  └─ /api/heidi/health                  → heidi-core GET /health (status dot)
```

| File | Role |
|---|---|
| `apps/ursula-frontend/src/components/heidi/HeidiChatPanel.tsx` | the panel, mounted in `src/app/layout.tsx` |
| `apps/ursula-frontend/src/lib/heidi-relay.ts` | the local-only check and the heidi-core address/secret |
| `apps/ursula-frontend/src/lib/heidi-sse.ts` | reads heidi-core's streamed reply |
| `apps/ursula-frontend/src/app/api/heidi/*` | the three relay routes |

Settings (server side only, both optional):
- `HEIDI_CORE_URL` (default `http://127.0.0.1:3459`);
- `HEIDI_SECRET`, sent as `x-heidi-secret` when set.

## Security

heidi-core trusts callers on this PC, so this relay must not let other
machines in through Ursula.

1. **The real boundary.** Ursula's PM2 entry binds
   `next start --hostname 127.0.0.1` (PR #473), so only this PC can reach it.
2. **The second guard.** Every relay route answers 403 `local_only`, without
   contacting heidi-core, unless both of these hold:
   - the request's Host is `127.0.0.1`, `localhost` or `[::1]`;
   - it carries no proxy headers pointing elsewhere (`X-Forwarded-For`,
     `X-Forwarded-Host`, `Forwarded`, `Tailscale-User-Login`).
   That covers running Ursula some other way, such as `next dev` on all
   interfaces or behind `tailscale serve`.
3. **Input limits.** Messages are capped at 8000 characters, and conversation
   ids must be 1–80 `[A-Za-z0-9_-]` characters.

From the phone, use the Heidi mobile chat (`:3006`, device login) instead.

## Verification

| Check | Result |
|---|---|
| `src/lib/heidi-relay.test.ts`: local check, relay against a fake heidi-core (streaming, ids, secret), refusals, history, health, core down → 503 | passed (8) |
| `src/components/heidi/HeidiChatPanel.test.tsx`: open by default, send and stream, conversation remembered, close/reopen across reloads, history reload, refusal message | passed (3) |
| Full Ursula vitest (13 files / 124 tests), `tsc --noEmit`, eslint | passed |
| Real heidi-core + `next dev` + Chromium on `/workspace`: Tasks and `memory status` answered live; LAN Host → 403; stays closed after reload; fits a 390px screen | passed |
