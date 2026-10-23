# HEIDI Operational Intelligence Layer

> Phase 1 — System inventory and architectural dependency map for the next HEIDI evolution: autonomous operational observation, classification, diagnosis, recovery, and verification.

## Repository state

* Branch: `release/v0.9.0`
* HEAD: `66e7fed` `docs(hydi): Phase 10 Gate D failure injection qualification`
* Work tree: dirty (Phase 10 Gate D evidence + uncommitted WSL `docker compose` routing in `scripts/lib/soak-chaos.js`)

## Existing subsystems located

| Subsystem | Entry point | Responsibility | Status |
|---|---|---|---|
| HEIDI Executive / Control Plane | `src/heidi-executive/` | Capability-registered, policy-gated, audited task execution | Active |
| HEIDI Executive Agent | `src/heidi-executive/HeidiExecutive.js` | Task lifecycle, approval, execution, recovery, audit | Active |
| Capability Registry | `src/heidi-executive/CapabilityRegistry.js` | Registers capabilities, timeouts, retry policy, risk levels | Active |
| Health Aggregator | `src/heidi-executive/HealthAggregator.js` | Collects per-component health checkers, returns `HEALTHY`/`DEGRADED`/`UNAVAILABLE`/`UNKNOWN` | Active |
| Local Health Probes | `src/heidi-executive/LocalHealthProbes.js` | `persistence`, `postgres`, `ollama`, `docker`, `workers`, `controlPlane`, `inbucket` | Active (needs WSL/Docker fix and more probes) |
| Controlled Executor | `src/heidi-executive/ControlledExecutor.js` | Executes allowlisted `docker.local`, `database.local`, `wsl.local`, `health.recover`, etc. | Active (needs WSL routing and more recovery operations) |
| Local Recovery Workflow | `src/heidi-executive/LocalRecoveryWorkflow.js` | One bounded recovery workflow for a configured safe service | Active |
| Policy Engine | `src/heidi-executive/PolicyEngine.js` | Deterministic policy checks for task + actor | Active |
| Approval Manager | `src/heidi-executive/ApprovalManager.js` | Approval records, self-approval prohibition | Active |
| Audit Log | `src/heidi-executive/AuditLog.js` | Records every task, redacts inputs | Active |
| Secret Broker | `src/heidi-executive/SecretBroker.js` | Redacts credentials in logs/reports | Active |
| Task State Machine | `src/heidi-executive/TaskStateMachine.js` | Prevents illegal state transitions | Active |
| Mission Planner | `src/heidi-executive/MissionPlanner.js` | Bounded task graphs from goals | Active |
| Recovery Engine | `src/heidi-executive/RecoveryEngine.js` | Bounded retries for recoverable failures | Active |
| Dry Run Executor | `src/heidi-executive/DryRunExecutor.js` | Previews medium/high/critical actions | Active |
| HYDI System Orchestrator | `src/HYDISystem.js` | Main system integration and coordination | Active (per `system-manifest.json`) |
| HYDI Core | `hydi-core.js` | Central orchestrator on port `9997` | Runtime service |
| Memory Engine | `memory-engine.js` | Unified memory system on port `9998` | Runtime service |
| Heidi Bridge | `C:\ProtoForge_Ecosystem\heidi-bridge.py` | Bridges ProtoForge local data to cloud systems on port `5050` | Runtime service |
| Next.js Frontend / API | `npm run dev` | Main UI/API on port `3000` | Runtime service |
| Heidi Mobile | `launch-heidi-mobile.js` | Local mobile chat on port `3006` | Runtime service |
| ProtoForge Forge Loop | `forge-loop.ps1` | Periodic build automation (PowerShell) | Runtime service |
| Process Supervisor | `supervisor.js` | Dependency-aware startup, health checks, auto-restart | Active |
| Service Manifest | `services-manifest.json` | Runtime service definitions, ports, health checks, dependencies | Active |
| System Manifest | `system-manifest.json` | Conceptual service graph, data flows, API endpoints | Active |
| Operational Qualification | `operational-qualification/` | Lifecycle, workloads, failure injection, metrics, reports | Active |
| Chaos / Failure Injection | `scripts/lib/soak-chaos.js` | `ChaosOrchestrator`, `ServiceRestartScenario`, `DockerServiceRestartScenario` | Active (WSL-routing fix in working tree) |
| Stack Orchestrator | `operational-qualification/orchestrator/stack-orchestrator.js` | Starts/stops the runtime stack for qualification | Active |
| Metrics Collector | `operational-qualification/metrics/metrics-collector.js` | CPU, memory, process count, dependency latency | Active |
| KILO hypothesis generator | `kilo/index.js` | Analysis / hypothesis engine | Active |
| ProtoForge policy engine | `lib/protoforge/policy-engine.js` | Policy decisions, fail-closed defaults | Active |
| HYDI V3 executive layer | `src/hydi-v3/index.js` | 70+ modules including `ObservabilityDashboard`, `SelfHealingEngine`, `WatchdogSupervisor` | Active (large surface) |
| CASCADE classifier | `modules/cascade-complete-v2.js` / `cascade/` | Event classification (INFRA_FAILURE, ROUTE_FAILURE, UNKNOWN_ANOMALY, ...) | Active |
| Supabase / PostgreSQL | `supabase/` / WSL Docker | Persistent data on `127.0.0.1:54321/54322` | External |
| Redis | Ursula Suite docker compose | Cache on `127.0.0.1:6379` | External |
| ProtoHub API | Ursula Suite docker compose | Flask API on `127.0.0.1:4000` | External |
| Ollama | optional local LLM | `http://127.0.0.1:11434` | Optional external |

## Architectural dependency map (derived)

