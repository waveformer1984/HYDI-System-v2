# HYDI V1 Master Plan

**Status:** Reconciled — 2026-07-23  
**Source of truth:** Repository state, verified tests, and git history on branch `feature/hydi-v3-mission-omega`.

This document reflects what is actually implemented. It does not include speculative or obsolete implementation instructions.

---

## 1. V1 Foundation — Complete

The following foundational work is implemented and verified. No further changes are required for V1.

### 1.1 Customer Identity Unification
- **Delivered:**
  - `001_core_schema.sql` — `public.customers` table, `customer_services` identity columns, `revenue_tracking` identity columns, `webhook_events` table.
  - `002_backfill.sql` — Backfills `customers` from existing `customer_services` and `revenue_tracking` emails.
  - `003_constraints.sql` — Foreign keys, uniqueness, and safe NOT NULL enforcement.
  - `004_triggers_rls.sql` — `updated_at` triggers and Row Level Security for identity tables.
  - `005_indexes_concurrent.sql` — Performance indexes including case-insensitive email uniqueness.
- **Verification:** Migration tests in `tests/migrations/` cover these changes.

### 1.2 `customers` Table Migration
- **Status:** Complete.
- **Artifact:** `001_core_schema.sql` lines 24-30.

### 1.3 `financial_ledger` Migration
- **Status:** Complete as the `ledger` table plus supporting clients/payouts schema.
- **Artifacts:**
  - `supabase/migrations/20260425104500_create_ledger_table.sql`
  - `supabase/migrations/20260425105500_create_clients_table.sql`
  - `supabase/migrations/20260425110000_create_payouts_table.sql`
  - `supabase/migrations/20260425110500_alter_ledger_table.sql`
  - `supabase/migrations/20260425111000_create_generate_monthly_payouts_function.sql`
  - `supabase/migrations/20260425111500_create_process_payout_function.sql`
  - `supabase/migrations/20260425112000_alter_ledger_add_project_name.sql`
  - `supabase/migrations/20260425161640_add_stripe_connect_subaccount_support.sql`

### 1.4 Compatibility View
- **Status:** Frozen / de-scoped for V1.
- **Rationale:** No compatibility view artifact exists in the repository. Per the V1 freeze directive, this will not be recreated.

### 1.5 Event Fabric Bridge
- **Status:** Frozen / de-scoped for V1.
- **Rationale:** No Event Fabric bridge artifact exists in the repository. Per the V1 freeze directive, this will not be recreated.

### 1.6 Associated Database Changes
- **Status:** Complete.
- Includes Stripe webhook/support tables, chat operator schema, notification tables, billing retry cron, and migration test coverage through `tests/migrations/`.

---

## 2. Current Branch State

- **Active branch:** `feature/hydi-v3-mission-omega`
- **Committed baseline ahead of `main`:** HYDI V3 Reliability & Autonomy Upgrade.
- **Uncommitted changes:** V3 reliability modules, V4 Evolution Engine / kernel subsystem (NEXUS), self-improvement APIs, telemetry/analysis/recommendation modules, manifests, and documentation.

---

## 3. Remaining Production Work (V1 Exit Criteria)

Do not begin Workstream 2 until all items below are closed.

### 3.1 Merge Verified V3 Reliability & Autonomy Fixes
- Files to protect (verified: TypeScript passes, tests pass, lint clean of errors):
  - `package.json`
  - `tsconfig.typecheck.json`
  - `scripts/soak-test.js`
  - `src/actions/HeidiActionLayer.js`
  - `src/memory/HeidiMemorySystem.js`
  - `src/hydi-v3/AutonomyManager.js`
  - `src/hydi-v3/DistributedCompute.js`
  - `src/hydi-v3/ObservabilityDashboard.js`
  - `src/hydi-v3/PerformanceBenchmark.js`
  - `src/hydi-v3/SecurityAuditor.js`
  - `src/hydi-v3/index.js`
  - `tests/unit/hydi-v3/DistributedCompute.test.js`
  - `tests/unit/hydi-v3/ObservabilityDashboard.test.js`
  - `tests/unit/hydi-v3/PerformanceBenchmark.test.js`
  - `tests/unit/hydi-v3/SecurityAuditor.test.js`
- Action: stage as a dedicated commit; do not include NEXUS kernel, RuntimeCoordinator, Scheduler, unrelated docs, or experimental modules.

### 3.2 Resolve Build Failure
- **Blocker:** `pages/api/self-improvement/orchestrate.js` imports `ImprovementManager` but the file is named `Improvement Manager.js`.
- **Action:** Rename the file or fix the import as part of NEXUS reconciliation (not the protected V1 commit).

### 3.3 Reconcile NEXUS Work
- **Artifacts:** `src/hydi-v4/`, `src/analysis/`, `src/recommendations/`, `src/telemetry/`, `pages/api/self-improvement/`, `pages/api/analysis/`, `pages/api/metrics/`, `pages/api/recommendations/`, `manifests/`, `supabase/migrations/2026062700000{1-4}_heidi_*_foundation.sql`.
- **Action:** Use `NEXUS_RECONCILIATION_REPORT.md` to classify each file as KEEP / SUPERSEDED / CONFLICTING / DELETE before any merge.
- **Outcome:** A clean NEXUS branch ready for future merge, isolated from V1 production work.

### 3.4 Dependency Security Baseline
- **Current state:** 10 npm advisories (1 critical, 7 high, 2 low), all with available fixes.
- **Action:** Update `next`, `sharp`, `tar`, and `undici` to patched versions; run the full validation gate before considering the baseline green.

### 3.5 Reduce Remaining ESLint Warnings
- **Current state:** 0 errors, 10 warnings in `src/hydi-v3/` GPU/model files and `scripts/production-readiness-score.js`.
- **Action:** Address unused-variable warnings after the protected commit.

### 3.6 Documentation Cleanup
- **Action:** Remove or archive outdated root-level READMEs and experimental scripts that duplicate `src/hydi-v3/` / `src/hydi-v4/` functionality.

### 3.7 Open Handle Cleanup
- **Observation:** Jest exits with a force-exited worker warning, indicating at least one retained timer or handle.
- **Action:** Audit remaining `setInterval` / `setTimeout` instances and ensure all are unreferenced or stopped during teardown.

---

## 4. Out of Scope for V1

The following are recognized as active workstreams but will not be merged into V1 production:

- HYDI V4 Evolution Engine kernel (`src/hydi-v4/`)
- NEXUS / RuntimeCoordinator / Scheduler modules
- Self-improvement API surface (`pages/api/self-improvement/`)
- V4 telemetry, analysis, and recommendation foundations
- Experimental root-level scripts and ad-hoc test files

---

## 5. Definition of V1 Complete

V1 is complete when:

1. `HYDI_V1_MASTER_PLAN.md` reflects repository reality (this document).
2. The verified V3 reliability fixes are committed as a dedicated, isolated commit.
3. NEXUS reconciliation report is approved and NEXUS files remain isolated.
4. `npm run typecheck`, `npm test`, and `npm run lint` pass with zero errors.
5. `npm run build` passes.
6. `npm audit` reports zero critical/high vulnerabilities.
7. Remaining ESLint warnings are reduced.
8. Open Jest handle warnings are resolved.

---

**Review cadence:** Reconcile this plan against the repository before every new workstream.
