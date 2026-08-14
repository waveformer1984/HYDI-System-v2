# HYDI Next-Phase Evolution Plan

Date: 2026-08-14
Repo: `C:\Users\Owner\HYDI-System-v2`
Branch: `feat/hydi-system-wide-audit`

## Executive Summary

The audit shows that the **largest operational bottleneck** is not a missing capability, but a missing **live, authorized, local-first orchestration loop**. Rezonate, KILO, and ProtoForge are sound in isolation, yet none are wired into a running Heidi control plane. At the same time, the core event pipeline (CASCADE RAW LEDGER, ProtoForge policies, workers) is cloud-locked to Supabase. The next phase should therefore focus on making **one real end-to-end path local, authorized, observable, and reversible**, from a Heidi request through to a safe local action.

## P0 — Required Before Autonomous Operation

### P0.1 Activate the local-first control plane
- **Problem**: `pao-system/core/heidi.controller.ts` is never constructed; the entire PAO orchestration is dead code.
- **Why it matters**: Without a constructed controller, Heidi cannot route tasks, enforce approvals, or emit audit events. Chat is a keyword dispatcher, not an orchestrator.
- **Current evidence**: Zero `new HeidiController()` outside the file; `tests/unit/task-router.test.ts` exists but does not exercise the controller.
- **Proposed architecture**: Construct `HeidiController` in `src/server.js` or `protoforge-main.js`; route chat `heidi`/`rezonate` messages through `processEvent()`; gate mutating operations with `ApprovalEngine` and existing RBAC.
- **Dependencies**: None beyond Node runtime.
- **Risk**: Low if done behind feature flag.
- **Estimated complexity**: Medium (2-3 days).
- **What it unlocks**: Every subsequent P1/P2 capability becomes reachable.

### P0.2 Local RAW LEDGER / persistence factory
- **Problem**: `protoforge/cascade/src/adapters/ledger-adapter.js`, `protoforge/hydi-gateway/src/adapters/raw-ledger.js`, and `workers/WorkerOrchestrator.js` throw if Supabase is missing.
- **Why it matters**: The intended LOCAL-FIRST architecture cannot be true if the event pipeline cannot start without a cloud Supabase project.
- **Current evidence**: P0 direct `createClient` classifications in the persistence audit.
- **Proposed architecture**: Implement a `LocalLedgerAdapter` backed by SQLite or JSON that satisfies the same interface; allow `WorkerOrchestrator` to queue in memory when Supabase is absent; select backend via `PERSISTENCE_MODE`.
- **Dependencies**: P0.1 (so the control plane can drive it).
- **Risk**: Medium — changes the single-source-of-truth path; must preserve determinism.
- **Estimated complexity**: Medium-High (4-6 days).
- **What it unlocks**: HYDI can start and run without cloud; cloud becomes an opt-in replica.

### P0.3 Add `requireAuth` to unauthenticated sensitive endpoints
- **Problem**: `api/health.js`, `api/traces.js`, `api/revenue.js`, `api/client-dashboard.js` are public or only rate-limited.
- **Why it matters**: Exposing health/replay/revenue data without authentication is a security blocker for any autonomy.
- **Current evidence**: Security audit lists these as unauthenticated.
- **Proposed architecture**: Apply `requireAuth` with appropriate RBAC permissions (`status:view`, `traces:view`, `revenue:view`) to each. Add unit tests.
- **Dependencies**: None.
- **Risk**: Low.
- **Estimated complexity**: Low (1-2 days).
- **What it unlocks**: Production-ready API surface.

## P1 — Required for Reliable Operational Control

### P1.1 Stripe test/live mode guard
- **Problem**: No runtime guard prevents `sk_live_` in development.
- **Why it matters**: Autonomous money operations are unacceptable until this class of accident is impossible.
- **Current evidence**: `api/checkout.js`, `api/stripe-connect-webhook.js` use `STRIPE_SECRET_KEY` directly; `npm test` uses `sk_test_fake`.
- **Proposed architecture**: Enforce `STRIPE_SECRET_KEY.startsWith('sk_test_')` when `NODE_ENV !== 'production'`; add `STRIPE_MODE` env var.
- **Dependencies**: None.
- **Risk**: Low.
- **Estimated complexity**: Low (1 day).

### P1.2 Human-approval gate for money operations
- **Problem**: Stripe checkout/refund and revenue actions are not routed through an approval queue.
- **Why it matters**: Even a correctly configured test key should not be spent by an autonomous agent.
- **Current evidence**: `pao-system/core/approval.engine.ts` has thresholds but is dormant.
- **Proposed architecture**: Route checkout/refund tasks through `ApprovalEngine` with `requiresApproval()`; persist pending approvals in SQLite; require operator `actions:approve`.
- **Dependencies**: P0.1.
- **Risk**: Medium.
- **Estimated complexity**: Medium (2-3 days).

