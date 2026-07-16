# Deployment Architecture

This document is the definitive map of how HYDI System v2 actually serves
traffic: every process that can open a port, which routes it serves, and
which of those are confirmed-live versus dead code versus unverifiable from
outside the operator's real host. It was produced by a source-level audit
(2026-07-15) — every claim below cites the file(s) it's based on. Where
reachability could not be independently confirmed (anything that depends on
what's actually running on the operator's machine right now), that is
stated explicitly rather than guessed.

## TL;DR

- **Vercel is not used.** No git integration is linked to the Vercel
  project; nothing auto-deploys on push (see CLAUDE.md's Local-First
  Architecture section). This means the entire top-level `api/` directory
  (a Vercel-only serverless convention) is **dead** — Next.js's own
  `next dev`/`next start` never serves it.
- **The confirmed-live web/API surface is Next.js's Pages Router**
  (`pages/**`, `pages/api/**`), run via `npm run dev` or
  `npm run build && npm start`. This is the only process this audit could
  positively confirm serves HTTP routes in a way consistent with the
  project's own architecture docs and code comments (see
  `lib/rate-limit.js`'s in-code rationale, `HYDI_KERNEL_ARCHITECTURE_ROADMAP.md`).
- **Checkout and both Stripe webhook handlers are now part of that
  confirmed-live surface** (`pages/api/checkout.js`,
  `pages/api/stripe-connect-webhook.js`, `pages/api/webhooks/stripe.js`) —
  see "Stripe routing" below. They were not before 2026-07-15.
- **Several other processes exist in this repo and may also be running on
  the operator's real host** (a separate Express server, a PM2-managed
  fleet, a start-hydi.js-managed set of Node processes) but this audit —
  running inside an isolated sandbox with no access to that host — **cannot
  confirm which of them are actually started right now**. Each is
  documented below with what it would serve *if running*, and how an
  operator can check.

## Every route-serving entry point in this repo

| Entry point | Exists | Default port | Routes | Reachability |
|---|---|---|---|---|
| `pages/**`, `pages/api/**` (Next.js) | Yes | 3000 (`next dev`/`next start`) | 25+ page routes, 30 API routes (table below) | **Confirmed live.** The only directory Next.js itself will ever serve as pages/API routes — no `vercel.json`, no `app/` router, no custom server wrapping Next. `npm run dev`/`npm start` are the documented commands in `README.md` and `CLAUDE.md`. |
| top-level `api/**` | Yes | n/a | 31 files, mirrors some of `pages/api/**` | **Dead.** A bare `api/` directory only has meaning under Vercel's serverless convention. Vercel deployment is confirmed disabled (CLAUDE.md: `link: undefined`, no auto-deploy). Files here only matter as the source that `pages/api/*` bridge files re-export from. |
| `src/server.js` (`npm run server`) | Yes | 3005 (`PORT`) | ~48 routes: `/keymaker/*`, `/cascade/*`, `/heidi/*`, `/infrastructure/*`, `/api/services/*` (mounts `src/api/services/index.js`), health/integrity/event endpoints | **Unclear.** A separate Express app, entirely independent of Next.js. Not referenced by `ecosystem.config.js`, `scripts/start-hydi.js`, or any CI workflow. Optionally started via `boot.config.json`'s `protoforge-core` module or `launch-chat-portal.js`. Its default port (3005) collides with `agents/ursula/ursula.js`'s default `URSULA_PORT` if both run unconfigured. |
| `heidi-core/server.js` | Yes | `HEIDI_PORT` | ~9 routes | **PM2-managed (per `ecosystem.config.js`, app name `heidi`).** `DIAGNOSTIC_AND_FIX_GUIDE.md` documents an operator restarting this via `pm2 restart heidi` on a real (Windows) host — real operational evidence it runs there, but this audit has no way to check whether it's running *right now*. |
| `hydi-processor.js` | Yes | `PROCESSOR_PORT` (3003) | ~8 routes | **PM2-managed** (app name `hydi-processor`), same caveat as above. |
| `protoforge-main.js` | Yes | `PORT` (3002) | 1 route (`GET /health`, raw `http`, not Express) | **PM2-managed** (app name `hydi-protoforge`), same caveat. Explicitly confirmed non-dead by `HYDI_KERNEL_ARCHITECTURE_ROADMAP.md`. |
| `agents/ursula/ursula.js` | Yes | `URSULA_PORT` (3005) | ~16 routes | **PM2-managed** (app name `ursula-agent`), same caveat. Port collides with `src/server.js`'s default if both run without env overrides. |
| `apps/ursula-frontend/` | Yes | 3001 (`next start`, per PM2 args) | Separate full Next.js app, not audited route-by-route in this pass | **PM2-managed** (app name `ursula-frontend`), same caveat. |
| `heidi-core/index-clean-3458.js` | Yes | `HEIDI_CORE_PORT`/`HEIDI_PORT` (3458) | ~66 routes: `/think`, `/task`, `/queue/*`, `/phase5/*`, `/revenue/*`, `/optimizer/*`, etc. | **start-hydi.js/boot-managed**, distinct from PM2's `heidi-core/server.js` (two different files, same conceptual role). Started by `scripts/start-hydi.js` and `boot.config.json`. |
| `launch-heidi-mobile.js` | Yes | `HEIDI_MOBILE_PORT`/`HEIDI_PORT` (3006) | `GET /`, `/heidi-mobile`, `/heidi`, `/api/models`, `/api/health`, `POST /api/chat` | **start-hydi.js/boot-managed.** Matches the Tailscale-reachable mobile chat CLAUDE.md describes (`heidi-pc.tailc50af2.ts.net`). |
| `hydi-monitor-deploy/` | Yes | n/a | Separate, self-contained sub-project (own `package.json`, `vercel.json`, `netlify.toml`, checked-in `.next` build) | **Dead/archived.** Not referenced by the root `package.json`, not part of the main app's dependency graph. Superseded by the main app's `api/`/`pages/api`. Kept around as a reference implementation (its `pages/api/webhook.js` is a correct example of raw-body reading under `bodyParser: false`, cited below) but should not be treated as a deployment target. |

