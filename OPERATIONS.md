# Operations

Index of operational procedures for HYDI System v2, plus current status as
of the 2026-07-15 production-readiness audit. This file is an index and
status summary, not a replacement for the detailed runbooks it links to —
see each linked doc for the actual step-by-step procedures.

## Incident response

| Situation | Doc |
|---|---|
| 3am / low-context decision tree | `ON_CALL_EMERGENCY.md` |
| Full incident decision tree | `ON_CALL_RUNBOOK.md` |
| Rollback / kill-switch procedures | `ROLLBACK_PLAYBOOK.md` |

The `WEBHOOK_PROCESSING_ENABLED=false` emergency pause now covers **both**
Stripe webhook consumers (see DEPLOYMENT.md §3): the subscription-tier
Edge Function and the Connect revenue-stream `pages/api/stripe-connect-webhook.js`
route. Previously it only existed in code that was never actually
reachable — see `archive/legacy-stripe-webhook-implementations/README.md`
for the full history and why the flag's default polarity was deliberately
changed when porting it to the live handlers.

## Deployment

See `DEPLOYMENT.md` for the definitive routing map (which files serve
which URLs, what's dead/duplicated, and why) and
`HEIDI-DEPLOYMENT-GUIDE.md` / `DEPLOY-CHECKLIST.md` for step-by-step
deployment procedures. Summary of the current deployment posture:

- **Application**: `next build && next start` (or `next dev` locally).
  Vercel is explicitly disabled — see CLAUDE.md's Local-First
  Architecture section. There is no `vercel.json` in this repo.
- **Data plane**: local Supabase via Docker (`supabase start`) plus 42
  Deno Edge Functions deployed independently via `supabase functions
  deploy <name>` or `./deploy-production-safe.sh`.
- **LLM inference**: Ollama, self-hosted.
- **CI**: GitHub Actions (`unit-tests.yml`, `hdi-governance-gate.yml`,
  `health-monitor.yml`, `codeql.yml`) plus a local `.githooks/pre-push`
  hook (typecheck + lint + full Jest suite) as a source of truth
  independent of GitHub Actions being available.

## Health & monitoring

- `./verify-supabase.sh` — Supabase connectivity + key table check.
- `api/health.js` (bridged at `/api/health`) — reads the `system_dashboard`
  Supabase view; degrades to `503` if that view is broken.
- `api/mobile-status.js` (bridged at `/api/mobile-status`) — compact,
  3G-safe health + per-revenue-stream snapshot in one round-trip.
- `MONITORING_SETUP.md` — minimal monitoring setup (health-check cadence,
  the one real payout-failure alert).
- `.github/workflows/health-monitor.yml` — scheduled health endpoint ping.
  Its `vercel-api-check.js` step is a read-only diagnostic (confirms
  Vercel deploy stays dormant), not a deploy trigger.

## Current status (2026-07-15 audit)

**Resolved this pass**:
- Checkout (`/api/checkout`) and Connect-webhook (`/api/stripe-connect-webhook`)
  routes are now actually reachable via `pages/api/` bridges — previously
  they were dead code in an unreachable top-level `api/` directory. See
  ISSUES_FOUND.md #33.
- `api/client-dashboard.js` — a full per-project financial ledger view —
  was unauthenticated and reachable by anyone who could guess a revenue
  stream name (the six names are publicly documented in CLAUDE.md). Now
  gated behind `requireAuth('ledger:view')`. See ISSUES_FOUND.md #38.
- The mobile-ops live SSE stream (`/api/events/stream`) was authenticated
  in code but never actually bridged into reachability — fixed. See
  ISSUES_FOUND.md #39.
- Four separate, inconsistent implementations of "handle a Stripe
  subscription webhook" existed in the repo; consolidated onto the one
  that was actually correct and complete (`supabase/functions/stripe-webhook/index.ts`).
  The other three (one with a real broken-export bug, one an
  unauthenticated diagnostic stub, one with zero signature verification)
  are archived, not deleted, with a full writeup in
  `archive/legacy-stripe-webhook-implementations/README.md`.
- The `WEBHOOK_PROCESSING_ENABLED` emergency kill switch the on-call
  runbooks document now actually works on both live webhook handlers
  (previously it only existed in dead code).
- **Critical**: `src/server.js`'s `POST /keymaker/keys` let any
  unauthenticated caller mint their own admin-role API key by simply
  requesting `{ role: 'admin', tier: 'enterprise' }` in the body — the
  original check only guarded which `userId` a key was issued for, not
  the requested `role`/`tier`. That key then passed every
  `identity.role !== 'admin'` gate elsewhere in the file. Fixed.
- **High**: `src/middleware/simple-keymaker.js` registered three
  well-known hardcoded API keys (`sk_test_*`) as valid in every
  environment including production, and registered an empty-string key
  mapped to a real tier whenever a production key env var was unset.
  Fixed — test keys are now development-only; unset env vars no longer
  register anything.

**Manual operator actions still required** (cannot be completed from an
automated sandbox — see DEPLOYMENT.md §4 and ROADMAP.md for full detail):
1. **Rotate the Supabase `service_role` key and Stripe secret/webhook
   keys** found hardcoded in tracked files on 2026-07-15. Files were
   scrubbed; the keys themselves are still live until rotated in the
   Supabase and Stripe dashboards.
2. **Confirm the Stripe Dashboard's webhook endpoint URLs** actually point
   at the two canonical handlers (see DEPLOYMENT.md §3-4). If this Next.js
   app isn't exposed at a public URL, the Connect webhook needs either
   public ingress or a different delivery mechanism — an infrastructure
   decision, not something an audit can resolve unilaterally.
3. **Decide the fate of three ambiguous routes** (`api/chat/route.js`,
   `api/heidi/route.js`, `api/ws/route.js`) — left unbridged pending a
   maintainer call on whether each is still wanted. See ISSUES_FOUND.md #34.
4. **Confirm whether `src/server.js` is deployed anywhere real — the
   final call requires checking the actual host.** A follow-up pass
   (2026-07-15) found this repo has *two separate, unreconciled boot
   orchestrators*: one (`scripts/start-hydi.js`+`.ports.json`) treats a
   different file (`heidi-core/index-clean-3458.js`) as core and never
   mentions `src/server.js`; the other (`scripts/boot-agent.js`+`boot.config.json`,
   the more recently updated of the two) treats `src/server.js` as
   required core infrastructure that the Next.js web layer depends on,
   consistent with CLAUDE.md's "ground truth anchored first" principle.
   The Next.js app's own `api/ws/route.js` directs WebSocket clients to
   `src/server.js`'s port (3005) for real-time features. This is stronger
   evidence than "unknown," but still not proof of what's running on any
   real host. See DEPLOYMENT.md §5, ISSUES_FOUND.md #42-#44.
5. **Decide the intended sensitivity of `src/server.js`'s `/infrastructure/*`
   routes** (currently fully open to any caller — deliberate code, not an
   oversight) and whether to wire up `Keymaker.requireAccess()`, which
   exists and works but is never called from any route. See DEPLOYMENT.md
   §5.

**Known accepted risks** (documented, not newly introduced): see
SECURITY.md's "Known Security Limitations" section — primarily the
`x-user-id` header trust model, tracked as the top near-term security
item in ROADMAP.md.
