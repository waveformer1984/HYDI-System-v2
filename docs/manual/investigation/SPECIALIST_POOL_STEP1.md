# Specialist pool — Step 1 investigation

**Branch:** `Cusor_agent01heidi-specialist-pool-7718` (investigation anchored @ `c3aa4d58` from `clean-main`)  
**Scope:** static code + PM2 wiring (no Frank execution)

## Commands

```bash
grep -rE 'claimLease|claimNext|SKIP LOCKED|FOR UPDATE' lib/execution-fabric lib/distributed-cloud
grep -r 'dev-workforce' --include='*.js' --include='*.ts' . | grep -v tests | grep -v node_modules
grep -r 'getExecutionGateway' lib pages api heidi-core --include='*.js' --include='*.ts'
wc -l lib/execution-fabric/*.js lib/dev-workforce/*.js lib/distributed-cloud/*.js
```

## `task-store-postgres` leased claim

**No** `SELECT … FOR UPDATE SKIP LOCKED` (or equivalent RPC) on `execution_fabric_tasks`.

- Leasing is **per-task** `claimLease(id, holder, ttlMs)` — read row, then conditional `UPDATE … WHERE version = expected` (`lib/execution-fabric/task-store-postgres.js:152-179`).
- **No** `claimNext` / dequeue API on the fabric store (contrast `lib/distributed-cloud/control-plane.js:134-158`, which claims under a **file lock** + in-memory pick).
- Stale lease sweep: `listStaleLeases` + `recoverInterruptedTasks` (`lib/execution-fabric/recovery.js`).
- Migration `20261014230000_execution_fabric_tasks.sql` adds `lease_holder`, `lease_expires_at`, index on `lease_expires_at`; **no** claim SQL function.

**Implication for Step 3:** in-process pool can serialize claims in one Node process; safe multi-process clone workers on Postgres need a new atomic claim path (RPC or `SKIP LOCKED`) — not present today.

## Canonical agent base (build here)

**`lib/dev-workforce/` + `lib/execution-fabric/gateway.js`**

- `DevWorkforceCoordinator` — only production path that models “agents” submitting work **exclusively through `ExecutionGateway`** (`lib/dev-workforce/coordinator.js:7-8`).
- `DevWorkforceRegistry` + `types.js` — role/capability permissions; `security-gate.js` blocks privileged fabric caps until operator ack.
- Pool “clones” should be **template-scoped registry entries + gateway.submit**, not a new orchestrator class.

## Duplicates — leave alone

| Area | Why |
|------|-----|
| `src/hydi-v3/BaseAgent.js` | V3 executive/autonomy layer; no production import chain |
| `src/hydi-v3/AgentWorkspace.js` | Read-model for 8 executive agents; tests/demos only |
| `lib/agents/*` (`SpecialistAgent`) | ActionExecutor router; **tests only** (`tests/unit/agents.test.ts`) |
| `pao-system/agents/base.agent.ts` + PAO agents | Different domain (simulated company); unrelated contract |
| `agents/specialized/*` | Legacy business/execution agents |
| `lib/execution-fabric/orchestrator.js` (`ObjectiveOrchestrator`) | Objective plans — do not stack a second planner on top for pool v1 |
| `lib/distributed-cloud/*` as **primary** queue | File-backed control plane + optional Oracle worker later; keep fabric adapter for cross-scheduling only |

## Module table

| module | what it does | reached by running PM2 app | reuse for pool |
|--------|----------------|----------------------------|----------------|
| **lib/dev-workforce** | | | |
| `coordinator.js` | `assign()` → `gateway.submit` with workforce actor + security gate | **N** (tests only) | **Y** — core pool assign path |
| `registry.js` | In-memory agent registrations, permissions | **N** | **Y** — extend for clone/template ids |
| `types.js` | Roles + `PERMISSIONS` defaults | **N** | **Y** |
| `security-gate.js` | Blocks privileged fabric capabilities | **N** | **Y** — align with template cap denylist |
| **lib/execution-fabric** | | | |
| `gateway.js` | Submit/approve/run tasks; `getExecutionGateway()` singleton | **Y** — `heidi-web-standalone` → mobile-ops → `ops-task-actions.js` | **Y** — mandatory execution authority |
| `task-store.js` / `task-store-postgres.js` | Durable tasks + optimistic lease | **Y** (when `EXECUTION_FABRIC_PERSIST=postgres` on web) | **Y** — enqueue subtasks |
| `task-store-memory.js` | In-process store | **Y** (default if env unset) | **Y** — tests |
| `task-store-core.js` | State machine, row mapping | **Y** (via store) | **Y** |
| `capabilities.js` + `registry-unified.js` | Allowlisted capability ids | **Y** (via gateway) | **Y** — template allowed caps |
| `orchestrator.js` | Multi-step objectives | **Y** (via gateway) | **N** as pool driver — mission→subtasks is new pool code |
| `mission-bridge.js` | heidi-core mission ↔ fabric states | **Partial** — if missions enqueued | **Y** (read bridge) |
| `recovery.js` | Stale lease recovery | **Y** on gateway construct | **Y** |
| `verification*.js`, `learn.js`, `access.js` | Verify, redact, learn | **Y** via mobile ops actions | **Y** |
| **lib/distributed-cloud** | | | |
| `control-plane.js` | File queue, `claimNext`, worker routing | **Partial** — in-process snapshot from `heidi-core` / mobile BFF, not PM2 app | **Partial** — Oracle node later, not v1 pool runner |
| `fabric-adapter.js` | Maps distributed task → fabric submit | **N** (smoke/tests) | **N** for v1 (pool uses fabric directly) |
| `store.js` + `lock.js` | JSON state + dir lock | **Partial** (snapshot reads) | **N** for primary store |
| `scheduler.js` | V3 `DistributedCompute` worker pick | **N** | **N** (optional remote worker) |
| **lib/agents** | | | |
| `base-agent.ts` + `*-agent.ts` | SpecialistAgent → ActionExecutor | **N** | **N** |
| `registry.ts` | Agent registry for specialists | **N** | **N** |
| **src/hydi-v3** | | | |
| `BaseAgent.js` | V3 agent stub with `analyze()` | **N** | **N** |
| `AgentWorkspace.js` | Executive workspace view model | **N** (tests/demos) | **N** |

### PM2 reachability notes

- **`heidi-web-standalone` (:3000):** loads `ExecutionGateway` on fabric-related mobile-ops actions (`lib/mobile-ops/ops-task-actions.js:9-10`). `ecosystem.config.js` sets `EXECUTION_FABRIC_PERSIST=postgres` for this app.
- **`heidi-core` (:3459):** `operations-evidence-snapshot.js` embeds `distributed-cloud` **read-only** snapshot (no enqueue).
- **`heidi-mobile-chat` (:3006):** BFF reads distributed snapshot (`pages/api/heidi-mobile/distributed-jobs.js`); does not run pool.
- **`heidi-agent` (:3462):** no direct import of dev-workforce / execution-fabric in tree search.
- **`distributed-cloud-serve.js`:** not declared in `ecosystem.config.js` (manual/opt-in).

## Later steps (same branch, after step 1 approval)

Steps 2–4 landed on `Cusor_agent01heidi-specialist-pool-7718` in a follow-up commit (`f1569323+`); not part of step 1 scope.