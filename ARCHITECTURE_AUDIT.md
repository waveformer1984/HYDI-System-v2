# HYDI-System-v2 Phase 4 Architecture Audit

**Date:** 2026-07-22  
**Scope:** Pre-convergence audit of customer identity, event systems, financial ledger, revenue/billing, dashboard, service, and configuration duplication.  
**Status:** Phase 1 report + Phase 2 implementation.

---

## Baseline verification

Run before producing this report:

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (root Jest) | 115/115 suites pass, 1208 tests pass |
| `apps/ursula-frontend npm run build` | Pass |
| `apps/ursula-frontend npm test` | 107 pass, 5 pre-existing failures (Starfield, claude-healing) unrelated to this work |

---

## Executive summary

This audit identified **23 critical architectural issues** that must be resolved before Phase 4 commercial convergence. The most severe issues involve customer identity fragmentation, dual event systems, ledger naming collisions, and duplicate revenue implementations across the codebase.

The platform has reached a maturity point where the most important work is convergence rather than adding new independent systems. Resolving these mismatches is the prerequisite for the commercial domain model defined in `COMMERCIAL_MODEL.md`.

---

## Summary table of most severe issues (ranked by architectural risk)

| Rank | Issue | Risk Level | Files Involved | Impact |
|---|---|---|---|---|
| 1 | Customer identity split | **CRITICAL** | `clients` table, `hydi_subscriptions` table, Supabase functions, API routes | No single customer identity; commercial records cannot be unified |
| 2 | Dual event systems | **CRITICAL** | `lib/event-bus/`, `event_bus_events` table, `modules/protoforge-event-bus.js`, `simple-event-bus.js`, `workers/EventBusWorker.js` | Two unrelated event logs with confusingly similar names |
| 3 | Ledger naming collision | **HIGH** | `ledger` table (financial), RAW LEDGER (pipeline), 37 code references | Financial ledger collides with pipeline terminology |
| 4 | Stripe webhook duplication | **HIGH** | `api/stripe-connect-webhook.js`, `apps/ursula-frontend/src/app/api/stripe-webhook/route.ts`, `supabase/functions/stripe-webhook/index.ts` | Three different webhook handlers with overlapping logic |
| 5 | Revenue engine schema duplication | **HIGH** | `revenue-engine/schema.sql`, `apps/ursula-frontend/src/lib/revenue-engine/schema.sql`, `hydi-monetization-schema.sql` | Three different revenue schemas |
| 6 | Dashboard implementation duplication | **MEDIUM** | `apps/ursula-frontend/src/app/dashboard/`, `public/client-dashboard.html`, `dashboard/client-view.html`, `hydi-monitor-deploy/pages/client-dashboard.js`, `archive/ui/` | Multiple dead dashboard implementations |
| 7 | Service layer duplication | **MEDIUM** | `lib/dashboard/revenue-service.js`, `apps/ursula-frontend/src/lib/dashboard/services/revenue-service.ts` | Duplicate service implementations |
| 8 | Configuration duplication | **MEDIUM** | 5 `package.json` files, 2 `next.config.*` files, 5 `package-lock.json` files | Multiple build configurations |

---

## 1. Customer identity systems

**Files involved:**

- `supabase/migrations/20260425105500_create_clients_table.sql`
- `supabase/migrations/20260424145243_hydi_monetization.sql`
- `supabase/migrations/20260425110000_create_payouts_table.sql`
- `supabase/functions/stripe-webhook/index.ts`
- `api/stripe-connect-webhook.js`
- `appforge-hydi.js`
- `supabase/functions/stripe-connect-admin/index.ts`
- `supabase/functions/monthly-payout-calculation/index.ts`

**Issue:**

- `clients.client_id` is a **UUID** with proper foreign keys (`payouts.client_id` references it).
- `hydi_subscriptions.client_id` is **TEXT** with no foreign key to `clients`.
- These are two disconnected customer identity systems.
- A client who both buys a one-off project and subscribes has two disconnected identities and no combined view.

**Type mismatch:**

```sql
-- clients table (UUID, with FKs)
client_id uuid primary key default gen_random_uuid()

-- hydi_subscriptions table (TEXT, no FK)
client_id text UNIQUE NOT NULL
```

**Recommended convergence action:**

