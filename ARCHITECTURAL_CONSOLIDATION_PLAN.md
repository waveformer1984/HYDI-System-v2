# Architectural Consolidation Plan — Phase 2

**Branch:** `refactor/architectural-consolidation`
**Date:** 2026-08-18
**Based on:** `ARCHITECTURAL_INVENTORY.md` (Phase 1) + Phase 2 investigation

---

## Phase 1 Corrections

Phase 2 investigation found three errors in the Phase 1 inventory:

| # | Inventory claim | Investigation finding | Impact |
|---|----------------|----------------------|--------|
| 1 | `src/memory/HeidiMemorySystem.js` is dead (0 callers) | Imported by `src/HYDISystem.js` (hydi-orchestrator boot module) and `src/core/HeidiCoreLoop.js` | **NOT dead — boot-reachable. Do NOT delete.** |
| 2 | `src/models/heartbeat.js` is dead (0 callers) | Imported by `modules/ursula-service-bundle.js` → `src/services/subscription-manager.js` → `src/server.js` (protoforge-core) | **NOT dead — boot-reachable. Do NOT delete.** |
| 3 | `pao-system/core/event.bus.ts` is not boot-reachable | Boot-reachable via: `heidi-web → pages/api/chat/route.js → api/chat/route.js → heidi.controller.ts → event.bus.ts` | **Boot-reachable. The setInterval leak affects the live heidi-web process, not just tests.** |

---

## Work Items

### Priority 1: Notifications Schema Conflict

#### WI-1.1: Create corrective forward migration

| Field | Value |
|-------|-------|
| **Classification** | FIX_BUG |
| **Abstraction** | Database/Migration |
| **File** | `supabase/migrations/20260818120000_reconcile_notifications_schema.sql` (NEW) |
| **Current role** | No file yet — creating new forward migration |
| **Proposed canonical** | July schema (category, severity, title, body, device_id, metadata, read_at, delivered_at) |
| **Callers** | `lib/notifications/notify.js` (July schema), `api/notifications/index.js` (July schema), `supabase/functions/notification-service/index.ts` (April schema), `modules/heidi-service-automator.js` (April schema), `core/workers/system-monitor-worker.js` (April schema) |
| **Runtime reachability** | Both schemas are boot-reachable |
| **Test coverage** | New test in `tests/migrations/20260818120000.test.js` |
| **Dependency impact** | Additive — adds July columns if missing, keeps April columns for backward compat |
| **Migration strategy** | Forward-only. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for July columns. `CREATE INDEX IF NOT EXISTS` for July indexes. Drop April policies, create July policy. |
| **Deletion criteria** | N/A (new file) |
| **Rollback strategy** | `ALTER TABLE ... DROP COLUMN IF EXISTS` for July columns (if needed) |
| **Risk** | Low — additive ALTER TABLE is safe for existing and fresh databases |
| **Validation** | `npm test -- tests/migrations/20260818120000.test.js` |

**Schema comparison:**

| Aspect | April schema (20260426122500) | July schema (20260715123000) |
|--------|-------------------------------|-------------------------------|
| Columns | id, type, recipient, channel, status, template, metadata, created_at, updated_at | id, category, severity, title, body, device_id, metadata, read_at, delivered_at, created_at |
| Types | text, text, text(check), text(check), text, jsonb, timestamptz, timestamptz | text(check), text(check), text, text, text, jsonb, timestamptz, timestamptz, timestamptz |
| Indexes | idx_notifications_recipient, idx_notifications_status, idx_notifications_created_at, idx_notifications_type | idx_notifications_created_at(desc), idx_notifications_unread, idx_notifications_category |
| RLS | 3 policies (select/insert/update for service_role) | 1 policy (all for service_role) |
| Extra | `get_notification_stats()` function | `notification_preferences` table |