### P1.3 Ollama runtime guarantee
- **Problem**: Ollama is not running in this environment; the AI fallback is cloud if keys are set.
- **Why it matters**: Local-first AI is a stated principle.
- **Current evidence**: `pgrep -a ollama` returned no process; `lib/ModelManager.ts` falls back to Anthropic/OpenAI.
- **Proposed architecture**: Add `start-hydi.js` / Docker Compose that starts Ollama and pulls a pinned model; gate cloud fallback behind `ALLOW_CLOUD_INFERENCE=true`.
- **Dependencies**: Local runtime packaging.
- **Risk**: Low.
- **Estimated complexity**: Medium (2 days).

## P2 — Important Capability Expansion

### P2.1 Consolidate revenue engines
- **Problem**: Three overlapping revenue engines (`revenue-engine/index.js`, `revenue-engine-v2.js`, `src/revenue/HeidiRevenueEngine.js`) create confusion.
- **Why it matters**: One canonical revenue boundary is required for Heidi to operate money safely.
- **Current evidence**: Revenue audit.
- **Proposed architecture**: Declare `revenue-engine/index.js` canonical; route all revenue calls through it; deprecate the others.
- **Dependencies**: P1.2.
- **Risk**: Medium.
- **Estimated complexity**: Medium (3-5 days).

### P2.2 Fix Rezonate Supabase schema gap
- **Problem**: `SupabaseStore` only supports 2/7 tables and `createProject` omits `user_id`.
- **Why it matters**: When Supabase is used, core Rezonate flows will fail.
- **Current evidence**: Rezonate audit; `supabase-store.js` `UNSUPPORTED_TABLES`.
- **Proposed architecture**: Add the 5 missing tables to the migration; set `user_id` when in Supabase mode; add SupabaseStore test with a real local project.
- **Dependencies**: P0.2 (for local-first default).
- **Risk**: Medium.
- **Estimated complexity**: Medium (3 days).

### P2.3 Hyve integration and tests
- **Problem**: `hyve_service/listener.py` has no tests and is not wired to HYDI.
- **Why it matters**: Hyve is an active revenue stream but not operational.
- **Current evidence**: No tests; filesystem polling only.
- **Proposed architecture**: Add unit tests; create a HyveAgent in PAO; route `hyve_opportunity_detected` to revenue agent for scoring.
- **Dependencies**: P0.1.
- **Risk**: Low.
- **Estimated complexity**: Medium (2-3 days).

## P3 — Future Strategic Work

### P3.1 NFT / blockchain / marketplace
- **Problem**: `PLANNED` in capability contract; no implementation.
- **Why it matters**: Only once the core orchestration is local and safe.
- **Dependencies**: P0.1, P1.2.

### P3.2 Mixing / mastering DSP
- **Problem**: `PLANNED`; no implementation.
- **Why it matters**: Rezonate production readiness.
- **Dependencies**: P0.1, P2.2.

### P3.3 Distributed rate limiting
- **Problem**: In-memory `lib/rate-limit.js` won't scale.
- **Why it matters**: Only relevant after multi-instance deployment.
- **Dependencies**: Production multi-node deployment.

## Recommended Primary Phase

**PHASE A: Heidi operational control plane + local-first persistence factory**

This is the right next phase because it removes the largest bottleneck: nothing is orchestrated, and the system cannot start without cloud. Rezonate has already been integrated cleanly; the next vertical slice should generalize that pattern to one real operation.

## Recommended First Vertical Slice

**Local Rezonate project creation via Heidi**

```text
User request in chat: "Create a Rezonate project called 'Demo'"
   ↓
api/chat/route.js (service-token auth)
   ↓
HeidiController.processEvent()
   ↓
TaskRouter → rezonate.agent
   ↓
ApprovalEngine checks payload (create is low risk but logged)
   ↓
RezonateAgent calls lib/rezonate/rezonate-client.js
   ↓
canonical ResonateRepository.createProject({ name: 'Demo' })
   ↓
local JsonStore / MemoryStore
   ↓
EventBus emits 'project.created'
   ↓
AuditLog records the action
   ↓
Heidi response: "Created project 'Demo' (id: ...)."
```

This slice is:
- **local** — uses canonical Rezonate with local persistence
- **testable** — unit + integration tests for the full chain
- **observable** — event + audit log
- **reversible** — delete not included; create is safe
- **authorized** — `verifyServiceToken` and `rezonate:manage`
- **persistent** — JSON or memory store
- **auditable** — EventBus + audit log

## Acceptance for the Vertical Slice

- [ ] `HeidiController` constructed on `npm run dev` / `npm run server`.
- [ ] Chat `system: 'rezonate'` with create intent routes to `RezonateAgent`.
- [ ] Project is created in local `heidi-db.json`.
- [ ] `project.created` event emitted and auditable.
- [ ] Missing/invalid `rezonate:manage` returns 403.
- [ ] All tests pass (`npm test`, `npm run typecheck`, `npm run build`, `npm run validate:rezonate-contract`).
