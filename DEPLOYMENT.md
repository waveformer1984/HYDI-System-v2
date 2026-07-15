# Deployment Architecture & Routing Map

Authoritative reference for how HYDI System v2 actually serves traffic
today, and the definitive map of every HTTP route: source file, runtime,
deployment target, and whether it's actually reachable. Produced by a
production-readiness audit (2026-07-15) that traced every routing
convention in the repo against what's actually executed, rather than
trusting file presence or documentation alone.

## 1. What actually serves requests

Per CLAUDE.md's **Local-First Architecture** section, Vercel deployment is
explicitly disabled: no git integration is linked to the Vercel project
(`link: undefined`, confirmed via API), so nothing auto-deploys on push.
`scripts/cloud-bootstrap/vercel.js` still exists as a dormant capability
but is not part of the normal workflow.

That means the thing actually serving HTTP requests for this repo is:

```
npm run build && npm start     # next build / next start — production
npm run dev                    # next dev --hostname 0.0.0.0 --port 3000 — local dev
```

**Next.js's pages router only ever serves routes under `pages/api/**`.**
It has no knowledge of, and never serves, a bare top-level `api/`
directory — that's a *Vercel-platform-only* zero-config serverless
functions convention (used when Vercel's "Other" framework preset detects
a root `api/` folder with no framework build step). Since this deployment
never goes through Vercel's build pipeline, every file directly under
`api/` at the repo root is **inert** unless something explicitly bridges
or imports it.

There is no `vercel.json` in this repo (checked directly — none present),
confirming there's no builds/functions config that would change this.

### The bridge pattern

Because `api/**` contains real, sometimes load-bearing implementations
(some written before this architecture decision, some still actively
maintained), the fix applied across two audit passes (2026-07-15) was to
add thin `pages/api/**` files that re-export the `api/**` implementation,
rather than duplicating logic:

```js
// pages/api/health.js
export { default } from '../../api/health.js';
```

For routes needing Next.js's special `config` export (disabling body
parsing for raw-body signature verification, disabling the response-size
limit for SSE), the bridge re-exports that too:

```js
// pages/api/stripe-connect-webhook.js
export { default, config } from '../../api/stripe-connect-webhook.js';
```

`api/**` files that construct a Supabase or Stripe client, this matters:
Next.js's pages router imports the whole module (including its bridge
target) at build/first-request time. A client constructed **eagerly at
module load** (`const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)`)
throws synchronously if the env var is missing, crashing the entire route
module before the handler's own error handling ever runs. Every bridged
route in this repo now uses a lazy-construction pattern instead:

```js
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured');
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}
```

A missing env var then surfaces as a clean JSON 500 from the specific
request that needed it, not a crash that takes the whole route (or, in a
real Vercel deployment, potentially a whole lambda bundling multiple
routes) down at cold start.

## 2. Routing map

### `pages/api/**` — live, reachable via `next dev`/`next start`

