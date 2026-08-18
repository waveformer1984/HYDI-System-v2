# Architectural Inventory — Phase 1

**Branch:** `refactor/architectural-consolidation` (from `clean-main` @ `49cbb55`)
**Date:** 2026-08-18
**Status:** PHASE 1 — INVENTORY ONLY. No implementation code was modified to produce this document.

---

## Purpose

This inventory catalogs every implementation found for five core abstractions (Memory, Event Bus, Scheduler, Auth, Model Access), distinguishes true duplicates from intentional layering, recommends one canonical implementation per abstraction where consolidation is justified, and categorizes the 136 migration-idempotency baseline violations into risk buckets.

**This is a read-only artifact.** No consolidation, deletion, caller migration, migration SQL edit, or baseline regeneration has been performed. Every recommendation below requires explicit review and approval before any Phase 2 action.

---

## Boot Path Reference

The live boot path is:

```
boot.config.json → scripts/boot-agent.js → four modules:
  1. protoforge-core  (port 3005)   — src/server.js
  2. heidi-web        (port 3000)   — Next.js (pages/api/*)
  3. heidi-mobile-chat(port 3006)   — Next.js mobile chat
  4. hydi-orchestrator (in-process) — workers/WorkerOrchestrator.js
```

"Boot-reachable" in the tables below means a file is imported (transitively) by one of these four entry points.

---

## 1. Memory

### 1.1 Inventory Table

| # | Path | LOC | First commit | Last touched | Description | Callers | Tests | Boot-reachable | Status |
|---|------|-----|-------------|-------------|-------------|---------|-------|----------------|--------|
| 1 | `lib/protoforge/raw-ledger.ts` | 83 | 2026-07-14 | 2026-07-14 | Canonical Supabase-backed raw event ledger (pipeline layer 2). Append-only, hashed. | 1 (protoforge gateway) | No | Yes (protoforge-core) | **CANONICAL — Supabase ledger** |
| 2 | `lib/protoforge/local-ledger-store.js` | 121 | 2026-08-17 | 2026-08-17 | Local JSON file-based ledger with atomic writes, duplicate detection. Local-first fallback. | 1 (test only) | Yes (7 tests) | No (local-first path) | **CANONICAL — local-first ledger** |
| 3 | `protoforge/cascade/src/adapters/ledger-adapter.js` | 95 | 2026-07-31 | 2026-07-31 | Supabase ledger adapter for CASCADE classifier. Adapter over the same `raw_events` table. | 1 (cascade) | No | Yes (via protoforge-core) | Complementary (adapter) |
| 4 | `modules/raw-event-ledger.js` | 402 | 2026-04-24 | 2026-07-31 | **@deprecated** file-based ledger with hash chain integrity. `setInterval(5s)` flush. | 0 (no live callers) | No | No | **DEAD — deprecated, orphaned** |
| 5 | `modules/event-ledger.js` | 290 | 2026-04-24 | 2026-04-30 | Event ledger with `setInterval(1s)` retry processor, Supabase persistence, quarantine. | 0 | No | No | **DEAD — orphaned** |
| 6 | `archive/heidi-v2-dormant-pipeline/replay-family/raw-event-ledger-v2.js` | ~50 | — | — | Archived copy of raw-event-ledger. | 0 | No | No | **DEAD — archived** |
| 7 | `src/hydi-v3/AuditLedger.js` | 193 | 2026-04-30 | 2026-07-25 | Append-only hash-chained audit log for executive decisions. | 2 | Yes | No (V3) | Complementary (audit trail, not a memory store) |
| 8 | `lib/heidi-memory.ts` | 79 | 2026-06-23 | 2026-07-15 | Supabase pgvector semantic memory for chat context. Queries `memories` table. | Multiple (heidi-web) | No | Yes (heidi-web) | **CANONICAL — semantic memory** |
| 9 | `lib/episodic-memory.ts` | 91 | 2026-07-14 | 2026-07-14 | Supabase episodic experiences (problem/actions/outcome). Extends `memories` table. | 0 | No | Yes (heidi-web) | Complementary (extends memories table) |
| 10 | `heidi-core/memory/sqlite-store.js` | 606 | 2026-04-30 | 2026-07-07 | SQLite + local vector similarity, fallback to in-memory. Local-first Heidi. | 5 | No | No (heidi-core not in boot) | **CANONICAL — local-first Heidi memory** |
| 11 | `core/memory/store.py` | 185 | 2026-04-30 | 2026-04-30 | Python memory store with ChromaDB/Qdrant backends. PAO system. | 0 (Python) | No | No | Complementary (PAO/Python) |
| 12 | `src/memory/MemoryStore.js` | 236 | 2026-04-30 | 2026-07-18 | Hybrid buffer + Supabase with instant writes. Legacy V2. | 5 | No | No (legacy V2) | Complementary (legacy V2) |
| 13 | `src/memory/MemoryBuffer.js` | 315 | 2026-04-30 | 2026-07-25 | In-process working memory with async flush. Buffer layer. | 2 | Yes | No | Complementary (buffer layer) |
| 14 | `src/memory/HeidiMemorySystem.js` | ~100 | 2026-04-30 | 2026-07-25 | 3-tier memory (session/DB/reflective). | 0 | No | No | **DEAD — orphaned, no callers** |
| 15 | `src/hydi-v3/BusinessMemory.js` | 409 | 2026-04-30 | 2026-07-25 | Local-first executive memory for entities/relationships. V3. | 12 | Yes | No (V3) | Complementary (V3 business) |
| 16 | `src/hydi-v3/SessionMemory.js` | 258 | 2026-04-30 | 2026-07-25 | Session state persistence (focus, commands, history). V3. | 5 | Yes | No (V3) | Complementary (V3 session) |
| 17 | `src/hydi-v3/SharedMemoryStore.js` | 213 | 2026-04-30 | 2026-07-25 | Distributed memory with vector-clock causality. V3. | 1 | Yes | No (V3) | Complementary (V3 multi-node) |
| 18 | `src/hydi-v3/StrategicMemory.js` | 70 | 2026-04-30 | 2026-07-25 | Long-term planning artifacts (missions, lessons). V3. | 0 | No | No (V3) | Complementary (V3 strategic) |
| 19 | `src/hydi-v3/SemanticMemoryIndex.js` | 243 | 2026-04-30 | 2026-07-25 | Vector similarity search with tiered memory. V3. | 0 | No | No (V3) | Complementary (V3 semantic) |
| 20 | `src/hydi-v3/DecisionOutcomeStore.js` | 376 | 2026-04-30 | 2026-07-25 | Decision/outcome tracking with learning loop. V3. | 13 | Yes | No (V3) | Complementary (V3 learning) |
| 21 | `src/hydi-v3/CheckpointStore.js` | 44 | 2026-04-30 | 2026-07-25 | Execution state snapshots for recovery. V3. | 3 | Yes | No (V3) | Complementary (V3 recovery) |
| 22 | `src/hydi-v3/SnapshotStore.js` | 100 | 2026-04-30 | 2026-07-25 | System snapshots with checksums and pruning. V3. | 3 | No | No (V3) | Complementary (V3 snapshots) |
| 23 | `lib/rezonate/rezonate-client.js` | 198 | 2026-08-14 | 2026-08-14 | JSON file persistence bridge for Rezonate control plane. | 9 | Yes | No (app-specific) | Complementary (app-specific persistence) |
| 24 | `protoforge-applications/rezonate/src/persistence/memory-store.js` | 48 | — | — | In-memory store for Rezonate ProtoForge app. | 0 | No | No | Complementary (app template) |
| 25 | `protoforge-applications/proto-yi/src/persistence/memory-store.js` | 48 | — | — | In-memory store for Proto-Yi ProtoForge app. | 0 | No | No | Complementary (app template) |
| 26 | `protoforge/blueprints/application/src/persistence/memory-store.js` | 48 | — | — | Blueprint template memory store. | 0 | No | No | Complementary (template) |
| 27 | `protoforge/examples/sample-app/src/persistence/memory-store.js` | 48 | — | — | Sample app memory store. | 0 | No | No | Complementary (example) |
| 28 | `switchboard/src/persistence/memory-store.js` | 48 | — | — | Switchboard memory store. | 0 | No | No | Complementary (switchboard) |
| 29 | `evolution/local-event-store.js` | 86 | — | — | SQLite event store for self-improvement loop. | 0 | No | No | Complementary (evolution) |
| 30 | `lib/jobs/stores/MemoryJobQueue.ts` | 119 | — | — | In-memory job queue. | 0 | No | No | Complementary (jobs) |
| 31 | `lib/metrics/stores/MemoryMetricsStore.ts` | 67 | — | — | In-memory metrics store with size limit. | 0 | No | No | Complementary (metrics) |
| 32 | `pao-system/services/storage.service.ts` | 55 | 2026-04-30 | 2026-06-23 | Mock S3-compatible storage service. PAO. | 0 | No | No | Complementary (PAO) |

