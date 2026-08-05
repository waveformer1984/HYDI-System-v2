# WORKLOG

Running log of autonomous production-readiness work. Newest entries first.

---

## 2026-08-05 — Edge Function hardening, CI for Deno, inventory alerting restored

Branch: `claude/protoforge-ecosystem-audit-vkz7kd`

Opened with a full baseline rather than trusting the prior session's closing
state: fresh `npm install`, then `npm test`, `npm run lint`, `npm run
typecheck`, `npm run lint:hydi-v3`, `npm run test:integration:jest`, and
`npm audit`. Everything was green — 244/244 suites, 62/62 integration, 0
lint errors, clean typecheck — so this pass had to find new ground rather
than re-audit the 77 issues already tracked. It went looking in the two
places the existing gates structurally cannot see: the Deno Edge Functions,
and the files with no test file at all.

1. **Reopened a security advisory that had been written off as unfixable.**
   `npm audit` showed two high-severity `brace-expansion` DoS advisories.
   `ISSUES_FOUND.md` #76 had concluded there was no non-`--force` path.
   That was true of a *global* override — it crashes `next lint`, because
   `minimatch@3` needs the v1 API — but `package.json` already carried a
   correctly *scoped* override for exactly this, pinning `brace-expansion`
   to `5.0.7` under `minimatch@10.2.5`. `5.0.7` is itself inside the
   vulnerable range: the pin had gone stale as the advisory widened. Bumped
   to `^5.0.9` and widened the selector to `minimatch@^10`, so a future
   minimatch patch bump can't silently drop the override — the exact way it
   went stale. `npm audit` now reports 0 vulnerabilities. See #78.