1. Introduce a canonical `customers` table with `customer_id uuid` primary key.
2. Migrate `clients.client_id` → `customers.customer_id`.
3. Migrate `hydi_subscriptions.client_id` (text) → `customers.customer_id` (uuid).
4. Add foreign keys from all commercial tables to `customers.customer_id`.
5. Keep `stripe_customer_id` and `marketplace_id` as external-reference columns only.

---

## 2. Event systems

**Files involved:**

- **Active (Event Fabric):** `lib/event-bus/EventBus.ts`, `lib/event-bus/index.ts`, `lib/event-bus/types.ts`, `lib/event-bus/recorder.ts`, `lib/event-bus/context.ts`
- **Active (PAO):** `pao-system/core/event.bus.ts`
- **Deprecated/legacy:** `modules/protoforge-event-bus.js`, `simple-event-bus.js`
- **Worker:** `workers/EventBusWorker.js`
- **API:** `pages/api/system/events.ts`
- **Database:** `event_bus_events` table, referenced in 41 files including migrations, Edge Functions, scripts, and the `business-intelligence-layer.sql` view

**Issue:**

Multiple event systems exist with no documented relationship:

1. **Event Fabric** (`lib/event-bus/`): NDJSON-backed, replay/trace-capable, used by the six-layer pipeline and the Unified Dashboard. This is the canonical runtime event bus for Phase 3.
2. **`event_bus_events`** (Postgres table): Used by billing Edge Functions, Supabase Realtime, trend analysis, and worker coordination. Different schema (`topic`/`event_name`/`occurred_at`/`source_worker`) from the Event Fabric's `BusEvent` shape.
3. **ProtoForge Event Bus** (`modules/protoforge-event-bus.js`): Legacy integration referencing `cascade-evolution-protocol` and `protoforge-prime-directive`. Appears abandoned.
4. **Simple Event Bus** (`simple-event-bus.js`): Minimal EventEmitter wrapper. Appears abandoned.
5. **EventBusWorker** (`workers/EventBusWorker.js`): Queue-based event processor registered in `workers/WorkerOrchestrator.js`.

**Recommended convergence action:**

1. Designate `lib/event-bus/EventBus` as the single logical event model.
2. Decide whether `event_bus_events` becomes the durable backing store for the Event Fabric (via an adapter) or a deprecated fan-out target.
3. Deprecate and archive `modules/protoforge-event-bus.js` and `simple-event-bus.js`.
4. Document the sync/ownership relationship explicitly before any commercial event wiring.

---

## 3. Ledger / financial tables

**Files involved:**

- `supabase/migrations/20260425104500_create_ledger_table.sql`
- `api/stripe-connect-webhook.js`
- `lib/dashboard/revenue-service.js`
- `api/mobile-status.js`
- `core/workers/stripe-billing-worker.js`
- `api/chat/route.js`
- `lib/health/collectors/database.ts`
- `supabase/functions/monthly-payout-calculation/index.ts`
- `supabase/functions/stream-health-watchdog/index.ts`
- Multiple test scripts (`test-galactic-bytes-payout.js`, `test-stripe-connect.js`, `test-critical-path.js`, etc.)
- `public/client-dashboard.html`
- `hydi-monitor-deploy/pages/client-dashboard.js`

**Issue:**

- "RAW LEDGER" is the immutable operational event history (pipeline layer 2).
- `ledger` is the financial transactions table.
- They share a name but are entirely different concepts.

**Collision:**

```sql
-- Financial transactions table
CREATE TABLE ledger (
    transaction_id uuid primary key,
    amount_gross numeric,
    platform_fee_amount numeric,
    net_amount numeric,
    status text
);
```

vs. RAW LEDGER concept in `modules/raw-event-ledger-v2.js`, `modules/raw-event-ledger.js`, and pipeline documentation.

**Code references:**

- 37 direct `.from('ledger')` calls across the codebase.
- No existing references to a `financial_ledger` name.

**Recommended convergence action:**

1. Rename the `ledger` table → `financial_ledger` via migration.
2. Update all 37 code references.
3. Update documentation to consistently use **RAW Ledger** (operational) and **Financial Ledger** (accounting).
4. Verify no external tooling (Stripe reconciliation scripts, BI queries, Edge Functions) references the old `ledger` name.

---

## 4. Revenue / billing implementations

**Files involved:**

