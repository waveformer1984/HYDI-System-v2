# Roadmap

This document describes the planned evolution of HYDI System v2. Dates are targets, not guarantees. All items are subject to change at the maintainer's discretion.

## Current state (v1.0, Q2 2026)

The core platform is operational:

- Six-layer deterministic event pipeline (Ingestion → RAW EVENT LEDGER → CASCADE → KILO → ProtoForge → Emission)
- Immutable, append-only RAW EVENT LEDGER with deterministic replay
- DSL policy engine with runtime-configurable rules and Supabase Realtime hot-reload
- KILO hypothesis generator (execution permanently prohibited via unconditional throw)
- 42 Supabase Edge Functions (Deno) covering billing, auth, observability, and marketing
- Stripe Connect with six active revenue sub-accounts
- `DecisionAssistWorker` covering financial planning, resource allocation, risk assessment, and system optimisation
- `api/mobile-status.js` — compact 3G-safe single-round-trip health + revenue snapshot
- Stream health watchdog Edge Function
- 17 `SECURITY DEFINER` functions with pinned `search_path`
- 7-gate DB migration governance CI workflow
- `npm run lint` (ESLint, TypeScript + Next.js aware) gated in CI on every push/PR

---

## 2026-07-16 audit: prioritized findings

Repository-wide audit pass. Ranked by impact × risk; P0 is
drop-everything, P1 is next up, P2 is scheduled but not urgent.

**P0 — blocking / operator action required:**
1. **Rotate the credentials leaked 2026-07-15** (still outstanding — see
   below). Cannot be completed from any sandbox; requires dashboard access.
2. ~~**Duplicate open PRs for the same issue**: #197 and #198 both close
   issue #195~~ **Consolidated 2026-07-16** — #197 closed as a duplicate,
   #198 kept (it was the superset: same 5 workflow changes plus the
   stuck-queue alert and `OPERATIONS.md` update).
