# HYDI Phase 6 — Supabase Dependency Inventory

## Method

- Grep for `createClient`, `@supabase`, `supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `system_dashboard`, `SupabaseJobQueue`, `SupabaseStore` in `api/`, `lib/`, `workers/`, `protoforge/`, `cascade/`.
- Read representative files from each subsystem.
- Classify each hit as runtime-critical, optional cloud integration, test, documentation, or dead code.
- Determine whether the dependency prevents `HYDI` from running locally with no cloud.

## Classification legend

| Class | Meaning |
|---|---|
| A | Runtime-critical for local-first HYDI |
| B | Optional cloud integration / enhancement |
| C | Test only |
| D | Documentation |
| E | Historical/dead code |
| F | Migration/backup tooling |
| G | Browser/public code |

## Inventory

### Health / status

| File | Subsystem | Purpose | Current dependency | Data contract | Class | Local replacement | Difficulty | Risk | Test coverage | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| `api/health.js` | health API | Returns system health snapshot | `system_dashboard` Supabase view | `{ status, hydi_status, metrics, ... }` | A | Local JSON dashboard store | low | low | none | high |
| `api/mobile-status.js` | mobile API | Compact health + revenue streams | `system_dashboard` + `financial_ledger` | `{ ok, alert, system, streams, silent }` | A | Local dashboard + local ledger | low-medium | low | none | high |
| `api/status/system.js` | status API | Subsystem/worker snapshot | `hydi_subsystem_status`, `hydi_status_events`, `worker_status` | `{ health_score, subsystems, workers, recent_events }` | A | Local subsystem registry + local worker registry | medium | low | none | high |
| `api/ursula/status.js` | ursula API | Formatted chat status | `system_dashboard` + `infrastructure_health` + `auto_heal_from_trends` | `{ ursula, metrics, trend, auto_heal, rezonate }` | A | Local dashboard store + local auto-heal registry | medium | low | none | high |
| `lib/health/collectors/database.ts` | health collector | Database layer health | `system_dashboard`, `sessions`, `actions`, `memories`, `worker_jobs`, `worker_status`, `financial_ledger`, `get_hydi_context` | `Partial<HealthSnapshot>` with `database` fields | A | Probe local stores, report unknown for cloud tables | medium | medium | existing | high |
| `lib/health/collectors/workers.ts` | health collector | Worker fleet health | `worker_status` table | `Partial<HealthSnapshot>` with `workers` fields | A | Local worker registry | medium | low | existing | high |
| `lib/health/types.ts` | health types | Shared types | none | `HealthSnapshot`, `HealthStatus`, etc. | D | none | N/A | N/A | N/A | N/A |
| `lib/health/utils.ts` | health utilities | Merge snapshots | none | utility | D | none | N/A | N/A | N/A | N/A |

### Workers / job queue

| File | Subsystem | Purpose | Current dependency | Data contract | Class | Local replacement | Difficulty | Risk | Test coverage | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| `lib/jobs/stores/SupabaseJobQueue.ts` | job queue | Supabase job queue implementation | `worker_queues` table, RPCs `enqueue_task`, `dequeue_task`, `complete_task` | `Job` with `id`, `status`, `attempts`, etc. | B | Use existing `MemoryJobQueue`; add durable local JSON store | low | low | existing for `MemoryJobQueue` | high |
| `lib/jobs/index.ts` | job queue | Exports queue impl | none (defaults `MemoryJobQueue`) | module | D | none | N/A | N/A | N/A | N/A |
| `lib/jobs/stores/MemoryJobQueue.ts` | job queue | In-memory queue | none | same as `JobQueue` | D | already local | N/A | N/A | existing | N/A |
| `workers/QueueManager.js` | workers | Worker task queue manager | `worker_queues` table, `worker_status` table, RPCs | job + status | A | `MemoryJobQueue` + local worker registry | medium | medium | none | high |
| `workers/WorkerOrchestrator.js` | workers | Spawns and supervises workers | `agent_control_commands` table, `worker_status` | command + status | A | local command queue + local worker registry | medium | medium | none | high |
| `workers/*.js` (individual) | workers | 18 worker implementations | each imports `lib/server.ts` or uses `QueueManager` | varies | A | use local queue/status | medium | medium | none | medium |

### ProtoForge / CASCADE

| File | Subsystem | Purpose | Current dependency | Data contract | Class | Local replacement | Difficulty | Risk | Test coverage | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| `lib/protoforge/policy-engine.js` | policy | Policy gate for KILO hypotheses | `policies` table (read), `decisions` table (write), Supabase Realtime | rule: `{ id, priority, if, then }`; decision: `{ decisionId, ... }` | A | Local JSON policy/decision store | medium | high (fail-closed must remain) | existing | high |
| `lib/protoforge/raw-ledger.ts` | ledger | Immutable raw event ledger | `raw_event_ledger` table | `{ fingerprint, event_type, payload, hash, created_at }` | A | Local append-only JSON/SQLite | medium | high (single source of truth) | existing | high |
| `lib/protoforge/auto-gate.js` | policy | Wraps policy engine, escalation queue | `actions` table | hypothesis + decision | A | local escalation queue | medium | high | none | high |
| `lib/protoforge/dispatcher.ts` | actions | Dispatch approved actions | `actions` table, `updateSessionState` | `{ type, payload, risk, reversible }` | A | local action queue + local session store | medium | high | none | high |
| `protoforge/cascade/src/index.js` | CASCADE | Event classifier entry | LedgerAdapter with Supabase | ledger interface | A | local file-based LedgerAdapter | medium | high | existing | high |
| `protoforge/cascade/src/adapters/ledger-adapter.js` | CASCADE | Read raw ledger | `raw_event_ledger` table | gateway record | A | local JSON adapter | medium | high | none | high |
| `protoforge/cascade/src/router.js` | CASCADE | HTTP router | none | router | D | already local | N/A | N/A | N/A | N/A |
| `protoforge/cascade/src/processor.js` | CASCADE | Event normalization | none | normalized event | D | already local | N/A | N/A | N/A | N/A |

### Chat / memory

| File | Subsystem | Purpose | Current dependency | Data contract | Class | Local replacement | Difficulty | Risk | Test coverage | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| `api/chat/route.js` | chat | Chat routing | `system_dashboard` view, `auto_heal_from_trends` RPC | system dashboard + auto-heal | A | Local status store; call PAO `HeidiController` | low | low | none | high |
| `lib/heidi-memory.ts` | memory | Semantic memory | `memories` table, `search_memories` RPC | `{ user_id, session_id, content, embedding }` | A | Local JSON + in-memory search (full-text for local) | medium | medium | none | high |
| `lib/session-state.ts` | state | Session state | `sessions` table | `SessionState` | A | Local JSON store | low | low | none | high |
| `lib/work-sessions.ts` | work | Multi-step work sessions | `work_sessions` table | `WorkSession` | A | Local JSON store | medium | medium | none | high |
| `lib/episodic-memory.ts` | memory | Experience memory | `memories` table with `kind='episodic'` | experience metadata | A | Local JSON store | medium | medium | none | high |

### Revenue / financial

| File | Subsystem | Purpose | Current dependency | Data contract | Class | Local replacement | Difficulty | Risk | Test coverage | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| `lib/dashboard/revenue-service.js` | revenue | Revenue dashboard | `financial_ledger` table | stream summary | B | SQLite ledger or remove from local-first core | high | very high (financial) | none | low |
| `revenue-engine/index.js` | revenue | Revenue pipeline | `leads`, `outreach`, `proposals`, `quotes`, `checkout_sessions`, `revenue_dashboard` | revenue lifecycle | B | SQLite or leave BLOCKED | high | very high (Stripe) | none | low |
| `api/revenue.js` | revenue | Revenue API | `financial_ledger`, etc. | revenue endpoints | B | SQLite or leave BLOCKED | high | very high | none | low |
| `api/stripe-connect-webhook.js` | revenue | Stripe Connect webhook | Supabase client | payment events | B | external — cannot be local-only | N/A | N/A | N/A | N/A |

### Direct client utilities

| File | Subsystem | Purpose | Current dependency | Class | Notes |
|---|---|---|---|---|---|
| `lib/server.ts` | supabase client | Server-side Supabase client factory | env vars | E | Shared utility; consumers must be migrated |
| `lib/client.ts` | supabase client | Browser client | G | Browser-only, not runtime for local HYDI |
| `lib/middleware.ts` | supabase client | Middleware client | G | Browser/auth, not runtime for local HYDI |
| `lib/bootstrap.ts` | supabase client | App bootstrap + client | B | Bootstrap; not required if local-only |

### Tests / docs / edge functions

- `tests/unit/*` — some tests reference Supabase or `system_dashboard`. Class C.
- `supabase/functions/*` — Deno Edge Functions. Class B/F. Not in local-first Node runtime.
- `supabase/migrations/*` — SQL schema. Class F.
- `*.md` documentation — Class D.

## Summary

### Counts by class

| Class | Count |
|---|---|
| A (runtime-critical) | ~25 |
| B (optional cloud / financial) | ~5 |
| C (tests) | many |
| D (docs/types/utilities) | many |
| E (client utilities) | 3 |
| F/G (migrations/edge/browser) | many |

### Top priority runtime-critical migrations

1. Health/status (`api/health.js`, `mobile-status.js`, `status/system.js`, `ursula/status.js`, `lib/health/collectors/*`).
2. Job queue/worker status (`workers/QueueManager.js`, `WorkerOrchestrator.js`).
3. ProtoForge policy store (`lib/protoforge/policy-engine.js`, `auto-gate.js`, `dispatcher.ts`).
4. Raw event ledger (`lib/protoforge/raw-ledger.ts`, `protoforge/cascade/src/adapters/ledger-adapter.js`).
5. Chat session/work/memory (`lib/session-state.ts`, `lib/work-sessions.ts`, `lib/heidi-memory.ts`, `lib/episodic-memory.ts`).

### Leave as optional / blocked

- Revenue/Stripe subsystems (high risk, external authority).
- Supabase Edge Functions (Deno, not local Node).
- Browser client utilities.

## Next action

Start with health/status because every other local-first migration depends on truthful observability, and the data contracts are small and well-defined.