- `api/revenue.js`
- `revenue-engine/index.js`, `revenue-engine/revenue-engine-v2.js`, `revenue-engine/schema.sql`, `revenue-engine/outcome-schema.sql`
- `apps/ursula-frontend/src/lib/revenue-engine/engine.ts`, `schema.sql`, `types.ts`, `storage.ts`
- `apps/ursula-frontend/src/app/api/revenue-engine/` (autopilot, deliveries, offers, sources, submissions, subscriptions routes)
- `lib/dashboard/revenue-service.js`
- `pages/api/revenue/` (cycle.js, index.js, leads.js, report.js)
- `core/workers/revenue-pipeline-worker.js`
- `workers/RevenueIngestionWorker.js`
- `supabase/functions/revenue-tracker/index.ts`
- `hydi-monetization-schema.sql`
- `src/services/subscription-manager.js`
- `src/revenue/HeidiRevenueEngine.js`

**Issue:**

Multiple independent revenue implementations with different schemas:

| Motion | Tables | Customer identity | Business model |
|---|---|---|---|
| Project motion | `leads`, `outreach`, `proposals`, `quotes`, `checkout_sessions` | `clients.client_id` (uuid) | One-off project fees |
| Subscription motion | `hydi_subscriptions`, `hydi_client_health_runs`, `hydi_schedules` | `client_id` (text) | Monthly tiered subscriptions |
| Autonomous revenue engine | `sources`, `submissions`, `offers`, `deliveries`, `products`, `subscriptions` | `user_id` (uuid) | Intake → offers → payment → fulfillment |

**Duplicate logic:**

- Stripe integration in at least 3 places: `api/stripe-connect-webhook.js`, `apps/ursula-frontend/src/app/api/stripe-webhook/route.ts`, `supabase/functions/stripe-webhook/index.ts`.
- Revenue aggregation in 2 places: `lib/dashboard/revenue-service.js` and `apps/ursula-frontend/src/lib/dashboard/services/revenue-service.ts`.
- Subscription management in `src/services/subscription-manager.js` and `apps/ursula-frontend/src/lib/revenue-engine/`.

**Recommended convergence action:**

1. Choose a canonical revenue schema (likely a merge of project and subscription motions).
2. Deprecate the autonomous revenue engine schema in `apps/ursula-frontend/src/lib/revenue-engine/`.
3. Consolidate Stripe webhook handlers into one canonical implementation.
4. Unify all revenue aggregation and subscription management into one service layer.

---

## 5. Dashboard implementations

**Files involved:**

- **Active:** `apps/ursula-frontend/src/app/dashboard/page.tsx`, `apps/ursula-frontend/src/components/dashboard/` (13 panel components), `apps/ursula-frontend/src/components/ui/operator-dashboard.tsx`, `apps/ursula-frontend/src/lib/dashboard/dashboard-context.tsx`
- **Dead/legacy:** `public/client-dashboard.html`, `public/life-flow-dashboard.html`, `public/protohub-dashboard.html`, `dashboard/client-view.html`, `hydi-monitor-deploy/pages/client-dashboard.js`
- **Archived:** `archive/ui/ursula-dashboard.html`, `archive/ui/ursula-dashboard-prod.html`, `archive/ui/ursula-dashboard-services.html`, `archive/ui/ursula-dashboard-enhanced.js`, `archive/ui/ursula-dashboard-config.js`, `archive/scripts/monitoring-dashboard.js`

**Issue:**

Multiple dashboard implementations exist across different eras of the codebase. The Next.js Unified Dashboard in `apps/ursula-frontend` is the active canonical implementation from Phase 3. The others are either static HTML, separate deployments, or archived historical versions.

**Recommended convergence action:**

1. Preserve `apps/ursula-frontend/src/app/dashboard/` and its components as canonical.
2. Delete `public/client-dashboard.html`, `public/life-flow-dashboard.html`, `public/protohub-dashboard.html`, and `dashboard/client-view.html`.
3. Delete `hydi-monitor-deploy/` if it is an obsolete separate deployment.
4. Keep `archive/` as historical reference.

---

## 6. Stripe webhook handlers

**Files involved:**

