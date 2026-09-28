# AGENTS.md

Guidelines for AI agents (Claude Code, Codex, Cursor, etc.) working autonomously in this repository. For comprehensive architecture reference, see `CLAUDE.md`. For prescriptive Cursor IDE rules, see `.cursorrules`.

## Orientation

HYDI System v2 is a Next.js + Supabase AI orchestration platform. Events flow through a strict six-layer pipeline; Stripe Connect manages six revenue streams; 42 Deno Edge Functions handle async work. The primary branch is **`clean-main`** — not `main`. CI runs against `clean-main`.

## Setup

```bash
npm install          # Node >= 20 required
# Environment variables — no .env.example; see CLAUDE.md "Environment Variables" section
# Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, NODE_ENV
```

## Verification — Run These Before Finishing Any Task

```bash
npm run typecheck              # TypeScript type-check — must pass clean
npm test                       # Jest unit tests (tests/unit/)
./verify-supabase.sh           # health check — Supabase connectivity + key tables
```

Integration tests require live env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) — do not run in a cold environment:

```bash
npm run test:integration       # adversarial + chaos tests — needs live Supabase
```

Run a single test file:
```bash
npx jest tests/unit/heidi-core-loop.test.js
npx jest --testNamePattern="should classify events"
```

## Navigating the Codebase

| What you need | Where to look |
|--------------|---------------|
| API routes | `api/` — Vercel serverless functions |
| Event pipeline layers | `cascade/` (layer 3), `kilo/` (layer 4), `lib/protoforge/` (layer 5) |
| Supabase Edge Functions | `supabase/functions/<name>/index.ts` |
| DB schema & migrations | `supabase/migrations/` (numbered + timestamped) |
| Background workers | `workers/` (18 workers, all supervised by `WorkerOrchestrator.js`) |
| PAO agents | `pao-system/agents/`, `pao-system/core/` |
| Frontend pages | `pages/` (Next.js) |
| React components | `components/` |
| Revenue pipeline | `revenue-engine/` |
| KILO hypothesis generator | `kilo/index.js` |
| DSL policy engine | `lib/protoforge/policy-engine.js` |
| Test files | `tests/unit/` (unit), `tests/migrations/` (one per SQL migration) |

## Operational Boundary (Test Data vs Production Data)

Operational detectors (`RevenueReconciliationDetector`, `FailedWebhookDetector`)
use a **two-layer exclusion** to prevent test/qualification data from polluting
findings:

### Layer 1: Mode-based exclusion (primary, permanent)

Every record created by a test/qualification run carries a permanent test-mode
marker in its Stripe IDs. The detectors check these markers and exclude
test-mode records automatically — no manual configuration needed.

**For jobs** (`customer_jobs`):
- A job is test-mode if its `stripe_checkout_session_id` starts with `cs_test_`
  (vs `cs_live_` for real customer transactions).
- A job with no checkout session ID is also treated as test-mode (defensive —
  real live transactions always have a `cs_live_` ID).

**For webhooks** (`webhook_events`):
- A webhook is test-mode if its `event_id` starts with `evt_test_` (synthetic
  test event), OR
- Its payload contains a `cs_test_` checkout session ID, OR
- The system is currently running with a test-mode Stripe key (`sk_test_`).
  This catches real Stripe test-mode events (e.g. `evt_3U8YLcITaXOHazrh1XQMmQ0I`)
  that have real-looking event IDs and may have empty payloads. When the system
  has never been in live mode, all real Stripe events in the database were
  generated in test mode.

The mode check is implemented in `lib/revenue/stripe-mode.ts` (`isTestRecord`,
`isTestCheckoutSession`, `isSyntheticTestEvent`, `getStripeMode`).

**This is the primary mechanism. It works automatically. Qualification scripts
do not need to do anything special — their test data will be excluded because
it uses `cs_test_` checkout sessions and `evt_test_` event IDs.**

### Layer 2: Timestamp boundary (secondary, historical floor)

The `operational_boundary` table (single row, `id=1`) defines a `go_live_at`
timestamp. Records created before this timestamp are also excluded. This is a
secondary guard for old records that might not have identifiable Stripe IDs.