2. **Found the Edge Function tests had never run.** `_shared/security.ts`
   gates ~30 of the 45 functions with `requireServiceRole()` and
   `rateLimit()`, and it has a test file — but nothing in CI runs Deno, and
   the file's first statement imported assertions from a `deno.land` URL, so
   it failed at import time in any sandboxed environment before a single
   test executed. Two real defects had accumulated behind that gap:

   - **Unbounded rate-limiter memory** (#79). Bucket keys derive from the
     caller-influenced `x-forwarded-for` header and nothing ever evicted, so
     a caller could mint unlimited buckets — the module meant to absorb
     floods was itself a memory-exhaustion vector. The Node twin
     `lib/rate-limit.js`, which this module's comment claims to mirror,
     explicitly guards the same hazard with a background sweep that was
     never carried across. A background timer is wrong for an edge isolate,
     so eviction now runs on the request path, under a hard ceiling.

     Worth recording: my first implementation gated the sweep purely on
     elapsed time, and the test I wrote for it failed — correctly. A
     time-only sweep lets a burst accumulate a full interval of garbage
     before reclaiming any. Added a size watermark so reclamation tracks
     load as well as the clock. The test caught a real weakness in the fix,
     which is the point of writing the test first.

   - **Non-constant-time service-role key comparison** (#80). `!==`
     short-circuits at the first differing byte, leaking guessed-prefix
     length through timing. Defense-in-depth rather than a known-exploitable
     hole, but it guards every privileged function. Kept synchronous, so no
     call site changed.

   Then closed the gap itself (#81): assertions moved to `node:assert` (a
   Deno built-in, hermetic), and a new `edge-functions.yml` workflow plus
   `npm run test:edge` actually execute the suite. Deliberately scoped to
   `_shared/` — the other functions import from esm.sh/deno.land at load, so
   type-checking them needs network egress and would fail the gate on a CDN
   hiccup instead of a real defect.

3. **Archived two unhardened copies of a refund-issuing handler** (#82).
   `chat-operator/` held three handlers; Supabase only deploys `index.ts`.
   The live one was hardened in the 2026-07-17 audit with a session-ownership
   check (without it, a client-supplied `user_id` lets a caller act as
   another user) and rate limiting. Neither sibling had either — a rename
   away from reintroducing a fixed privilege-escalation bug. Moved to
   `archive/`, with a README recording what to port back first.

   The blueprint doc made this worse than dead code: it named `index-new.ts`
   as *the* implementation and credited it with "Conversation ownership
   verification" it does not implement, actively pointing implementers at
   the unhardened file. Corrected.

   Archiving these then broke `npm run typecheck` with 14 errors (#83) —
   `tsconfig.json` excluded `supabase/functions` but not `archive`, and
   these were the first `.ts` files ever archived. `.eslintrc.json` already
   ignored `archive/`, so the omission was clearly an oversight; added.

4. **Wrote the tests #74 asked for, and they found three live bugs.** #74
   fixed real `ReferenceError` crashes in `InventoryMaterialsWorker` and
   `revenue-engine-v2` — found by lint, not by tests — and flagged that
   neither file had any test file. Writing them surfaced (#84-#86):

   - **No low-stock alert was ever sent, for any item, ever.** The severity
     split in `triggerLowStockAlerts()` read `item.quantity`, but
     `inventory_items` rows store quantity in
     `quantity_count`/`quantity_grams`/`quantity_ml` and have no such
     column. Both filters compared `undefined`, both were always empty, and
     every low-stock item landed in neither group — so the method enqueued
     nothing and returned silently, including for stock at zero. This worker
     is registered and polls every 30s, so inventory alerting has been dead
     in production the whole time.
   - The same bug meant out-of-stock items were procured at `high` rather
     than `critical` urgency — 72h expected delivery instead of 24h.
   - **Fasteners were never monitored.** One of the five families in the
     canonical taxonomy matched no branch in the threshold chain. The chain
     also existed as two drifted copies, only one honouring caller-supplied
     overrides, so a taxonomy gap had to be fixed twice to take effect.
     Consolidated to one predicate; that also fixed a `||` fallback that
     discarded a legitimate threshold of `0`.

   Kept the unreachable `component` branch deliberately, with a comment:
   deleting it would recreate exactly the silent fall-through that hid the
   fastener gap.

   Both new suites were verified against the pre-fix code — 10 inventory
   tests and 6 revenue tests fail without the fixes (the latter reproducing
   `ReferenceError: filterScore is not defined`), so they are real
   regression tests rather than tests written to match the implementation.

5. **Followed the same thread into the rest of `workers/`, and it kept
   paying.** The inventory bugs were a field-name mismatch found by writing
   a test; the pattern generalized:

   - **Every worker reported unhandled events as successfully completed**
     (#89). All ten dispatching workers logged an unrecognised `event_type`
     at info level and then called `completeTask(taskId, true)`. Since
     `dequeue()` is per-queue, a worker only ever sees events routed to it,
     so an unrecognised type is always a misroute or an unimplemented
     handler -- never routine. Those events vanished with a success signal.
     They now throw into each worker's existing catch, which already fails
     the task properly; per the `complete_task` RPC that requeues to
     `max_attempts` then lands in `failed`, so it is bounded and visible.
   - That immediately surfaced a live contract mismatch (#90):
     `TaskRouterWorker` routes `cost.calculate` to the `cost_margin` queue,
     but `CostMarginWorker` implements only `analytics.generate`. Every such
     task would have been discarded and marked done. I deliberately did
     **not** pick a side -- per-job costing and aggregate reporting are
     different operations, and nothing currently emits either event -- but
     it now fails loudly instead of silently, which it needed either way.
   - **Cost analytics ignored the period it was asked for** (#91).
     `generateCostAnalytics()` stored `time_period` on the row it inserts
     and then queried a hardcoded 30 days, so a week request returned a
     month of data labelled 'week'. Any consumer comparing periods was
     comparing the same numbers under different labels.
   - The `time_period` vocabulary turned out to be duplicated and already
     drifted (#92): `NotificationWorker` and `BehaviorPatternWorker` each
     had their own copy of the chain, and only one understood `yesterday`.
     Extracted to `workers/time-period.js` with `fallbackHours` as a
     *required* argument -- the three callers genuinely differ, and silently
     defaulting the window is exactly how #91 read as working.

6. **Removed the duplication that caused the fastener gap** (#93).
   `getOptimalLevel`'s 14-entry table was a byte-identical private copy in
   two workers. Both listed `fastener_*`; neither was connected to the
   threshold chain that omitted it. Extracted to
   `workers/inventory-taxonomy.js`, and `isLowStock()` is now a lookup over
   the family table rather than a hand-written branch chain -- a missing
   family is no longer expressible. The consistency test is the real
   deliverable: every item type with an optimal level must resolve to a
   monitored family, so a repeat fails CI rather than silently not alerting.

7. **CI: ruled out the billing hypothesis for the repo-wide Actions block.**
   Health Monitor has failed every scheduled run through 2026-08-05T01:00Z
   with `runner_id: 0` and job logs 404ing -- jobs never dispatched. The
   useful finding is negative: **the repository is public**, and
   GitHub-hosted standard runners are unmetered for public repos, so a
   spending limit cannot be the cause. That retires the "incomplete
   spending-limit fix" branch of ROADMAP P0 2a, and also retires the
   `total_ms: 0` billable-time observation 2b treated as evidence -- that
   value is always 0 for a public repo, so it never distinguished anything.
   Corroborated by no `health-alert` issue existing despite the workflow
   opening one on every failure, confirming the job fails before any step
   runs. Still needs dashboard access, but the diagnosis is narrower and now
   warrants a support ticket. Recorded in ROADMAP as item 2c.

   Consequence worth stating plainly: the `edge-functions.yml` gate added
   this session will not go green until that is resolved. It was verified
   locally instead (13/13), and `.githooks/pre-push` remains the trustworthy
   signal.

8. **Investigated, not fixed** (#88): `reserveMaterialsInDatabase()` — the
   method whose `customer_email` `ReferenceError` was #74(a) — has no
   callers anywhere in the repository, so that fix landed in dead code. It
   writes reservations and deducts inventory, so it reads as an unfinished
   feature rather than an abandoned one. Left for a maintainer call rather
   than guessing: wire it into the job-acceptance path, or delete it.

Closing state: 249/249 unit suites (2431 tests, up from 244/2320), 62/62
integration, 13/13 Deno edge tests (previously 0 runnable), `npm audit` 0
vulnerabilities (from 2 high), lint 0 errors, typecheck clean.

---

## 2026-08-03 — CI-breaking test fix + dependency security patch

Branch: `claude/protoforge-ecosystem-audit-4idowa`

Started with a full discovery pass per `CLAUDE.md`'s autonomous mission
protocol: fresh `npm install`, then `npm test`, `npm run lint`, `npm run
typecheck`, `npm run lint:hydi-v3`, `npm run typecheck:hydi-v3`, `npm run
test:integration:jest`, and `npm audit` to establish a real baseline rather
than trust the prior session's closing state. Given the depth of the audit
trail already in this file and `ISSUES_FOUND.md` (75 previously-tracked
issues across security, auth, dead code, and reliability), this pass
focused on what a fresh, credential-free baseline run could actually
surface rather than re-auditing already-covered ground.

1. **Found and fixed a genuine, pre-existing CI-breaking bug**:
   `tests/unit/hydi-v3/HardwareDiscovery.test.js`'s `falls back to OS
   enumeration when nvidia-smi is missing` test hardcoded an expectation
   that `HardwareDiscovery`'s OS-level GPU fallback calls `powershell` —
   true only when `os.platform() === 'win32'`. The test never mocked
   `os.platform()`, so on the actual CI host (`unit-tests.yml` runs on
   `ubuntu-latest`) the code correctly took the Linux `lspci` branch
   instead, which the test's mock didn't recognize and answered with a
   generic error — leaving `inventory.gpus` empty against an assertion
   expecting exactly one entry. Confirmed via `git log` that this test
   predates this branch (added in `c0b8032`) and is byte-identical to the
   version on `clean-main`, meaning it has been silently failing `npm
   test` in CI on every push/PR to `clean-main` since it was added — a
   real, live gap between "CI is green" and "CI is actually running this
   suite's real assertions." Root-caused by reading `HardwareDiscovery.js`
   directly (its platform-dispatch logic is correct) rather than assuming
   the failure meant a production bug. See `ISSUES_FOUND.md` #75.

2. **Patched two `npm audit`-flagged dependencies**: `ip-address`
   (SSRF/trust-boundary-bypass advisories — reachable via the production
   `express-rate-limit` package, which backs every rate-limited route added
   across the 2026-07-17 Edge Function + API security-audit session) and
   `undici` (moderate, build-tooling-only via `node-gyp`). Used `npm audit
   fix` (non-force) — no `package.json` range changes, just lockfile
   resolution bumps (`ip-address` → `10.4.0`, `undici` → `6.28.0`).
   Deliberately did **not** force-fix the remaining `brace-expansion`
   advisory (transitive via `@typescript-eslint/*`, dev-only ESLint
   tooling) — the same fix shape (an `overrides` pin forcing a breaking
   major version) was already tried and reverted once, per this file's own
   2026-07-15 entry / `ISSUES_FOUND.md` #2, because it crashed `next lint`.
   No non-breaking resolution exists yet for that one. See `ISSUES_FOUND.md`
   #76.

3. **Investigated, no action needed**: checked the other 5 files matching
   `platform()`/`process.platform` in `src/` (`local-model-adapter.js`,
   `ResourceManager.js`, `HYDIStartupSequence.js`,
   `CapabilityInstaller.js`, `DeepLifeArchitect.js`) for the same
   test-mocking gap as item 1. Only `local-model-adapter.js` has a test
   file, and it doesn't exercise the platform-dependent branch — no
   equivalent bug found.

4. **The repo's own `.githooks/pre-push` hook then caught a second, live
   flaky-test failure** while pushing item 1's fix:
   `tests/unit/hydi-v3/HeartbeatSystem.test.js`'s `detects missing
   heartbeat` failed under the full parallel `npm test` run (passed in 5/5
   isolated re-runs — confirming it's a timing race, not a real
   regression). Investigated and found `HeartbeatSystem.test.js` and
   `tests/unit/hydi-v3/DistributedCompute.test.js` both race a fixed
   `setTimeout` sleep against the engine's own ~100ms internal interval
   timer landing at close to the same wall-clock time — reliable alone,
   flaky under CPU contention from 243 other suites running concurrently.
   This is the exact bug class this file's own 2026-07-15 entry describes
   fixing in these exact two files (`Promise.race` against the real
   event) — but that fix is not present at the current `clean-main` tip,
   so either it was lost in a merge or that entry describes work from a
   branch that was never actually merged. Also found the identical
   pattern, not yet observed to flake but same root cause, in
   `tests/unit/hydi-v3/WatchdogSupervisor.test.js`'s two timer-driven
   tests. Fixed all three files: each now awaits the real `EventEmitter`
   event via `.once()` (with a 2s timeout as a genuine failure backstop,
   not a race), instead of sleeping a fixed duration and hoping the
   internal timer already fired. See `ISSUES_FOUND.md` #77.

### Verification

- `npm install` — clean (no lockfile conflicts against the tracked
  `package-lock.json`; confirmed separately that `npm ci`, what CI actually
  runs, also succeeds against the pre-existing lockfile).
- `npm test` — 244/244 suites, 2320/2321 tests passing (1 pre-existing,
  unrelated skip), both before item 2 and reconfirmed after; reconfirmed a
  further 3 consecutive full runs after item 4's flaky-test fixes with no
  failures.
- `npm run lint` / `npm run lint:hydi-v3` — 0 errors (749 / 11
  pre-existing warnings, unchanged, out of scope for this pass).
- `npm run typecheck` / `npm run typecheck:hydi-v3` — clean.
- `npm run test:integration:jest` — 12/12 suites, 62/62 tests.
- `npm run build` — succeeds, full route table generated.
- `npm audit` — down from 4 vulnerabilities (3 moderate + 1 high in the
  default report; `ip-address`'s 3 advisories collapse into that count via
  the deduped tree) to 1 remaining (the documented `brace-expansion`
  dev-only item).

### Not done in this pass

- Did not re-run the full prior audit surface (auth, dead code,
  duplicated logic) given how recently and thoroughly it was already
  covered (see the rest of this file and `ISSUES_FOUND.md`); this pass
  was scoped to what a fresh baseline run could surface that the prior
  sessions' closing state wouldn't have shown (a CI-only-reproducible test
  failure, and a fresh `npm audit` diff).
- `brace-expansion` (dev-tooling-only advisory) — see item 2 above; no
  safe fix path exists yet.
- Per `CLAUDE.md`'s mission protocol item 9: no further meaningful
  improvement was found in this pass that didn't require external
  credentials or dashboard access (the remaining `ROADMAP.md` near-term
  items — credential rotation, Local-First Phase 1 migration, PM2 fleet
  confirmation — all explicitly require operator/host access this sandbox
  doesn't have).

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
