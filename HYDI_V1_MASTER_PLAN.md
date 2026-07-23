# HYDI v1.0 Completion Master Plan

**Repo:** `C:\Users\Owner\HYDI-System-v2`  
**Version:** 4.0.0-cc  
**Primary branch:** `clean-main`  
**Last updated:** 2026-07-23  
**Reconciled against git log:** cb907e8, f0e5c57, e921d45, 17ade43

## Executive Summary

Finish HYDI v1.0 by converging, hardening, and productionizing the existing v4.0.0-cc codebase. No new features. Priorities are, in order:

1. Single source of truth for events, identity, and money.
2. Stable validation baseline (typecheck, tests, build, lint, integration).
3. Remove duplication and dead code.
4. Harden the runtime, observability, and deployment pipeline.

This plan is organized into 10 dependency-ordered workstreams. Each workstream lists the problem, success criteria, blockers, risks, and a milestone target.

---

## Validation Baseline (run before/after each workstream)

```bash
npm run typecheck
npm test
npm run build
npm run lint        # currently scoped; see Workstream 1
./verify-supabase.sh
```

Current status (2026-07-23):
- `typecheck`: PASS
- `test`: PASS (128 passed, 1276 total)
- `build`: PASS
- `lint`: FAIL — 357 errors remain after config fix; see Workstream 1
- `verify-supabase.sh`: not run; requires live env

## Recent git-state findings

- **Workstream 2 (identity/ledger) is already merged** via commits `cb907e8` (customer identity convergence) and `f0e5c57` (ledger → `financial_ledger` with compatibility view). The plan text below is preserved for traceability but should be treated as **DONE**.
- **Workstream 3 (event system) is partially merged** via `e921d45` and `17ade43` (`event_bus_events` → Event Fabric bridge). What remains is cleanup of abandoned in-memory `lib/event-bus/` code and verification of replay determinism, not a full migration.
- Remaining active workstreams are therefore: **1, 3-cleanup, 4, 5, 6, 7, 8, 9, 10**.

---

## Workstream 1: Lint, Type, and Validation Gate
**Goal:** Make `npm run lint` pass cleanly on the core source set and restore full-repo lint coverage.

**Why first:** A red lint gate blocks every other workstream from being safely merged.

**Tasks**
- [ ] Decide final lint scope: full repo vs. core directories.
- [ ] Fix or suppress `@typescript-eslint/no-explicit-any` in `apps/ursula-frontend/src/app/api/**/*.ts` (bulk of errors).
- [ ] Fix `no-assign-module-variable` in `apps/ursula-frontend/src/app/api/ucmrs/**` and `src/enforcement/RuntimeEnforcer.js`.
- [ ] Fix `no-html-link-for-pages` in `pages/test-simple.tsx`.
- [ ] Fix remaining `no-unused-vars` warnings in core directories.
- [ ] Re-enable `--max-warnings=0` and expand lint to `workers/`, `agents/`, `supabase/functions/` (Deno) with separate config.

**Blockers:** None (pure code cleanup).

**Risks:**
- Large surface area; easy to introduce runtime regressions while typing APIs.
- `supabase/functions/` are Deno; may need a separate ESLint / `deno lint` pass.

**Milestone:** `npm run lint` exits 0 on core source by end of WS1.

---

## Workstream 2: Identity and Data Model Convergence — DONE
**Status:** Completed in git history (`cb907e8`, `f0e5c57`).  
**Goal:** Create one customer identity across `clients` and `hydi_subscriptions`; rename the financial `ledger` table to avoid collision with the operational RAW LEDGER concept.

**What landed:**
- Canonical `customers` table with foreign keys from `clients`, `payouts`, `hydi_subscriptions`, `hydi_client_health_runs`, `hydi_schedules`.
- `ledger` table renamed to `financial_ledger`; a read-only compatibility `ledger` view remains.
- Edge Functions, `scripts/reconciliation-query.sql`, and `setup-payout-system.sql` updated for the new name.

**Remaining cleanup:**
- [ ] Audit for any straggler references to the old monolithic `ledger` table name (as opposed to the compatibility view).
- [ ] Add migration governance test in `tests/migrations/` for the identity and ledger migrations if not already present.

**Blockers:** None.

**Risks:**
- Rewriting this workstream from a stale plan risks reintroducing the old `ledger` table or duplicating `customers` schema.

**Milestone:** A single `customer_id` resolves to one record; all references to `ledger` are disambiguated.

---

## Workstream 3: Event System Consolidation — PARTIALLY DONE
**Status:** Phase 6 bridge merged (`e921d45`, `17ade43`) — `event_bus_events` now feeds the Event Fabric.  
**Goal:** Complete the cleanup: remove abandoned `lib/event-bus/` in-memory bus code, keep the persistence-backed event store as the single source of truth, and verify replay determinism.

