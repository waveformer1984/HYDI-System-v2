# Deployment Architecture & Routing Map

Authoritative reference for how HYDI System v2 actually serves traffic
today, and the definitive map of every HTTP route: source file, runtime,
deployment target, and whether it's actually reachable. Produced by a
production-readiness audit (2026-07-15) that traced every routing
convention in the repo against what's actually executed, rather than
trusting file presence or documentation alone.

## 0. Scope of this document

This map covers the Next.js `pages/api/**` + top-level `api/**` surface,
the Supabase Edge Functions, and (§6, added in a follow-up pass)
`src/server.js`'s standalone Express app. Do not assume a "reachable"
finding in one section applies to another — they are three independent
runtimes with independent routing, independent auth, and (per §6)
independently uncertain deployment status.

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

## 5. `src/server.js` — a third, separately-mapped Express surface

`src/server.js` (1734 lines, `npm run server` → `node src/server.js`) is a
standalone Express app with ~60 routes (`/cascade/*`, `/heidi/*`,
`/infrastructure/*`, `/keymaker/*`, `/insight`, `/opportunities`,
`/event`, `/process`) plus a WebSocket chat server. It is **not** the same
thing as `heidi-core/`:

| | `src/server.js` | `heidi-core/index-clean-3458.js` |
|---|---|---|
| Default port | `3005` (`process.env.PORT`) | `3459` (`process.env.HEIDI_PORT`, per `.ports.json`) |
| In `.ports.json`? | **No** — no entry at all | Yes — `heidi-core`, the registry's canonical orchestrator |
| Launched by `npm run start:hydi` (`scripts/start-hydi.js`)? | **No** | Yes — this is the process it actually starts as "HEIDI Core" |
| Routes | `/cascade/*`, `/heidi/*`, `/infrastructure/*`, `/keymaker/*` | `/think`, `/task`, `/tasks`, `/phase5/*`, `/revenue/*` (policy/arbitration/governance/bias) |
| Test coverage | None — no test file `require()`s it | N/A to this comparison |

### Reachability status: two competing orchestrators disagree — resolved as far as repo evidence can take it

A follow-up pass (2026-07-15) went looking for a definitive answer and
found something more specific than "ambiguous": **this repo contains two
separate, unreconciled boot orchestrators that were never cross-referenced
with each other**, and they disagree about whether `src/server.js` is core
infrastructure.

| | `scripts/start-hydi.js` + `.ports.json` | `scripts/boot-agent.js` + `boot.config.json` |
|---|---|---|
| What it calls "core" | `heidi-core/index-clean-3458.js` (port 3459) | `src/server.js`, labeled `protoforge-core` (port 3005) |
| `heidi-web` (Next.js) depends on it? | Not modeled — services listed flat, no `dependsOn` graph | **Yes** — `boot.config.json`'s `heidi-web` entry has `"dependsOn": ["protoforge-core"]` |
| npm script | `npm run start:hydi` | `npm run boot` / `npm run boot:prod` |
| Last meaningfully edited | 2026-07-10 (`.ports.json`) | 2026-07-09 (`boot.config.json`, folding in mobile chat) |
| Is it a real, working implementation or just docs? | Real — `scripts/start-hydi.js` spawns processes, waits on health | Real — `scripts/boot-agent.js` (398 lines) does a topological sort by `dependsOn`, spawns processes, health-gates them |

Both are genuinely implemented (not aspirational documentation), both
received real commits within a day of each other, and **neither
references the other or `heidi-core/index-clean-3458.js` vs
`src/server.js` at all** — this looks like two boot systems built at
different times that were never reconciled, not one superseding the
other.

**Evidence leaning toward "yes, `src/server.js` is meant to be live":**
- `boot.config.json` — the newer of the two configs — explicitly makes the
  Next.js web layer depend on it, and `BOOT_AGENT.md` ties this directly
  to CLAUDE.md's own stated architecture principle: "this respects the V2
  principle of anchoring ground truth (ProtoForge core) before the layers
  on top come online."
- `api/ws/route.js` (in the Next.js app itself) tells WebSocket clients to
  connect to `ws://localhost:3005` for real-time chat/cascade/kilo/protoforge
  events — the Next.js app's own code treats `src/server.js` as the real
  backend for that feature.
- Deployment/feature docs (`HEIDI-DEPLOYMENT-GUIDE.md`, `DEPLOY-CHECKLIST.md`)
  describe recent, deliberate feature work landing in `src/server.js`
  (structured model-event logging), not archival maintenance.
- Two prior audit passes fixed real bugs in it (ISSUES_FOUND.md #7
  `approvedBy`/`approved_by` typo, #8 the `Keymaker` class never being
  wired in) — someone has been actively treating it as worth maintaining.

**Evidence leaning the other way:**
- Absent from `.ports.json` and `scripts/start-hydi.js` entirely.
- README.md's own "Quick Start" section says only `npm run dev` — no
  mention of `npm run boot` or starting `src/server.js` separately. (This
  carries less weight than it first appears: README.md hasn't been
  touched since 2026-07-01, predating `boot.config.json`'s most recent
  edit — it's likely just stale, not a considered decision to exclude
  `src/server.js`.)
- Zero test coverage, and **zero server-side runtime coupling**: nothing
  in `pages/`, `lib/`, or the rest of `api/` makes an HTTP call to port
  3005. The Next.js REST API surface this audit otherwise covers
  functions completely independently of whether `src/server.js` is
  running — only the WebSocket-based real-time chat feature actually
  needs it.
