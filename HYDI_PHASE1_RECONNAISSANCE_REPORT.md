# HYDI Phase 1 — Reconnaissance Report

**Date:** 2026-08-22
**Branch:** `feat/governed-autonomy`
**HEAD:** `4ddce67`
**Designation at start:** GOVERNED HUMAN PROXY CONTROL PLANE — PRODUCTION-QUALIFIED

## 1. Git State

- **Branch:** `feat/governed-autonomy`
- **HEAD:** `4ddce670ceff25026d3346ded228444a27e92df2`
- **Working tree:** Dirty (3 modified tracked files, 40+ untracked files)
  - Modified: `HEIDI_REAL_COGNITIVE_CYCLE_REPORT.md`, `data/awareness/reflections.json`, `data/memory/reflective_memory.json`
  - Untracked: Various docs, scripts, temp files — all unrelated to control plane
- **No uncommitted control-plane changes**

## 2. PM2 Process State

| Process | Status | Uptime | PID |
|---------|--------|--------|-----|
| hydi-boot | online | 11h | 1740 |
| hydi-watchdog | online | 11h | 22984 |
| hydi-daemon | **NOT RUNNING** | — | — |

hydi-daemon was cleaned up after the last test run. It is not required for the control plane to function — the control plane reads from singleton managers and Supabase.

## 3. Service Availability