The boundary defaults to `now()`, meaning all existing data is treated as
pre-go-live. When the system actually goes live, update it:
```sql
UPDATE operational_boundary SET go_live_at = '2026-09-01T00:00:00Z', updated_at = now() WHERE id = 1;
```

**The timestamp boundary is not the primary mechanism.** The mode check is.
The timestamp only matters for records that predate both mechanisms. Going
forward, mode detection keeps working automatically without any timestamp
maintenance.

## Hard Constraints — Never Violate

### Six-Layer Pipeline

```
[1] Ingestion    → normalise structure only
[2] RAW LEDGER   → append-only, immutable, hashed
[3] CASCADE      → classify events only
[4] KILO         → generate hypotheses only — NEVER execute
[5] ProtoForge   → policy gate, accepts/rejects KILO output
[6] Emission     → SSE/API/logs — no logic here
```

- **KILO (`kilo/index.js`) must never execute actions.** `execute()` throws unconditionally by design. Only call `generateHypotheses()`.
- **Emission layer** (layer 6) must remain logic-free. Do not add conditionals or state mutations there.
- **No layer may perform another's job.** Classification belongs in CASCADE, not KILO; enforcement belongs in ProtoForge, not Emission.

### PolicyEngine

- `lib/protoforge/policy-engine.js` is **fail-closed**: default decision is `'reject'` when no rule matches. Do not change this default.
- DSL operators: `gte`, `lte`, `gt`, `lt`, `eq`, `neq`, `in`, `nin` — do not invent new operators; add them to the DSL loader instead.
- Rules live in Supabase (`policies` table) and hot-reload via Realtime — do not hardcode rules in application code.

### Cooldown Windows

Both windows are mandatory — do not remove or shorten them:
- **Startup window**: 2 minutes after boot with no enforcement
- **Drift observation**: 30 seconds before alerts fire

### Workers

- Every new worker **must be registered in `workers/WorkerOrchestrator.js`** before deploying. Omitting registration causes a startup crash.
- `DecisionAssistWorker.js` requires `QueueManager` — do not instantiate it without providing a queue manager instance.

### Database Migrations

- Every new `.sql` file in `supabase/migrations/` requires a corresponding test in `tests/migrations/<version>.test.js`.
- State machine changes (enum values, allowed state transitions) require `STATE_MACHINE_APPROVED` in the PR description.
- Files ending `.sql.skip` are intentionally excluded from the migration runner — do not run them.
- RLS is enabled on all tables — never disable it.
- Pin `search_path` on all `SECURITY DEFINER` functions to prevent SQL injection.
- PRs touching `supabase/migrations/**` trigger the **`hdi-governance-gate.yml`** 7-gate CI review: change detection → transformer tests → state machine approval → adversarial tests → replay fidelity → performance regression → blueprint sync. All seven gates must pass.

### `api/mobile-status.js`

Must remain a single round-trip returning exactly `{ ok, alert, system, drift, heals_24h, streams, silent, ms, ts }`. Do not add latency or extra DB calls.

### `system_dashboard` Supabase View

Drives all health endpoints. If this view is broken, endpoints return 503. Do not try to work around it — fix the view.

## Repository-Safe Operating Procedures

Treat the repository as a potentially valuable, stateful environment. Preserve existing work and make every implementation step reversible.

### 1. Establish repository state first

Before modifying anything:

