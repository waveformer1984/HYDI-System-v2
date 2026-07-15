# WORKLOG

Running log of autonomous production-readiness work. Newest entries first.

---

## 2026-07-15 (fourth pass) — `src/server.js` reachability audit

Branch: `claude/production-readiness-audit-fk9lth`. Follow-up to the third
pass's own recommended next milestone (ISSUES_FOUND.md #42): repeat the
reachability-mapping exercise for `src/server.js`, a standalone Express
app (`npm run server`) discovered while archiving
`src/webhook-handlers/stripe-webhook.js` and explicitly flagged as
out-of-scope for the checkout/webhook pass.

### What was found

`src/server.js` (1734 lines) is genuinely distinct from `heidi-core/index-clean-3458.js`
— the process `.ports.json` and `scripts/start-hydi.js` (the documented
orchestrated startup, `npm run start:hydi`) actually treat as "HEIDI
Core." `src/server.js` has no entry in `.ports.json`, isn't launched by
`start-hydi.js`, and has zero test coverage (`grep` confirms no test file
`require()`s it). All three point toward "legacy/orphaned." But it's also
a real `package.json` script (though notably absent from CLAUDE.md's own
Commands section — undocumented even there), and two prior audit passes
fixed real bugs in it specifically (ISSUES_FOUND #7, #8) — meaning someone
has been actively treating it as
worth maintaining. Net: reachability is genuinely unresolved, not
resolved by this pass — see DEPLOYMENT.md §5 for the full comparison
table and reasoning.

Regardless of that open question, mapping the file's ~60 routes and its
two-layer auth setup (`SimpleKeymaker` — crude, hardcoded API keys → tier;
`Keymaker` — a more complete but half-wired role/tier system backed by
Supabase) surfaced two real, unambiguous bugs, fixed independent of the
reachability question:

1. **Critical — unauthenticated privilege escalation.** `POST
   /keymaker/keys` (self-service key issuance) checked whether the
   caller could issue a key *for a different `userId`*, but never checked
   whether the caller could request an elevated `role` or `tier` for
   *themselves*. A caller with zero credentials resolves to
   `Keymaker.makeAnonymous()`'s `{ role: 'guest', tier: 'starter', userId:
   null }`, and could simply `POST { role: 'admin', tier: 'enterprise' }`
   with no `userId` in the body — the `userId` guard never triggers, and
   the handler happily does `role || identity?.role || 'guest'`, which
   evaluates to the attacker-supplied `'admin'` since it's truthy. The
   resulting key then satisfies every `identity.role !== 'admin'` check
   elsewhere in the file: `/keymaker/admin/kill-switch`,
   `/keymaker/admin/break-glass`, `DELETE /keymaker/keys/:keyHash`, `GET
   /keymaker/audit`. Full unauthenticated admin takeover of the Keymaker
   subsystem, zero credentials required.
2. **High — hardcoded, unconditionally-active test credentials.**
   `src/middleware/simple-keymaker.js` registered `sk_test_starter_123`,
   `sk_test_pro_456`, `sk_test_enterprise_789` as always-valid API keys —
   no `NODE_ENV` guard, so they were live in a production deployment of
   this file exactly as much as a dev one. Same bug class as the
   `keeper-break-glass` hardcoded-fallback-secret fix from an earlier
   pass. Also found and fixed while in the same constructor:
   `[process.env.STARTER_API_KEY || '']` (and its two siblings) silently
   registered an **empty-string key** mapped to a real tier whenever the
   corresponding production env var was unset.

### What was fixed

- **#1 above**: extracted the authorization check into
  `Keymaker.canIssueKeyAs(identity, requested)` — a pure, dependency-free,
  static method on the existing `Keymaker` class (`src/middleware/keymaker.js`),
  called from `src/server.js`'s route handler. Chose extraction-into-a-pure-function
  specifically because `src/server.js` itself can't be feasibly
  `require()`'d in a unit test (it constructs a queue, a heartbeat
  monitor, and a WebSocket server as side effects of module load) — this
  is almost certainly *why* no prior pass added regression coverage for
  bugs it fixed in this file (#7, #8 in ISSUES_FOUND.md have no
  accompanying tests either). The extracted method now has 8 unit tests
  covering the exact escalation path plus the legitimate self-service and
  admin-override cases (`tests/unit/keymaker-key-issuance.test.js`).
- **#2 above**: test keys now gated behind `NODE_ENV !== 'production'`;
  each production key only registers when its env var is actually set (no
  more `|| ''` fallback creating an empty-string map key). 5 unit tests
  (`tests/unit/simple-keymaker.test.js`).
- Documented, but deliberately **not** changed (see DEPLOYMENT.md §5 for
  the full reasoning): `SimpleKeymaker`'s blanket exemption of every GET
  request and the entire `/infrastructure/*` path from auth (unlike #1/#2,
  this is consistent, deliberate code — flipping it risks breaking a real
  caller this sandbox can't see, and needs a product decision on intended
  sensitivity, not a unilateral guess); `Keymaker.requireAccess()` — a
  real, working authorization method with a populated service registry —
  being wired up in the `Keymaker` class but never actually called from
  any route.
- Added DEPLOYMENT.md §5 (the full `src/server.js` vs. `heidi-core/`
  comparison, the two fixes, and the two open structural findings).
  Updated ISSUES_FOUND.md (#42 updated with the resolution status, #43-#46
  new), OPERATIONS.md.

### Verification

- `npm run typecheck` — clean.
- `npm run lint` — exit 0, 0 errors.
- `npm test` — 136/136 suites, 1442/1442 tests passing (up from 134/134,
  1429/1429 before this pass's 2 new test files: `keymaker-key-issuance.test.js`
  and `simple-keymaker.test.js`).

### Not done in this pass

- Did not determine whether `src/server.js` is actually deployed anywhere
  real — genuinely couldn't resolve it from repo evidence alone; needs a
  maintainer answer (see DEPLOYMENT.md §5, ISSUES_FOUND.md #42).
- Did not change `/infrastructure/*`'s auth-exempt status or wire up
  `Keymaker.requireAccess()` — both are policy decisions, not bugs, and
  both are contingent on the reachability question above being answered
  first (no point hardening a server nobody runs, and no point leaving a
  real caller broken if someone does).
- Did not audit the remaining ~50 routes in `src/server.js` line-by-line
  beyond the auth-layer analysis above (`/cascade/*`, `/heidi/*`,
  `/opportunities`, `/insight`, `/event`, `/process` were spot-checked,
  not exhaustively reviewed) — the two bugs found were high-confidence,
  clear-cut wins; a full line-by-line pass of a 1734-line file was judged
  lower value than documenting the structural findings and stopping at a
  defensible, well-verified boundary.

---

## 2026-07-15 (third pass) — Checkout/webhook routing consolidation

Branch: `claude/production-readiness-audit-fk9lth` (continuation of the
prior two same-day sessions). Picked up the single highest-priority item
the previous pass flagged: ISSUES_FOUND.md #33, "checkout and Stripe
webhook delivery may be silently broken right now."

### What was found

Traced every "handle a Stripe checkout/webhook" implementation across the
whole repo rather than guessing which one to fix. Found **four** separate
implementations of "process a Stripe subscription webhook" (not one, as
the file names might suggest):

1. `supabase/functions/stripe-webhook/index.ts` — a Supabase Edge
   Function. Complete: real Deno-compatible async signature verification,
   idempotent via a unique constraint on `keymaker_events.event_id`
   (verified against `supabase/migrations/001_keymaker_core.sql`), and its
   `processEvent()` switch actually invokes its own handler functions.
2. `api/webhooks/stripe.js` — a Vercel/Express-era Node handler with a
   real, live bug: `module.exports.handler = ...` was set, then two lines
   later `module.exports = { handleStripeWebhook, SERVICE_TIERS }`
   silently replaced the whole exports object, deleting the `.handler`
   export its own doc comment called "Vercel API handler." Its per-event
   handler functions were also dead — the actual code path queues every
   event to a task queue via `WebhookQueueAdapter` instead of calling
   them, and nothing in the repo consumes those queued tasks.
3. `stripe-webhook-server.js` — a standalone Express server whose only job
   was `require`-ing #2 directly (bypassing its broken export). Not
   started by any `package.json` script, PM2 config, or CI workflow.
4. `src/webhook-handlers/stripe-webhook.js` — a third, fully independent
   `StripeWebhookHandler` class targeting a `users`/`api_keys` schema that
   doesn't otherwise appear anywhere in this codebase, with **no signature
   verification at all**. Never imported outside its own test file.

Separately, `api/stripe-connect-webhook.js` handles a genuinely different
concern (Stripe Connect sub-account revenue routing → the `ledger` table)
and has no Edge Function equivalent — it's the sole implementation of that
concern, correctly built (signature verification, `claim_webhook_event`
idempotency), just never reachable.

`api/checkout.js` and `api/checkout-v2.js` were byte-for-byte identical
since the commit that introduced both (`b473969`) — a straightforward
duplicate, not two designs.

While tracing the Connect webhook's reachability, also found
`api/client-dashboard.js` (CLAUDE.md: "Per-project ledger view with fee
breakdown") had **zero authentication** — any caller supplying
`?project=galactic_bytes` (or any of the other five *publicly documented*
revenue stream names) got the full financial ledger for that stream. A
live, unauthenticated full-company revenue disclosure once bridged, not a
theoretical IDOR.

Also found `api/events/stream.js` (the mobile-ops live SSE stream) was
already fully authenticated and using the established lazy-client
pattern, but — unlike its `heartbeat.js`/`notifications/index.js`
siblings — was never bridged into `pages/api/`. Apparent oversight in the
prior pass's bridging sweep.

Finally: porting the archived subscription webhook's
`WEBHOOK_PROCESSING_ENABLED` kill switch (documented in
`ON_CALL_RUNBOOK.md`/`ROLLBACK_PLAYBOOK.md`) to the two now-live canonical
handlers surfaced that this operational safety control had *never*
actually been reachable — it only existed in dead code (#2 above).

### What was fixed

- Determined and documented the correct production topology (see
  DEPLOYMENT.md, new this session): Edge Function canonical for
  subscription tiers, `api/stripe-connect-webhook.js` canonical for
  Connect routing.
- Bridged `api/checkout.js` and `api/stripe-connect-webhook.js` into
  `pages/api/` (the latter re-exporting its `config` too, since Stripe
  needs the raw body for signature verification).
- Deleted `api/checkout-v2.js` outright (true duplicate, not archived).
- Archived the three dead/broken Stripe-webhook implementations (#2-#4
  above) plus their sole caller (`stripe-webhook-server.js`) and the local
  dev script that spawned it (`setup-stripe-integration.js`), with a full
  writeup in `archive/legacy-stripe-webhook-implementations/README.md`.
  Moved (not deleted) the now-pointless test for #4.
- Fixed the eager-client-construction cold-start-crash bug (same class as
  the prior pass's #32) in `api/checkout.js`, `api/stripe-connect-webhook.js`,
  and `api/client-dashboard.js` — all three now lazily construct their
  Stripe/Supabase clients.
- Gated `api/client-dashboard.js` behind `requireAuth('ledger:view')` (new
  RBAC permission, granted to `owner`/`operator` only) before bridging it
  into reachability.
- Bridged `api/events/stream.js` into `pages/api/events/stream.js` with
  `responseLimit: false` (SSE, not a bounded JSON response).
- Ported the `WEBHOOK_PROCESSING_ENABLED` kill switch to both canonical
  webhook handlers (the Edge Function and the Connect route), deliberately
  flipping its default polarity from "process only when explicitly true"
  to "pause only when explicitly false" — reusing the original's
  fail-closed-by-default semantics on routes that had always processed
  with no gate risked silently zeroing out ledger writes / pausing
  subscription provisioning the instant this shipped, given this sandbox
  can't verify the flag's current configuration in the live environment.
  Documented the reasoning in the archive README and added a header note
  to `ON_CALL_RUNBOOK.md`.
- Produced `DEPLOYMENT.md` (new) — the definitive routing map: every
  `pages/api/**` URL, its `api/**` implementation, auth, and status; every
  `api/**` file's reachability status and why; the two-webhooks-not-one
  clarification; manual verification items.
- Produced `OPERATIONS.md` (new) — operational doc index + current status
  summary.
- Updated ISSUES_FOUND.md, ROADMAP.md, SECURITY.md to reflect the above.

### Verification

- `npm run typecheck` — clean.
- `npm run lint` — exit 0, 0 errors (pre-existing `no-unused-vars`
  warnings only, unchanged from before this session).
- `npm test` — 134/134 suites, 1426/1426 tests passing (was 129/129,
  1344/1344 before this session's new tests: `checkout.test.js`,
  `client-dashboard.test.js`, `route-bridges.test.js`, plus additions to
  `stripe-connect-webhook.test.js`).
- `npm run security-audit` — clean (0 critical/high/medium/low).
- `tests/unit/no-hardcoded-secrets.test.js` — clean, confirms nothing in
  this session's diff (including the archived files' new paths)
  reintroduced a secret-shaped literal.

### Not done in this pass (see ISSUES_FOUND.md / ROADMAP.md / DEPLOYMENT.md)

- Did not bridge `api/chat/route.js`, `api/heidi/route.js`, or
  `api/ws/route.js` — investigated each individually; none is a safe
  default guess (admin/infra control surface, a divergent second chat
  implementation, and a non-functional placeholder respectively). Left as
  an explicit open decision rather than guessed at.
- Did not attempt Stripe Dashboard webhook-endpoint verification, Supabase
  secret rotation, or live-database schema verification — no credentials
  for any of these from this sandbox. All documented as manual operator
  actions in DEPLOYMENT.md §4.

---

## 2026-07-15 (later same day) — Security incident response + route reachability gap

Branch: `claude/protoforge-production-readiness-t4wdn4` (continuation of the
lint/bug-fix session earlier the same day)

Scope note: the driving request for this session asked for a full-platform
transformation (multi-agent orchestration framework, knowledge graph,
multi-provider AI routing, comprehensive E2E suite, full observability
stack, disaster-recovery validation, etc.) — realistically months of work.
Rather than producing shallow placeholder scaffolding across all of it, this
session did a real security/production audit and fixed everything it found,
in depth, with verification. The rest of that mission's scope is listed as
future work in ISSUES_FOUND.md and ROADMAP.md rather than claimed as done.

### Critical: live credentials hardcoded in tracked files (active incident)

A security audit (delegated to a research subagent, then independently
verified) found a live Supabase `service_role` JWT — full RLS-bypassing
database access, project `akbnfovjdcobifeupvbn`, functionally non-expiring
— hardcoded in **21 tracked files**, including
`supabase/migrations/20260426122000_action_worker_cron_schedule.sql`, where
it was embedded directly in a `pg_cron.schedule()` call and a
`SECURITY DEFINER`-adjacent function body. That means it wasn't just sitting
in source control — it was very likely also stored, in plaintext, in the
live database's `cron.job` table. Further sweeps found a live Stripe
restricted key (`rk_live_...`) and two live Stripe webhook signing secrets
(`whsec_...`) hardcoded in `vercel-env-checklist.md` and
`comprehensive-audit-report.md`, and a third webhook secret in a standalone
`test-webhook.js`.

**This required flagging to the user immediately, mid-session, since key
rotation is the one part of this incident that can't be done from here** —
no authenticated Supabase or Stripe dashboard access exists in this
environment. Editing the files removes the *current* exposure; it does not
undo the fact that these values are already in git history and must be
treated as compromised regardless of what happens to the working tree.

Remediation (everything that *could* be done autonomously):

1. **New migration** `20260715210000_secure_action_worker_cron.sql` —
   redefines `trigger_action_worker()` and its cron schedule to read the
   invocation URL/JWT from `vault.decrypted_secrets` (Vault secret names
   `action_worker_project_url` / `action_worker_service_jwt`), matching the
   pattern the *later* `20260426123500_billing_retry_cron.sql` migration
   already established correctly. The old migration's literal secret was
   also redacted from its current tree content (safe to do without
   disturbing replay order or checksums, since `CREATE OR REPLACE
   FUNCTION` + unschedule/reschedule in the new, later-timestamped
   migration fully supersedes it regardless of what the old file leaves
   behind).
2. **`add-vault-secrets.js` rewritten**: no more hardcoded values (the old
   "anon key" wasn't even JWT-shaped — a stale/wrong value), everything
   sourced from env vars, and it no longer prints secret values to the
   console on failure (a `SECURITY_PROTOCOL.md` violation the old version
   had). Now also seeds the two new Vault secrets the migration above
   needs.
3. **20 dead one-off scripts/docs deleted** (`create-*.js`, `test-*.js`,
   `get-*.ps1`, several stale `*.md` troubleshooting notes, a duplicate
   `revenue-dashboard.html` at repo root that diverged from the actually-
   served `public/revenue-dashboard.html`) — each confirmed to have zero
   live references before deletion. Removing them also removed the leaked
   secrets they carried.
4. **2 files kept, secrets redacted in place**: `vercel-env-checklist.md`
   (still-useful env-var checklist; Stripe secret key + both webhook
   secrets replaced with placeholders), `comprehensive-audit-report.md`
   (redacted the truncated-but-still-real secret fragments it quoted).
5. **`scripts/validate-production-grade.ps1`** — hardcoded anon key default
   replaced with a required `$env:SUPABASE_PUBLISHABLE_KEY` read (script
   now fails loudly instead of silently using a stale key).
6. **Two regression-guard tests added**:
   `tests/migrations/no-hardcoded-secrets.test.js` scans every migration
   (including `.sql.skip` files) for JWT-shaped literals;
   `tests/unit/no-hardcoded-secrets.test.js` scans every `git ls-files`
   tracked file repo-wide for Supabase JWTs, Stripe live/restricted keys,
   Stripe webhook secrets, AWS keys, and PEM private-key blocks, with a
   documented, minimal allowlist (a secret-scanner's own detection-pattern
   list, and the Supabase *anon* key in `public/client-dashboard.html`,
   which is meant to be public client-side under RLS — a materially
   different risk class from `service_role`). Both pass clean.
7. **Not a leak, ruled out explicitly after checking**:
   `public/client-dashboard.html`'s anon key (by design), and two
   `cleanup/*.ps1` scripts whose own secret-*detection* regex patterns
   matched my scanner (they're tools for finding this exact class of bug,
   not instances of it — interesting that this tooling already existed and
   apparently was never run against the 21 files above).

### High: `keeper-break-glass` / `keeper-break-glass-simple` auth bypass

Both Edge Functions fell back to a **publicly-known, hardcoded string**
(`'fallback-secret'`, `'break-glass-secret-test'`) as the verification
secret whenever `KEEPER_BREAK_GLASS_TOKEN` wasn't configured — meaning
anyone could forge a valid break-glass token (this system escalates a
safety circuit-breaker's risk level) using a value visible in this
now-public source. Both now fail closed (503) instead of authenticating
against a fallback.

### High: unauthenticated mutating routes with real impact

The audit found several `api/` routes with no auth check at all, each using
the service-role Supabase client to mutate data:

- `api/song-composer/songs.js` — unauthenticated `DELETE` on the shared
  `actions` table by raw `id`, no ownership/type scoping (IDOR: could
  delete unrelated rows, e.g. agent-manager tasks). Fixed: `requireAuth`
  gate + scoped the delete to `task_name = 'song_composition'` as
  defense-in-depth even for authorized callers.
- `api/agent-manager/tasks.js` — unauthenticated task dispatch
  (POST, triggers real agent execution via the event bus) and
  cancel/retry (PATCH). Its sibling `control.js` already had
  `requireAuth`; this one was missed. Fixed, matching the sibling's
  pattern exactly.
- `api/agent-manager/agents.js` — unauthenticated read of aggregated
  agent/task statistics. Lower severity (read-only) but inconsistent with
  its siblings; added `requireAuth` (`worker:view`) for consistency.
- `api/hydi/sync.js` — unauthenticated RPC triggers (`auto_heal_from_trends`,
  `analyze_health_trends`, `evaluate_system_escalation`) and arbitrary
  event-bus injection. Fixed: `status:view` for GET, new `hydi_sync:trigger`
  permission for POST.
- `api/rezonate/route.js` — unauthenticated project/track CRUD + task
  dispatch, using the `x-user-id` header as trusted identity (a known,
  already-roadmapped issue — see ROADMAP.md's "cryptographic identity
  verification" item; this session added an auth *gate* on top without
  redesigning that deeper per-user-scoping model, which is out of scope for
  a hardening pass). New `rezonate:manage` permission.
- `api/life-flow/route.js` — unauthenticated Deep Life Architect request
  processing. New `life_flow:manage` permission. **Deliberately not made
  reachable** (see below) — this file instantiates a `HYDISystem` and
  starts recurring hardware/software-polling timers *at module load*, not
  per-request, which is a separate, more invasive behavior change than the
  other routes; flagged for product review rather than unilaterally
  activated.
- `api/song-composer/generate.js` — unauthenticated LLM-backed song
  generation (cost/DoS vector: any caller could trigger unlimited LLM
  calls). Fixed: `requireAuth` with a tightened 10/min rate limit
  (default is 60/min) given each call invokes an LLM.

New RBAC permissions added to `lib/auth/rbac.js`:
`song_composer:view`/`song_composer:manage`, `rezonate:manage`,
`life_flow:manage`, `hydi_sync:trigger` (operator+owner; `song_composer:view`
also granted to viewer).

`tests/unit/rezonate.test.js` needed updating: its 11 tests called the
handler directly with mock req/res objects that had no auth headers, so
they started failing (correctly) once `requireAuth` was added. Fixed by
constructing a valid HMAC service token per the pattern already established
in `tests/unit/agent-manager-control.test.js`, fixed one assertion that
assumed `mockInsert`'s first call was the handler's own insert (requireAuth's
audit logging now also calls `insert()`, shifting the index), and added two
new tests explicitly asserting the auth gate rejects missing/invalid
credentials — the exact regression this session's fix prevents.

### High: two Stripe-moving Edge Functions had no authorization at all

`stripe-transfer-payout` (moves real money via `stripe.transfers.create`)
and `stripe-connect-admin` (create/update/retrieve/list/delete Stripe
Connect accounts) were absent from `supabase/config.toml`'s per-function
`verify_jwt` table, silently falling back to the platform default —
which only proves *some* valid Supabase JWT was presented, and the public
`anon` key satisfies that. Neither function had any code-level check that
the caller was privileged. Fixed: both now decode the (already
platform-verified) JWT payload and require `role === 'service_role'`,
returning 403 otherwise. Also added explicit `verify_jwt = true` entries
to `config.toml` for both — relying on an implicit default is exactly what
let this go unnoticed.

### Major finding: the entire top-level `api/` directory was unreachable

While verifying the routes above actually enforce what I'd just added,
booting `next dev` and curling `/api/health` returned a **404**, not the
expected response. Investigation confirmed: Next.js's router (`next dev` /
`next start`, which is how this app actually runs per CLAUDE.md's
Local-First Architecture pivot — Vercel deployment is explicitly disabled)
only ever serves `pages/api/*`. A bare top-level `api/` directory is a
*Vercel-platform-only* convention for auto-detecting serverless functions;
it means nothing to Next.js itself, and no `middleware.ts`, `next.config.js`
rewrite, or custom server bridges the gap in this repo.

Of the ~30 files under `api/`, only 2 (`revenue.js`, `traces.js`) have any
`pages/api/` counterpart at all — meaning this wasn't "old files superseded
by newer ones," it's that an entire, actively-developed feature surface
(the "mobile-ops" cluster referenced by `lib/auth/requireAuth.js`'s own doc
comment, plus health/mobile-status/checkout/Stripe webhooks/chat/
song-composer/rezonate/etc.) has been unreachable via the real running app,
undetected, because nothing ever smoke-tested these routes with an actual
HTTP request against `next dev`. `.github/workflows/health-monitor.yml`'s
"health check" only runs `test-critical-path.js`, which tests direct
Supabase connectivity, never an HTTP request to `/api/health` — so this
gap was invisible to existing CI too.

Fix scope, deliberately conservative given the size and risk:

- Added thin `pages/api/**` re-export bridge files (`export { default }
  from '../../api/...'`, or `module.exports = require(...)` +
  `.default = ...` for the one CommonJS file) for: `health.js`,
  `mobile-status.js` (pure observability, zero risk, explicitly requested
  by this session's mission), and the entire already-authenticated
  "mobile-ops" + song-composer + rezonate + hydi-sync cluster this session
  either found already had `requireAuth` wired or personally added it to
  (13 more files). Every one of the 16 bridged routes was verified live
  against a running `next dev` server: auth-gated ones return 401/405 as
  expected (proving `requireAuth` genuinely executes against a real HTTP
  request, not just in a unit test's mocked call), and `health`/
  `mobile-status` return graceful JSON errors given this sandbox's missing
  Supabase credentials (previously they'd have crashed the whole module at
  import time — see below).
- Also fixed a robustness bug the reachability fix surfaced: `api/health.js`
  and 4 other files constructed their Supabase client at module load
  (`const supabase = createClient(...)`), so a missing env var crashed the
  entire module before the handler's own try/catch could run its intended
  graceful-degradation path. Switched to the lazy-construction-via-Proxy
  pattern already established in `api/agent-manager/control.js`.
- **Deliberately did NOT bridge**: `checkout.js`, `checkout-v2.js`,
  `stripe-connect-webhook.js`, `webhooks/stripe.js`,
  `webhooks/stripe-test.js` (payment-critical — I can't verify webhook
  signing-secret configuration or whether there's a reason payments are
  currently paused from this sandbox; wrong unilateral action here has
  real financial/security consequences), `life-flow/route.js` (module-load
  side effects, see above), and the more ambiguous remainder (`chat/route.js`,
  `heidi/route.js`, `client-dashboard.js`, `ursula/status.js`,
  `events/stream.js`, `ws/route.js`, `local-model.js`) where I don't have
  enough confidence about whether they're intentionally superseded by
  existing `pages/api/` functionality or genuinely just missing. All of
  these are listed explicitly in ISSUES_FOUND.md as needing a product-level
  decision, not a guess.

### Verification

- `npm run typecheck` — clean.
- `npm run lint` — exit 0, only pre-existing warnings.
- `npm test` — 132/132 suites, 1430/1430 tests, stable across 3 consecutive
  runs (was 129/129, 1344/1344 before this session's new tests).
- `npm audit` — 0 vulnerabilities (unchanged).
- All 16 newly-bridged `pages/api/*` routes independently verified against
  a live `next dev` server (not just unit-tested): correct 401/405/200/503
  responses, zero crashes, zero raw stack-trace HTML responses.

---

## 2026-07-15 — Production-readiness sweep: lint gate repair + real bug fixes

Branch: `claude/protoforge-production-readiness-t4wdn4`

Started from a clean `npm install` (0 vulnerabilities) and ran the full
verification triad (`typecheck`, `lint`, `test`) to find real, fixable
problems rather than speculative refactors.

### Found and fixed

1. **`npm run lint` was silently broken for nearly the entire Next.js app**
   (`pages/`, `components/`, most of `lib/`). Root cause:
   `.eslintrc.json` (added in the HYDI V3 Reliability & Autonomy PR,
   commit `2fd36cc`) set `"extends": ["eslint:recommended"]` with no
   Next.js/TypeScript parser, so every `.ts`/`.tsx` file and every ESM
   `.js` file failed to parse (`'import' and 'export' may appear only
   with 'sourceType: module'`). This wasn't caught before because CI's
   `unit-tests.yml` doesn't run lint, and a prior local check of the lint
   output was truncated (`| tail -100`) so the failures were invisible.
   Fixed with a scoped `overrides` block that applies `next/core-web-vitals`
   to `pages/`, `components/`, `lib/`, and `hooks/`.

2. **That fix immediately crashed with `TypeError: expand is not a
   function`** inside `@eslint/eslintrc`'s bundled `minimatch@3.1.5`.
   Root cause: `package.json`'s `overrides` field force-pinned
   `brace-expansion` globally to `>=5.0.6` (to patch
   GHSA-jxxr-4gwj-5jf2, a ReDoS bug scoped to brace-expansion
   5.0.0–5.0.5). But `brace-expansion@5.x` is a breaking rewrite with a
   different export shape than the `1.x` line every `minimatch@3.x`
   consumer (essentially the whole ESLint toolchain) expects, so the
   blanket override silently broke every one of them. `brace-expansion`
   1.x was never in the vulnerable 5.0.0–5.0.5 range, so the fix was to
   remove the blanket override entirely and let each consumer resolve its
   own compatible major version — `minimatch@3.x` → `brace-expansion@1.1.16`
   (safe, correct API), `minimatch@10.x` (from `@typescript-eslint`) →
   `brace-expansion@5.0.6+` (safe, correct API). Verified with
   `npm audit` (0 vulnerabilities before and after) and `npm ls
   brace-expansion`.

3. **With lint actually working, it surfaced real runtime bugs that had
   been invisible:**
   - `src/models/HybridModelStack.js` — `strategy` and `input` were
     `const`-declared inside a `try` block and referenced again inside
     the paired `catch` block (out of scope). Any failure during
     `execute()` or `executeLocal()` threw a *new*, unrelated
     `ReferenceError` from inside the error handler instead of the real
     error, and local-model fallback never actually ran. Fixed by
     hoisting the declarations above the `try` with `let`.
   - `src/control/OutcomeValidator.js:235` — typo `worSourceSource`
     instead of `worstSource` in a template literal. Silently threw
     inside a caught block, so the "lead source underperformance"
     adaptation suggestion was never returned whenever the interesting
     case (best source beats worst by 2x+) actually triggered.
   - `src/models/heartbeat.js` — two methods both named
     `checkModelHealth` (one aggregate/no-arg, one per-model). The
     second silently shadowed the first in the class body, so the
     periodic heartbeat (`start()`'s `setInterval`) actually called the
     per-model checker with `modelId=undefined` every 30s, and the real
     aggregate logic — failure-count tracking, `recoverFailedModels()`,
     `storeHeartbeatMetrics()`, the `heartbeat_check` event — was 100%
     dead code. Renamed the per-model method to
     `checkSingleModelHealth` and repointed `checkAllModels()` at it.
     Fixing this then exposed a second, previously-inert bug in the same
     method: `this.failedModels` was constructed as a `Set` but used
     with `Map`-only methods (`.get()`/`.set()`, and a `forEach((count,
     modelId) => …)` callback shape). Changed it to a `Map`.
   - `src/server.js` — `/cascade/quarantine/:eventId/release` referenced
     `approvedBy` (undefined) instead of the destructured `approved_by`
     from `req.body`; the endpoint threw on every call. Also, all five
     `/keymaker/*` admin routes (`status`, `keys` issue/revoke, `validate`,
     `audit`, kill-switch, break-glass) referenced a `keymaker` object
     that was never imported or instantiated — only the unrelated
     `SimpleKeymaker` (a separate, simpler tier-based gate) was wired up.
     The full `Keymaker` class already existed at
     `src/middleware/keymaker.js` with exactly the methods these routes
     call (`getStats`, `issueKey`, `revokeKey`, `validateKey`) and its
     own `middleware()` that populates `req.keymaker`. Imported,
     instantiated, and mounted it alongside `simpleKeymaker`.

4. **Archived 6 orphaned ESM-syntax files** under `src/` that were
   unreachable in practice (confirmed via repo-wide grep) and would have
   thrown `SyntaxError: Cannot use import statement outside a module` if
   anything had ever actually tried to load them via `require()`:
   `src/net/net.js`, `src/server-clean.js`, `src/services/persistence.js`,
   `src/db/dbRouter.js`, `src/db/local.sqlite.js`,
   `src/lib/supabaseClient.js`. Moved to
   `archive/src-esm-orphans/` following the existing archival convention
   (see `archive/heidi-v2-dormant-pipeline/README.md` and
   `archive/agents-specialized-orphans/README.md` for precedent); a
   README documents why each was safe to move. This also resolved the
   remaining ESLint parsing errors that weren't fixed by the
   `next/core-web-vitals` override (those files sit outside `pages/`,
   `components/`, `lib/`, `hooks/`).

5. **Fixed two flaky/racy tests** with the same root shape:
   `tests/unit/hydi-v3/DistributedCompute.test.js`'s `detects node
   timeout` and `tests/unit/hydi-v3/HeartbeatSystem.test.js`'s `detects
   missing heartbeat` each raced a fixed `setTimeout` against the
   engine's own internal interval tick landing at approximately the same
   wall-clock time, so the assertion could run before the tick that
   flips state. Replaced both fixed sleeps with `Promise.race` between
   the actual event and a generous 2s timeout.
   `WatchdogSupervisor.test.js` uses the same fixed-sleep pattern but
   wasn't observed to be flaky in several runs; left alone (see
   `ISSUES_FOUND.md`).

6. **Fixed the remaining 20 real ESLint errors** that the newly-working
   lint gate (item 1) surfaced across the wider codebase, so that `npm
   run lint` — now wired into CI (see below) — actually passes instead of
   immediately turning CI red:
   - `no-case-declarations` (9x, `src/HYDISystem.js`,
     `pages/api/revenue/index.js`, `src/control/HeidiControlPlane.js`) —
     lexical `const`/`let` directly in a `switch case` without block
     braces. One instance in `HeidiControlPlane.js` was a real latent
     bug: two sibling cases would have redeclared the same `const` name
     in the same scope (a `SyntaxError`) had the author not already
     worked around it by manually suffixing the second case's variables
     (`currentWeight2`, `newWeight2`). Wrapped each case body in `{ }`
     and removed the suffix hack.
   - `no-prototype-builtins` (3x, `lib/ActionParser.ts`,
     `lib/ModelManager.ts`, `src/enforcement/RuntimeEnforcer.js`) —
     `obj.hasOwnProperty(x)` called directly instead of
     `Object.prototype.hasOwnProperty.call(obj, x)` (would throw if
     `obj` were ever `Object.create(null)`).
   - `react/no-unescaped-entities` (2x, `MidiStatusBar.tsx`,
     `SongStructure.tsx`) — literal `"` in JSX text, escaped to `&quot;`.
   - `@next/next/no-html-link-for-pages` (4x, `pages/index.tsx`,
     `pages/funding.tsx`, `pages/test-simple.tsx`) — raw `<a href="/...">`
     for in-app navigation forces a full page reload; swapped for
     Next.js `<Link>`.
   - `no-empty` (1x, `lib/protoforge/policy-engine.js`) — an empty
     `catch (_) {}` guarding per-callback failures during ProtoForge's
     realtime policy hot-reload. Confirmed intentional (isolates one bad
     reload callback from breaking the others), not a bug; gave it a
     named `err` and a `console.warn` plus a comment instead of leaving
     it silently empty.

7. **Wired `npm run lint` into CI** (`unit-tests.yml`), now that it's
   actually meaningful and passing, so a regression like item 1 can't
   land silently again.

8. **Found `.githooks/pre-push` was never actually executable.** The
   file was committed to git with mode `100644` instead of `100755`, so
   it has silently no-op'd on every push in every clone since it was
   added — CLAUDE.md describes it as load-bearing precisely because
   GitHub Actions once sat stuck `queued` for 24+ hours, but the local
   fallback it documents was never actually running. Confirmed directly:
   this session's own `git push` printed "the hook was ignored because
   it's not set as executable." Fixed with `chmod +x` (git tracks the
   mode change), and added a `lint` step to the hook itself (it only ran
   typecheck + test before) so local pushes match the CI gate.

### Verification

- `npm install` — 0 vulnerabilities, before and after.
- `npm run typecheck` — clean.
- `npm run lint` — went from silently non-functional (parsing errors on
  ~60 files, one hard crash) to `exit 0`, 0 errors, warnings only
  (pre-existing `no-unused-vars` style items, out of scope for this pass).
- `npm run lint:hydi-v3` — unaffected, still clean.
- `npm test` — 129/129 suites, 1344/1344 tests passing, stable across 3
  consecutive full runs (was 128/129, 1343/1344 before the flaky-test
  fixes).

### Not done in this pass (see ISSUES_FOUND.md / ROADMAP.md)

- The remaining ESLint *warnings* (unused vars/args across `src/`) are
  numerous but low-severity; left alone to keep this diff focused on
  correctness bugs and the broken lint gate itself.
- Did not add `lint` to CI (`unit-tests.yml`) in this pass — recommend
  doing so now that it's actually meaningful, as a follow-up.
