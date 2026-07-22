# HYDI Mobile Operations

Status as of 2026-07-15. This document covers the mobile command-center
surface built on branch `claude/hydi-mobile-operations-ozd777`: real-time
status, worker fleet control, push notifications, device-scoped auth/RBAC,
a voice command pipeline, mobile-facing views over the existing memory and
autonomous-work kernel, and native-packaging prep.

**Important correction to prior claims.** The task brief this work started
from asserted a "worker-control milestone" was already complete — HMAC
auth, an `agent_control_commands` migration, `api/agent-manager/control.js`,
an orchestrator that polls commands, and a Worker Fleet UI. Verification
before writing any code found most of that false: no migration, no
`control.js`, no fleet UI, and `workers/WorkerOrchestrator.js` was a
self-driven internal health monitor with no external command queue. Only
the PWA and the HMAC guard on `/api/chat` were real, and the HMAC guard
covered nothing else. Everything described below as "built" was verified
by a passing automated test, not assumed from the brief.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Mobile PWA (hydi-mobile-protoforge.html, "Ops" tab)                 │
│   - Device pairing (HMAC secret, stored in localStorage)             │
│   - hydiFetch(): signs every request with a fresh device token       │
│   - EventSource client (auto-reconnect) + 30s poll fallback          │
└───────────────┬───────────────────────────────────────┬─────────────┘
                │ HTTPS + x-hydi-device-token            │ SSE
                ▼                                        ▼
┌───────────────────────────────┐   ┌───────────────────────────────────┐
│ lib/auth/requireAuth.js        │   │ api/events/stream.js               │
│  Authentication (HMAC/device)  │   │  subscribes lib/realtime/eventBus  │
│  -> Authorization (RBAC)       │   │  + 30s offline sweep over          │
│  -> rate limit -> audit log    │   │  hydi_subsystem_status             │
└───────────────┬─────────────────┘   └───────────────┬────────────────┘
                │                                       │ publish()
                ▼                                       │