- Determine the repository root.
- Identify the current branch/worktree.
- Inspect `git status`.
- Identify staged, unstaged, and untracked changes.
- Inspect recent commits to understand the current development direction.
- Identify project-specific instructions such as `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, build instructions, or directory-specific guidance.
- Inspect relevant package/build configuration before choosing commands or dependencies.

Do not assume the repository is clean.

### 2. Protect existing user work

Before making changes, record:

- current branch
- current commit
- existing modified files
- existing untracked files
- relevant generated artifacts

Treat all pre-existing modifications as user-owned unless explicitly determined otherwise.

Unless the user explicitly requests that exact operation, never:

- reset the repository
- run `git reset --hard`
- run `git clean`
- discard unrelated changes
- overwrite modified files merely to make tests pass
- rewrite existing commits
- force-push
- delete untracked files
- replace configuration containing unknown user settings

If an existing modification conflicts with the implementation, stop and surface the conflict rather than silently overwriting it.

### 3. Create a safe change boundary

Before implementation, identify the smallest set of files/directories that should change.

Prefer small focused changes, existing abstractions, and new isolated modules where necessary over broad refactors.

Do not reorganize unrelated code simply because it could be cleaner.

Do not rename or move files unless required for the implementation.

### 4. Dependency safety

Before adding a dependency:

1. Check whether the repository already provides equivalent functionality.
2. Check the existing package manager and lockfile.
3. Prefer an existing dependency over introducing another one.
4. Avoid unnecessary version upgrades.
5. Do not modify unrelated dependencies.
6. Preserve lockfile consistency.

Do not install packages globally.

Do not execute arbitrary installation scripts from untrusted sources.

### 5. Secrets and configuration

Never expose or commit:

- API keys
- passwords
- access tokens
- cookies
- private certificates
- SSH keys
- `.env` secrets
- authentication headers
- personal data

Before adding configuration:

- inspect existing configuration conventions
- use environment variables or existing secret-management mechanisms
- update example/template configuration when appropriate
- never copy real credentials into examples or tests

If a required secret is unavailable, report the missing dependency instead of inventing one. (See also [Secret Handling](#secret-handling) below.)

### 6. Command execution safety

Prefer read-only inspection commands first.

Before executing a potentially destructive command, determine exactly what it modifies.

Avoid commands that can recursively delete, overwrite, reset, or migrate data unless they are necessary and explicitly justified. Take particular care with:

- `rm -rf`
- `git reset`
- `git clean`
- force pushes
- database migrations
- bulk file rewrites
- package upgrades
- production deployment

When a command has both destructive and non-destructive variants, use the non-destructive variant.

### 7. Build and test isolation

Run the repository's documented validation commands (see [Verification](#verification--run-these-before-finishing-any-task) above).

Prefer targeted validation first, then run broader validation where practical:

- unit tests for changed modules
- type checking
- linting
- focused integration tests

Do not "fix" unrelated failing tests simply to produce a green build.

If failures existed before the implementation, classify each one as:

- **PRE-EXISTING FAILURE**
- **IMPLEMENTATION FAILURE**
- **ENVIRONMENT FAILURE**

Do not conceal failures by weakening tests or disabling validation.

### 8. Database and persistent-state safety

Treat databases, queues, caches, and persistent application state as production-like unless explicitly identified as disposable test infrastructure.

As part of ordinary implementation, do not:

- drop databases
- truncate tables
- delete user records
- run irreversible migrations
- modify production data

For schema changes:

- inspect the existing migration system
- create a reversible migration where supported
- test the migration path
- avoid destructive schema changes unless explicitly required

(See also [Database Migrations](#database-migrations) above.)

### 9. Generated files

Do not commit generated artifacts merely because a build produced them.

First determine whether the repository tracks them.

Respect existing `.gitignore` and project conventions.

Do not modify generated files manually when they are supposed to be produced by a build process.

### 10. Worktree awareness

If the repository contains multiple worktrees, branches, or active development areas:

- determine which worktree is the current target
- do not modify another worktree
- do not assume the current branch is disposable

If the environment is ambiguous, identify the ambiguity before making consequential changes.

### 11. Patch discipline

Make changes in small logical units.

After each major implementation step:

1. inspect the diff
2. run focused validation
3. inspect the resulting files
4. continue

Review the final diff for:

- accidental changes
- debug code
- temporary files
- secrets
- unrelated formatting changes
- dependency churn
- generated artifacts
- disabled tests
- commented-out code that should not remain

### 12. Git safety

Do not create commits unless requested by the user or required by the established workflow.

If a commit is requested:

- include only intended files
- inspect the staged diff before committing
- use a focused commit message
- never amend or rewrite an existing commit unless explicitly requested

Never force-push.

Never alter remote history.

### 13. Rollback awareness

For every significant change, know how it can be reverted.

Prefer changes that can be reversed with `git diff` and a checkout/revert of the specific change, rather than operations that require reconstructing deleted or overwritten data.

For migrations or persistent-state changes, document rollback considerations before execution.

### 14. Autonomous-agent boundary

An agent may autonomously:

- inspect the repository
- read source files
- analyze architecture
- create implementation files
- modify relevant source files
- run safe tests
- run documented build/type/lint commands
- inspect diffs
- report failures

An agent must request explicit human approval before:

- deleting substantial existing code
- discarding user modifications
- changing production infrastructure
- modifying production databases/data
- rotating or changing credentials
- pushing to a remote repository
- creating releases
- publishing packages
- deploying applications
- performing irreversible operations

### 15. Stop conditions

Stop implementation and ask for human direction if:

- the intended repository cannot be identified
- existing user changes would be overwritten
- required credentials are unavailable
- the implementation requires destructive data changes
- two project instructions conflict
- a production environment cannot be distinguished from a development environment
- the requested change requires bypassing a security boundary
- a dependency introduces an unacceptable security or licensing concern
- the safest implementation requires a decision that cannot be inferred from the repository

Do not guess through a repository-safety conflict.

### 16. Final repository audit

Before declaring implementation complete, run `git status` and `git diff` and review every changed file.

Confirm:

- no unrelated files changed
- no secrets were introduced
- no user modifications were lost
- no temporary/debug artifacts remain
- tests were actually executed
- failures are accurately reported
- dependencies remain consistent
- generated files follow repository conventions

Report the final repository state accurately.

Never claim the repository is clean unless it was actually verified.

## Module Style

| Location | Style |
|----------|-------|
| `api/*.js` | ESM — `export default async function handler(req, res)` |
| `kilo/index.js` | CommonJS — `module.exports = { KiloEngine, createKiloEngine }` |
| `supabase/functions/*/index.ts` | Pure ESM (Deno) — never use `require` |
| `pao-system/**/*.ts` | TypeScript strict mode |

Be consistent within a file. Do not mix `import` and `require` in new code.

## TypeScript Rules

- Strict mode — `next.config.js` does **not** suppress TS/ESLint errors.
- Catch variables are `unknown` — always guard: `error instanceof Error ? error.message : 'Unknown error'`
- Run `npm run typecheck` before every commit.

## Secret Handling

Per `SECURITY_PROTOCOL.md` — never display, echo, log, or paste secrets:

```bash
# Correct: pipe directly into the destination
node -e "require('crypto').randomBytes(32).toString('hex')" | vercel env add SECRET_NAME