```text
HEIDI Operational Intelligence
├── src/heidi-executive/ (control plane)
│   ├── HealthAggregator
│   │   ├── LocalHealthProbes
│   │   │   ├── Supabase REST (127.0.0.1:54321)
│   │   │   ├── PostgreSQL container (docker ps)
│   │   │   ├── Ollama (127.0.0.1:11434)
│   │   │   ├── Docker daemon (docker version)
│   │   │   ├── inbucket container
│   │   │   └── workers (NOT_CONFIGURED)
│   │   └── ServiceHealthProbes (from services-manifest.json)
│   │       ├── memory-engine (9998)
│   │       ├── hydi-core (9997)
│   │       ├── heidi-bridge (5050)
│   │       ├── next-app (3000)
│   │       ├── heidi-mobile (3006)
│   │       └── docker-stack / protohub-api (4000)
│   ├── ControlledExecutor
│   │   ├── docker.local (status / restart_service)
│   │   ├── wsl.local (placeholder)
│   │   ├── database.local (status)
│   │   ├── health.recover (restart safe containers)
│   │   └── forbidden: deploy.production, credential.production, financial.transaction, database.destructive
│   ├── HeidiExecutive (run → verify → recover → audit)
│   ├── RecoveryEngine (bounded retries)
│   ├── PolicyEngine + ApprovalManager + AuditLog
│   └── LocalRecoveryWorkflow
│
├── Runtime process layer (supervisor.js / services-manifest.json)
│   ├── memory-engine
│   ├── hydi-core ──► memory-engine
│   ├── docker-stack (postgres + redis + protohub-api)
│   ├── heidi-bridge ──► docker-stack
│   ├── next-app ──► docker-stack
│   ├── heidi-mobile
│   └── forge-loop ──► heidi-bridge
│
├── Data / model layer
│   ├── HYDI Brain / HYDISystem.js ──► Supabase, Stripe, local files
│   ├── HeidiMemorySystem
│   ├── HybridModelStack ──► LocalModelAdapter, Ollama
│   └── LocalModelAdapter
│
├── External infrastructure
│   ├── WSL2 Ubuntu (dockerd)
│   ├── Docker daemon (inside WSL)
│   ├── Supabase (Kong 54321, DB 54322)
│   ├── PostgreSQL (5432)
│   ├── Redis (6379)
│   └── ProtoHub (4000)
```

## Health / availability endpoints

| Component | Health endpoint | Transport |
|---|---|---|
| memory-engine | `http://localhost:9998/health` | HTTP |
| hydi-core | `http://localhost:9997/health` | HTTP |
| heidi-bridge | `http://localhost:5050/health` | HTTP |
| next-app | `http://localhost:3000/` and `/api/health` | HTTP |
| heidi-mobile | `http://localhost:3006/api/health` | HTTP |
| protohub-api | `http://localhost:4000/health` | HTTP |
| supervisor | `http://localhost:9999/health` | HTTP |
| Kong | `http://127.0.0.1:54321/auth/v1/health` | HTTP |
| PostgreSQL TCP | `127.0.0.1:5432` | TCP |
| Redis TCP | `127.0.0.1:6379` | TCP |
| Ollama | `http://127.0.0.1:11434/api/tags` | HTTP |
| WSL | `wsl -d Ubuntu -e ...` | child_process |
| Docker | `wsl -d Ubuntu -e docker version` | child_process |

## Operational state vocabulary (already present or to be used)

`HEALTHY`, `DEGRADED`, `UNAVAILABLE`, `NOT_CONFIGURED`, `UNKNOWN`, `RECOVERING`, `RECOVERY_FAILED`.

## Gaps identified (target for the new evolution)

1. `LocalHealthProbes.docker()` calls the Windows `docker` CLI, which is not connected to the live WSL2 `dockerd`. It must route through `wsl -d Ubuntu -e docker ...`.
2. No explicit WSL runtime health probe (is `wsl` responding? is `dockerd` responding?).
3. No container restart-count / crash-loop detection.
4. No resource-pressure probes (CPU, memory, disk) in the control plane.
5. No failure taxonomy / classifier connected to `CASCADE`.
6. No durable incident store beyond the in-memory `AuditLog`.
7. No bounded Docker/WSL recovery executor (`docker compose restart`, `wsl docker` operations).
8. No `heidi diagnose` command that surfaces the dependency graph and recent incidents.
9. No explicit autonomy matrix documented for the new Docker/runtime capabilities.
10. Dashboard live polling is not wired to `src/heidi-executive/HealthAggregator`.

## Implementation target

Extend the existing `src/heidi-executive/` subsystem rather than creating a competing one:

* `LocalHealthProbes.js` — add WSL/Docker-aware probes and per-service health.
* `ControlledExecutor.js` — add WSL `docker`/`docker compose` executors with strict allowlists.
* New `RuntimeObserver.js` — container / crash-loop / resource forensics.
* New `FailureClassifier.js` — bounded taxonomy + confidence.
* New `IncidentStore.js` — durable, append-only incident records.
* New `DiagnosticCommand.js` — `heidi diagnose` output.
* Extend `HeidiExecutive.js` to route recovery through verification.
* Update `docs/HEIDI_OPERATIONAL_*` docs and add the required five documents.

## Test results

```text
npx jest tests/unit/heidi-executive/
```

```text
Test Suites: 3 passed, 3 total
Tests:       50 passed, 50 total
```

Includes the original 26 control-plane tests plus the new 8 operational-intelligence tests. No regressions.

## Quick commands

```text
node src/heidi-executive/DiagnosticCommand.js
npx jest tests/unit/heidi-executive/operational-intelligence.test.js
```
