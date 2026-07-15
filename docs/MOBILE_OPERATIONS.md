# Mobile Operations

Status of the "mobile control center" effort, what exists today, what was
added in this pass, and what's left to build. This exists because the full
ask (native app, OAuth, voice assistant, remote file browser, full RBAC,
etc.) is too large to build blind in one pass — this documents an honest
increment plus a roadmap for the rest.

## What already existed

- **`docs/index.html`** — a working, installable PWA (manifest + service
  worker, offline shell) hosted on GitHub Pages (manual `workflow_dispatch`
  deploy only, per the Local-First decision in `CLAUDE.md`) or reached over
  Tailscale. Chat + a live health dot, all state in `localStorage`.
- **Auth**: HMAC-SHA256 service tokens (`x-hydi-service-token`), minted
  client-side from a user-entered secret, verified server-side against
  `HYDI_SERVICE_SECRET`. No JWT/OAuth/session layer exists.
- **`GET /api/mobile-status`** — compact, unauthenticated health + per-stream
  revenue snapshot, built for the mobile client's status dot.
- **`GET /api/agent-manager/agents`** — read-only list of the six
  conversational agents (Heidi, Ursula, CASCADE, KILO, ProtoForge, Hyve) with
  task stats from the `actions` table. No write/control surface.
- **`workers/WorkerOrchestrator.js`** — the real start/stop/restart logic for
  the 15-type background worker fleet (`revenue_ingestion`, `task_router`,
  `sync`, `notification`, ...), but it only runs as a long-lived local Node
  process; nothing exposed it over HTTP.

## What this pass added: worker fleet remote control

The clearest gap against "start/stop/restart agents from a phone" was that
no HTTP endpoint could reach the worker fleet at all. `WorkerOrchestrator` is
a long-lived process — a Vercel/Next serverless function can't hold a
reference to it — so control is asynchronous via a command queue:

1. **`supabase/migrations/20260715120000_agent_control_commands.sql`** — new
   `agent_control_commands` table. Least-privilege by construction: `command`
   is constrained to `start`/`stop`/`restart` (no arbitrary exec), RLS scopes
   it to `service_role` only.
2. **`api/agent-manager/control.js`** — `POST` validates `worker_type`
   against the known fleet and `command` against the allowed set, requires
   the same HMAC service token as `/api/chat`, and requires an explicit
   `confirm: true` for `stop` (the destructive one) before it will queue it.
   `requested_by` is always taken from the verified token, never trusted
   from the request body. `GET` lists the 20 most recent commands so a
   client can poll status. Rate-limited like the other API routes.
3. **`workers/WorkerOrchestrator.js`** — `startCommandPolling()` runs every 5s
   alongside the existing metrics/health intervals, picks up `pending` rows,
   and executes them via new `startWorkerType()` / `stopWorkerType()`
   helpers, writing the outcome back to the row (`completed`/`failed` +
   `result_message`) and to `worker_events` for the audit trail.
4. **`docs/index.html`** — new 🤖 "Worker fleet" sheet: one row per worker
   type with Start / Restart / Stop buttons and a recent-commands log. Stop
   shows a native `confirm()` prompt before sending `confirm: true`.

Tests: `tests/migrations/20260715120000.test.js`,
`tests/unit/agent-control-api.test.js` (auth, validation, the stop-confirm
gate, requested_by spoofing), `tests/unit/worker-orchestrator-commands.test.js`
(polling executes start/stop/restart against real worker instances, rejects
unknown/unimplemented worker types).

**Note on "agents" vs. "workers"**: the mobile spec says "start/stop/restart
agents." The six conversational agents (Heidi, CASCADE, KILO, ProtoForge,
Hyve, Ursula) are stateless per-request handlers in `api/chat/route.js` —
there's no running process to stop. The units that actually have
start/stop/restart semantics are the 15 background workers. This control
surface targets those; if per-agent enable/disable (e.g. temporarily routing
`kilo` messages to a maintenance response) turns out to be what's wanted,
that's a smaller, separate follow-up against `api/chat/route.js`'s
`systemHandlers` map, not the worker fleet.

## Roadmap for the rest of the spec

Rough phases, not commitments — pick a starting point before building
further, the same way this increment was scoped.

1. **Auth hardening** — the HMAC scheme has no notion of *who* beyond a
   free-text `service` string, no roles, no revocation, no MFA. Real
   role-based access control and per-device authorization (spec:
   "OAuth or JWT authentication," "Role-based access control," "Multi-factor
   authentication," "Device authorization") need a users/devices table and a
   session layer that doesn't exist yet — this is the highest-leverage next
   phase since agent control, file browser, and config editing are all
   unsafe to expose broadly without it.
2. **Push notifications** — `push_subscriptions` table already exists
   (migrations `20260617000004`, `20260623120000`) but nothing writes to it
   or sends a push. `HYDI_GAME_PLAN.md` §P1 has the unbuilt plan
   (`POST /api/push/subscribe` + VAPID). Needed for "Worker failures,"
   "Deployment completion," "Critical errors" notifications.
3. **Live worker status** — this pass added control but not a live
   "N instances running, last heartbeat" view; `WorkerOrchestrator.getWorkerStatus()`
   has the data, it just isn't exposed over HTTP yet. Small follow-up.
4. **Dev tools tab** — GitHub PR/CI/deployment status. `api/chat/route.js`'s
   `infrastructure` handler already wraps Vercel deploy status/redeploy/env
   vars; a dedicated read-only dashboard panel wrapping the same calls is a
   presentation-layer task, not a new backend.
5. **Remote command execution / file browser / config editor** — explicitly
   the highest-risk items in the spec ("Secure command execution," "File
   browser," "Backup and restore controls"). Do not build these ahead of
   phase 1 (auth) landing — arbitrary remote exec or file access without
   real RBAC and audit logging would violate the spec's own "least-privilege"
   and "command approval for destructive operations" requirements.
6. **Voice mode / native app wrapper** — no React Native/Capacitor/Expo
   project exists. The PWA is the reasonable base to wrap or extend; a
   from-scratch native app is a separate, much larger effort and should be
   scoped on its own once the API surface above is stable.

## Using the new endpoints

```bash
# List known worker types + recent command status
curl -H "x-hydi-service-token: $TOKEN" https://your-hydi.example.com/api/agent-manager/control

# Restart the sync worker
curl -X POST https://your-hydi.example.com/api/agent-manager/control \
  -H "Content-Type: application/json" -H "x-hydi-service-token: $TOKEN" \
  -d '{"worker_type": "sync", "command": "restart", "reason": "stale heartbeat"}'

# Stop the notification worker (destructive — requires confirm)
curl -X POST https://your-hydi.example.com/api/agent-manager/control \
  -H "Content-Type: application/json" -H "x-hydi-service-token: $TOKEN" \
  -d '{"worker_type": "notification", "command": "stop", "confirm": true}'
```

Token minting follows the same HMAC-SHA256 scheme documented inline in
`api/chat/route.js` and `lib/auth/verifyServiceToken.js`.