- `api/stripe-connect-webhook.js`
- `apps/ursula-frontend/src/app/api/stripe-webhook/route.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `api/webhooks/stripe.js`
- `src/webhook-handlers/stripe-webhook.js`

**Issue:**

Three different Stripe webhook handlers with overlapping logic:

- `api/stripe-connect-webhook.js` handles Connect events (`payment_intent.succeeded`, `payout.paid`, etc.) and writes directly to `ledger`.
- `apps/ursula-frontend/src/app/api/stripe-webhook/route.ts` handles `checkout.session.completed` and `payment_intent.succeeded`, uses Redis for idempotency, and creates tasks through the revenue engine.
- `supabase/functions/stripe-webhook/index.ts` handles subscriptions and writes to `keymaker_events`.

None of them publishes to `lib/event-bus/`. Financial events are invisible to CASCADE, KILO, ProtoForge, replay, and the dashboard Event Fabric.

**Recommended convergence action:**

1. Choose `api/stripe-connect-webhook.js` as the canonical Stripe webhook entry point (most complete fee-split and Connect logic).
2. Add an Ingress Adapter that publishes a `BusEvent` to the Event Fabric before/alongside the table write.
3. Deprecate the Next.js webhook handler and move any unique logic (Redis idempotency, task creation) into the canonical handler or projections.
4. Fix or deprecate the Edge Function handler; verify its table references (`customers`, `customer_services`) against the canonical schema.

---

## 7. Configuration duplication

**Files involved:**

- Root: `package.json`, `package-lock.json`, `next.config.js`
- `apps/ursula-frontend/`: `package.json`, `package-lock.json`, `next.config.ts`
- `heidi-core/`: `package.json`, `package-lock.json`
- `hydi-monitor-deploy/`: `package.json`, `package-lock.json`
- `hydi-npm/`: `package.json`, `package-lock.json`
- `keeper/`: `package.json`

**Issue:**

Multiple package.json files and lockfiles. The root and `apps/ursula-frontend` are both active but on different Next.js versions (15.5.19 vs 16.2.6). Other packages may be obsolete or standalone.

**Recommended convergence action:**

1. Keep root `package.json` as the monorepo root.
2. Keep `apps/ursula-frontend/package.json` as the active dashboard app.
3. Keep `heidi-core/` and `hydi-npm/` as standalone packages.
4. Remove `hydi-monitor-deploy/` if obsolete.
5. Document or consolidate the relationship between the two Next.js versions and the duplicate lockfiles.

---

## 8. Schema duplication

**Files involved:**

- `revenue-engine/schema.sql`
- `apps/ursula-frontend/src/lib/revenue-engine/schema.sql`
- `hydi-monetization-schema.sql`
- `supabase/migrations/20260430182441_revenue_engine_schema.sql`
- `revenue-engine/outcome-schema.sql`

**Issue:**

Three different revenue schemas with overlapping concepts but different table names and customer identity fields:

- Project motion: `leads`, `outreach`, `proposals`, `quotes`, `checkout_sessions`
- Autonomous motion: `sources`, `submissions`, `offers`, `deliveries`, `products`, `subscriptions`
- Subscription motion: `hydi_subscriptions`, `hydi_client_health_runs`, `hydi_schedules`

There is no migration path or documented ownership between them.

**Recommended convergence action:**

1. Choose a canonical revenue schema aligned with `COMMERCIAL_MODEL.md`.
2. Deprecate the autonomous revenue engine schema.
3. Create migrations that consolidate tables where concepts overlap.
4. Update all code references to use the canonical schema.

---

## 9. Service layer duplication

**Files involved:**

- `lib/dashboard/revenue-service.js` (174 lines, CommonJS)
- `apps/ursula-frontend/src/lib/dashboard/services/revenue-service.ts` (13 lines, TypeScript wrapper)

**Issue:**

Two revenue service implementations. The TypeScript wrapper adds minimal value and may rely on a monorepo alias (`@repo/lib/dashboard/revenue-service`) whose resolution should be verified.

**Recommended convergence action:**

1. Keep `lib/dashboard/revenue-service.js` as the canonical implementation or rewrite it in TypeScript.
2. Remove the thin TypeScript wrapper or merge it into the canonical service.
3. Ensure `api/client-dashboard.js` (the compatibility adapter) and the Unified Dashboard both consume the same service.

---

## 10. Projection architecture status

The projection engine described in `COMMERCIAL_MODEL.md` does not yet exist as explicit code. Phase 4 should implement it as:

```
External System (Stripe, ForgeFinder, marketplace, manual invoice)
        │
        ▼
Ingress Adapter (normalize to BusEvent)
        │
        ▼