`ecosystem.config.js`'s `cwd: 'C:\Users\Owner\HYDI_System'` entries are not
stale placeholders — they're a real Windows-host path outside this
container, consistent with `DIAGNOSTIC_AND_FIX_GUIDE.md`'s PowerShell/`pm2`
operator runbook. This audit runs in an ephemeral Linux sandbox with no
access to that host, so **none of the "PM2-managed" rows above could be
verified as actually running at this moment** — only that the code exists
and PM2 is configured to run it. See "How to verify" below.

## `pages/api/**` route table (confirmed-live surface)

| Route | Source | Notes |
|---|---|---|
| `/api/checkout` | `pages/api/checkout.js` → bridges `api/checkout.js` | **Fixed 2026-07-15** — see "Stripe routing" below |
| `/api/stripe-connect-webhook` | `pages/api/stripe-connect-webhook.js` → bridges `api/stripe-connect-webhook.js` | **Fixed 2026-07-15** |
| `/api/webhooks/stripe` | `pages/api/webhooks/stripe.js` → bridges `api/webhooks/stripe.js` | **Fixed 2026-07-15** |
| `/api/chat` | `pages/api/chat.ts` | The confirmed-live chat entry point (`lib/orchestrator.ts` + `lib/ModelManager.ts`) per `HYDI_KERNEL_ARCHITECTURE_ROADMAP.md` |
| `/api/health` | `pages/api/health.js` → bridges `api/health.js` | |
| `/api/mobile-status` | `pages/api/mobile-status.js` → bridges `api/mobile-status.js` | |
| `/api/heartbeat` | `pages/api/heartbeat.js` → bridges `api/heartbeat.js` | |
| `/api/status`, `/api/status/system` | `pages/api/status.ts`, `pages/api/status/system.js` | |
| `/api/session` | `pages/api/session.ts` | |
| `/api/execute` | `pages/api/execute.ts` | |
| `/api/agent-manager/{agents,control,tasks}` | `pages/api/agent-manager/*.js` → bridges `api/agent-manager/*.js` | `requireAuth`-gated |
| `/api/devices` | `pages/api/devices/index.js` → bridges `api/devices/index.js` | `requireAuth`-gated |
| `/api/memory/search` | `pages/api/memory/search.js` → bridges `api/memory/search.js` | `requireAuth`-gated |
| `/api/notifications` | `pages/api/notifications/index.js` → bridges `api/notifications/index.js` | `requireAuth`-gated |
| `/api/voice/command` | `pages/api/voice/command.js` → bridges `api/voice/command.js` | `requireAuth`-gated |
| `/api/work-sessions` | `pages/api/work-sessions/index.js` → bridges `api/work-sessions/index.js` | `requireAuth`-gated |
| `/api/hydi/sync` | `pages/api/hydi/sync.js` → bridges `api/hydi/sync.js` | `status:view` / `hydi_sync:trigger`-gated |
| `/api/rezonate/route` | `pages/api/rezonate/route.js` → bridges `api/rezonate/route.js` | `rezonate:manage`-gated; still trusts `x-user-id` for per-user scoping (see SECURITY.md) |
| `/api/song-composer/{songs,generate}` | `pages/api/song-composer/*.js` → bridges `api/song-composer/*.js` | `requireAuth`-gated |
| `/api/revenue`, `/api/revenue/{cycle,leads,report}` | `pages/api/revenue/*.js` | Native `pages/api` implementation — **not** a bridge. `api/revenue.js` (top-level) is a separate, dormant fourth implementation; see `HYDI_KERNEL_ARCHITECTURE_ROADMAP.md` for the divergence writeup. |
| `/api/traces` | `pages/api/traces.js` | Native; `api/traces.js` (top-level) is dormant |
| `/api/funding/chat` | `pages/api/funding/chat.ts` | |