**Tasks**
- [x] Choose canonical event store: `event_bus_events` (persistence) + replay engine.
- [x] Bridge `event_bus_events` to the Event Fabric.
- [ ] Audit and deprecate `lib/event-bus/` in-memory broker and abandoned event modules.
- [ ] Confirm `api/chat/route.js`, `HeidiOrchestrator`, and workers consume the persistence-backed bus.
- [ ] Verify replay determinism with `hdi-everything-wrong.test.js`.

**Blockers:** Workstream 2 completed; none technical.

**Risks:**
- Real-time SSE stream (`api/events/stream.js`) may still read from the in-memory broker.
- Workers may subscribe to deprecated in-memory topics.

**Milestone:** One event bus implementation remains; replay test passes deterministically.

---

## Workstream 4: Stripe Webhook and Checkout Consolidation
**Goal:** Merge the three Stripe webhook handlers (`api/webhooks/stripe.js`, `api/stripe-connect-webhook.js`, `src/webhook-handlers/stripe-webhook.js`, `apps/ursula-frontend/src/app/api/stripe-webhook/`) and the duplicate checkout routes (`api/checkout.js`, `api/checkout-v2.js`) into one canonical path.

**Why fourth:** Revenue correctness depends on exactly-once event handling; duplicate handlers cause double ledger entries.

**Tasks**
- [ ] Inventory webhook handlers and checkout implementations.
- [ ] Choose canonical endpoints: `/api/webhooks/stripe` and `/api/checkout`.
- [ ] Move Connect-specific logic into the canonical webhook with event-type routing.
- [ ] Delete or archive duplicates.
- [ ] Add idempotency keys to all Stripe event writes.
- [ ] Update Stripe dashboard webhook URLs and `vercel-env-checklist.md`.

**Blockers:** Requires Stripe webhook URLs and secrets; risky on live account.

**Risks:**
- Missing an edge case in one of the duplicated handlers can lose revenue events.
- Webhook signature verification differences between handlers may cause silent failures.

**Milestone:** One webhook handler and one checkout handler exist; Stripe event tests pass.

---

## Workstream 5: Revenue Engine and Schema Deduplication
**Goal:** Converge the three revenue schemas (`revenue-engine/`, `src/revenue/HeidiRevenueEngine.js`, `apps/ursula-frontend/src/app/api/ucmrs/`) into a single engine and schema.

**Why fifth:** After identity, events, and webhooks are unified, revenue calculation can be centralized.

**Tasks**
- [ ] Map the three revenue schemas and identify overlapping tables/columns.
- [ ] Choose canonical schema (likely `financial_ledger` + `checkout_sessions` + revenue stream tables).
- [ ] Consolidate calculation logic into `src/revenue/` or `revenue-engine/`.
- [ ] Remove UCMRS-specific revenue duplication or make it a thin API over the canonical engine.
- [ ] Add payout reconciliation test.

**Blockers:** Depends on Workstreams 2 and 4.

**Risks:**
- Revenue numbers may drift between old and new engine during transition; require parallel run.
- Payout timing and fee breakdowns must match exactly.

**Milestone:** Single revenue engine produces consistent ledger/payout numbers across all six streams.

---

## Workstream 6: Dashboard and Frontend Consolidation
**Goal:** Remove dead dashboard implementations and converge the active frontend to one Next.js app (`apps/ursula-frontend` or `pages/`).

**Why sixth:** UI is downstream of identity, events, and revenue; consolidating early would rebuild on unstable foundations.

**Tasks**
- [ ] Inventory all dashboard/status implementations (`pages/`, `apps/ursula-frontend/src/app/`, `api/health.js`, `api/mobile-status.js`, `api/ursula/status.js`).
- [ ] Choose canonical frontend: Next.js App Router (`apps/ursula-frontend/src/app`) vs. Pages Router (`pages/`).
- [ ] Port or delete `pages/` routes not in `apps/ursula-frontend`.
- [ ] Keep `api/mobile-status.js` contract exactly unchanged.
- [ ] Delete dead `components/` and pages.

**Blockers:** Depends on Workstreams 2, 3, 4.

**Risks:**
- `api/mobile-status.js` is a hard contract; any change breaks mobile clients.
- Next.js App Router vs Pages Router collision can cause build/runtime routing conflicts.

**Milestone:** One frontend app builds and serves all user-facing routes; `api/mobile-status.js` still returns the exact contract.

---

## Workstream 7: Service and Worker Layer Cleanup
**Goal:** Deduplicate service implementations and ensure every worker is registered and supervised.

**Why seventh:** Workers and services consume the unified identity/events/revenue; they must be canonical before scaling.