Commercial Event
        │
        ▼
Event Fabric (lib/event-bus/EventBus + EventRecorder)
        │
        ├── Financial Ledger Projection  → financial_ledger
        ├── Customer Projection          → customers / clients view
        ├── Subscription Projection      → hydi_subscriptions + entitlements
        ├── Analytics Projection         → revenue dashboards, MRR views
        ├── Dashboard Projection         → Unified Dashboard panels
        └── Automation                   → billing retry, entitlement grants, alerts
```

No existing projection is disposable/rebuildable from replay. This is the target architecture for Phases 3–6 of the Phase 4 plan.

---

## Dead/unreferenced files (can likely be removed)

### Dashboard (dead)
- `public/client-dashboard.html`
- `public/life-flow-dashboard.html`
- `public/protohub-dashboard.html`
- `dashboard/client-view.html`
- `hydi-monitor-deploy/` (entire folder, if obsolete separate deployment)

### Archive (keep for reference)
- `archive/ui/ursula-dashboard.html`
- `archive/ui/ursula-dashboard-prod.html`
- `archive/ui/ursula-dashboard-services.html`
- `archive/ui/ursula-dashboard-enhanced.js`
- `archive/ui/ursula-dashboard-config.js`
- `archive/scripts/monitoring-dashboard.js`

### Event bus (deprecated)
- `modules/protoforge-event-bus.js`
- `simple-event-bus.js`

### Heidi Core startup scripts (redundant)
- `heidi-core/Start-Heidi*.ps1`
- `heidi-core/Test-Heidi*.ps1`

### Root-level test scripts (obsolete or one-off)
- `test-galactic-bytes-payout.js`
- `test-stripe-connect.js`
- `test_payout_flow.js`
- `test-critical-path.js`

> These should be verified for references before deletion. Any script still used in CI or documentation should be migrated, not deleted.

---

## Active canonical files (preserve and extend)

### Core pipeline and Event Fabric
- `lib/event-bus/EventBus.ts`
- `lib/event-bus/index.ts`
- `lib/event-bus/types.ts`
- `lib/event-bus/recorder.ts`
- `lib/event-bus/context.ts`
- `modules/raw-event-ledger-v2.js`
- `modules/cascade-classifier-v2.js`
- `kilo/index.js`
- `lib/protoforge/policy-engine.js`

### Revenue (to be converged)
- `api/stripe-connect-webhook.js`
- `api/revenue.js`
- `revenue-engine/schema.sql`
- `hydi-monetization-schema.sql`
- `lib/dashboard/revenue-service.js`

### Dashboard (canonical)
- `apps/ursula-frontend/src/app/dashboard/page.tsx`
- `apps/ursula-frontend/src/components/dashboard/`
- `apps/ursula-frontend/src/components/ui/operator-dashboard.tsx`
- `apps/ursula-frontend/src/lib/dashboard/dashboard-context.tsx`
- `apps/ursula-frontend/src/app/api/events/stream/route.ts`
- `apps/ursula-frontend/src/app/api/events/recent/route.ts`

### Workers
- `workers/WorkerOrchestrator.js`
- `workers/EventBusWorker.js`
- `workers/RevenueIngestionWorker.js`
- `workers/DecisionAssistWorker.js`

### Key migrations
- `supabase/migrations/20260425105500_create_clients_table.sql`
- `supabase/migrations/20260425104500_create_ledger_table.sql`
- `supabase/migrations/20260424145243_hydi_monetization.sql`
- `supabase/migrations/20260707151854_local_baseline_missing_core_objects.sql`

---

## Recommended convergence priority

### Phase 1 — Critical blockers (before any commercial work)
1. **Customer identity unification** — create `customers` table, migrate `clients` and `hydi_subscriptions`.
2. **Event system decision** — designate `lib/event-bus/` as canonical; define `event_bus_events` relationship.
3. **Ledger rename** — `ledger` → `financial_ledger`.

### Phase 2 — High priority
4. **Stripe webhook consolidation** — single canonical handler with Event Fabric integration.
5. **Revenue schema convergence** — choose canonical schema; deprecate duplicates.
6. **Dashboard cleanup** — remove dead dashboard files.

### Phase 3 — Medium priority
7. **Service layer consolidation** — remove or merge duplicate revenue service.
8. **Configuration cleanup** — remove obsolete package configs and lockfiles.
9. **Dead code removal** — deprecate legacy event bus files and obsolete scripts.

---

## Phase 2 — Customer Identity Convergence (implemented)

### Decisions

- `customers` is the canonical identity table. `customer_id` is a UUID primary key.
- `clients` becomes a project-account table that references `customers.customer_id`.
- `hydi_subscriptions`, `hydi_client_health_runs`, `hydi_schedules`, and `payouts` all gained a `customer_id` foreign key to `customers`.
- Legacy `client_id` columns were preserved; no code paths were broken.
- `stripe_customer_id` and future marketplace IDs remain external-reference columns only.

### Artifacts

| File | Purpose |
|---|---|
| `supabase/migrations/20260722000001_customer_identity_convergence.sql` | Creates `customers`, seeds it from `clients` and `hydi_subscriptions`, adds `customer_id` columns/FKs/indexes/RLS. |
| `supabase/rollbacks/20260722000001_customer_identity_convergence_rollback.sql` | Removes `customers` and all `customer_id` columns (destructive — emergency use only). |
| `tests/migrations/20260722000001.test.js` | Governance gate test for the migration. |
| `lib/customers/customer-service.ts` | Canonical service for creating and resolving customers by id, email, or Stripe customer id. |
| `tests/unit/customer-service.test.ts` | Unit tests for the customer service. |

### Remaining code migration

Edge Functions and API routes that currently read `clients.client_id` directly (`supabase/functions/stripe-connect-admin/index.ts`, `supabase/functions/stripe-webhook/index.ts`, `supabase/functions/monthly-payout-calculation/index.ts`, etc.) should be migrated to join through `customers` as part of Phase 6/7 revenue-path consolidation, not as one-off edits. The schema now supports the canonical identity; the code migration will be systematic.

---

## Phase 3 — Event Fabric Convergence (in progress)

### Decisions

- `lib/event-bus/EventBus` is the canonical logical event system.
- Every `BusEvent` now carries `version`, `source`, `correlationId`, `causationId`, and `traceId`.
- `validateBusEvent` rejects malformed events before they enter the bus.
- The EventRecorder backfills missing `version`/`source` for older NDJSON records.
- `lib/commercial/ingress-adapter.ts` is the single ingress point for Stripe commercial events.
- `apps/ursula-frontend/src/app/api/stripe-webhook/route.ts` now publishes `payment.received` events into the Event Fabric before creating tasks/offers.

### Artifacts

| File | Purpose |
|---|---|
| `lib/event-bus/validation.ts` | `validateBusEvent` — schema validation with detailed error reporting. |
| `tests/unit/event-bus-validation.test.ts` | Tests for event validation. |
| `lib/commercial/ingress-adapter.ts` | Normalizes Stripe webhooks into canonical `BusEvent` objects and publishes them. |
| `tests/unit/commercial-ingress-adapter.test.ts` | Tests for Stripe event adaptation and commercial event publishing. |
| `lib/event-bus/EventBus.ts` | Now injects `version`/`source` defaults and validates every published event. |
| `lib/event-bus/recorder.ts` | Backfills `version`/`source` when rehydrating old NDJSON logs. |
| `apps/ursula-frontend/src/app/api/events/stream/route.ts` | Forwards `version` field in SSE payloads. |
| `apps/ursula-frontend/src/app/api/stripe-webhook/route.ts` | Publishes commercial events to the Event Fabric. |

### Remaining work

- `api/stripe-connect-webhook.js` now routes recognized Stripe events through `lib/commercial/ingress-adapter` before table writes. `supabase/functions/stripe-webhook/index.ts`, `billing-engine`, `billing-retry-worker`, and direct SQL consumers of `event_bus_events` will be consolidated in Phase 6.
- `event_bus_events` (Postgres) is the durable fan-out projection/queue of the Event Fabric. It is not a separate logical bus and must not be written to directly by new code; writers should publish to the Event Fabric and let a projection adapter fan out to Postgres. Existing direct writes in Edge Functions and SQL are legacy and will be migrated in Phase 6.
- Legacy event buses (`modules/protoforge-event-bus.js`, `simple-event-bus.js`) should be deprecated and removed.

---

## Files added by this audit

- `ARCHITECTURE_AUDIT.md` (this file)
- `COMMERCIAL_MODEL.md` (Phase 4 commercial domain model)