┌─────────────────────────────────────────────────────────────────────┐
│ api/agent-manager/control.js   api/heartbeat.js   api/status/system.js│
│ api/devices/index.js           api/notifications   api/memory/search  │
│ api/voice/command.js           api/work-sessions                      │
│   Every write is a Command Queue insert, never a direct action.       │
└───────────────┬─────────────────────────────────────────────────────┘
                │ pending rows
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ workers/WorkerOrchestrator.js                                        │
│  pollControlCommands() every 5s -> executeControlCommand()           │
│  -> start/stop/restart/scale a real worker instance                  │
│  -> writes result back + worker_events audit row                     │
│  -> on failure: lib/notifications/notify.js + eventBus publish        │
└─────────────────────────────────────────────────────────────────────┘
```

### Subsystems tracked (Phase 1)

`hydi_core`, `ursula`, `rave_voice`, `botforge`, `worker_fleet`, `memory`,
`database`, `deployment` — one row each in `hydi_subsystem_status`,
written by `api/heartbeat.js`. A subsystem that has never called
`/api/heartbeat` correctly reads as `unknown`/health 0, not a fabricated
"healthy" — `rave_voice` and `botforge` have no heartbeat source wired up
yet (see Tech Debt below), so they will show `unknown` until something
calls in.

### Why SSE + a process-wide EventEmitter, not polling

Per `CLAUDE.md`'s Local-First Architecture decision, this deployment runs
as a single long-lived Node process (Vercel's serverless deploy is
dormant). `lib/realtime/eventBus.js` is therefore a plain `EventEmitter`
singleton, the same assumption `lib/rate-limit.js`'s in-memory Map already
relies on. `api/heartbeat.js` and `workers/WorkerOrchestrator.js` publish
onto it; `api/events/stream.js` forwards to every connected SSE client.
Browsers' native `EventSource` reconnects automatically on drop; the
server also sends `retry: 3000` and a monotonic `id:` per event.

**Known gap, not hidden:** this is a third SSE implementation in the repo.
`src/server.js`'s inline `/events/stream` route and
`modules/ursula-sse-stream.js`'s standalone Ursula dashboard stream are
pre-existing and were **not** wired to the new shared bus by this change —
see Tech Debt.

**2026-07-22 fix: the EventEmitter bus didn't actually bridge processes.**
`workers/WorkerOrchestrator.js` (the process that executes queued worker
commands and creates `worker_failure` notifications) runs as its own PM2
app, not inside the Next.js server — so its local `publish()` calls landed
in a `bus` instance no phone was ever listening to. A mobile client only
ever saw a completed command via the 30s REST poll, never live, and
`createNotification()` never called `publish()` at all — the `notification`
event type existed in the client's `EventSource` listener but nothing ever
fired it outside of web-push. Fixed by adding a **Realtime bridge**:
`api/events/stream.js`'s `startRealtimeBridge()` subscribes once per
process (not once per connection) to Supabase Realtime `postgres_changes`
on `agent_control_commands` (UPDATE — both success and failure paths update
this row) and `notifications` (INSERT), re-emitting them onto the same
local `bus` every connected SSE client already listens to.
`supabase/migrations/20260722120000_realtime_mobile_ops_bridge.sql` adds
both tables to the `supabase_realtime` publication (idempotent). A new
`command_result` event type carries the row's `status`/`result`/
`error_message`; `hydi-mobile-protoforge.html`'s Ops tab now refreshes the
worker cards on it instead of only on the 30s poll.

## Security model (Phase 4)

```
Authentication → Authorization (RBAC) → Command Queue → Execution → Audit Log
```

Every mobile-ops route in `api/` runs through `lib/auth/requireAuth.js`,
which enforces this chain in one place rather than per-route.

### Credentials

- **Legacy service token** (`x-hydi-service-token`, unchanged from before
  this work — `lib/auth/verifyServiceToken.js`, `HYDI_SERVICE_SECRET`).
  Treated as role `owner` so every pre-existing internal caller
  (`api/chat`, termux, hardware agents) keeps working unmodified.
- **Device token** (`x-hydi-device-token`, new — `lib/auth/deviceAuth.js`).
  HMAC-SHA256, same 5-minute replay window and `timingSafeEqual` check as
  the legacy token, keyed per-device instead of globally. A raw secret is
  generated once at registration and returned in that single response;
  the server only ever stores `sha256(rawSecret)`, and that derived value
  — not the raw secret — is the actual signing key both sides use
  afterward (`deriveSigningKey()`). Losing the registration response means
  re-registering.

### RBAC (`lib/auth/rbac.js`)

| Role | Can do |
|---|---|
| `owner` | Everything (wildcard) — device management, worker control, all reads. |
| `operator` | Worker start/stop/restart/scale, status/notification/memory reads, voice commands, notification preferences. |
| `agent` | Post heartbeats, read status, read its own work sessions. Machine role for worker/agent processes, not a human. |
| `viewer` | Read-only: status, worker list, notifications, memory search, work sessions. |

Fails closed: an unknown role or permission is always denied
(`tests/unit/rbac.test.js`).

### Device lifecycle

- **Register**: `POST /api/devices { action: 'register', device_id, requested_role }` — unauthenticated, but the resulting device is `status: 'pending'` and unusable until approved. Rate-limited (10/min/IP).
- **Bootstrap exception**: if zero devices exist yet, `requested_role: 'owner'` **and** a valid `x-hydi-service-token` together auto-approve — otherwise there is no way to approve the first device at all.
- **Approve / revoke**: `POST /api/devices { action: 'approve'|'revoke', device_id, role? }` — owner-only.
- **List**: `GET /api/devices` — owner-only.

### Audit trail

Every auth attempt (success/failure), permission denial, rate-limit trip,
device lifecycle event, and control-command request is written to
`auth_audit_log` by `requireAuth()` itself — routes don't have to
remember to log it. `hydi_status_events` separately audits every
subsystem status transition, and `memory_audit_log` logs every memory
search.

### Rate limiting

`lib/rate-limit.js` (pre-existing, in-memory per-IP fixed window), applied
per-route via `requireAuth`'s `rateMax` option (default 60/min; device
registration is 10/min).

## API reference

All routes: CORS scoped to `MOBILE_CHAT_ORIGIN` (or `*` if unset), accept
`x-hydi-service-token` or `x-hydi-device-token`.

| Route | Method | Permission | Purpose |
|---|---|---|---|
| `/api/devices` | POST `action:'register'` | none (self-limiting via `pending` status) | Register a device |
| `/api/devices` | POST `action:'approve'\|'revoke'`, GET | `device:manage` (owner only) | Manage devices |
| `/api/agent-manager/control` | POST | `worker:control` | Queue a `start\|stop\|restart\|scale_up\|scale_down` command |
| `/api/agent-manager/control` | GET | `worker:view` | Recent command history |
| `/api/heartbeat` | POST | `heartbeat:post` | Subsystem reports its status |
| `/api/status/system` | GET | `status:view` | Health score, per-subsystem status, worker list, recent events |
| `/api/events/stream` | GET (SSE) | `status:view` | Live push of subsystem/notification/command events |
| `/api/notifications` | GET | `notifications:view` | List, `?unread=true` filter |
| `/api/notifications` | POST `action:'mark_read'` | `notifications:view` | Mark one notification read |
| `/api/notifications` | POST `action:'preferences'` | `notifications:manage_prefs` | Per-device category on/off |
| `/api/memory/search` | GET | `memory:search` | Filtered read over `memories` (`q`, `tags`, `min_importance`, `kind`) |
| `/api/work-sessions` | GET | `work_sessions:view` (or `_own`) | Active goal, current task, queue depth, history |
| `/api/voice/command` | POST | baseline `status:view`, then per-intent | Transcript → validated intent → command queue |

Full request/response shapes are covered by each route's Jest test
(`tests/unit/*-api.test.js`) — treat those as the executable spec.

## Voice pipeline (Phase 5)

```
mobile microphone → Web Speech API (client) → POST transcript
  → lib/voice/intentParser.js (wake word + intent match)
  → per-intent RBAC check (never bypassed — same requireAuth path)
  → command queue (agent_control_commands) or actions table
  → workers/WorkerOrchestrator.js executes, same as any other command
```

Supported: `"HYDI status report"`, `"HYDI check workers"`,
`"HYDI summarize activity"`, `"HYDI prepare report"`,
`"HYDI restart service <name>"`, `"HYDI start <name>"`. Speech-to-text
itself is **not implemented server-side** — the mobile client is expected
to use the browser's `SpeechRecognition`/Web Speech API and POST the
resulting text; no audio ever reaches the server.

## Memory & autonomy (Phases 6, 8)

`HYDI_KERNEL_ARCHITECTURE_ROADMAP.md` explicitly rules out a new memory
store or a new orchestrator/agent framework until its own triage is
resolved. This work honors that: `api/memory/search.js` and
`api/work-sessions/index.js` are **read-only views** over the existing
`memories` table (extended additively with `tags`, `importance_score`,
`expires_at`, `last_accessed_at` — `20260715124000_memory_intelligence_foundation.sql`)
and the existing `work_sessions` table (`lib/work-sessions.ts`). Goal
execution still only happens via `HeidiOrchestrator.runWorkSession()`;
nothing new executes plans.

## Deployment

1. `npm install` (adds `web-push` for notification delivery).
2. Apply the six new migrations (`supabase/migrations/20260715120000`
   through `20260715124000`) — `supabase db push` or via the Supabase MCP
   server. None have been applied to a live project by this change (no
   authenticated DB access from this session — same limitation prior
   migrations in this repo hit).
3. Set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` to enable
   push delivery (notifications work without them, just undelivered —
   see `lib/notifications/notify.js`'s graceful degradation).
4. Bootstrap the first device:
   ```bash
   curl -X POST $HOST/api/devices \
     -H "x-hydi-service-token: $(node -e "...")" \
     -H "Content-Type: application/json" \
     -d '{"action":"register","device_id":"my-phone","requested_role":"owner"}'
   ```
   Save the returned `secret` — it is shown exactly once. Enter
   `device_id` + `secret` into the PWA's Ops tab → "Pair Device" prompt.
5. Start `workers/WorkerOrchestrator.js` (or however it's process-managed
   today — it isn't in `package.json`'s scripts or under PM2 per the
   kernel roadmap's audit; that's pre-existing, not introduced here) so
   `pollControlCommands()` actually runs.
6. Native packaging (optional, Phase 7): `npm run build:capacitor-www`
   stages the PWA into `www/` (Capacitor's required `webDir` layout),
   then `npx cap add android && npx cap sync` — **not run in this
   session** (no Android SDK / Gradle here). Add `icons/icon-192.png` and
   `icon-512.png` first; `manifest.json` references them but they don't
   exist in the repo yet (pre-existing gap, unrelated to this change).

## Testing

`npm test` — 1296 tests passing, including:
- 5 new migration governance tests (`tests/migrations/20260715*.test.js`), satisfying `hdi-governance-gate.yml`'s "every migration needs a test" rule.
- 15 new unit test files covering RBAC, device auth, the shared auth guard, every new API route, the orchestrator's command-queue wiring, health-score math, the notification framework, and the voice intent parser.
- The Ops tab was driven in a real headless Chromium session (mocked API responses) to confirm it renders health score, worker cards, notifications, and memory search results with zero console errors — not just typechecked.

`npm run typecheck` — clean (all additions are `.js`; no `.ts` surface touched).

## Remaining technical debt

- **Migrations not applied to any live database** — no authenticated Supabase access from this session, consistent with every other pending migration in this repo currently. This now includes `20260722120000_realtime_mobile_ops_bridge.sql`; until it's applied, `startRealtimeBridge()` subscribes successfully but `agent_control_commands`/`notifications` never actually emit `postgres_changes` (degrades to REST-poll-only, not an error).
- ~~**`WorkerOrchestrator.js` isn't process-managed anywhere**~~ **Fixed 2026-07-22** — added the `hydi-worker-orchestrator` app to `ecosystem.config.js`. Same "can't confirm it's actually running on the real host right now" caveat as every other PM2-managed process in this repo (see `DEPLOYMENT.md`).
- ~~**Cross-process live push was silently broken**~~ **Fixed 2026-07-22**: `WorkerOrchestrator.js` runs as its own process, so its local `publish()` calls never reached a phone's SSE connection in the Next.js process — a completed command only ever surfaced via the 30s REST poll, and `createNotification()` never called `publish()` at all despite the client already listening for a `notification` event. `api/events/stream.js`'s `startRealtimeBridge()` now subscribes once per process to Supabase Realtime `postgres_changes` on `agent_control_commands` (UPDATE) and `notifications` (INSERT) and re-emits them onto the same local bus every SSE client already listens to — one shared subscription regardless of client count. New `command_result` event type; `hydi-mobile-protoforge.html`'s Ops tab refreshes worker cards on it.
- **Three parallel SSE implementations** (`api/events/stream.js` here, `src/server.js`'s inline route, `modules/ursula-sse-stream.js`) — only the first was touched. Consolidating onto `lib/realtime/eventBus.js` is real follow-up work, not done here to avoid guessing which one is actually live without maintainer input.
- **`rave_voice` and `botforge` have no heartbeat source** — they'll show `unknown` until something is wired to call `/api/heartbeat` for them. Neither subsystem exists as identifiable code in this repo yet (verified before writing the status system).
- **EventSource reconnection doesn't replay missed events** — `id:`/`retry:` are sent for correct native reconnect behavior, but there's no durable event log to replay from; a client that's offline for a while relies on the REST snapshot (`/api/status/system`) to catch up, not stream replay.
- **Capacitor is config-only** — `capacitor.config.json` and the `www/` staging script exist and were tested; `@capacitor/core`/`@capacitor/android` are not installed and no APK has been built (no Android SDK/Gradle in this environment). Biometric auth and a true background service are not implemented — they need the native shell to exist first.
- **Device pairing is a `prompt()` flow** — deliberately simple for a single-operator tool per `CLAUDE.md`; a real onboarding UI (QR-code pairing, etc.) is future work if this becomes multi-user.
- ~~**`manifest.json`'s icon references are dangling**~~ **Fixed 2026-07-22** — added `icons/icon-192.png`, `icon-512.png`, `icon.svg` at repo root (copied from the already-existing `docs/icons/` set used by the GitHub Pages client), so `scripts/build-capacitor-www.js` no longer warns about a missing launcher icon.
- **Session/token expiration is purely the 5-minute HMAC replay window** — there's no separate revocable session concept beyond device revocation; acceptable for this threat model (personal tool, device-level revocation exists) but worth naming explicitly as a design choice, not an oversight.