**Tasks**
- [ ] Identify duplicate service classes (`src/api/services/`, `src/services/`, `lib/`, `apps/ursula-frontend/src/lib/`).
- [ ] Merge or alias duplicate services; remove dead exports.
- [ ] Verify `WorkerOrchestrator.js` registers all 18 workers.
- [ ] Add a worker registration test.
- [ ] Consolidate `QueueManager`, `MessageBroker`, `InMemoryBroker`, `RedisStreamBroker` into one broker abstraction.

**Blockers:** Depends on Workstream 3 (event bus).

**Risks:**
- Removing a service that is imported by an Edge Function or worker can break async processing.
- Worker lifecycle changes can cause message loss during deploy.

**Milestone:** All workers start/stop cleanly; service imports resolve to one implementation.

---

## Workstream 8: Runtime Hardening and Local AI Orchestration
**Goal:** Stabilize the local AI orchestration path: model routing, tool execution, memory, provider fallback, and action execution.

**Why eighth:** Local AI is the user-facing value; it must be reliable before adding polish.

**Tasks**
- [ ] Harden `lib/ModelManager.ts` fallback chain (OpenAI → Anthropic → local Ollama).
- [ ] Validate `HeidiActionLayer.js` executes only approved actions from ProtoForge.
- [ ] Consolidate memory stores (`src/memory/`, `src/services/heidi-memory-service.js`, `memories` table, `data/memory/`).
- [ ] Add deterministic timeout and circuit-breaker for tool execution.
- [ ] Add `/api/heidi` integration test with mocked providers.

**Blockers:** Depends on Workstreams 3 and 7.

**Risks:**
- Model fallback changes may route paid traffic to local models unexpectedly.
- Memory consolidation can lose active session context.

**Milestone:** `/api/heidi` chat pipeline passes end-to-end with all three provider modes.

---

## Workstream 9: Observability, Logging, Diagnostics, and Installer
**Goal:** Add unified logging, health diagnostics, a reproducible installer, and auto-update mechanism.

**Why ninth:** Production readiness comes after the core runtime is stable.

**Tasks**
- [ ] Replace ad-hoc `console.log` with a structured logger in `src/` and `workers/`.
- [ ] Add OpenTelemetry or Datadog-compatible traces across the six pipeline layers.
- [ ] Harden `api/health.js` and `api/mobile-status.js` against `system_dashboard` failures.
- [ ] Create/validate `setup.sh` and `install-hydi-services-elevated.ps1` for clean installs.
- [ ] Implement auto-update check for desktop/mobile companions.

**Blockers:** Depends on Workstreams 3 and 7.

**Risks:**
- Structured logging must not leak secrets; review redaction.
- Auto-update on Windows requires code-signing/elevated privileges.

**Milestone:** Fresh clone installs and runs with one script; health endpoints return structured diagnostics.

---

## Workstream 10: CI/CD, Test Suite, and Production Deployment
**Goal:** Lock in the production deployment pipeline and comprehensive test coverage.

**Why tenth:** Deployment is the final gate; all upstream workstreams must be green first.

**Tasks**
- [ ] Ensure all CI workflows run against `clean-main`.
- [ ] Add `npm run lint` back to the unit-tests workflow with zero-tolerance.
- [ ] Add pre-commit hook or CI gate for migration tests.
- [ ] Create production deployment runbook with rollback steps.
- [ ] Run `npm run test:integration` and `npm run test:soak` against staging.

**Blockers:** Depends on Workstreams 1–9.

**Risks:**
- Long-running soak tests may fail on timing-sensitive race conditions.
- Production rollback requires DB snapshot discipline.

**Milestone:** `clean-main` is green on all gates and deploys to production with one command.

---

## Dependency Graph

```
WS1 Lint/Type  ─────────────────┐
WS2 Identity/Data Model ─── DONE │
WS3 Event Bus ───────── partial   │
WS4 Stripe Webhooks ────────────┤
WS5 Revenue Engine ─────────────┤
WS6 Frontend/Dashboard ─────────┤
WS7 Workers/Services ───────────┤
WS8 Local AI/Memory ────────────┤
WS9 Observability/Installer ────┤
WS10 CI/CD/Deploy ──────────────┘
```

## Immediate Next Actions

1. **Complete Workstream 1 lint pass** — finish replacing `any` in core `apps/ursula-frontend/src/app/api/**` route files, then re-enable `--max-warnings=0`.
2. **Archive duplicate root-level files** (`ursula-api-hydi-sync.js`, obsolete `verify-*.js` scripts) once references are verified.
3. **Clean up abandoned `lib/event-bus/` code** as part of Workstream 3-cleanup.
4. **Move to Workstream 4** (Stripe webhook/checkout consolidation) once Workstream 1 is green.
