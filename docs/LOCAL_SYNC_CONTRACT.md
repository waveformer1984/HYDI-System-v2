# Local sync contract (= Vercel routes)

Phone and Termux thin clients must use the **same JSON contracts** as the historical Vercel deployment—no parallel shapes.

## Status snapshot (primary)

| Surface | Method | Auth | Stable fields |
|---------|--------|------|----------------|
| `api/mobile-status.js` | GET | `x-hydi-service-token` or device cookie | `ok`, `alert`, `system`, `drift`, `heals_24h`, `streams`, `silent`, `ms`, `ts` |
| `api/hydi/sync.js` | GET | `requireAuth` + `status:view` | `ok`, `status`, `emoji`, `trend`, `summary`, `dashboard`, `timestamp` |

**Rule:** Local Frank serves these via `heidi-web` (port 3000). Tailscale clients hit the same paths on the tailnet hostname—not a forked payload.

## Mutations (secondary)

`POST api/hydi/sync.js` actions: `heal`, `trends`, `escalation`, `event` — each returns `{ ok: true, action, result? }` on success.

## Contract tests

`tests/unit/hydi-sync-contract.test.js` mocks Supabase and asserts GET shape.  
`tests/unit/mobile-status-api.test.js` covers the compact mobile route.

## Local vs cloud URL

| Env | Typical base |
|-----|----------------|
| Frank LAN | `http://127.0.0.1:3000` |
| Tailscale | `https://<frank-host>/` (ingress gate applies) |
| Legacy Vercel | Deprecated — see `docs/VERCEL_AUDIT.md` |

## Tailscale

See `docs/TAILSCALE.md` for serve/funnel policy. Cloud agents **cannot** join the tailnet; Jordan validates sync from phone after pairing.