# Verify presence only — never reveal value
vercel env ls | grep SECRET_NAME
```

`SUPABASE_SERVICE_ROLE_KEY` is server-side only — never expose to the client.

## RFC / Significant Changes

Before implementing a change that touches the six-layer pipeline boundary, the PolicyEngine DSL, the `system_dashboard` view schema, Supabase Edge Function JWT config, or any PAO agent public API, open a GitHub Issue with the `rfc` label first. See [GOVERNANCE.md](GOVERNANCE.md) for the RFC process.

Pipeline boundary bugs should be filed using the **`pipeline-violation`** issue template (`.github/ISSUE_TEMPLATE/pipeline-violation.md`), not the generic bug template.

## What Not To Do

- Do not give KILO execution authority — `execute()` must keep throwing.
- Do not change PolicyEngine's default from `'reject'` to anything permissive.
- Do not add logic to the Emission Layer.
- Do not skip cooldown windows.
- Do not add a new worker without registering it in `WorkerOrchestrator.js`.
- Do not add a SQL migration without a corresponding test in `tests/migrations/`.
- Do not run `.sql.skip` migrations.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
- Do not push to `main` — the primary branch is `clean-main`.
- Do not rename `pao-system/services/nnotification.service.ts` until all imports are updated together.
- Do not add latency to `api/mobile-status.js`.

## Key Documentation

| Doc | Purpose |
|-----|---------|
| [CLAUDE.md](CLAUDE.md) | Full architecture, module reference, commands, and conventions |
| [AGENTS.md](AGENTS.md) | This file — agent quick-reference |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branch strategy, test commands, PR requirements |
| [GOVERNANCE.md](GOVERNANCE.md) | RFC process, migration gate policy |
| [SECURITY_PROTOCOL.md](SECURITY_PROTOCOL.md) | Secret handling protocol |