### 1.2 Findings

**True duplicates (consolidation justified):**

- **Raw event ledger triple:** `modules/raw-event-ledger.js` (#4, @deprecated, 0 callers), `modules/event-ledger.js` (#5, orphaned, 0 callers), and `archive/.../raw-event-ledger-v2.js` (#6, archived). All three are dead. The canonical Supabase-backed ledger is `lib/protoforge/raw-ledger.ts` (#1), with `lib/protoforge/local-ledger-store.js` (#2) as the local-first complement.

- **Heidi memory fragmentation:** `src/memory/HeidiMemorySystem.js` (#14) is orphaned with 0 callers. The canonical semantic memory is `lib/heidi-memory.ts` (#8, Supabase pgvector, boot-reachable). `heidi-core/memory/sqlite-store.js` (#10) is the local-first Heidi complement (not in boot path but serves heidi-core).

**Not duplicates (intentional layering):**

- **Ledger vs. memory:** Ledgers (#1–7) are append-only event logs; memories (#8–22) are semantic/state stores. Different purposes.
- **Local vs. cloud:** `local-ledger-store.js` (#2) and `sqlite-store.js` (#10) enable offline operation. Not duplicates of their Supabase counterparts.
- **V3 stores (#15–22):** Each serves a distinct domain (business, session, strategic, decisions, checkpoints, snapshots). Not duplicates of each other or of V2 memory.
- **ProtoForge app stores (#24–28):** These are per-application templates/examples generated by the ProtoForge blueprint. Each belongs to a separate app. Not duplicates.
- **Utility stores (#30–32):** Job queue, metrics, S3 mock — utility purposes, not memory abstractions.

### 1.3 Recommendations

| Action | Target | Justification |
|--------|--------|---------------|
| **Canonical — Supabase ledger** | `lib/protoforge/raw-ledger.ts` | Boot-reachable, pipeline layer 2, only Supabase-backed ledger |
| **Canonical — local-first ledger** | `lib/protoforge/local-ledger-store.js` | Tested (7 tests), atomic writes, local-first fallback |
| **Canonical — semantic memory** | `lib/heidi-memory.ts` | Boot-reachable via heidi-web, pgvector-backed |
| **Canonical — local-first Heidi memory** | `heidi-core/memory/sqlite-store.js` | SQLite + vector similarity, serves heidi-core |
| **Delete (dead code)** | `modules/raw-event-ledger.js` | @deprecated, 0 callers, superseded by `raw-ledger.ts` |
| **Delete (dead code)** | `modules/event-ledger.js` | 0 callers, orphaned since 2026-04-30 |
| **Delete (dead code)** | `src/memory/HeidiMemorySystem.js` | 0 callers, orphaned |
| **Delete (archived)** | `archive/.../raw-event-ledger-v2.js` | Already in archive/ directory |
| **Keep separate** | All V3 stores, ProtoForge app stores, utility stores | Different domains, not duplicates |

---

## 2. Event Bus

### 2.1 Inventory Table

| # | Path | LOC | First commit | Last touched | Description | Callers | Tests | Boot-reachable | Status |
|---|------|-----|-------------|-------------|-------------|---------|-------|----------------|--------|
| 1 | `lib/event-bus/EventBus.ts` | 331 | 2026-07-17 | 2026-07-22 | TypeScript event bus with AsyncLocalStorage context, causality tracing, request/response, priority queuing, validation, replay. No polling. | 25+ | Yes (10+ test files) | Yes (heidi-web, ursula-frontend) | **CANONICAL** |
| 2 | `pao-system/core/event.bus.ts` | 293 | 2026-04-30 | 2026-04-30 | PAO event bus with **`setInterval(100ms)` leak** (line ~130). Priority queues, dead letter queue, agent routing. | 1 (heidi.controller.ts) | No | No (PAO not in boot) | **FIX OR DELETE — the leak** |
| 3 | `lib/realtime/eventBus.js` | 35 | 2026-07-15 | 2026-07-25 | Simple EventEmitter singleton for SSE streaming to mobile clients. | 5 | Yes (2 test files) | Yes (heidi-web SSE) | Complementary (SSE-specific) |
| 4 | `modules/protoforge-event-bus.js` | 586 | 2026-04-24 | 2026-04-30 | ProtoForge 6-layer pipeline event bus (integrity→validate→classify→emit→persist→broadcast). CASCADE integration. | 5 (src/server.js, tests) | No | Yes (protoforge-core) | **DEPRECATE — migrate to canonical** |
| 5 | `src/hydi-v3/BusinessEventBus.js` | 135 | 2026-07-25 | 2026-07-27 | V3 business event bus for filesystem/git/telemetry/sales events. | 14 | Yes (12+ test files) | No (V3) | Complementary (V3 ecosystem) |
| 6 | `modules/raw-event-ledger.js` | 402 | 2026-04-24 | 2026-07-31 | **@deprecated** file-based ledger with `setInterval(5s)` flush. (Also listed in Memory.) | 0 | No | No | **DEAD — deprecated** |
| 7 | `modules/event-ledger.js` | 290 | 2026-04-24 | 2026-04-30 | Event ledger with `setInterval(1s)` retry processor. (Also listed in Memory.) | 0 | No | No | **DEAD — orphaned** |
| 8 | `modules/cascade-event-intake.js` | 209 | 2026-04-24 | 2026-04-30 | **@deprecated** CASCADE event intake with source adapters. | 1 (cascade-complete.js) | No | No | **DEAD — deprecated** |
| 9 | `simple-event-bus.js` | 142 | — | — | Simple event bus with module registration and permission enforcement. | 0 | No | No | **DEAD — no callers** |
| 10 | `modules/event-bus-lock.js` | 275 | 2026-04-24 | 2026-04-30 | Event bus lock enforcing CASCADE/KILO contract. | 3 (tests, kilo-truth-filter) | No | No | **DEAD — contract enforcement moved** |
| 11 | `workers/EventBusWorker.js` | 497 | 2026-04-24 | 2026-07-25 | Event bus worker with Supabase queue, webhook delivery, pattern subscriptions. | 2 (WorkerOrchestrator, tests) | Yes (1 test file) | Yes (via WorkerOrchestrator) | Complementary (worker infra) |
| 12 | `switchboard/src/events/event-bus.js` | 155 | — | — | Switchboard event bus with Memory/File transports. | 3 | Yes (1 test file) | No | Complementary (switchboard) |
| 13 | `protoforge/blueprints/application/src/events/event-bus.js` | 120 | — | — | ProtoForge blueprint event bus. | 2 | Yes (1 test file) | No | Complementary (blueprint) |
| 14 | `protoforge/examples/sample-app/src/events/event-bus.js` | 120 | — | — | Sample app event bus (copy of blueprint). | 2 | Yes (1 test file) | No | Complementary (example) |
| 15 | `protoforge-applications/rezonate/src/events/event-bus.js` | 120 | — | — | Rezonate app event bus. | 3 | Yes (6 test files) | No | Complementary (Rezonate app) |
| 16 | `protoforge-applications/proto-yi/src/events/event-bus.js` | 120 | — | — | Proto-Yi app event bus. | 3 | Yes (4 test files) | No | Complementary (Proto-Yi app) |
| 17 | `modules/protoforge-event-system.js` | ~600 | 2026-04-24 | 2026-04-30 | ProtoForge event system for 15-agent communication. Superseded. | 1 (protoforge-integration.js) | No | No | **DEAD — superseded by #4** |
| 18 | `lib/commercial/projections/event-bus-events-adapter.ts` | 112 | — | — | Projection adapter with `setInterval(5s)` polling Postgres `event_bus_events`. | 2 | Yes (1 test file) | Yes (lib/commercial) | Complementary (migration shim) |

### 2.2 The `setInterval(100ms)` Leak

**File:** `pao-system/core/event.bus.ts`, line ~130

```typescript
private startEventProcessor(): void {
  setInterval(() => {
    this.processEvents();
  }, 100); // Process every 100ms
}
```

**Root cause:** The PAO event bus uses a 100ms polling loop to process queued events. This timer is never cleared (`clearInterval` is never called), and the timer is not `.unref()`'d, so Node.js/Jest cannot exit while the bus is instantiated.

**Is this a symptom of duplication?** **Partially.** The PAO system has its own isolated event bus that doesn't integrate with the canonical `lib/event-bus/EventBus.ts`. However, the leak is fundamentally a **bug in a single implementation** — the canonical bus processes events on-demand (no polling), so there's no "two event buses fighting" scenario. The PAO bus is only used by `heidi.controller.ts` and is not boot-reachable.

**Other `setInterval` calls in event-related code:**
- `modules/raw-event-ledger.js` (5s flush) — DEAD, deprecated
- `modules/event-ledger.js` (1s retry) — DEAD, orphaned
- `api/events/stream.js` (30s SSE heartbeat) — NECESSARY for SSE keepalive
- `lib/event-bus/recorder.ts` (flush interval) — NECESSARY, uses `.unref()`
- `lib/commercial/projections/event-bus-events-adapter.ts` (5s poll) — NECESSARY for legacy table polling

### 2.3 Findings

**True duplicates (consolidation justified):**

- `pao-system/core/event.bus.ts` (#2) is a competing event bus with a leak. Only 1 caller, not boot-reachable. Either fix the leak or migrate the caller to the canonical bus and delete.
- `modules/protoforge-event-bus.js` (#4) is boot-reachable but has no tests and implements a 6-layer pipeline that overlaps with the canonical bus's capabilities. Candidate for migration to `lib/event-bus/EventBus.ts`.
- `modules/protoforge-event-system.js` (#17) is superseded by #4 and has only 1 caller.

**Dead code (delete):**
- #6, #7, #8, #9, #10, #17 — all deprecated, orphaned, or superseded with 0–1 callers and no boot reachability.

**Not duplicates (intentional layering):**
- `lib/realtime/eventBus.js` (#3) — SSE streaming singleton, different purpose.
- `src/hydi-v3/BusinessEventBus.js` (#5) — V3 ecosystem, well-tested (12+ test files).
- `workers/EventBusWorker.js` (#11) — Worker infrastructure, different use case.
- ProtoForge app/blueprint event buses (#12–16) — Per-application scaffolding.
- `lib/commercial/projections/event-bus-events-adapter.ts` (#18) — Migration shim for legacy Postgres table.

### 2.4 Recommendations

| Action | Target | Justification |
|--------|--------|---------------|
| **Canonical** | `lib/event-bus/EventBus.ts` | TypeScript, 25+ callers, 10+ test files, boot-reachable, no polling/leaks, AsyncLocalStorage causality tracing |
| **Fix or delete** | `pao-system/core/event.bus.ts` | 1 caller, not boot-reachable, `setInterval(100ms)` leak. Either replace polling with on-demand processing or migrate caller to canonical bus and delete. |
| **Deprecate and migrate** | `modules/protoforge-event-bus.js` | Boot-reachable but untested. 6-layer pipeline logic should be extracted into modules using the canonical bus. |
| **Delete (dead code)** | #6, #7, #8, #9, #10, #17 | All deprecated/orphaned/superseded, 0–1 callers, not boot-reachable |
| **Keep separate** | #3, #5, #11, #12–16, #18 | Different domains, not duplicates |

---

## 3. Scheduler

### 3.1 Inventory Table

| # | Path | LOC | First commit | Last touched | Description | Callers | Tests | Boot-reachable | Status |
|---|------|-----|-------------|-------------|-------------|---------|-------|----------------|--------|
| 1 | `workers/WorkerOrchestrator.js` | ~600 | 2026-04-24 | 2026-07-18 | Main worker orchestrator. Polls `agent_control_commands` (5s), metrics (60s), health (30s). | 2 (start-workers.js, test) | Yes | Yes (hydi-orchestrator) | **CANONICAL** |
| 2 | `pao-system/core/event.bus.ts` | 293 | 2026-04-30 | 2026-04-30 | PAO event bus with `setInterval(100ms)` — **the leak** (also in Event Bus table). | 1 | No | No | **FIX — not a scheduler** |
| 3 | `scripts/watchdog.js` | 173 | 2026-08-17 | 2026-08-17 | Independent health endpoint watchdog. Polls every 2 min (configurable). | 0 (standalone script) | No | No (run separately) | Complementary (ops tool) |
| 4 | `src/models/heartbeat.js` | 450 | 2026-05-15 | 2026-07-15 | Ursula local model heartbeat. Checks model health every 30s. | 0 | No | No | **DEAD — unused** |
| 5 | `src/hydi-v3/HeartbeatSystem.js` | 161 | 2026-06-01 | 2026-07-15 | V3 heartbeat system. Publishes/monitors service heartbeats (30s). | 4 | Yes | No (V3) | Complementary (V3) |
| 6 | `apps/ursula-frontend/src/lib/cron-scheduler.ts` | 323 | 2026-06-15 | 2026-07-15 | Ursula cron scheduler. Hourly/daily reconciliation, health checks. | 1 | No | No (Ursula frontend) | Complementary (Ursula) |
| 7 | `apps/ursula-frontend/src/lib/eventual-consistency-scheduler.ts` | 423 | 2026-06-20 | 2026-07-15 | Ursula eventual consistency scheduler. Hourly/daily/weekly reconciliation. | 0 | No | No (Ursula frontend) | **DEAD — unused** |
| 8 | `lib/health/HealthPoller.ts` | 69 | 2026-07-17 | 2026-07-17 | Health poller. Collects health snapshots on interval (30s). | 1 (HealthService) | Yes | Yes (protoforge-core) | **CANONICAL — health polling** |
| 9 | `workers/SyncWorker.js` | ~500 | 2026-04-24 | 2026-07-15 | Sync worker. Polls queue (5s) + 4 sync intervals (30s–75s). | 1 (WorkerOrchestrator) | No | Yes (via orchestrator) | Complementary (worker) |
| 10 | `workers/EventBusWorker.js` | 497 | 2026-04-24 | 2026-07-25 | Event bus worker. Polls queue (1s) + metrics (60s). (Also in Event Bus table.) | 1 (WorkerOrchestrator) | Yes | Yes (via orchestrator) | Complementary (worker) |
| 11 | `lib/health-monitor.js` | 243 | 2026-06-26 | 2026-07-25 | Health monitor. Component health checks (10s default). | Multiple | No | Yes (protoforge-core) | **CANONICAL — component health** |
| 12 | `modules/health-manager.js` | ~200 | 2026-06-26 | 2026-06-26 | HYDI health manager. Polls services (10s), global sweep (10s). | 0 | No | No | **DEAD — unused** |
| 13 | `src/hydi-v3/NodeScheduler.js` | 95 | 2026-06-01 | 2026-07-15 | V3 task scheduler for distributed compute. No `setInterval` (policy-based). | 2 | Yes | No (V3) | Complementary (V3) |
| 14 | `supabase/migrations/20260426122000_action_worker_cron_schedule.sql` | 76 | 2026-04-26 | 2026-07-15 | pg_cron: action-worker every minute. | 0 (DB-level) | Yes | Yes (DB-level) | **CANONICAL — DB cron** |
| 15 | `supabase/migrations/20260426123500_billing_retry_cron.sql` | 116 | 2026-04-26 | 2026-07-15 | pg_cron: billing-retry-worker every 2 min. | 0 (DB-level) | Yes | Yes (DB-level) | **CANONICAL — DB cron** |
| 16 | `supabase/migrations/20260528000004_protoforge_calibration_worker.sql` | 141 | 2026-05-28 | 2026-07-15 | pg_cron: protoforge-calibration every 5 min. | 0 (DB-level) | Yes | Yes (DB-level) | **CANONICAL — DB cron** |

### 3.2 Findings

**Is the EventBus `setInterval` leak the same problem as scheduler duplication?**

**No.** The `setInterval(100ms)` in `pao-system/core/event.bus.ts` is an event processing loop, not a task scheduler. It's PAO-internal (1 caller, not boot-reachable). The scheduler implementations are independent systems for independent subsystems (production workers, health monitoring, Ursula frontend, V3, database-level pg_cron). The real issue is the EventBus 100ms loop being unnecessarily aggressive, not scheduler duplication.

**True duplicates:**
- `modules/health-manager.js` (#12) overlaps with `lib/health-monitor.js` (#11) and `lib/health/HealthPoller.ts` (#8) but has 0 callers and is not boot-reachable. Dead.

**Dead code:**
- `src/models/heartbeat.js` (#4) — 0 callers, not boot-reachable.
- `apps/ursula-frontend/src/lib/eventual-consistency-scheduler.ts` (#7) — 0 callers.
- `modules/health-manager.js` (#12) — 0 callers.

**Not duplicates (intentional layering):**
- `WorkerOrchestrator` (#1) — production worker supervisor.
- `HealthPoller` (#8) + `health-monitor.js` (#11) — different health monitoring layers (poller vs. component checker).
- `SyncWorker` (#9), `EventBusWorker` (#10) — specialized workers under orchestrator.
- `HeartbeatSystem` (#5), `NodeScheduler` (#13) — V3 subsystem.
- `cron-scheduler.ts` (#6) — Ursula frontend.
- `watchdog.js` (#3) — standalone ops tool.
- pg_cron migrations (#14–16) — database-level scheduling.

### 3.3 Recommendations

| Action | Target | Justification |
|--------|--------|---------------|
| **Canonical — worker scheduling** | `workers/WorkerOrchestrator.js` | Boot-reachable, tested, supervises all workers |
| **Canonical — health polling** | `lib/health/HealthPoller.ts` | Boot-reachable, tested, used by HealthService |
| **Canonical — component health** | `lib/health-monitor.js` | Boot-reachable, multiple callers |
| **Canonical — DB cron** | 3 pg_cron migrations | Database-level, tested, always active |
| **Fix (not delete)** | `pao-system/core/event.bus.ts` | Replace 100ms polling with on-demand processing. This is an event bus bug, not a scheduler duplicate. |
| **Delete (dead code)** | `src/models/heartbeat.js`, `apps/ursula-frontend/src/lib/eventual-consistency-scheduler.ts`, `modules/health-manager.js` | 0 callers, not boot-reachable |
| **Keep separate** | #3, #5, #6, #9, #10, #13 | Different subsystems, not duplicates |

---

## 4. Auth

### 4.1 Inventory Table

| # | Path | LOC | First commit | Last touched | Description | Callers | Tests | Boot-reachable | Status |
|---|------|-----|-------------|-------------|-------------|---------|-------|----------------|--------|
| 1 | `lib/auth/rbac.js` | 75 | 2026-07-15 | 2026-08-14 | RBAC permission matrix (owner/operator/agent/viewer). | 24 | Yes | Yes (heidi-web) | **CANONICAL — RBAC** |
| 2 | `lib/auth/requireAuth.js` | 119 | 2026-07-15 | 2026-07-15 | Unified request guard (service token + device token). Writes to `auth_audit_log`. | 18 | Yes | Yes (heidi-web) | **CANONICAL — request guard** |
| 3 | `lib/auth/verifyServiceToken.js` | 47 | 2026-05-16 | 2026-05-16 | HMAC-SHA256 service token verification (5-min replay window). | 18 | Yes | Yes (heidi-web) | **CANONICAL — service token** |
| 4 | `lib/auth/deviceAuth.js` | 125 | 2026-07-15 | 2026-07-15 | Device-scoped HMAC authentication (per-device secret, revocation). | 4 | Yes | Yes (heidi-web) | **CANONICAL — device auth** |
| 5 | `lib/protoforge/policy-engine.js` | 328 | 2026-05-28 | 2026-08-14 | ProtoForge DSL policy engine (fail-closed). Evaluates KILO hypotheses. | 12 | Yes | Yes (protoforge-core) | **CANONICAL — policy gate** |
| 6 | `lib/protoforge/auto-gate.js` | 130 | 2026-05-28 | 2026-08-14 | Automatic KILO→ProtoForge gating pipeline. | 3 | Yes | Yes (protoforge-core) | **CANONICAL — auto-gate** |
| 7 | `lib/rezonate/capability-guard.js` | 136 | 2026-08-13 | 2026-08-17 | Capability guard for Heidi→Rezonate (VERIFIED/FUNCTIONAL/PLANNED/SCAFFOLD/MISSING/FORBIDDEN). | 2 | No | Yes (heidi-web) | Complementary (capability, not identity) |
| 8 | `lib/apex/apex-capability-guard.js` | 34 | 2026-08-13 | 2026-08-17 | Capability guard for Heidi→Apex Archive (read-only). | 1 | No | Yes (heidi-web) | Complementary (capability, not identity) |
| 9 | `api/webhooks/stripe.js` | 521 | 2026-04-24 | 2026-08-17 | Stripe webhook signature verification (`constructEvent`). | 3 | Yes | Yes (heidi-web) | Complementary (Stripe webhook) |
| 10 | `supabase/functions/stripe-webhook/index.ts` | ~80 | 2026-04-26 | 2026-08-17 | Edge Function Stripe webhook verification (`constructEventAsync`). | 1 | No | No (Edge Function) | Complementary (Edge Function) |
| 11 | `supabase/functions/keeper-break-glass/index.ts` | 219 | 2026-07-15 | 2026-08-17 | Break-glass safety circuit override (JWT or token, fail-closed). | 1 (manual) | No | No (Edge Function) | Complementary (emergency access) |
| 12 | `supabase/functions/keeper-break-glass-simple/index.ts` | 193 | 2026-07-15 | 2026-08-17 | Simplified break-glass (`x-break-glass-token` header). | 1 (manual) | No | No (Edge Function) | Complementary (emergency access) |
| 13 | `supabase/functions/keymaker-gate/index.ts` | ~111 | 2026-01-01 | 2026-08-17 | Keymaker gate (validates `key_hash`, routes to RPC). | 1 | No | No (Edge Function) | Complementary (key validation) |
| 14 | `supabase/functions/stream-health-watchdog/index.ts` | ~100 | 2026-07-15 | 2026-08-17 | Revenue stream watchdog (`HYDI_WATCHDOG_KEY` header, fail-closed). | 1 | No | No (Edge Function) | Complementary (watchdog) |
| 15 | `supabase/functions/_shared/security.ts` | 82 | 2026-07-17 | 2026-08-17 | Shared Edge Function helpers (`requireServiceRole`, `rateLimit`). | 15 | No | No (Edge Function) | Complementary (Edge Function shared) |
| 16 | `keeper/policy-engine.js` | 164 | 2026-01-01 | 2026-08-17 | **DEPRECATED** KEEPER policy engine. Superseded by `lib/protoforge/policy-engine.js`. | 0 | No | No | **DEAD — deprecated** |
| 17 | `keeper/crypto/agent-auth.js` | 198 | 2026-01-01 | 2026-08-17 | Agent cryptographic authentication (RSA key pairs, signature verification). | 0 | No | No | **DEAD — unused** |
| 18 | `core/safety/permissions.py` | 202 | 2026-01-01 | 2026-08-17 | ProtoForge safety permissions (Python, action-level gating). | 0 (Python) | Yes (Python tests) | No (Python) | Complementary (Python safety) |
| 19 | `agents/hid/key-rotation-agent.js` | 347 | 2026-01-01 | 2026-08-17 | HID key rotation agent (secure secret rotation). | 0 (manual) | No | No | Complementary (ops tool) |
| 20 | `pao-system/core/approval.engine.ts` | 66 | 2026-07-15 | 2026-08-17 | PAO approval engine (cost thresholds, risk assessment). | 1 | No | Yes (heidi-web) | Complementary (approval workflow) |
| 21 | `lib/action-approval.ts` | ~80 | 2026-07-15 | 2026-08-17 | Action approval resolver (ProtoForge escalated actions). | 3 | Yes | Yes (heidi-web) | Complementary (approval resolver) |
| 22 | `lib/rate-limit.js` | 60 | 2026-07-15 | 2026-08-17 | In-memory rate limiter (per-IP, per-route). | 26 | Yes | Yes (heidi-web) | Complementary (rate limiting) |
| 23 | `lib/session-state.ts` | 57 | 2026-07-14 | 2026-08-17 | Session state layer (`sessions` table owner). | 6 | Yes | Yes (heidi-web) | Complementary (session management) |
| 24 | `protoforge/hydi-gateway/src/auth.js` | 17 | 2026-01-01 | 2026-08-17 | Simple Bearer token auth for hydi-gateway. | 1 | Yes | No (separate service) | Complementary (gateway) |
| 25 | `apps/ursula-frontend/src/lib/request-auth.ts` | 132 | 2026-01-01 | 2026-08-17 | Ursula JWT + `x-user-id` auth (backward-compat). | 5 | Yes | No (Ursula app) | Complementary (Ursula) |
| 26 | `apps/ursula-frontend/mobile/colters-pwa/src/store/authStore.ts` | 113 | 2026-01-01 | 2026-08-17 | Ursula mobile auth store (mock login, RBAC). | 1 | No | No (Ursula mobile) | Complementary (Ursula mobile) |

### 4.2 Findings

**True duplicates:**
- `keeper/policy-engine.js` (#16) is explicitly deprecated and superseded by `lib/protoforge/policy-engine.js` (#5). 0 callers.
- `keeper/crypto/agent-auth.js` (#17) is an unused RSA-based agent auth. 0 callers.

**Not duplicates (intentional layering):**

This abstraction has the most "looks like a duplicate but isn't" cases:

- **Identity vs. policy:** `lib/auth/*` (#1–4) verifies *who* the caller is. `lib/protoforge/policy-engine.js` (#5) decides *what* they may do. Different layers.
- **Capability guards** (#7, #8): Verify what Heidi is *allowed to do* against Rezonate/Apex. Not identity checking.
- **Stripe webhook verification** (#9, #10): Cryptographic signature verification of Stripe webhooks. Fundamentally different from RBAC.
- **Break-glass** (#11, #12): Emergency override mechanism. Different purpose.
- **Edge Function security** (#13–15): Deno runtime helpers. Different runtime.
- **Approval workflow** (#20, #21): Action approval, not identity verification.
- **Rate limiting** (#22): DoS protection, not auth.
- **Session state** (#23): Session management, not auth.
- **Ursula auth** (#25, #26): Separate application with different requirements.
- **Python safety** (#18): Different language/runtime.
- **HID key rotation** (#19): Operational tool, not runtime auth.

### 4.3 Recommendations

| Action | Target | Justification |
|--------|--------|---------------|
| **Canonical — identity/RBAC** | `lib/auth/` suite (#1–4) | Well-designed, tested, boot-reachable, 24+ callers |
| **Canonical — policy gate** | `lib/protoforge/policy-engine.js` (#5) | Fail-closed, boot-reachable, tested, 12 callers |
| **Delete (dead code)** | `keeper/policy-engine.js` (#16) | Deprecated, 0 callers, superseded by #5 |
| **Delete (dead code)** | `keeper/crypto/agent-auth.js` (#17) | 0 callers, unused |
| **Keep separate** | All others | Different purposes (capability, webhook, break-glass, rate limiting, session, approval, Ursula, Python, HID) |

---

## 5. Model Access

### 5.1 Inventory Table

| # | Path | LOC | First commit | Last touched | Description | Callers | Tests | Boot-reachable | Status |
|---|------|-----|-------------|-------------|-------------|---------|-------|----------------|--------|
| 1 | `lib/ModelManager.ts` | 590 | 2026-04-30 | 2026-07-17 | Model orchestration: local-first Ollama routing, fallback to Anthropic/OpenAI, circuit breaker, metrics, session state. | 2 | No (tested via orchestrator) | Yes (heidi-web) | **CANONICAL — orchestration** |
| 2 | `lib/heidi-agent.ts` | 127 | 2026-06-23 | 2026-07-15 | Native streaming Anthropic tool-using agent with memory, action execution, SSE. | 1 (pages/api/chat.ts) | No | Yes (heidi-web) | **CANONICAL — streaming agent** |
| 3 | `lib/claude.ts` | 148 | 2026-05-23 | 2026-07-17 | Anthropic client wrapper with system prompts for 6 named agents. | 3 | No | Yes (heidi-web) | **CANONICAL — Anthropic client** |
| 4 | `lib/embeddings.ts` | 140 | 2026-06-23 | 2026-06-23 | Embedding generation via OpenAI or Ollama (zero-pads to 1536-dim for pgvector). | 3 | Yes | Yes (heidi-web) | **CANONICAL — embeddings** |
| 5 | `pao-system/services/llm.service.ts` | 82 | 2026-04-30 | 2026-06-23 | PAO LLM service: Anthropic/OpenAI text generation + embeddings for PAO agents. | 0 | No | No (PAO not in boot) | Complementary (PAO) |
| 6 | `api/local-model.js` | 414 | 2026-04-24 | 2026-07-17 | Local model client (Ollama/LM Studio) with health context, cloud fallback. | 2 | No | No (not in boot path) | **DUPLICATE — of ModelManager** |
| 7 | `heidi-core/brain/ollama-client.js` | 197 | 2026-04-30 | 2026-07-07 | Ollama client for heidi-core: streaming, chat, tool-calling. | 3 | Mocked (`tests/__mocks__/ollama-client-stub.js`) | No (heidi-core) | Complementary (heidi-core) |
| 8 | `src/hydi-v3/ModelManager.js` | 134 | 2026-04-30 | 2026-07-15 | V3 model manager with adapter pattern. | 0 | Yes (via AgentWorkspace test) | No (V3) | Complementary (V3) |
| 9 | `src/hydi-v3/OllamaAdapter.js` | 69 | 2026-04-30 | 2026-07-15 | V3 Ollama adapter. | 1 (#8) | No | No (V3) | Complementary (V3 adapter) |
| 10 | `src/hydi-v3/LMStudioAdapter.js` | 64 | 2026-04-30 | 2026-07-15 | V3 LM Studio adapter. | 1 (#8) | No | No (V3) | Complementary (V3 adapter) |
| 11 | `src/hydi-v3/LlamaCppAdapter.js` | 54 | 2026-04-30 | 2026-07-15 | V3 llama.cpp adapter. | 1 (#8) | No | No (V3) | Complementary (V3 adapter) |
| 12 | `src/models/HybridModelStack.js` | ~950 | 2026-04-30 | 2026-07-15 | Hybrid local/external model stack with cost controls. | 1 (src/server.js) | Yes | Yes (protoforge-core) | Complementary (protoforge-core) |
| 13 | `src/models/local-model-adapter.js` | ~1000 | 2026-04-30 | 2026-07-15 | Local model adapter for Ursula service bundle (13 specialized models). | 2 | Yes | Yes (protoforge-core) | Complementary (Ursula bundle) |
| 14 | `src/orchestrator/HeidiOrchestrator.js` | ~650 | 2026-04-30 | 2026-07-15 | Heidi orchestrator v2: task routing, model selection, drift detection. | 1 | Yes | Yes (hydi-orchestrator) | Complementary (orchestrator) |
| 15 | `apps/ursula-frontend/src/lib/inference-router.ts` | 210 | 2026-06-15 | 2026-07-15 | Ursula inference router: Ollama → OpenVINO → Claude fallback. | 2 | No | No (Ursula frontend) | Complementary (Ursula) |
| 16 | `apps/ursula-frontend/src/lib/healing/claude-healing.ts` | ~150 | 2026-06-15 | 2026-07-15 | Claude healing service for Ursula task failure recovery. | 1 | Yes | No (Ursula frontend) | Complementary (Ursula healing) |
| 17 | `apps/ursula-frontend/src/lib/swarm/task-decomposer.ts` | ~80 | 2026-06-15 | 2026-07-15 | Task decomposition using Claude Opus. | 1 | No | No (Ursula frontend) | Complementary (Ursula swarm) |
| 18 | `apps/ursula-frontend/src/lib/swarm/swarm-coordinator.ts` | ~150 | 2026-06-15 | 2026-07-15 | Swarm coordinator with Claude Opus synthesis. | 0 | No | No (Ursula frontend) | Complementary (Ursula swarm) |
| 19 | `lib/health/collectors/ollama.ts` | 93 | 2026-07-17 | 2026-07-17 | Health monitoring collector for Ollama (status, loaded models, latency). | 1 (HealthService) | Yes | Yes (heidi-web) | **CANONICAL — Ollama health** |
| 20 | `api/chat/route.js` | ~604 | 2026-04-24 | 2026-07-17 | Universal chat router — dispatches to 6 named agents. NOT a model client. | 0 (entry point) | No | No (not in boot path) | Complementary (router, not model client) |

### 5.2 Findings

**True duplicate:**
- `api/local-model.js` (#6) duplicates `lib/ModelManager.ts` (#1) functionality — local model client with cloud fallback — but lacks the circuit breaker, metrics, and session state integration. Not boot-reachable. 2 callers (`api/heidi/route.js`, `pages/api/heidi.js`).

**Not duplicates (intentional layering):**

- **Orchestration vs. client:** `ModelManager.ts` (#1) orchestrates routing; `heidi-agent.ts` (#2) is the streaming agent; `claude.ts` (#3) is the Anthropic client wrapper. Three different layers.
- **PAO LLM service** (#5): Separate TypeScript subsystem (PAO), not in boot path.
- **heidi-core Ollama client** (#7): Serves heidi-core (not in boot path). Different subsystem.
- **V3 adapters** (#8–11): Experimental V3 system with adapter pattern. Not in boot path.
- **HybridModelStack / local-model-adapter** (#12, #13): Serve protoforge-core's Ursula service bundle. Boot-reachable but different domain (13 specialized models for Ursula).
- **HeidiOrchestrator** (#14): hydi-orchestrator module. Different orchestrator.
- **Ursula frontend** (#15–18): Separate frontend app.
- **Ollama health collector** (#19): Observability, not model access.
- **Chat router** (#20): Routing layer, not a model client.

### 5.3 Recommendations

| Action | Target | Justification |
|--------|--------|---------------|
| **Canonical — orchestration** | `lib/ModelManager.ts` | Boot-reachable, circuit breaker, metrics, session state |
| **Canonical — streaming agent** | `lib/heidi-agent.ts` | Native Anthropic streaming, tool use, boot-reachable |
| **Canonical — Anthropic client** | `lib/claude.ts` | Centralized Anthropic client with 6 agent system prompts |
| **Canonical — embeddings** | `lib/embeddings.ts` | Tested, boot-reachable, dual OpenAI/Ollama backend |
| **Canonical — Ollama health** | `lib/health/collectors/ollama.ts` | Boot-reachable, tested, observability |
| **Delete or migrate** | `api/local-model.js` | Duplicate of ModelManager. Migrate 2 callers to ModelManager, then delete. |
| **Keep separate** | #5, #7, #8–18, #20 | Different domains/subsystems, not duplicates |

---

## 6. Migration-Idempotency Baseline Categorization

**Baseline file:** `supabase/migration-lint-baseline.json`
**Total violations:** 136 across 36 files
**Supabase project ref:** `akbnfovjdcobifeupvbn`

### 6.1 Violation Type Breakdown

| Violation type | Count | Files |
|----------------|-------|-------|
| `CREATE POLICY` without `IF NOT EXISTS` or `DO $$` guard | 93 | 28 |
| `CREATE INDEX` without `IF NOT EXISTS` | 26 | 1 |
| `INSERT` without `ON CONFLICT` or `DO $$` guard | 15 | 10 |
| `CREATE TABLE` without `IF NOT EXISTS` | 2 | 2 |

### 6.2 Risk Buckets

#### Bucket A — Trivially Safe to Fix (28 violations, 2 files)

These are `CREATE TABLE` and `CREATE INDEX` violations where the fix is mechanical: add `IF NOT EXISTS`. The fix does not change semantic intent and is safe for both fresh installs and re-runs.

| File | Violations | Type |
|------|-----------|------|
| `20260425161640_add_stripe_connect_subaccount_support.sql` | 7 | CREATE INDEX (×7) |
| `20260424152159_hydi_update_webhook_events.sql` | 1 | CREATE TABLE (×1) |
| `20260426122500_notifications_table.sql` | 1 | CREATE TABLE (×1) — already uses `IF NOT EXISTS` for table; violation is a false positive or edge case |
| `20260430010000_create_users_table.sql` | 7 | CREATE INDEX (×7) |
| `20260623120000_push_subscriptions.sql` | 1 | CREATE INDEX (×1) |
| `20260625200000_procedural_lessons.sql` | 1 | CREATE INDEX (×1) |
| `20260626130000_heidi_event_loop_schema.sql` | 7 | CREATE INDEX (×7) |
| `20260627000001_heidi_telemetry_foundation.sql` | 1 | CREATE INDEX (×1) |

**Note:** `CREATE INDEX IF NOT EXISTS` is natively supported by PostgreSQL. The fix is a one-word insertion. However, see Bucket B caveat: if these migrations have already been applied to the live Supabase project, modifying them retroactively is a desync risk (Supabase tracks applied migrations by filename/hash).

#### Bucket B — Needs Care: Likely Already Applied to Live Supabase (108 violations, 33 files)

These are `CREATE POLICY` (93) and `INSERT` (15) violations. The fixes are more structurally invasive:
- `CREATE POLICY` requires wrapping in `DO $$ ... EXCEPTION WHEN DUPLICATE_OBJECT ... $$` (PostgreSQL has no `CREATE POLICY IF NOT EXISTS`).
- `INSERT` requires adding `ON CONFLICT DO NOTHING` or wrapping in `DO $$ ... EXCEPTION WHEN UNIQUE_VIOLATION ... $$`.

**All migrations from 2026-04-30 onward have likely been applied to the live Supabase project `akbnfovjdcobifeupvbn`.** Modifying applied migrations retroactively can cause:
1. **Migration history desync:** Supabase records applied migrations. If a migration file is modified after being applied, the recorded hash no longer matches. Fresh installs would get the new version; the live database has the old version.
2. **Re-run ambiguity:** If the migration is ever re-run (e.g., during a reset), the new guards might mask issues that the original migration would have surfaced.

**These must NOT be modified without explicit approval.** The safe approach for Bucket B is to add *new* follow-up migrations that wrap the original DDL in idempotent guards, rather than editing the original migration files.

| File | Violations | Types |
|------|-----------|-------|
| `20260101000000_keymaker_core.sql` | 1 | INSERT (×1) |
| `20260424010000_fix_event_bus_dependency.sql` | 2 | CREATE POLICY (×2) |
| `20260424220000_hdi_chaos_safety_schema.sql` | 10 | CREATE POLICY (×9), INSERT (×1) |
| `20260425161640_add_stripe_connect_subaccount_support.sql` | 4 | CREATE POLICY (×3), INSERT (×1) |
| `20260426121300_chat_operator_schema.sql` | 6 | CREATE POLICY (×6) |
| `20260426121400_fix_rls_policies.sql` | 3 | CREATE POLICY (×3) |
| `20260426122500_notifications_table.sql` | 3 | CREATE POLICY (×3) |
| `20260426140000_fix_event_bus_dependency.sql` | 2 | CREATE POLICY (×2) |
| `20260429150000_heidi_memory_layer.sql` | 6 | CREATE POLICY (×6) |
| `20260430010000_create_users_table.sql` | 0 | (all Bucket A) |
| `20260515000000_hydi_phase3_memory_layer.sql` | 4 | CREATE POLICY (×4) |
| `20260522000001_rezonate_schema.sql` | 10 | CREATE POLICY (×10) |
| `20260527000001_infrastructure_health_table.sql` | 2 | CREATE POLICY (×2) |
| `20260528000002_policies_table.sql` | 3 | CREATE POLICY (×3) |
| `20260528000003_decisions_table.sql` | 3 | CREATE POLICY (×3) |
| `20260626140000_seed_procedural_memory.sql` | 6 | INSERT (×6) |
| `20260626150000_heidi_feedback_loop.sql` | 4 | CREATE POLICY (×4) |
| `20260627000001_heidi_telemetry_foundation.sql` | 16 | CREATE POLICY (×16) |
| `20260629120000_seed_heidi_capabilities.sql` | 1 | INSERT (×1) |
| `20260707151854_local_baseline_missing_core_objects.sql` | 2 | CREATE POLICY (×2) |
| `20260714075216_hdi_governance.sql` | 6 | CREATE POLICY (×6) |
| `20260714120000_raw_event_ledger_table.sql` | 2 | CREATE POLICY (×2) |
| `20260714140000_work_sessions_table.sql` | 1 | CREATE POLICY (×1) |
| `20260714150000_promote_action_type_policy.sql` | 1 | CREATE POLICY (×1) |
| `20260715000000_ensure_webhook_events_claim_function.sql` | 1 | INSERT (×1) |
| `20260715120000_agent_control_commands.sql` | 1 | CREATE POLICY (×1) |
| `20260715121000_device_registration_rbac.sql` | 2 | CREATE POLICY (×2) |
| `20260715122000_hydi_subsystem_status.sql` | 3 | CREATE POLICY (×3) |
| `20260715124000_memory_intelligence_foundation.sql` | 1 | INSERT (×1) |
| `20260722000001_customer_identity_convergence.sql` | 1 | INSERT (×1) |

#### Bucket C — Potentially Dead/Superseded Migrations (2 files, 4 violations)

These migrations appear to be superseded by later migrations that create the same objects more idempotently.

| File | Violations | Superseded by | Reason |
|------|-----------|---------------|--------|
| `20260424010000_fix_event_bus_dependency.sql` | 2 (CREATE POLICY ×2) | `20260426140000_fix_event_bus_dependency.sql` | Both create `event_bus_events` table with identical schema. The later one (0426) uses `DROP POLICY IF EXISTS` before `CREATE POLICY`, making it strictly more idempotent. The earlier one (0424) is redundant. |
| `20260426122500_notifications_table.sql` | 3 (CREATE POLICY ×3) | `20260715123000_notifications.sql` | **SCHEMA CONFLICT:** The April migration creates `public.notifications` with columns (type, recipient, channel, status, template). The July migration creates `public.notifications` with **different** columns (category, severity, title, body, device_id, read_at, delivered_at). Both use `CREATE TABLE IF NOT EXISTS`, so if the April migration ran first, the July migration's `CREATE TABLE IF NOT EXISTS` is a no-op — meaning the July migration's new columns are **never added**. This is a latent desync bug that needs investigation. |

**Additional note on `20260426013200_fix_auto_escalate_overloads.sql`:** This migration is superseded by `20260426140200_fix_auto_escalate_overloads.sql` (same function drops, later timestamp). However, it has no baseline violations, so it's not counted in the 136. It should still be flagged for potential removal.

### 6.3 Migration Debt Summary

| Bucket | Count | Files | Risk | Action |
|--------|-------|-------|------|--------|
| **A — Trivially safe** | 28 | ~8 | Low (mechanical `IF NOT EXISTS` addition) | Fix in batches of 10–15 files in Phase 2. Regenerate baseline after each batch. |
| **B — Needs care (likely applied)** | 108 | ~30 | High (desync risk if edited retroactively) | **Do NOT edit original migrations.** Add new follow-up migrations with idempotent guards if needed. Requires explicit approval. |
| **C — Potentially dead/superseded** | 4 | 2 | Medium (removal changes migration history) | Investigate supersession. If confirmed, remove the earlier migration. Requires explicit approval. |

### 6.4 Critical Finding: Notifications Schema Conflict

`20260426122500_notifications_table.sql` and `20260715123000_notifications.sql` both create `public.notifications` with **incompatible schemas**. Both use `CREATE TABLE IF NOT EXISTS`, so whichever runs first wins, and the second is a silent no-op. This means:

- If the April migration ran first (likely, given chronological order), the `notifications` table has the April schema (type, recipient, channel, status, template) and the July migration's columns (category, severity, title, body, device_id, read_at, delivered_at) are **missing**.
- The July migration's indexes (`idx_notifications_unread`, `idx_notifications_category`) would fail to create if the columns don't exist.
- Code expecting the July schema (e.g., `lib/notifications/notify.js`) would break at runtime.

**This requires investigation and likely a new migration that `ALTER TABLE`s the `notifications` table to add the missing columns.** This is flagged for Phase 2 attention but is NOT acted on in Phase 1.

---

## 7. Cross-Cutting Findings

### 7.1 The `setInterval(100ms)` Leak Is Not a Duplication Symptom

The EventBus `setInterval(100ms)` leak in `pao-system/core/event.bus.ts` is a **bug in a single implementation**, not a symptom of two event buses fighting. The canonical `lib/event-bus/EventBus.ts` processes events on-demand (no polling). The PAO bus is only used by `heidi.controller.ts` and is not boot-reachable. The fix is to replace the polling loop with on-demand processing, not to consolidate schedulers.

### 7.2 Dead Code Summary (All Abstractions)

| Abstraction | Dead files | Total dead LOC |
|-------------|-----------|----------------|
| Memory | 4 files (#4, #5, #6, #14) | ~842 |
| Event Bus | 7 files (#6, #7, #8, #9, #10, #17, plus #4 if migrated) | ~2,100 |
| Scheduler | 3 files (#4, #7, #12) | ~1,073 |
| Auth | 2 files (#16, #17) | ~362 |
| Model Access | 1 file (#6 if migrated) | ~414 |
| **Total** | **17–18 files** | **~4,800 LOC** |

### 7.3 Boot-Reachable Canonical Implementations

| Abstraction | Canonical | Boot path |
|-------------|-----------|-----------|
| Memory — Supabase ledger | `lib/protoforge/raw-ledger.ts` | protoforge-core |
| Memory — local-first ledger | `lib/protoforge/local-ledger-store.js` | (local-first path) |
| Memory — semantic | `lib/heidi-memory.ts` | heidi-web |
| Event Bus | `lib/event-bus/EventBus.ts` | heidi-web, ursula-frontend |
| Scheduler — workers | `workers/WorkerOrchestrator.js` | hydi-orchestrator |
| Scheduler — health | `lib/health/HealthPoller.ts` + `lib/health-monitor.js` | protoforge-core |
| Auth — identity | `lib/auth/` suite (rbac, requireAuth, verifyServiceToken, deviceAuth) | heidi-web |
| Auth — policy | `lib/protoforge/policy-engine.js` | protoforge-core |
| Model — orchestration | `lib/ModelManager.ts` | heidi-web |
| Model — streaming | `lib/heidi-agent.ts` | heidi-web |
| Model — Anthropic client | `lib/claude.ts` | heidi-web |
| Model — embeddings | `lib/embeddings.ts` | heidi-web |

### 7.4 Items Requiring Explicit Approval Before Phase 2

1. **Deleting any dead code** — even dead code deletion should be confirmed.
2. **Migrating `modules/protoforge-event-bus.js` callers** to `lib/event-bus/EventBus.ts` — this is boot-reachable and has 5 callers; migration is non-trivial.
3. **Fixing the `setInterval(100ms)` leak** in `pao-system/core/event.bus.ts` — requires deciding whether to fix in place or migrate to canonical bus.
4. **Migrating `api/local-model.js` callers** to `lib/ModelManager.ts` — 2 callers need migration.
5. **Editing any Bucket B migration** — all 108 violations in 30 files are likely already applied to live Supabase.
6. **Removing Bucket C migrations** — supersession needs confirmation.
7. **Investigating the notifications schema conflict** — `20260426122500` vs `20260715123000` create incompatible `notifications` tables.
8. **Reverting the Jest `forceExit: true` workaround** — should only be done after the EventBus leak is fixed and Jest exits naturally.

---

## 8. Phase 1 Completion

This inventory was produced by read-only investigation only. No implementation code, migration SQL, or baseline files were modified. The only file created is `ARCHITECTURAL_INVENTORY.md` (this file).

**Next step:** STOP and await user review of this inventory before any Phase 2 consolidation work begins.