**What happens on a fresh database today:**
1. April migration creates `notifications` with April columns ✓
2. July migration's `CREATE TABLE IF NOT EXISTS` is a **no-op** (table exists)
3. July migration's `CREATE INDEX idx_notifications_unread ON notifications(device_id, read_at)` **FAILS** — `device_id` column doesn't exist
4. July migration's `CREATE INDEX idx_notifications_category ON notifications(category)` **FAILS** — `category` column doesn't exist
5. July migration's `DROP POLICY IF EXISTS "notifications_service_all"` succeeds (no-op)
6. July migration's `CREATE POLICY "notifications_service_all"` succeeds
7. `notification_preferences` table created ✓

**Result:** Fresh databases have April schema + July policy + notification_preferences. July indexes are missing. `lib/notifications/notify.js` fails at runtime (inserts `category` which doesn't exist).

**Corrective migration approach:**
```sql
-- Add July columns if they don't exist (safe for both April-schema and July-schema databases)
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS severity text DEFAULT 'info';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- Add constraints only if they don't exist (use DO $$ blocks)
-- Add July indexes
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications (device_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_category ON public.notifications (category);

-- Replace April policies with July policy
DROP POLICY IF EXISTS "notifications_select_service_role" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_service_role" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_service_role" ON public.notifications;
DROP POLICY IF EXISTS "notifications_service_all" ON public.notifications;
CREATE POLICY "notifications_service_all" ON public.notifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**April-schema callers to migrate (WI-1.2):**
- `supabase/functions/notification-service/index.ts` — uses type, recipient, channel, status, template
- `modules/heidi-service-automator.js` — uses recipient, type, channel, status, content, metadata
- `core/workers/system-monitor-worker.js` — uses type, message, metadata, status

These callers will continue to work after the corrective migration because the April columns are preserved. Migration of callers to the July schema is deferred (see WI-1.3).

#### WI-1.2: Add notifications schema verification test

| Field | Value |
|-------|-------|
| **Classification** | FIX_BUG |
| **File** | `tests/migrations/20260818120000.test.js` (NEW) |
| **Validation** | Verifies that after the corrective migration, the notifications table has both April and July columns, July indexes exist, and July policy is active |
| **Risk** | None — test only |

#### WI-1.3: Migrate April-schema callers to July schema (DEFER)

| Field | Value |
|-------|-------|
| **Classification** | DEFER |
| **Files** | `supabase/functions/notification-service/index.ts`, `modules/heidi-service-automator.js`, `core/workers/system-monitor-worker.js` |
| **Reason for deferral** | These callers work correctly after the corrective migration because April columns are preserved. Migrating them to use `lib/notifications/notify.js` is a code change that should be done separately and tested thoroughly. |
| **Risk** | Medium — changing notification insert logic in active code |

---

### Priority 2: Event Bus 100ms Polling Bug

#### WI-2.1: Fix event.bus.ts polling leak

| Field | Value |
|-------|-------|
| **Classification** | FIX_BUG |
| **Abstraction** | Event Bus |
| **File** | `pao-system/core/event.bus.ts` |
| **Current role** | PAO event bus with `setInterval(100ms)` polling. Singleton instantiated on import (line 293). |
| **Proposed canonical** | Keep as PAO-specific event bus (not duplicate of `lib/event-bus/EventBus.ts` — different subsystem). Fix the leak. |
| **Callers** | `pao-system/core/heidi.controller.ts` (creates `new EventBus()`), `pao-system/core/ethical-decision-engine.ts` (receives via constructor) |
| **Runtime reachability** | **Boot-reachable** via `heidi-web → pages/api/chat/route.js → api/chat/route.js → heidi.controller.ts → event.bus.ts` |
| **Test coverage** | No direct tests. 17 test files import `heidi.controller.ts` which triggers the singleton. |
| **Dependency impact** | The `eventBus` singleton (line 293) is never imported by anyone. Only the `EventBus` class is used. |
| **Migration strategy** | 1. Remove `setInterval` from `startEventProcessor()`. 2. Call `processEvents()` on-demand from `publish()` (fire-and-forget, guarded by `this.processing`). 3. Remove the unused singleton at line 293. 4. Add `shutdown()` method for cleanup. |
| **Deletion criteria** | N/A (fixing, not deleting) |
| **Rollback strategy** | Revert the commit |
| **Risk** | Low — the polling was redundant. `publish()` already emits `event_published`, and `processEvents()` has a reentrancy guard. On-demand processing is the same pattern used by the canonical `lib/event-bus/EventBus.ts`. |
| **Validation** | `npm run typecheck`, `npx jest tests/unit/heidi-control-plane-acceptance.test.js`, `npx jest tests/unit/lifecycle-cleanup.test.js` |

**Fix details:**
```typescript
// BEFORE (leaky):
constructor() {
  super();
  this.initializePriorityQueues();
  this.startEventProcessor();  // creates setInterval(100ms)
}

private startEventProcessor(): void {
  setInterval(() => { this.processEvents(); }, 100);
}

// AFTER (on-demand):
constructor() {
  super();
  this.initializePriorityQueues();
  // No polling — events are processed on-demand from publish()
}

async publish(event: Omit<EventSchema, 'id' | 'timestamp'>): Promise<string> {
  // ... existing logic ...
  this.priorityQueues.get(fullEvent.priority)!.push(fullEvent);
  this.addToHistory(fullEvent);
  this.emit('event_published', fullEvent);
  // Process immediately (fire-and-forget, guarded by this.processing)
  this.processEvents();
  return fullEvent.id;
}

// Add shutdown for cleanup
shutdown(): void {
  this.subscriptions.clear();
  this.priorityQueues.clear();
  this.eventHistory = [];
  this.deadLetterQueue = [];
  this.removeAllListeners();
}

// Remove line 293: export const eventBus = new EventBus();
// (unused singleton — nobody imports it)
```

#### WI-2.2: Add regression test for event bus leak fix

| Field | Value |
|-------|-------|
| **Classification** | FIX_BUG |
| **File** | `tests/unit/pao-event-bus-leak.test.js` (NEW) |
| **Validation** | Verifies that: 1. Creating an EventBus does not start a setInterval. 2. Publishing an event processes it on-demand. 3. `shutdown()` clears all state. 4. No timer leaks. |
| **Risk** | None — test only |

#### WI-2.3: Remove Jest forceExit workaround (DEFER)

| Field | Value |
|-------|-------|
| **Classification** | DEFER |
| **File** | `jest.config.js` |
| **Reason for deferral** | The `forceExit: true` workaround should only be removed after confirming the full test suite exits naturally. This should be done as the final validation step, not as a separate commit. If tests still hang after the event.bus.ts fix, there may be other timer leaks. |
| **Risk** | Low — if tests pass with forceExit, removing it is safe only if no other leaks exist |

---

### Priority 3: Dead/Orphaned Implementations

#### WI-3.1: Delete confirmed dead code (Batch 1 — standalone files)

| Field | Value |
|-------|-------|
| **Classification** | DELETE_DEAD_CODE |
| **Files** | See table below |
| **Validation** | `npm run typecheck`, `npm test` (full suite) |

| File | LOC | Evidence | Callers |
|------|-----|----------|---------|
| `modules/event-ledger.js` | 290 | 0 require/import callers | None |
| `simple-event-bus.js` | 142 | 0 require/import callers | None |
| `modules/health-manager.js` | ~200 | 0 require/import callers | None |
| `keeper/policy-engine.js` | 164 | 0 require/import callers, marked deprecated | None |
| `keeper/crypto/agent-auth.js` | 198 | 0 require/import callers | None |
| `apps/ursula-frontend/src/lib/eventual-consistency-scheduler.ts` | 423 | 0 import callers | None |

**Total: 6 files, ~1,417 LOC**

#### WI-3.2: Delete confirmed dead code (Batch 2 — dead-chain files)

| Field | Value |
|-------|-------|
| **Classification** | DELETE_DEAD_CODE |
| **Files** | See table below |
| **Validation** | `npm run typecheck`, `npm test` (full suite) |

| File | LOC | Evidence | Callers (all dead) |
|------|-----|----------|-------------------|
| `modules/raw-event-ledger.js` | 402 | @deprecated; only callers are `test-grounded-architecture.js` (standalone), archived code, and dead-chain modules | `test-grounded-architecture.js`, `modules/two-phase-pipeline.js`, `modules/kilo-hypothesis-engine.js`, `modules/cascade-replay-system.js` (all dead) |
| `modules/event-bus-lock.js` | 275 | Only caller is `modules/kilo-truth-filter.js` → `test-system-enforcement.js` (standalone) | `modules/kilo-truth-filter.js` (dead) |
| `modules/protoforge-event-system.js` | ~600 | Only caller is `modules/protoforge-integration.js` → `protoforge-main.js` → nothing | `modules/protoforge-integration.js` (dead) |
| `modules/cascade-event-intake.js` | 209 | @deprecated; only caller is `modules/cascade-complete.js` → `test-cascade-system.js` (standalone) | `modules/cascade-complete.js` (dead) |

**Total: 4 files, ~1,486 LOC**

**Also remove dead-chain intermediaries (only called by other dead files or standalone scripts):**

| File | LOC | Evidence |
|------|-----|----------|
| `modules/two-phase-pipeline.js` | ? | Only caller: `test-grounded-architecture.js` |
| `modules/kilo-hypothesis-engine.js` | ? | Only callers: `test-grounded-architecture.js` |
| `modules/cascade-replay-system.js` | ? | Only callers: `test-grounded-architecture.js`, `modules/kilo-hypothesis-engine.js` |
| `modules/kilo-truth-filter.js` | ? | Only caller: `test-system-enforcement.js` |
| `modules/cascade-complete.js` | ? | Only caller: `test-cascade-system.js` |
| `modules/protoforge-integration.js` | ? | Only caller: `protoforge-main.js` |
| `protoforge-main.js` | ? | No callers |

**Standalone test scripts (DEFER — may be used manually):**

| File | Reason for deferral |
|------|---------------------|
| `test-grounded-architecture.js` | Standalone test script — may be run manually |
| `test-system-enforcement.js` | Standalone test script — may be run manually |
| `test-cascade-system.js` | Standalone test script — may be run manually |

#### WI-3.3: Files NOT deleted (inventory corrections)

| File | Inventory said | Investigation found | Decision |
|------|---------------|---------------------|----------|
| `src/memory/HeidiMemorySystem.js` | Dead (0 callers) | Boot-reachable via `src/HYDISystem.js` | **PRESERVE_INTENTIONAL_LAYER** |
| `src/models/heartbeat.js` | Dead (0 callers) | Boot-reachable via `ursula-service-bundle.js` → `subscription-manager.js` → `src/server.js` | **PRESERVE_INTENTIONAL_LAYER** |
| `archive/.../raw-event-ledger-v2.js` | Dead (archived) | In archive/ directory | **PRESERVE_INTENTIONAL_LAYER** (already archived, leave as-is) |

---

### Priority 4: Genuine Duplicates with Active Callers

#### WI-4.1: Migrate api/local-model.js callers to ModelManager (DEFER)

| Field | Value |
|-------|-------|
| **Classification** | DEFER |
| **Abstraction** | Model Access |
| **File** | `api/local-model.js` |
| **Current role** | Local model client (Ollama/LM Studio) with cloud fallback |
| **Proposed canonical** | `lib/ModelManager.ts` |
| **Callers** | `api/heidi/route.js`, `pages/api/heidi.js` |
| **Reason for deferral** | Migrating callers requires understanding the exact API surface differences between `api/local-model.js` and `lib/ModelManager.ts`. This is a non-trivial code change that should be done carefully. The duplicate is not causing runtime issues. |
| **Risk** | Medium — changing model access in active API routes |

#### WI-4.2: Migrate protoforge-event-bus.js callers to canonical EventBus (DEFER)

| Field | Value |
|-------|-------|
| **Classification** | DEFER |
| **Abstraction** | Event Bus |
| **File** | `modules/protoforge-event-bus.js` |
| **Current role** | ProtoForge 6-layer pipeline event bus |
| **Proposed canonical** | `lib/event-bus/EventBus.ts` |
| **Callers** | `src/server.js` (protoforge-core), test files |
| **Reason for deferral** | This is boot-reachable with 5 callers. The 6-layer pipeline logic (integrity→validate→classify→emit→persist→broadcast) is semantically different from the canonical bus. Migration would require extracting the pipeline logic into separate modules. This is a significant refactor that should not be done in this phase. |
| **Risk** | High — changing the event pipeline in protoforge-core could break the six-layer pipeline contract |

---

### Priority 5: Migration Hygiene

#### WI-5.1: Verify migration lint baseline ratchet

| Field | Value |
|-------|-------|
| **Classification** | PRESERVE_INTENTIONAL_LAYER |
| **File** | `scripts/lint-migration-idempotency.js`, `supabase/migration-lint-baseline.json` |
| **Current role** | Ratchet mechanism that allows existing 136 violations but fails on new ones |
| **Validation** | `node scripts/lint-migration-idempotency.js --ratchet` |
| **Risk** | None — verifying existing mechanism |

#### WI-5.2: Bucket A migration fixes (DEFER)

| Field | Value |
|-------|-------|
| **Classification** | DEFER |
| **Files** | 8 files with 28 CREATE TABLE/CREATE INDEX violations |
| **Reason for deferral** | The user's instructions say "Do not edit historical migrations merely to make the lint report green" and "If a migration has already been applied, prefer a new forward migration." All Bucket A migrations have likely been applied to live Supabase. Editing them retroactively is a desync risk. The ratchet mechanism already prevents new violations. |
| **Risk** | Medium — retroactive migration editing can desync from live database |

#### WI-5.3: Bucket C superseded migrations (DEFER)

| Field | Value |
|-------|-------|
| **Classification** | DEFER |
| **Files** | `20260424010000_fix_event_bus_dependency.sql` (superseded by `20260426140000`), `20260426122500_notifications_table.sql` (conflicts with `20260715123000`) |
| **Reason for deferral** | Removing historical migrations from the migration history is risky — it changes what gets applied on fresh databases. The corrective migration (WI-1.1) handles the notifications conflict without removing the historical migration. The event_bus_dependency supersession is harmless (both use `CREATE TABLE IF NOT EXISTS`). |
| **Risk** | High — removing migrations can break fresh installs |

---

## Commit Structure

| # | Commit | Work items | Priority |
|---|--------|-----------|----------|
| 1 | `fix(hydi): reconcile notifications schema` | WI-1.1, WI-1.2 | P1 |
| 2 | `fix(hydi): remove event bus polling leak` | WI-2.1, WI-2.2 | P2 |
| 3 | `refactor(hydi): remove dead standalone implementations` | WI-3.1 | P3 |
| 4 | `refactor(hydi): remove dead-chain implementations` | WI-3.2 | P3 |
| 5 | `chore(hydi): verify migration lint baseline ratchet` | WI-5.1 | P5 |
| 6 | `docs(hydi): architectural consolidation report` | Final report | — |

**Deferred items (not in this phase):**
- WI-1.3: Migrate April-schema notification callers
- WI-2.3: Remove Jest forceExit workaround
- WI-4.1: Migrate api/local-model.js callers
- WI-4.2: Migrate protoforge-event-bus.js callers
- WI-5.2: Bucket A migration fixes
- WI-5.3: Bucket C superseded migration removal

---

## Validation Plan

### After each commit:
- `npm run typecheck`
- Targeted tests (relevant test files)
- `npm run lint`

### After all commits (milestone):
- `npm test` (full suite)
- `node scripts/lint-migration-idempotency.js --ratchet`
- `node scripts/scan-live-secrets.js`
- Verify no implementation files were modified outside the plan

### Final report:
- `ARCHITECTURAL_CONSOLIDATION_REPORT.md` with before/after comparison
