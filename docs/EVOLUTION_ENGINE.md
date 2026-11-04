# Evolution Engine

Persistent self-improvement for HYDI / Heidi: observe → audit → plan → execute (approved) → verify → rollback → remember.

## Architecture (reuse, no duplicate orchestrators)

| Component | Location | Reuses |
|-----------|----------|--------|
| SystemObserver | `lib/evolution-engine/system-observer.js` | Frank snapshot, optional HTTP probes |
| CapabilityAuditor | `lib/evolution-engine/capability-auditor.js` | `lib/execution-fabric/registry-unified`, `lib/observation/fix-list` |
| PerformanceAnalyzer | `lib/evolution-engine/performance-analyzer.js` | `evolution/self-assessment.js` |
| MemoryAuditor | `lib/evolution-engine/memory-auditor.js` | Same contract as chat `memory audit` (inject on host) |
| SecurityAuditor | `lib/evolution-engine/security-auditor.js` | `lib/cost/paid-llm-gate.js` |
| SourceQualityAuditor | `lib/evolution-engine/source-quality-auditor.js` | Read-only repo scans |
| ImprovementPlanner | `lib/evolution-engine/improvement-planner.js` | Ranks findings into backlog |
| ExecutionCoordinator | `lib/evolution-engine/execution-coordinator.js` | Isolated `.runtime/evolution/workspace` |
| VerificationEngine | `lib/evolution-engine/verification-engine.js` | Bounded Jest |
| RollbackManager | `lib/evolution-engine/rollback-manager.js` | File snapshots per attempt |
| EvolutionMemory | `lib/evolution-engine/evolution-memory.js` | `.runtime/evolution/events.jsonl` |

Long-running goal execution and Supabase-backed cycles remain in `evolution/self-evolve-cycle.js` and `evolution/heidi-goals.js`. The engine does **not** replace execution-fabric; mobile ops invoke typed actions and objectives.

## Control plane

- Protected write boundaries: `protected-boundaries.js` (RBAC, migrations, control-plane modules).
- Approval contract per run: base SHA, allowed paths, frozen verification, TTL, `implement_only` scope.
- Durable runs: `run-store.js` (idempotency, leases, lifecycle); poll via `evolution.run_status`.
- Emergency stop: `evolution.emergency_stop` or `.runtime/evolution/EMERGENCY_STOP`.
- Evidence manifests: `evidence/<run_id>.json` with completeness check.
- Trend metrics: `metrics.jsonl` (`not_measured` when unavailable).
- Blocking architecture map: `node scripts/evolution-architecture-audit.js`.

## Operator gates

- `EVOLUTION_ALLOW_EXECUTE=true` — apply workspace patches (never `clean-main` directly).
- `EVOLUTION_ALLOW_GIT=true` — future git branch/PR helpers (off by default).
- `EVOLUTION_ALLOW_DESTRUCTIVE=true` — security/credential class changes (off by default).
- Mobile: `evolution.execute` and `evolution.rollback` require confirm + fabric permission.

## CLI

```bash
node scripts/evolution-engine.js status
node scripts/evolution-engine.js audit
node scripts/evolution-engine.js plan
node scripts/evolution-engine.js history
node scripts/evolution-engine.js verify --suite evolution
```

## Mobile

Typed actions: `evolution.status`, `evolution.audit`, `evolution.plan`, `evolution.history`, `evolution.execute`, `evolution.execute_async`, `evolution.run_status`, `evolution.rollback`, `evolution.verify`, `evolution.emergency_stop`.

Jobs: `job.evolution.improvement` (runs `scripts/evolution-execute.js`).

Objectives: `ops.evolution-audit` (read-only bundle); `ops.evolution-vertical-slice` (audit → plan → async execute).

See [EVOLUTION_VERTICAL_SLICE.md](./EVOLUTION_VERTICAL_SLICE.md) for Frank operator steps.

## Tests

Hermetic cycle (detect → plan → verify failure → rollback → memory):

```bash
npx jest tests/unit/evolution-engine-cycle.test.js --runInBand
```

Suite name for phones: `tests.run` with `{ "suite": "evolution" }`.