## Unbridged / dead under this deployment model

These exist only under top-level `api/` with no `pages/api/` counterpart —
404 under `next dev`/`next start`, and unreachable under Vercel too since
Vercel is disabled:

`client-dashboard.js`, `local-model.js`, `ursula/status.js`,
`webhooks/stripe-test.js`, `ws/route.js`, `chat/route.js`,
`events/stream.js`, `life-flow/route.js`, `heidi/route.js`.

`webhooks/stripe-test.js` was deliberately left unbridged in the 2026-07-15
pass — it's a diagnostic-only endpoint (echoes back signature-header
presence, no real function) with no product purpose documented anywhere,
not payment-critical. `life-flow/route.js` was left unbridged in the prior
(2026-07-15, security) pass because it starts recurring background timers
at module load, which is unsafe to activate as a side effect of bridging
without a product decision. The rest are genuinely ambiguous — see
`ISSUES_FOUND.md` #34.

## Stripe routing (checkout + both webhooks)

### What's canonical

- **Checkout**: `api/checkout.js` (creates a Stripe Checkout Session for
  the three HYDI subscription tiers — starter/pro/enterprise). Its former
  duplicate, `api/checkout-v2.js`, was deleted 2026-07-15 (near-identical,
  zero references anywhere).
- **Webhook A — Stripe Connect** (`api/stripe-connect-webhook.js`): routes
  `payment_intent.*`/`charge.refunded`/`payout.*` events to the correct
  revenue-stream Connect sub-account and writes `ledger` rows with the fee
  breakdown documented in `CLAUDE.md`. This is the six-revenue-stream
  billing pipeline CLAUDE.md's architecture section describes.
- **Webhook B — platform-level** (`api/webhooks/stripe.js`): handles
  `checkout.session.completed`/subscription lifecycle events, queues them
  through `WebhookQueueAdapter`, provisions services, and updates
  `leads`/`customers`/`customer_services`/`heidi_memory`. Both webhook
  handlers share the same `webhook_events` table and `claim_webhook_event`
  RPC for idempotency, so a duplicate delivery from Stripe (its own retry
  behavior) can't double-process on either path.

All three are now bridged into `pages/api/` (confirmed reachable via a real
`npm run build` — they appear in the Next.js route table with the `ƒ`
dynamic marker) and covered by regression tests (`tests/unit/checkout.test.js`,
`tests/unit/webhooks-stripe.test.js`, `tests/unit/stripe-connect-webhook.test.js`,
`tests/unit/stripe-route-bridges.test.js`, `tests/unit/get-raw-body.test.js`).

### Bugs found and fixed alongside the routing gap