| Service | Port | Status |
|---------|------|--------|
| heidi-web | 3000 | 200 (API routes work, pages return 500 — see below) |
| protoforge-core | 3005 | 200 |
| heidi-mobile-chat | 3006 | 200 |
| Ollama | 11434 | 200 |
| Chrome | — | Available at `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Supabase | — | Available (adaptive_operator_events, human_intervention_requests, goal_checkpoints tables verified) |

### Dashboard 500 Issue (PRE-EXISTING)

All Next.js pages (`/`, `/ops`, `/agent-manager`) return HTTP 500 with:
```
TypeError: (0 , react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV) is not a function
```

This is a React 19.2 / Next.js 15.5 SSR compatibility issue in `pages/_app.tsx`. It affects ALL pages, not just `/ops`. API routes work correctly (returning 401 for auth). This is an environmental issue, not caused by control-plane changes.

## 4. Operator API Routes

All 10 routes exist and return 401 (auth required) without tokens — correct behavior:

| Route | Method | HTTP | Auth |
|-------|--------|------|------|
| `/api/operator/status` | GET | 401 | `status:view` |
| `/api/operator/goals` | GET | 401 | `work_sessions:view` |
| `/api/operator/goals/[goalId]` | GET | 401 | `work_sessions:view` |
| `/api/operator/goals/[goalId]/events` | GET | 401 | `work_sessions:view` |
| `/api/operator/interventions` | GET | 401 | `work_sessions:view` |
| `/api/operator/interventions/[id]/approve` | POST | 401 | `actions:approve` |
| `/api/operator/interventions/[id]/reject` | POST | 401 | `actions:approve` |
| `/api/operator/interventions/[id]/cancel` | POST | 401 | `actions:approve` |
| `/api/operator/recovery` | GET | 401 | `work_sessions:view` |
| `/api/operator/stream` | GET (SSE) | 401 | `status:view` |

## 5. Control-Plane Modules

All present in `lib/delegated-operator/`:

| Module | File | Status |
|--------|------|--------|
| OperationalGoalState | `OperationalGoalState.ts` | Present |
| OperationalEvent | `OperationalEvent.ts` | Present |
| HumanProxyControlPlane | `HumanProxyControlPlane.ts` | Present |
| InterventionController | `InterventionController.ts` | Present |
| GoalCheckpointManager | `GoalCheckpoint.ts` | Present |
| GoalStateMachine | `GoalStateMachine.ts` | Present |
| InterventionQueue | `InterventionQueue.ts` | Present |
| DelegatedIdentityManager | `DelegatedIdentity.ts` | Present |
| VerificationContract | `VerificationContract.ts` | Present |
| OperationalStatus | `OperationalStatus.ts` | Present |
| DelegatedOperatorIntegration | `DelegatedOperatorIntegration.ts` | Present |

## 6. Database Schema

`adaptive_operator_events` table columns:
- `id` (auto-increment, NOT `event_id`)
- `goal_id`
- `session_id` (nullable)
- `user_id` (nullable)
- `event_type`
- `payload` (JSONB)
- `created_at`

The OperationalEvent persistence maps `eventId` into `payload._eventId` since the table has `id` not `event_id`. No `sequence` column — sequence is stored in `payload._sequence`.

## 7. Daemon Recovery Ordering

From `scripts/heidi-daemon.ts` (lines 610-629):
1. Self-repair runs first
2. `initializePersistence(supabase)` — attaches persistence to singletons
3. `restoreFromPersistence()` — restores interventions and checkpoints
4. Single-cycle mode (if `--once` flag)

## 8. State Machine Analysis

### Defined States (`GoalRuntimeStatus`)
- `RUNNING`
- `PAUSED`
- `WAITING_FOR_HUMAN`
- `WAITING_FOR_PROVIDER`
- `RECOVERING`
- `COMPLETED` (terminal)
- `PARTIAL` (terminal)
- `FAILED` (terminal)
- `EXPIRED` (terminal)

### NOT Defined
- `REPLANNING` — replanning is handled as `RECOVERING` state
- `VERIFYING` — verification is an event, not a state

### FINDING: PARTIAL terminal inconsistency
`GoalStateMachine.TERMINAL_STATES` includes `PARTIAL`, but `GoalCheckpointManager.listActive()` only filters `['COMPLETED', 'FAILED', 'EXPIRED']` — missing `PARTIAL`. A `PARTIAL` goal would appear as "active" in the control plane but be terminal in the state machine. **This must be fixed in Phase 2.**

## 9. SSE Stream Analysis

Current implementation (`pages/api/operator/stream.ts`):
- Polls every 2 seconds
- Heartbeat every 15 seconds
- **No replay cursor** — reconnecting clients miss events
- **No `Last-Event-ID` support** — standard SSE replay mechanism not implemented
- **Only sends latest event** — doesn't batch multiple new events
- **Event count heuristic is fragile** — `totalActions + totalReplans + totalRecoveries` may not change for all event types
- **No stale connection cleanup** — intervals run forever if `close` event doesn't fire

**These must be hardened in Phase 4.**

## 10. Test Results (Baseline)

### Typecheck
- **115 errors** (matches established baseline)

### Focused Tests (delegated/human-action/adaptive + migrations)
- **104/104 passed** (5 suites)

### Control-Plane Qualification Scripts

| Script | Assertions | Result |
|--------|-----------|--------|
| `test-operational-safety.ts` | 41 | 41/41 passed |
| `test-control-plane-e2e.ts` | 79 | 79/79 passed |
| `test-control-plane-soak.ts` (100 cycles) | 13 | 13/13 passed |
| `test-full-human-proxy-demo.ts` | 42 | 42/42 passed |

### Full Jest Suite (not re-run in this phase)
Previous baseline: 17 failed suites, 301 passed suites. All failures are pre-existing environmental issues (cognitive-core, revenue-engine, communication-layer, etc.). None are control-plane-related.

## 11. Findings Summary

| # | Finding | Severity | Phase |
|---|---------|----------|-------|
| 1 | `PARTIAL` not in `listActive()` terminal filter | Medium | Phase 2 |
| 2 | SSE has no replay cursor | High | Phase 4 |
| 3 | SSE event detection heuristic is fragile | Medium | Phase 4 |
| 4 | SSE no stale connection cleanup | Medium | Phase 4 |
| 5 | `REPLANNING` and `VERIFYING` not defined as states | Low (design choice) | Phase 2 |
| 6 | Dashboard 500 on all pages (React/Next.js SSR) | Environmental | Not blocking |
| 7 | hydi-daemon not running | Expected | Not blocking |
| 8 | Event table has `id` not `event_id` | Known (handled) | Phase 3 |

## 12. Baseline Established

| Metric | Value |
|--------|-------|
| Typecheck errors | 115 |
| Focused tests | 104/104 |
| Safety tests | 41/41 |
| E2E tests | 79/79 |
| Soak tests (100 cycles) | 13/13 |
| Full human proxy demo | 42/42 |
| PM2 processes | hydi-boot + hydi-watchdog online |
| Supabase | Available |
| Chrome | Available |
| Ollama | Available |

**No code was modified during this phase.**