- This sandbox is a fresh checkout with no running processes, log files,
  or PID files — there is no way to observe an actual live instance from
  here, on this occasion or any other.

**Conclusion**: the repo's own most-recently-updated module registry
(`boot.config.json`) declares `src/server.js` a required dependency of the
web layer, and the code backs that declaration up in one concrete way
(the WebSocket redirect). That's stronger evidence than "genuinely
unknown" — but it still isn't proof of what's running on any actual host
right now, which no static analysis of a git checkout can provide. If it
is not currently running, then real-time chat / cascade / kilo /
protoforge WebSocket features are silently non-functional, while the REST
`pages/api/**` surface (checkout, webhooks, mobile-ops, etc.) is
unaffected. **Definitive confirmation requires checking the actual
deployment host** (a running process on port 3005, a systemd/PM2 unit, or
simply asking the maintainer) — something no amount of repo archaeology
can substitute for.

### Two real bugs found and fixed regardless of reachability

Both are unambiguous logic/hardening bugs — fixed independent of the
reachability question above, since "maybe nobody runs this" is not a
defensible reason to leave a live privilege-escalation path in a
committed, documented, `npm run`-able server.

1. **Critical — unauthenticated privilege escalation via `POST /keymaker/keys`.**
   Self-service key issuance only guarded the `userId` field of the
   request body, not `role` or `tier`. A caller with **no credentials at
   all** gets `identity = { role: 'guest', tier: 'starter', userId: null }`
   (`Keymaker.makeAnonymous`), and could `POST /keymaker/keys` with
   `{ role: 'admin', tier: 'enterprise' }` in the body to receive a
   freshly issued, valid, admin-role key — which then passed every
   `identity.role !== 'admin'` gate elsewhere in the file: kill-switch,
   break-glass, key revocation, the audit log. **Fixed**: extracted the
   authorization check into `Keymaker.canIssueKeyAs()` (a pure, static,
   unit-tested method — `tests/unit/keymaker-key-issuance.test.js`) that
   rejects any `role`/`tier`/`userId` override that doesn't match the
   caller's own already-resolved identity, unless that identity is
   already `role: 'admin'`.
2. **High — hardcoded, always-active test credentials.**
   `src/middleware/simple-keymaker.js` registered `sk_test_starter_123`,
   `sk_test_pro_456`, and `sk_test_enterprise_789` as valid API keys
   unconditionally, in every environment including production — anyone
   who read this file (or this public repo) could authenticate as any
   tier with a well-known string. Separately, `[process.env.X || '']`
   registered an **empty-string key** mapped to a real tier whenever a
   production key env var was unset. **Fixed**: test keys now only
   register when `NODE_ENV !== 'production'`; env-var-backed keys only
   register when the env var is actually set. Regression tests in
   `tests/unit/simple-keymaker.test.js`.

### Structural gaps found, deliberately not fixed (need a product decision)

Unlike the two bugs above, these are consistent, deliberate design
choices in the code — changing them is a policy decision, not a bug fix,
and risks breaking a real caller this sandbox can't see:

- **`SimpleKeymaker.middleware()` exempts every GET request and the
  entire `/infrastructure/*` path (all methods) from any auth check at
  all**, by explicit code: `if (req.method === 'GET' || ... ||
  req.path.startsWith('/infrastructure')) return next();`. This means
  `GET /infrastructure/revenue` (real revenue stream figures) and
  `POST /infrastructure/revenue` (writes an arbitrary revenue record from
  the request body) are both completely open. `Keymaker`'s own service
  registry disagrees with this — it lists `infrastructure` as requiring
  `minTier: 'pro', roles: ['admin']` — but that registry is never actually
  enforced (see next item), so `SimpleKeymaker`'s blanket exemption is
  what governs in practice.
- **`Keymaker.requireAccess(serviceId)` — a real, working, tier/role
  authorization-check method — is never called anywhere in
  `src/server.js`.** The global `keymaker.middleware()` only populates
  `req.keymaker.identity` (falling back to an anonymous `guest`/`starter`
  identity when no key is presented — itself a fail-open default, not
  fail-closed); enforcement per-route is opt-in via `requireAccess()`, and
  no route opts in. The handful of routes that do check `identity.role`
  (the `/keymaker/admin/*` and `/keymaker/keys`/`/keymaker/audit` routes
  fixed above) do so with ad hoc inline checks, not the shared mechanism
  built for this.

If a maintainer confirms `src/server.js` is live, the recommended
follow-up is: decide the intended sensitivity of `/infrastructure/*` and
either wire `requireAccess()` to it and every other route the `Keymaker`
service registry describes, or delete the unused registry entries so the
code doesn't imply protections that don't exist.

## 6. Local-first runtime summary (unchanged, see CLAUDE.md for detail)

- LLM inference / embeddings: Ollama, self-hosted.
- Data plane: local Supabase via Docker (`supabase start`).
- Execution: `heidi-core`'s mission worker, health observer, and
  `ActionExecutor` never call out to any cloud service.
- Stripe: the one deliberate external dependency with no local substitute.
- Vercel: disabled, dormant capability only.
- GitHub: still the remote/CI host; a local pre-push hook
  (`.githooks/pre-push`) runs typecheck + lint + the full Jest suite
  before every push as a source of truth independent of GitHub Actions.
