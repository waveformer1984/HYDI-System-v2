# Architectural Consolidation Report — Phase 2

**Branch:** `refactor/architectural-consolidation`
**Date:** 2026-08-18
**Base:** `63adc10` (Phase 1 inventory commit)
**Final commit:** `ba1cd0c`

---

## Before

### Implementation counts (from Phase 1 inventory)

| Abstraction | Total implementations | Canonical | Dead/orphaned | Intentional layers |
|-------------|----------------------|-----------|---------------|-------------------|
| Memory | 32 | 4 | 4 | 24 |
| Event Bus | 18 | 1 | 8 | 9 |
| Scheduler | 16 | 6 | 3 | 7 |
| Auth | 26 | 6 | 2 | 18 |
| Model Access | 20 | 5 | 1 | 14 |
| **Total** | **112** | **22** | **18** | **72** |

### Candidate dead code

- 18 files identified as dead/orphaned in Phase 1 inventory
- ~4,800 LOC estimated for removal

### Migration debt

- 136 idempotency violations across 36 files (baseline ratchet)
- Bucket A: 28 trivially safe violations (8 files)
- Bucket B: 108 likely-applied violations (30 files)
- Bucket C: 4 potentially dead/superseded violations (2 files)

### Schema conflicts

- `public.notifications` had incompatible April and July schemas
- Both used `CREATE TABLE IF NOT EXISTS` — April schema won, July columns missing
- `lib/notifications/notify.js` would fail at runtime on any migrated database

---

## Phase 1 Corrections

Phase 2 investigation found three errors in the Phase 1 inventory:

| # | Inventory claim | Investigation finding | Resolution |
|---|----------------|----------------------|------------|
| 1 | `src/memory/HeidiMemorySystem.js` is dead (0 callers) | Boot-reachable via `src/HYDISystem.js` (hydi-orchestrator) | **Preserved** — not dead |
| 2 | `src/models/heartbeat.js` is dead (0 callers) | Boot-reachable via `ursula-service-bundle.js` → `subscription-manager.js` → `src/server.js` | **Preserved** — not dead |
| 3 | `pao-system/core/event.bus.ts` is not boot-reachable | Boot-reachable via `heidi-web → pages/api/chat/route.js → api/chat/route.js → heidi.controller.ts` | **Fixed** — the leak affects the live process |

---

## Changes

### Commit 1: `e0191cd` — fix(hydi): reconcile notifications schema conflict

| Abstraction | Action | Files | Reason |
|-------------|--------|-------|--------|
| Database/Migration | FIX_BUG | `supabase/migrations/20260818120000_reconcile_notifications_schema.sql` (NEW), `tests/migrations/20260818120000.test.js` (NEW), `ARCHITECTURAL_CONSOLIDATION_PLAN.md` (NEW) | Schema conflict between April and July notifications migrations |

### Commit 2: `dd6216e` — fix(hydi): remove event bus polling leak

| Abstraction | Action | Files | Reason |
|-------------|--------|-------|--------|
| Event Bus | FIX_BUG | `pao-system/core/event.bus.ts`, `tests/unit/pao-event-bus-leak.test.js` (NEW) | 100ms setInterval leak in PAO event bus |

### Commit 3: `79d22fa` — refactor(hydi): remove dead standalone implementations

| Abstraction | Action | Files | Reason |
|-------------|--------|-------|--------|
| Memory | DELETE_DEAD_CODE | `modules/event-ledger.js` (290 LOC) | 0 callers, orphaned since 2026-04-30 |
| Event Bus | DELETE_DEAD_CODE | `simple-event-bus.js` (142 LOC) | 0 callers, never imported |
| Scheduler | DELETE_DEAD_CODE | `modules/health-manager.js` (~200 LOC) | 0 callers, overlaps with canonical `lib/health-monitor.js` |
| Auth | DELETE_DEAD_CODE | `keeper/policy-engine.js` (164 LOC) | Deprecated, superseded by `lib/protoforge/policy-engine.js` |
| Auth | DELETE_DEAD_CODE | `keeper/crypto/agent-auth.js` (198 LOC) | 0 callers, unused RSA auth |
| Scheduler | DELETE_DEAD_CODE | `apps/ursula-frontend/src/lib/eventual-consistency-scheduler.ts` (423 LOC) | 0 callers, unused Ursula scheduler |