| URL | Source (`pages/api/`) | Implementation | Auth | Notes |
|---|---|---|---|---|
| `/api/health` | `health.js` | bridges `api/health.js` | none (public health check) | reads `system_dashboard` view |
| `/api/mobile-status` | `mobile-status.js` | bridges `api/mobile-status.js` | none (public, 3G-safe snapshot) | |
| `/api/heartbeat` | `heartbeat.js` | bridges `api/heartbeat.js` | `requireAuth` | mobile-ops |
| `/api/status/system` | `status/system.js` | bridges `api/status/system.js` | `requireAuth` | unified status snapshot |
| `/api/notifications` | `notifications/index.js` | bridges `api/notifications/index.js` | `requireAuth` | |
| `/api/memory/search` | `memory/search.js` | bridges `api/memory/search.js` | `requireAuth` | |
| `/api/voice/command` | `voice/command.js` | bridges `api/voice/command.js` | `requireAuth` | |
| `/api/work-sessions` | `work-sessions/index.js` | bridges `api/work-sessions/index.js` | `requireAuth` | |
| `/api/devices` | `devices/index.js` | bridges `api/devices/index.js` | `requireAuth` | |
| `/api/agent-manager/agents` | `agent-manager/agents.js` | bridges `api/agent-manager/agents.js` | `requireAuth('worker:view')` | |
| `/api/agent-manager/control` | `agent-manager/control.js` | bridges `api/agent-manager/control.js` | `requireAuth` | |
| `/api/agent-manager/tasks` | `agent-manager/tasks.js` | bridges `api/agent-manager/tasks.js` | `requireAuth` | |
| `/api/hydi/sync` | `hydi/sync.js` | bridges `api/hydi/sync.js` | `status:view` (GET) / `hydi_sync:trigger` (POST) | |
| `/api/rezonate/route` | `rezonate/route.js` | bridges `api/rezonate/route.js` | `rezonate:manage` | per-user scoping still trusts `x-user-id` (see ROADMAP.md) |
| `/api/song-composer/generate` | `song-composer/generate.js` | bridges `api/song-composer/generate.js` | `requireAuth`, 10/min | LLM-backed, cost/DoS-sensitive |
| `/api/song-composer/songs` | `song-composer/songs.js` | bridges `api/song-composer/songs.js` | `requireAuth` | |
| `/api/events/stream` | `events/stream.js` | bridges `api/events/stream.js` | `requireAuth('status:view')` | SSE; `responseLimit: false`. **Newly bridged this session** (was an oversight — sibling routes were bridged, this wasn't). |
| `/api/checkout` | `checkout.js` | bridges `api/checkout.js` | none (public, rate-limited 10/10min) | creates a Stripe Checkout Session for the SaaS tier signup flow. **Newly bridged this session.** |
| `/api/stripe-connect-webhook` | `stripe-connect-webhook.js` | bridges `api/stripe-connect-webhook.js` | Stripe signature (`STRIPE_CONNECT_WEBHOOK_SECRET`) | Connect payment → ledger routing. **Newly bridged this session.** `bodyParser: false`. |
| `/api/client-dashboard` | `client-dashboard.js` | bridges `api/client-dashboard.js` | `requireAuth('ledger:view')` | **Auth added this session** — was previously unauthenticated (see ISSUES_FOUND.md #38); newly bridged now that it's safe. |
| `/api/chat` | `chat.ts` (native, not a bridge) | `lib/heidi-agent.ts` / `lib/orchestrator.ts` | — | Heidi's real, live chat entry point. Streams via SSE. Falls back to the non-streaming orchestrator when `ANTHROPIC_API_KEY` is unset (which it is, per the Local-First decision — Ollama is primary). |
| `/api/status` | `status.ts` (native) | `lib/orchestrator.ts` | — | |
| `/api/session` | `session.ts` (native) | — | — | |
| `/api/execute` | `execute.ts` (native) | — | — | |
| `/api/funding/chat` | `funding/chat.ts` (native) | — | — | |
| `/api/revenue/*` | `revenue/{index,cycle,leads,report}.js` (native) | — | — | independent of top-level `api/revenue.js` |
| `/api/traces` | `traces.js` (native) | — | — | independent of top-level `api/traces.js` |

### `api/**` — implementation modules, or dead/unreachable

Every file below is inert as a Vercel-style handler in this deployment
unless a `pages/api/**` bridge (table above) or another Node process
(noted per-row) imports it.

| File | Status | Notes |
|---|---|---|
| `api/health.js`, `api/mobile-status.js`, `api/heartbeat.js`, `api/status/system.js`, `api/notifications/index.js`, `api/memory/search.js`, `api/voice/command.js`, `api/work-sessions/index.js`, `api/devices/index.js`, `api/agent-manager/*.js`, `api/hydi/sync.js`, `api/rezonate/route.js`, `api/song-composer/*.js`, `api/events/stream.js`, `api/checkout.js`, `api/stripe-connect-webhook.js`, `api/client-dashboard.js` | **Reachable** — bridged, see table above | |
| `api/revenue.js`, `api/traces.js` | **Superseded, not bridged** | `pages/api/revenue/*` and `pages/api/traces.js` already exist as independent native implementations; presumed to be the maintained versions. Not verified byte-identical — worth a diff if the two ever need reconciling. |
| `api/chat/route.js` | **Unreachable, ambiguous purpose** | Not a chat implementation — a "Universal Chat Router" performing Vercel admin operations (`lib/vercel/vercelAdmin.js`: deploy triggers, env var management) and Termux device control. Bridging it under `/api/chat` would collide with `pages/api/chat.ts`'s URL if bridged as `chat.js` (it wouldn't — `pages/api/chat/route.js` resolves to `/api/chat/route`, a different URL — but exposing admin/infra control needs a maintainer decision, not a guess). See ISSUES_FOUND.md #34. |
| `api/heidi/route.js` | **Unreachable, ambiguous purpose** | A second, divergent chat implementation talking directly to local Ollama, bypassing `lib/heidi-agent.ts`/`lib/orchestrator.ts` (the ones `pages/api/chat.ts` uses). Left unbridged pending a decision on whether this is meant to still exist. |
| `api/local-model.js` | **Not a route** | Exports a `LocalModelClient` class, consumed internally by `api/heidi/route.js`. Nothing to bridge. |
| `api/ws/route.js` | **Non-functional placeholder** | Its own source comment: `// This is a placeholder for WebSocket upgrade ... In production, you'd use a proper WebSocket server`. Bridging a stub under a real-sounding URL would be actively misleading; left unbridged. |
| `api/life-flow/route.js` | **Deliberately unbridged** | Auth was fixed in a prior pass, but the module starts recurring hardware/software-polling timers (`HYDISystem` instantiation) **at module load**, not per-request — importing it as a side effect of bridging would start persistent background timers. Needs a product decision first. |
| `api/checkout-v2.js` | **Deleted** | Byte-for-byte duplicate of `api/checkout.js` since the commit that introduced both (`b473969`). Removed outright, not archived. |
| `api/webhooks/stripe.js`, `api/webhooks/stripe-test.js`, `src/webhook-handlers/stripe-webhook.js` | **Archived** | Dead/broken/orphaned duplicate Stripe-subscription-webhook implementations. See `archive/legacy-stripe-webhook-implementations/README.md` for the full per-file writeup. |
| `stripe-webhook-server.js` (repo root) | **Archived** | Standalone Express server whose only job was serving the now-archived `api/webhooks/stripe.js`. Not started by any `package.json` script, PM2 config, or CI workflow. |

### Supabase Edge Functions (`supabase/functions/`)

42 Deno functions, deployed independently of the Next.js app via
`supabase functions deploy <name>` (or `deploy-production-safe.sh`), each
served at `https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/<name>`.
JWT enforcement is per-function in `supabase/config.toml`. See CLAUDE.md
for the full grouped list.

**Canonical for the SaaS subscription-tier Stripe webhook**:
`supabase/functions/stripe-webhook/index.ts` — `verify_jwt = false`
(correct: Stripe can't present a Supabase JWT; the webhook signature
itself is the auth), signature-verified with Deno-compatible async
verification, idempotent via a unique constraint on
`keymaker_events.event_id`, and its handler functions are actually wired
up and called (unlike the archived Node duplicates). Handles
`checkout.session.completed`, `invoice.payment_succeeded`,
`customer.subscription.{created,updated,deleted}`.

## 3. The two Stripe webhooks — which handles what

There are **two** distinct, both-legitimate Stripe webhook consumers in
this system, for two different concerns. Do not conflate them:

| Concern | Handler | Trigger events | Data written |
|---|---|---|---|
| SaaS subscription tiers (starter/pro/enterprise, `api/checkout.js`'s flow) | `supabase/functions/stripe-webhook/index.ts` (Edge Function) | `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.*` | `customers`, `customer_services`, `keymaker_events` |
| Stripe Connect revenue-stream routing (six sub-accounts, `galactic_bytes` etc.) | `api/stripe-connect-webhook.js` (now `pages/api/stripe-connect-webhook.js`) | `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `payout.{created,paid}` | `ledger` |

## 4. Manual verification required (cannot be done from this sandbox)

- **Stripe Dashboard webhook endpoint URLs.** Confirm the Dashboard has an
  endpoint configured for `https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-webhook`
  (subscription events) and a second endpoint for wherever this Next.js
  app is actually publicly reachable + `/api/stripe-connect-webhook`
  (Connect events). If this app isn't exposed at a public URL (plausible,
  given the Local-First/Tailscale-first posture), the Connect webhook
  needs either a public ingress or a different delivery mechanism —
  that's a real infrastructure decision, not something this audit can
  make. `STRIPE_WEBHOOK_SETUP.md` in this repo is **stale** (references
  `heidi-chat-portal.vercel.app`, a deployment target this repo's own
  CLAUDE.md says is disabled) — do not follow it as-is; the Edge Function
  deploy step it documents (`supabase functions deploy stripe-webhook`) is
  still valid.
- **Credential rotation** (carried over from the prior audit pass, still
  outstanding): a live Supabase `service_role` key and live Stripe
  secret/webhook keys were found hardcoded in tracked files on
  2026-07-15. Files were scrubbed; the keys themselves must still be
  rotated in the Supabase and Stripe dashboards. Treat as compromised
  until rotated. See ROADMAP.md.
- **`keymaker_events.event_id` uniqueness** is confirmed present in
  `supabase/migrations/001_keymaker_core.sql` (`event_id TEXT UNIQUE NOT
  NULL`) — the Edge Function's idempotency guard is backed by a real
  constraint, not just application logic. Verified by reading the
  migration; not verified against the live database schema (would need
  Supabase access this sandbox doesn't have).

## 5. Local-first runtime summary (unchanged, see CLAUDE.md for detail)

- LLM inference / embeddings: Ollama, self-hosted.
- Data plane: local Supabase via Docker (`supabase start`).
- Execution: `heidi-core`'s mission worker, health observer, and
  `ActionExecutor` never call out to any cloud service.
- Stripe: the one deliberate external dependency with no local substitute.
- Vercel: disabled, dormant capability only.
- GitHub: still the remote/CI host; a local pre-push hook
  (`.githooks/pre-push`) runs typecheck + lint + the full Jest suite
  before every push as a source of truth independent of GitHub Actions.
