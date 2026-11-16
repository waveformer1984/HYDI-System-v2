# MOBILE_ACCEPTANCE

## What was tested (cloud)

| Surface | Test | Result |
|---------|------|--------|
| Heidi Mobile BFF | `tests/unit/heidi-mobile-api.test.js` | **pass** — pairing rejection, signed upstream relay, idempotent control |
| Mobile status contract | Code review + `api/mobile-status.js` shape | **IMPLEMENTED_UNVERIFIED** live round-trip |
| Static portal | `docs/index.html` (GitHub Pages) | **VERIFIED_PARTIAL** — UI only |

## What was not tested (requires Frank + phone)

| Surface | Blocker |
|---------|---------|
| Real device pairing cookie | `HYDI_SERVICE_SECRET` on Frank; `HEIDI_MOBILE_TOKEN` for :3006 |
| Chat SSE to Ollama | heidi-mobile-chat not running on VM |
| `/api/mobile-status` on tailnet | DNS `heidi-pc.tailc50af2.ts.net` fails from cloud |
| Push / notifications | No device credentials on VM |

## Manual steps (Frank + phone)

1. On Frank, ensure `heidi-mobile-chat` PM2 online with `HEIDI_MOBILE_TOKEN` in env.
2. Phone on Tailscale: open `https://heidi-pc.<tailnet>.ts.net` (or GitHub Pages shell with API URL + service secret).
3. Pair: `POST /api/heidi-mobile/pair` (or in-app flow).
4. Verify: `GET /api/heidi-mobile/status` returns `ok` and live-derived fields (not mocked).
5. Chat: send message; confirm SSE and memory `conversation_id` persistence.

## Verdict

| Claim | Status |
|-------|--------|
| Mobile **code** paths | **VERIFIED_PARTIAL** (unit) |
| Phone talks to **live** HYDI | **BLOCKED_EXTERNAL** |