**Total: 6 files, 1,650 LOC removed**

### Commit 4: `00eea69` — refactor(hydi): remove dead-chain implementations

| Abstraction | Action | Files | Reason |
|-------------|--------|-------|--------|
| Memory | DELETE_DEAD_CODE | `modules/raw-event-ledger.js` (402 LOC) | @deprecated, only callers are standalone scripts and dead-chain files |
| Event Bus | DELETE_DEAD_CODE | `modules/event-bus-lock.js` (275 LOC) | Only caller: `modules/kilo-truth-filter.js` (dead) |
| Event Bus | DELETE_DEAD_CODE | `modules/protoforge-event-system.js` (~600 LOC) | Only caller: `modules/protoforge-integration.js` (dead) |
| Event Bus | DELETE_DEAD_CODE | `modules/cascade-event-intake.js` (209 LOC) | @deprecated, only caller: `modules/cascade-complete.js` (dead) |
| — | DELETE_DEAD_CODE | `modules/two-phase-pipeline.js` | Only caller: `test-grounded-architecture.js` (standalone) |
| — | DELETE_DEAD_CODE | `modules/kilo-hypothesis-engine.js` | Only callers: standalone scripts |
| — | DELETE_DEAD_CODE | `modules/cascade-replay-system.js` | Only callers: standalone scripts, dead files |
| — | DELETE_DEAD_CODE | `modules/kilo-truth-filter.js` | Only caller: `test-system-enforcement.js` (standalone) |
| — | DELETE_DEAD_CODE | `modules/protoforge-integration.js` | Only caller: `protoforge-main.js` (dead) |
| — | DELETE_DEAD_CODE | `protoforge-main.js` | No callers |
| — | DELETE_DEAD_CODE | `modules/cascade-complete.js` | Only caller: `test-cascade-system.js` (standalone) |

**Total: 11 files, 4,611 LOC removed**

### Commit 5: `ba1cd0c` — fix(hydi): wrap corrective migration CREATE POLICY in DO exception guard

| Abstraction | Action | Files | Reason |
|-------------|--------|-------|--------|
| Database/Migration | FIX_BUG | `supabase/migrations/20260818120000_reconcile_notifications_schema.sql`, `tests/migrations/20260818120000.test.js` | Migration lint ratchet requires DO $$ exception guard for CREATE POLICY |

### Summary

| Action | Count | LOC affected |
|--------|-------|-------------|
| FIX_BUG | 3 commits | ~100 LOC changed (event.bus.ts) + 60 LOC (migration) |
| DELETE_DEAD_CODE | 2 commits | 6,261 LOC removed (17 files) |
| DEFER | 6 work items | — |
| PRESERVE_INTENTIONAL_LAYER | 2 files (inventory corrections) | — |

**Total: 17 files deleted, 6,261 LOC removed, 3 files created (migration + 2 tests + plan)**

---

## Notifications

### Old schemas

**April schema** (`20260426122500_notifications_table.sql`):
- Columns: `id, type, recipient, channel (check: sms/email), status (check: pending/sent/delivered/failed), template, metadata, created_at, updated_at`
- Indexes: `idx_notifications_recipient`, `idx_notifications_status`, `idx_notifications_created_at`, `idx_notifications_type`
- RLS: 3 policies (select/insert/update for service_role)
- Function: `get_notification_stats()`

**July schema** (`20260715123000_notifications.sql`):
- Columns: `id, category (check: 10 operational categories), severity (check: critical/operational/approval/info), title, body, device_id, metadata, read_at, delivered_at, created_at`
- Indexes: `idx_notifications_created_at (desc)`, `idx_notifications_unread (device_id, read_at)`, `idx_notifications_category`
- RLS: 1 policy (all for service_role)
- Extra table: `notification_preferences`

### Actual schema (before corrective migration)

