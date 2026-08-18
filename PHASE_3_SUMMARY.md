# Phase 3 Summary — Failure Injection & Self-Recovery Framework

## What Phase 3 Built

Phase 3 added an operational intelligence layer that lets Heidi observe its own runtime state, detect failures with evidence (not assumptions), and perform bounded recovery with verification. Prior to Phase 3, the system had no way to answer "is protoforge-core actually healthy?" beyond checking if a port was open — which is insufficient (a wrong process can occupy a port, or a process can be alive but non-functional).

### Core Modules

| Module | Purpose |
|--------|---------|
| `SystemStateModel.ts` | Tracks component states: UNKNOWN, STARTING, HEALTHY, DEGRADED, UNAVAILABLE, RECOVERING, FAILED, BLOCKED, ESCALATION_REQUIRED |
| `HealthProvenanceChecker.ts` | Reality-based health checks: port + process identity + endpoint response + dependency state + functional probes (database write/read, Ollama model availability) |
| `DependencyGraphBuilder.ts` | Builds a machine-readable dependency graph from `boot.config.json` — determines recovery order and causal chains |
| `CapabilityAuthorizer.ts` | Security boundary: explicit capability allowlist for autonomous actions, no arbitrary execution |
| `RecoveryEngine.ts` | Bounded recovery: spawns detached processes from `boot.config.json`, verifies postconditions, caps grace period at 30s |
| `OperationalMemory.ts` | Durable event log at `.hydi-operational/operational-events.jsonl` — append-only, survives restarts |
| `IncidentCorrelator.ts` | Correlates multiple failures into root-cause incidents (e.g., database down → ProtoForge down → Heidi degraded = one incident, not three) |
| `DiagnosticSnapshot.ts` | Full system snapshot: repo identity, runtime, components, dependency graph, persistence, recovery history, security state |

### CLI Tools

| Command | Purpose |
|---------|---------|
| `npm run hydi:diagnose` | Full diagnostic snapshot (human-readable or `--json`) |
| `npm run hydi:recover` | Bounded recovery with verification (`--component=X` or auto-recover all unhealthy) |

### Key Principle: No False Greens

A component is only HEALTHY if there is a complete evidence chain answering "why do you believe this is healthy?" A port being open is not sufficient. A process existing is not sufficient. A restart command returning exit code 0 is not sufficient. Functional postconditions are required.

`UNKNOWN` is never collapsed into `HEALTHY` or `FAILED`. If the system cannot answer "why do you believe this is healthy?", the state MUST be `UNKNOWN`.

## What Phase 3 Proved (Live Demonstrations)

Three classes of failure were injected against the real local runtime:

### 1. Process Failure (PASS)
- `protoforge-core` (PID found via port 3005 lookup) was killed with `Stop-Process`
- Health checker detected: port not listening, process not running
- State transitioned: HEALTHY → UNAVAILABLE
- Recovery engine spawned a detached replacement process from `boot.config.json`
- Postcondition verified: port listening, process identity correct, health endpoint returning OK
- State transitioned: UNAVAILABLE → RECOVERING → HEALTHY
- All events persisted to `.hydi-operational/operational-events.jsonl`

### 2. Wrong-Process / Port Corruption (PASS)
- A Python HTTP server was started on port 3005 (the port `protoforge-core` expects)
- Health checker detected: port listening BUT process identity is `python.exe`, not `node.exe`
- State correctly reported as UNAVAILABLE (not HEALTHY — no false green)
- This is the case that a simple port check would miss

### 3. Dependency Failure (PASS)
- Database dependency was simulated as unavailable
- `protoforge-core` was correctly classified as BLOCKED (not UNAVAILABLE — the process itself is fine, its dependency is down)
- Recovery engine recovered the root dependency first
- `protoforge-core` was NOT unnecessarily restarted — it was unblocked when its dependency recovered

## Runtime Issues Found and Fixed During Phase 3

Phase 3 uncovered four runtime gaps that static analysis and unit tests missed:

1. **CLI TypeScript runtime loading** — `hydi-diagnose.js` and `hydi-recover.js` used CommonJS `require()` against `.ts` files, which Node cannot load directly. Fixed by adding `scripts/babel-register.js` with `@babel/register` using the same Babel presets as Jest.

2. **Detached recovery process lifetime** — Recovery spawned child processes that were killed when the CLI exited (stored in `spawnedProcesses`, killed by `destroy()`). Fixed by spawning detached processes with `unref()` and ignored stdio, so recovered services survive CLI shutdown.

3. **Uncapped recovery grace period** — `protoforge-core` has `graceMs: 300000` (5 minutes) in `boot.config.json`. Recovery would wait up to 5 minutes per attempt. Fixed by adding a practical recovery grace cap of 30 seconds in `RecoveryEngine.ts`. Boot grace remains the source configuration for normal startup.

4. **Missing durable operational-event wiring** — `OperationalIntelligence.wireEventLog()` was a stub, and `SystemStateModel.logEvent()` stored events only in memory. The `.hydi-operational/operational-events.jsonl` file was never created from normal diagnostics. Fixed by adding an event-forwarder callback to `SystemStateModel` and wiring it to `OperationalMemory.record()`.

## Test Results

- 6 test suites, 51 tests, all passing
- Full regression: 268 suites, 2549 passed, 1 skipped, 0 failed (no regression to existing tests)
- Typecheck: PASS
- Lint: 0 errors, 768 pre-existing warnings

## Gate State

All 11 Phase 3 gates passed:
- P3-G0_BASELINE, P3-G1_STATE_MODEL, P3-G2_HEALTH_PROVENANCE, P3-G3_DEPENDENCY_GRAPH, P3-G4_FAILURE_DETECTION, P3-G5_RECOVERY_ENGINE, P3-G6_RECOVERY_VERIFICATION, P3-G7_OPERATIONAL_MEMORY, P3-G8_SECURITY_BOUNDARIES, P3-G9_END_TO_END_AUTONOMY, P3-G10_REGRESSION

Final status: **PHASE 3 PASS**

## Important Note

Phase 3's recovery engine is currently invoked manually (`npm run hydi:recover`). It is NOT wired to run continuously or unattended. The question of whether it should run automatically in the background is addressed in `SUPERVISION_MODEL.md` and requires explicit user approval.