2a. **New finding while consolidating: #198's own CI is still failing**,
    not just stuck-queued. Both `Jest Unit Tests` and the CodeQL analyze
    job complete with `conclusion: failure` in ~3-4 seconds on
    `ubuntu-latest`, with `runner_id: 0` — never actually assigned to a
    runner. That session already tried retriggering twice believing an
    Actions spending-limit fix had resolved it ("chore: retrigger CI after
    spending-limit fix") — both retriggers failed identically. This points
    at either an incomplete spending-limit fix or a separate account/repo
    level block on GitHub-hosted runners (Settings → Actions → General,
    Settings → Billing → spending limits) — needs dashboard access to
    diagnose further, same as the credential rotation above. **Do not merge
    #198 until a check actually goes green** — merging now trades "stuck
    queued forever" for "fails immediately every time," which isn't
    actually a trustworthy CI signal either.
2b. **2026-07-17 follow-up: confirmed repo-wide, not workflow-specific.**
    Checked the last several runs of all three active, frequently-triggered
    workflows (`unit-tests.yml`, `codeql.yml`, `health-monitor.yml`,
    including a scheduled Health Monitor run and a run on a feature branch,
    not just `clean-main`) — every one fails within 3-25 seconds with the
    same `runner_id: 0` symptom. All 8 workflows in the repo report
    `state: "active"`, ruling out "Actions disabled" at the repo/workflow
    level. `get_workflow_run_usage` on a failing run shows `total_ms: 0`
    billable UBUNTU runner time — the runner was never dispatched at all,
    which reads more like an account/repo-level block on GitHub-hosted
    runners than a mid-run spending-limit cutoff (that would normally show
    some partial billable time before being killed). No tool available to
    any sandbox session exposes the `actions/permissions` or account-billing
    API, so this still needs a human to check, specifically:
    `github.com/waveformer1984/HYDI-System-v2/settings/actions` (Actions
    permissions not disabled) and `github.com/settings/billing/summary` or
    `.../budgets` (spending limit not $0 / account not paused). If both
    check out clean, this may warrant a GitHub support ticket — instant
    failure with zero billable time and no runner assignment isn't a normal
    "ran out of minutes" pattern.

**P1 — high impact/risk, not yet started:**
3. Cryptographic identity verification to replace the `x-user-id`
   header-trust model (unchanged top priority — see below). **Reviewed
   2026-07-16 before starting** (not yet decided): this conflates two
   different problems. Caller/device identity is already solved (real HMAC
   crypto in `lib/auth/deviceAuth.js`). Only the *data-owner* identity used
   by `api/rezonate/route.js` (and the unreachable `api/life-flow/route.js`)
   is unverified, and there are two unconnected, half-built scaffolds
   already in the codebase that could become the real source of it —
   extending the existing device/service token to carry a `user_id` claim,
   vs. wiring up the dormant Supabase Auth scaffolding (`auth.users` FK +
   correct RLS already exist, but no login/signup UI exists anywhere and
   the route uses the service-role key, bypassing RLS regardless). Which
   one to build out is a product decision — see `SECURITY.md`. In the
   meantime, the narrower "some actions had zero ownership check at all"
   gap this surfaced is fixed — see item 3a.
3a. `api/rezonate/route.js`'s `get_project`/`list_tracks`/`add_track` had
    **no ownership check at all** (not just an unverified header — nothing).
    **Fixed 2026-07-16** (`ISSUES_FOUND.md` #48): all three now confirm the
    project belongs to the request's `userId` before proceeding. The
    `userId` itself is still unverified pending the decision in item 3.
3b. ~~Fixing the `pages/api/actions/[id].ts` human-review-bypass
    vulnerability (`ISSUES_FOUND.md` #56) meant the dashboard's
    approve/reject buttons (`pages/index.tsx`) got a 401, since that page
    had no credential-storage mechanism at all.~~ **Fixed 2026-07-17** —
    added a ⚙️ settings panel (matching the pattern the GitHub Pages
    mobile client already uses) where the operator enters
    `HYDI_SERVICE_SECRET` once; stored in `localStorage`, minted into an
    HMAC `x-hydi-service-token` client-side via Web Crypto on each
    approve/reject call. Verified end-to-end with Playwright against a
    real `next dev` server: panel opens/saves/persists across reload, and
    the client-minted token is byte-for-byte identical to what
    `lib/auth/verifyServiceToken.js` computes server-side.
4. ~~`workers/SecurityIdentityWorker.js`'s `processAuthentication()` always
   succeeds regardless of submitted credentials~~ **Fixed 2026-07-16** —
   now fails closed (`ISSUES_FOUND.md` #47). Still open: no real
   credential verification exists for this worker at all (the payload
   carries nothing to verify against) — designing that path, or deciding
   to retire it in favor of the already-live `Keymaker` middleware, is a
   product decision for the maintainer.
5. Consolidate the **4 parallel, unreachable Stripe
   checkout/webhook implementations** (`src/webhook-handlers/stripe-webhook.js`,
   `src/api/services/index.js`'s bundle, the standalone
   `stripe-webhook-server.js`, and the stale `hydi-monitor-deploy/`
   sub-deployment) — needs a maintainer decision on which billing model
   is current before the other three can be archived or deleted
   (`ISSUES_FOUND.md`, "Investigated, not fixed").
6. ~~Per-file review of the remaining ambiguous unbridged `api/**` routes~~
   **Done 2026-07-17** (`ISSUES_FOUND.md` #49-#54). `chat/route.js`,
   `ursula/status.js`, `events/stream.js` bridged into `pages/api/**`
   (each confirmed genuinely live and distinct from any `pages/api`
   sibling, not superseded); bridging `chat/route.js` also surfaced and
   fixed a real `.js`/`.ts` import-extension bug that broke `next build`.
   `ws/route.js` archived as confirmed-dead. `heidi/route.js` and
   `client-dashboard.js` deliberately left unbridged — both lack any auth
   and bridging them as-is would introduce a live vulnerability rather
   than fix a gap; see `ISSUES_FOUND.md` #53-#54 for what a real fix would
   need. **Follow-on found the same day by a parallel session**
   (`ISSUES_FOUND.md` #55): `components/song-composer/CopilotPanel.tsx`
   was calling `/api/chat/route` with a payload shape that route never
   accepted (a freeform system prompt instead of one of the 8 fixed
   routing keys) and no HMAC service token — bridging the route doesn't
   fix that, since a browser can't safely hold the token anyway. Fixed by
   repointing `CopilotPanel` at the real, already-live, unauthenticated
   `/api/chat` instead (the same SSE contract `pages/index.tsx`'s Heidi
   chat already uses), folding the song-context prompt into the message
   text since that endpoint has no separate system-prompt param.
   **Second follow-on found 2026-07-17** (`ISSUES_FOUND.md` #67-#68), same
   root cause hitting the mobile clients this time: `docs/index.html` and
   `public/hydi-chat.html` were calling bare `/api/chat` (needed
   `/api/chat/route` for their HMAC + system-picker contract) and
   `hydi-mobile-protoforge.html` — the actual canonical mobile PWA
   (`manifest.json`'s `start_url`) — was calling `/api/chat` with neither
   required field for either handler. All three fixed and verified
   end-to-end against a running `next dev` server (not just by inspection);
   also fixed stale Vercel-deployment guidance in the same files
   (`ISSUES_FOUND.md` #69) that contradicted the Local-First Architecture
   decision below.

**P2 — scheduled, lower urgency:**
7. ~~JWT enforcement audit across all 42 Supabase Edge Functions + rate
   limiting on the public (no-JWT) ones~~ **Done 2026-07-17**
   (`ISSUES_FOUND.md` #55-#66). 15 functions had no explicit `verify_jwt`
   entry and no code-level auth check at all — now gated with a new shared
   `requireServiceRole()` helper (`supabase/functions/_shared/security.ts`).
   All 14 intentionally-public functions now have rate limiting. Also
   surfaced and fixed two critical findings beyond the Edge Function scope
   this item named: `pages/api/actions/[id].ts` let anyone bypass
   ProtoForge's human-review escalation with zero auth (now gated,
   **breaking change for the dashboard UI** — see item 3b below), and
   `chat-operator` trusted a client-supplied `user_id` to authorize real
   refunds (now cross-checked against the session's real owner). Also
   found and left open, needing a maintainer decision:
   `supabase/functions/stripe-worker`'s live role vs. the already-public
   `stripe-webhook` function is ambiguous (`ISSUES_FOUND.md` #63) — same
   class of call as item 5 below.
8. ~~~150 `no-unused-vars` ESLint warnings (`ISSUES_FOUND.md` #18)~~ **Fixed
   2026-07-18** (`ISSUES_FOUND.md` #71) — had grown to 201 across 49 files;
   cleaned up file-by-file as originally recommended, not mechanically.
   `npm run lint` now reports 0 warnings, 0 errors repo-wide.
9. ~~`tests/unit/hydi-v3/WatchdogSupervisor.test.js` has the same
   fixed-`setTimeout`-vs-own-interval race~~ **Fixed** in PR #202
   (2026-07-16).
10. ~~`AGENT_REGISTRY`'s Rezonate endpoint path in
    `api/agent-manager/agents.js` doesn't match the file's actual
    resolved route~~ **Fixed** in PR #202 (2026-07-16).

**Done this pass (housekeeping):**
- Archived 3 confirmed-orphaned dead-code files flagged in a prior audit's
  follow-up list but never actioned: `modules/keymaker-core.js`,
  `emergency/break-glass-implementation.js`,
  `keeper/emergency/break-glass.js` → `archive/dead-keymaker-and-break-glass-prototypes/`.
- Archived 7 stale April 26, 2026 "✅ PRODUCTION READY" / "✅ COMPLETE
  SUCCESS" reports that actively contradicted the current, accurate
  `DEPLOYMENT.md` / `OPERATIONS.md` / `SECURITY.md` (a stale audit report
  claiming "no exposed secrets" and a fully Vercel-hosted deployment model
  that's since been confirmed unused) →
  `archive/stale-april-2026-deployment-reports/`.
- Local-First execution plan Phase 0: archived the last dead Vercel
  artifacts (`.vercelignore`, `apps/ursula-frontend/vercel.json`,
  `scripts/cloud-bootstrap/vercel.js`) → `archive/dead-vercel-config/`. See
  "Local-First execution plan" under Near-term below.

---

## Near-term (Q3 2026)

### URGENT: rotate the credentials leaked 2026-07-15
A live Supabase `service_role` key and live Stripe secret/webhook keys were
found hardcoded across 21+ tracked files (see `ISSUES_FOUND.md` #20-#21).
The files have been scrubbed and a Vault-backed replacement wired up, but
the keys themselves are still live until rotated in the Supabase and
Stripe dashboards — this session had no authenticated access to do that
part. Treat as compromised until rotated.

### RESOLVED (2026-07-15, third pass): checkout and Stripe webhooks are now reachable
Checkout (`api/checkout.js`, bridged to `pages/api/checkout.js`) and both
Stripe webhook handlers (`api/stripe-connect-webhook.js`,
`api/webhooks/stripe.js`, bridged to their `pages/api/` equivalents) are
now part of Next.js's actual served route set — confirmed with a real
`npm run build`. Two additional latent bugs that would have broken them
even after bridging were also found and fixed: a clobbered module export
in `webhooks/stripe.js`, and both handlers reading `req.body` directly
instead of buffering the raw request stream (Next.js does not
auto-populate `req.body` when `bodyParser: false` is set, which raw-body
Stripe signature verification requires). See `ISSUES_FOUND.md` #38-#41 and
`DEPLOYMENT.md` for the full routing map.

**Still open**: the top-level `api/` directory as a whole remains a dead
Vercel-only convention under this deployment model (~13 files still
unbridged — see `DEPLOYMENT.md`'s reachability table). More importantly,
**this audit could not confirm from inside the sandbox which of this
repo's several possible "production" processes (`next start`, the separate
Express server at `src/server.js`, or the PM2-managed fleet described in
`ecosystem.config.js` — `heidi-core/server.js`, `hydi-processor.js`,
`protoforge-main.js`, `agents/ursula/ursula.js`, `apps/ursula-frontend`) is
actually running on the real host right now.** `DEPLOYMENT.md` documents
what's *reachable in principle* per each process's own code; whether each
process is *actually started* on the operator's machine is something only
the operator can confirm (e.g. `pm2 list`).

### Security: cryptographic identity verification
Replace the current `x-user-id` header trust model with cryptographically verified identity tokens. This is the highest-priority security item and is a prerequisite for any public-facing expansion.

### Local-First execution plan
Full inventory + phased path in `LOCAL_FIRST_EXECUTION_PLAN.md` for
replacing every external platform this system depends on with a
local/self-hosted equivalent, wherever one exists — extends `CLAUDE.md`'s
Local-First Architecture decision (2026-07-10) from a status summary into
something executable.

- **Phase 0 (✅ done 2026-07-16)**: archived the last dead Vercel
  artifacts now that Vercel deployment is confirmed unused — see the
  audit findings above.
- **Phase 1 (🔜 runbook + migration script ready, execution pending host
  access)**: promote the already-proven local Supabase Docker stack from
  dev-only to the actual production data plane, replacing the cloud
  project entirely. `LOCAL_FIRST_PHASE1_RUNBOOK.md` has the full
  step-by-step; `scripts/migrate-to-local-supabase.sh` automates the
  data-only migration + per-table row-count verification. **Confirmed
  2026-07-16: no Claude Code Remote sandbox session can execute this
  phase's actual migration** — no DNS resolution for the Tailscale host,
  generic outbound HTTPS 403s everywhere except the git remote (even via
  the environment's own web-fetch tool), no `supabase` CLI installed. This
  needs to be run by an operator, or a session with real access to
  `heidi-pc`, following the runbook.
- **Phase 2 (🔜)**: Edge Functions — no code changes needed, all 42 already
  run identically under `supabase functions serve`.
- **Phase 3 (🔜, low priority)**: GitHub Pages → local static serving.
- **Out of scope**: Stripe (no self-hosted payment processor exists) and
  GitHub itself (self-hosting already explicitly declined per the
  2026-07-10 decision) — see `LOCAL_FIRST_EXECUTION_PLAN.md` for the full
  reasoning.

### Pipeline observability
- Structured trace IDs flowing through all six layers end-to-end
- Per-layer latency metrics surfaced in `api/mobile-status.js`
- Replay Engine automated regression suite running on every PR

### PolicyEngine expansion
- Additional DSL operators (`contains`, `startsWith`, `regex`)
- Multi-condition rule grouping (`all`, `any`)
- Rule version history in the `policies` table

---

## Medium-term (Q4 2026)

### Revenue stream expansion
- Additional Stripe Connect sub-accounts for new projects
- Per-stream real-time P&L dashboard
- Automated payout scheduling via `pg_cron`

### KILO hypothesis quality
- Confidence scoring tied to ProtoForge calibration feedback loop
- Hypothesis deduplication before Emission Layer
- Audit trail for accepted vs. rejected hypotheses in the `decisions` table

### Edge Function hardening
- ~~JWT enforcement audit across all 42 functions~~ **Done 2026-07-17**,
  see P2 item 7 above.
- ~~Rate limiting on public (no-JWT) functions~~ **Done 2026-07-17**, see
  P2 item 7 above.
- Chaos runner integration into CI

---

## Long-term (2027)

### Multi-tenant pipeline
Support isolated pipeline instances per tenant, each with their own RAW EVENT LEDGER partition and PolicyEngine rule set.

### Federated HYDI nodes
Allow external services (Rezonette, ProtoForge, future nodes) to register as first-class pipeline participants with verifiable identities.

### Self-healing automation
Expand the existing `SelfHealingService` to automatically remediate common drift conditions without human intervention, gated behind a human-approval workflow for destructive actions.

---

## Non-goals

The following are explicitly out of scope and will not be added:

- **KILO execution authority** — KILO will never be permitted to execute actions directly; `execute()` throws unconditionally by design
- **Mutable event ledger** — the RAW EVENT LEDGER is append-only; no update or delete paths will be added
- **Unauthenticated pipeline ingestion** — all ingestion endpoints will require authentication once the identity hardening milestone is complete