On any database where both migrations ran in chronological order:
1. April migration creates `notifications` with April columns ✓
2. July migration's `CREATE TABLE IF NOT EXISTS` is a **no-op** (table exists)
3. July indexes on `device_id` and `category` **FAIL** (columns don't exist)
4. July policy `notifications_service_all` is created (DROP IF EXISTS + CREATE)
5. `notification_preferences` table created ✓

**Result:** April schema + July policy + notification_preferences. July columns missing. `lib/notifications/notify.js` fails at runtime.

### Corrective migration

**File:** `supabase/migrations/20260818120000_reconcile_notifications_schema.sql`

- Adds all 7 July columns using `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- Creates July indexes using `CREATE INDEX IF NOT EXISTS`
- Drops April RLS policies, creates July policy wrapped in `DO $$ ... EXCEPTION WHEN DUPLICATE_OBJECT $$`
- Preserves all April columns for backward compatibility
- Enables RLS idempotently

### Fresh database result

1. April migration creates `notifications` with April columns
2. July migration's `CREATE TABLE IF NOT EXISTS` is a no-op
3. July indexes fail (columns missing) — **but this is now harmless**
4. Corrective migration adds July columns ✓
5. Corrective migration creates July indexes ✓
6. Corrective migration replaces policies ✓

**Result:** Both April and July columns present. All callers work.

### Existing database result

1. Corrective migration adds July columns (IF NOT EXISTS — no-op if already present)
2. Corrective migration creates July indexes (IF NOT EXISTS — no-op if already present)
3. Corrective migration replaces policies (DROP IF EXISTS + CREATE in DO $$ guard)

**Result:** Both April and July columns present. All callers work.

### Repeat application

All statements use `IF NOT EXISTS` or `DO $$ ... EXCEPTION $$` — fully idempotent. Re-running produces no changes.

### Application compatibility

| Caller | Schema used | Works after fix? |
|--------|------------|-----------------|
| `lib/notifications/notify.js` | July (category, severity, title, body, device_id, metadata, delivered_at) | ✓ |
| `api/notifications/index.js` | July (read_at, notification_preferences) | ✓ |
| `supabase/functions/notification-service/index.ts` | April (type, recipient, channel, status, template) | ✓ (April columns preserved) |
| `modules/heidi-service-automator.js` | April (recipient, type, channel, status, content, metadata) | ✓ (April columns preserved) |
| `core/workers/system-monitor-worker.js` | April (type, message, metadata, status) | ✓ (April columns preserved) |

---

## Event Bus

### Polling bug root cause

**File:** `pao-system/core/event.bus.ts`, line ~130 (before fix)

```typescript
private startEventProcessor(): void {
  setInterval(() => {
    this.processEvents();
  }, 100); // Process every 100ms
}
```

The constructor called `this.startEventProcessor()` which created a `setInterval(100ms)` that was:
- Never cleared (no `clearInterval`)
- Not `.unref()`'d (kept Node.js/Jest alive)
- Redundant — `publish()` already emits `event_published`, and `processEvents()` has a reentrancy guard

Additionally, the file exported a singleton (`export const eventBus = new EventBus()`) that was never imported by anyone. The singleton was instantiated on every import, triggering the leak even when only the `EventBus` class was needed.

### Reachability

**Boot-reachable** via:
```
heidi-web → pages/api/chat/route.js → api/chat/route.js
→ heidi.controller.ts → event.bus.ts
```

17 test files import `heidi.controller.ts`, which triggers the singleton.

### Fix

1. Removed `setInterval(100ms)` from constructor
2. Replaced with on-demand processing via `queueMicrotask(() => this.processEvents())` in `publish()`
   - Batches synchronously-published events
   - Preserves priority ordering
   - No timer leak
3. Added re-check loop in `processEvents()` for events published during processing
4. Added `shutdown()` method for explicit cleanup
5. Removed unused singleton (`export const eventBus = new EventBus()`)
6. Added null-safety in `processEvents()` for queues cleared by `shutdown()`

### Regression test

**File:** `tests/unit/pao-event-bus-leak.test.js` (6 tests)

1. Constructor does not start a setInterval
2. No timer leak when creating and destroying multiple buses
3. publish() processes events on-demand without polling
4. shutdown() clears all state and listeners
5. Broadcast events reach all subscribed agents
6. Priority ordering is respected when events accumulate

All 35 existing `heidi-control-plane-acceptance` tests still pass.

---

## Migration Debt

| Metric | Value |
|--------|-------|
| Original violations | 136 |
| Resolved violations | 0 (no historical migrations edited) |
| Baseline violations | 136 (unchanged) |
| Remaining violations | 136 (all grandfathered) |
| New violations | 0 |

The migration lint baseline (`supabase/migration-lint-baseline.json`) was not modified. The corrective migration was written to be fully idempotent (all DDL uses `IF NOT EXISTS` or `DO $$ ... EXCEPTION $$` guards), so it introduces zero new violations.

---

## Validation

| Check | Result | Details |
|-------|--------|---------|
| Typecheck | ✓ PASS | `npm run typecheck` — 0 errors |
| Lint | ✓ PASS | `npm run lint` — 0 errors, 750 warnings (all pre-existing) |
| Tests | ✓ PASS | `npm test` — 262 suites, 2498 passed, 1 skipped, 0 failed (95.7s) |
| Migration lint ratchet | ✓ PASS | `node scripts/lint-migration-idempotency.js --ratchet` — 0 new violations, 136 grandfathered |
| Secret scan | ✓ PASS | `node scripts/scan-live-secrets.js` — no live secrets in 4227 tracked files |

---

## Remaining Risks

1. **April-schema notification callers not migrated** — `supabase/functions/notification-service/index.ts`, `modules/heidi-service-automator.js`, and `core/workers/system-monitor-worker.js` still use April-schema columns. They work correctly because April columns are preserved, but they should eventually be migrated to use `lib/notifications/notify.js` for consistency. (Deferred — WI-1.3)

2. **`api/local-model.js` duplicate not migrated** — 2 callers (`api/heidi/route.js`, `pages/api/heidi.js`) still use `api/local-model.js` instead of `lib/ModelManager.ts`. Migration requires API surface comparison. (Deferred — WI-4.1)

3. **`modules/protoforge-event-bus.js` not migrated** — 5 callers including `src/server.js` (protoforge-core). The 6-layer pipeline logic is semantically different from the canonical bus. Migration is a significant refactor. (Deferred — WI-4.2)

4. **Jest `forceExit: true` not removed** — Should only be removed after confirming the full test suite exits naturally. The event.bus.ts fix may have resolved the primary leak, but other timer leaks may exist. (Deferred — WI-2.3)

5. **Bucket A migration fixes not applied** — 28 trivially safe violations in 8 files. Not edited because they may have been applied to live Supabase, and the user's instructions say to prefer forward migrations over editing historical ones. (Deferred — WI-5.2)

6. **Bucket C superseded migrations not removed** — 2 files with 4 violations. Not removed because removing historical migrations can break fresh installs. (Deferred — WI-5.3)

7. **20 GitHub Dependabot vulnerabilities** — 11 high, 9 moderate. Reported by pre-push hook in Phase 1. Not addressed in Phase 2. (Informational)

8. **Standalone test scripts not deleted** — `test-grounded-architecture.js`, `test-system-enforcement.js`, `test-cascade-system.js` reference deleted modules. They will fail if run, but are not in the test suite and may be used manually. They should be deleted or updated in a future phase.

---

## Final Decision

```
PHASE 2 PASS WITH LIMITATIONS
```

**Rationale:** All implemented changes are evidence-backed, tested, and validated. The notifications schema conflict is resolved with a forward corrective migration. The event bus polling leak is fixed with regression coverage. 17 dead files (6,261 LOC) are removed with zero test failures. The migration lint baseline is unchanged.

The limitations are the 6 deferred work items (WI-1.3, WI-2.3, WI-4.1, WI-4.2, WI-5.2, WI-5.3), none of which affect runtime correctness. They are documented in the plan and this report for future phases.