Bridging alone would not have been sufficient — two independent bugs would
have broken both webhooks even once reachable:

1. **`api/webhooks/stripe.js` had a clobbered export.** It set
   `module.exports.handler = async (req, res) => {...}` and then, a few
   lines later, overwrote the whole thing with
   `module.exports = { handleStripeWebhook, SERVICE_TIERS }` — silently
   dropping the handler function. `require()`ing this file never returned
   anything callable. It had zero test coverage before this pass (the
   existing `stripe-webhook.test.js` tests an unrelated file,
   `src/webhook-handlers/stripe-webhook.js`).
2. **Both webhook handlers read `req.body` directly for Stripe signature
   verification, but Next.js's Pages Router does not auto-populate
   `req.body` when `config.api.bodyParser = false` is set** (required so
   the raw bytes Stripe signed survive intact — a re-serialized JSON body
   fails signature verification). The handler receives the raw,
   unconsumed request stream and must read it itself. This was verified
   against Next.js's actual documented behavior and cross-checked against
   a working reference already dormant in this repo
   (`hydi-monitor-deploy/pages/api/webhook.js`, which correctly uses
   `micro`'s `buffer(req)`). Fixed with a small local helper,
   `lib/get-raw-body.js`, rather than adding the `micro` dependency —
   it passes through unchanged if `req.body` is already a Buffer/string
   (so the standalone Express consumer below, and existing unit tests
   that construct a fake `req` with `body` pre-set, are unaffected).

### Other Stripe implementations that exist but are not part of this routing

These were found during the audit and are **not** modified — they're
either dead code or live on a process whose production status this audit
could not confirm (see the entry-point table above):

- **`stripe-webhook-server.js`** (repo root) — a standalone Express
  micro-server dedicated to Stripe webhooks, correctly using
  `express.raw({ type: 'application/json' })` (so it already got raw-body
  reading right) and calling `handleStripeWebhook` from
  `api/webhooks/stripe.js` directly. Not referenced by any `package.json`
  script — would need to be started manually (`node stripe-webhook-server.js`).
- **`src/api/services/index.js`**'s `POST /subscriptions/checkout` and
  `POST /webhooks/stripe` — Express routes mounted into `src/server.js`
  under `/api/services`, backed by `src/services/subscription-manager.js`.
  Whether `src/server.js` is actually running in production is unconfirmed
  (see entry-point table). The checkout route had its own, separate
  security bug (see `ISSUES_FOUND.md` #42) that was fixed regardless of
  this router's reachability status, since the fix is small and safe either way.
- **`src/webhook-handlers/stripe-webhook.js`** — a class-based
  `StripeWebhookHandler` targeting an entirely different data model
  (`users`/`api_keys` tables — a per-tier API-key SaaS model, not the
  Connect sub-account ledger model CLAUDE.md documents as current). Only
  referenced by its own unit test (`tests/unit/stripe-webhook.test.js`) —
  fully orphaned from any live route.

Consolidating these into one implementation would require a maintainer
decision on which billing model (Connect sub-accounts vs. per-tier API
keys vs. the Ursula service bundle) is actually the current product —
this audit does not have enough context to make that call, so all three
were left as-is and documented rather than guessed at or deleted.

## How to verify what's actually running (operator action)

This audit cannot answer "what's running right now" — only "what would run
if started, and how." On the real host:

```bash
# Is Next.js running, and on what port?
curl -s localhost:3000/api/health

# What does PM2 think is running?
pm2 list
pm2 describe heidi
pm2 describe hydi-processor
pm2 describe hydi-protoforge
pm2 describe ursula-agent
pm2 describe ursula-frontend

# Is the separate Express server (src/server.js) running?
curl -s localhost:3005/health

# Is the start-hydi.js-managed heidi-core running?
curl -s localhost:3458/health

# Is the mobile chat process running (matches the Tailscale-reachable
# endpoint CLAUDE.md describes)?
curl -s localhost:3006/api/health
```

If Stripe's dashboard currently points its webhook endpoint at a URL this
audit didn't identify above, that's the strongest signal of what's really
live — cross-check the Stripe Dashboard's configured webhook URL
(Developers → Webhooks) against this document's routing table.
