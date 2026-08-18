# HYDI Operational Intelligence Architecture

**Phase 3 — Self-Verifying Local-First Operational Intelligence**

## 1. Purpose

HYDI must never claim something happened merely because it attempted it. This document describes the architecture that transforms HYDI from a system that can be manually diagnosed into a system that establishes reality, detects deviation, classifies failure, recovers with bounds, verifies recovery, records evidence, and learns from events.

The operating model is:

```
OBSERVE → ESTABLISH REALITY → UNDERSTAND STATE → DETECT DEVIATION
       → CLASSIFY FAILURE → RECOVER WITH BOUNDS → VERIFY RECOVERY
       → RECORD EVIDENCE → LEARN FROM THE EVENT
```

## 2. Core Principles

1. **No false greens.** A component is HEALTHY only when an evidence chain proves it. A wrong process on the right port is UNAVAILABLE, not HEALTHY.
2. **UNKNOWN is never collapsed.** If the system cannot answer "why do you believe this is healthy?", the state is UNKNOWN — not HEALTHY, not FAILED.
3. **Recovery is bounded.** Every action has a retry budget, cooldown, postcondition, and escalation path. No infinite retries. No arbitrary shell execution.
4. **Recovery is verified.** A restart command returning zero is not success. Success requires: process healthy + listener correct + endpoint responding + dependency graph healthy + functional probe succeeds.
5. **Recovery is causal.** If Ollama fails, ProtoForge and Heidi are not restarted unless dependency analysis proves it is necessary.
6. **Recovery is idempotent.** If the component is already healthy, recover() verifies state and returns without restarting.
7. **AI is not the source of truth.** Health determinations are made by deterministic probes, not LLM output.
8. **Local-first.** Operational evidence is recorded locally. Cloud persistence is not a prerequisite for recording local operational state.

## 3. Component State Model

Every component in the system is tracked with one of eight states. States are never collapsed.

| State | Meaning |
|-------|---------|
| `UNKNOWN` | No evidence collected yet. NOT the same as HEALTHY or FAILED. |
| `STARTING` | Process launched, waiting for readiness. |
| `HEALTHY` | All checks passed, evidence chain complete. |
| `DEGRADED` | Partially functional — some checks failed, others passed. |
| `UNAVAILABLE` | Process/port/endpoint not responding. |
| `RECOVERING` | Recovery action in progress. |
| `FAILED` | Recovery attempted and exhausted, or unrecoverable. |
| `BLOCKED` | Cannot proceed — dependency failed or policy denial. |

**Severity ordering:**
```
HEALTHY < STARTING < DEGRADED < UNKNOWN < UNAVAILABLE < RECOVERING < BLOCKED < FAILED
```

The overall system state is the worst state across all registered components.

**Implementation:** `lib/operational/SystemStateModel.ts`

## 4. Health Provenance

Every health determination includes an evidence chain (`HealthEvidence[]`). Each evidence item records:

- `check` — what was checked (e.g., `port-listening`, `process-identity`, `health-endpoint`, `service-role-write`)
- `status` — `pass`, `fail`, `warn`, or `skip`
- `value` — the observed value (e.g., `HTTP 200`, `PID 1234 (node)`)
- `detail` — additional context
- `checkedAt` — ISO timestamp
- `latencyMs` — how long the check took

For each boot.config.json module, the checker verifies:

1. **Port listening** — is anything on the expected port?
2. **Process identity** — is the EXPECTED process on this port? (A wrong process is UNAVAILABLE.)
3. **Health endpoint** — does it respond with HTTP 200?
4. **Response body** — is it valid (not an error page)?
5. **Dependencies** — are upstream dependencies healthy?

For the database, the checker verifies:

1. **REST API reachable** — HTTP check
2. **Service-role write** — insert a test row
3. **Service-role read** — read it back
4. **Service-role delete** — clean up

For Ollama, the checker verifies reachability and model availability.

For the bridge (universal chat router), the checker verifies the route is reachable through Heidi's `/api/chat` endpoint.

**Implementation:** `lib/operational/HealthProvenanceChecker.ts`

## 5. Dependency Graph

The dependency graph is derived from `boot.config.json` plus known runtime dependencies (database, Ollama, bridge) that are not expressed in the boot config.

The graph distinguishes:

- **Upstream dependencies** — what a component needs
- **Downstream dependents** — what needs this component
- **Critical path** — the minimum operational path for a Heidi request:
  ```
  database → protoforge-core → bridge → heidi-web
  ```
- **Recovery order** — dependencies are recovered before dependents (topological sort)

Each node has:

- `id` — component identifier
- `category` — `database`, `protoforge`, `heidi`, `bridge`, `ollama`, etc.
- `criticality` — `critical`, `important`, or `optional`
- `dependencies` — upstream component IDs
- `dependents` — downstream component IDs
- `recoveryOrder` — lower = recover first
- `recoveryPolicy` — `restart_process`, `wait_for_dependency`, `escalate`, or `no_action`

**Implementation:** `lib/operational/DependencyGraphBuilder.ts`

## 6. Failure Detection

The health provenance checker detects:

- **Process exit** — port not listening
- **Wrong process on expected port** — process identity mismatch
- **Endpoint failure** — HTTP error or timeout
- **Functional health failure** — error page, invalid response body
- **Dependency failure** — upstream component is UNAVAILABLE or FAILED
- **Database failure** — REST API unreachable, write/read/delete fails
- **Persistence failure** — env vars not configured
- **Ollama failure** — unreachable or no models
- **Bridge failure** — chat route not found

Failures are classified into the eight-state model. A component with a failed dependency is `BLOCKED`, not `HEALTHY`.

## 7. Bounded Recovery Engine

Recovery is implemented through explicit capabilities and policies. The engine never uses arbitrary shell commands.

### Recovery Policy

Each recovery action defines:

| Field | Description |
|-------|-------------|
| `type` | `restart_process`, `wait_for_dependency`, `escalate`, `no_action` |
| `target` | Component ID to act on |
| `precondition` | What must be true before acting |
| `maxAttempts` | Retry budget (default: 3, never infinite) |
| `cooldownMs` | Minimum time between attempts (default: 5000ms) |
| `postcondition` | What must be true after acting (verified, not assumed) |
| `escalationPath` | What happens if all attempts fail |

### Recovery Flow

```
1. Idempotent check — if already HEALTHY, verify and return
2. Prevent concurrent recovery — one recovery per component at a time
3. Authorize via capability system
4. Determine strategy from dependency graph
5. Recover dependencies first (causal recovery)
6. Execute bounded recovery with retry budget
7. Verify postcondition with functional probe (re-run health checks)
8. Record evidence
9. Escalate if all attempts fail
```

### Command Allowlist

The recovery engine can only restart modules listed in `boot.config.json`. It reads the command and arguments from the boot config — never from user input or AI output. The restartable set is:

- `protoforge-core`
- `heidi-web`
- `heidi-mobile-chat`

Unknown targets are denied. Protected modules are never auto-restarted.

**Implementation:** `lib/operational/RecoveryEngine.ts`

## 8. Recovery Verification

After recovery, the engine re-runs the full health check suite and verifies:

- Correct process is on the expected port
- Health endpoint responds with HTTP 200
- Response body is valid
- Dependencies are healthy
- Functional behavior is proven

If verification fails, recovery remains `FAILED` and escalates. The engine does NOT declare success because the restart command returned zero.

## 9. Incident Correlation

Multiple symptoms may represent one root failure. The incident correlator groups events by:

- **Dependency graph** — if A depends on B and both fail, B is the root cause
- **Time window** — events within 60 seconds are likely correlated
- **Causal chain** — recovery of B should resolve A's failure too

Each incident has:

- `rootCause` — the originating failure
- `rootComponent` — the component that failed first
- `affectedComponents` — downstream components impacted
- `events` — all operational events in this incident
- `state` — `active`, `resolved`, or `escalated`

**Implementation:** `lib/operational/IncidentCorrelator.ts`

## 10. Operational Memory

Operational events are recorded to a durable JSONL file at `.hydi-operational/operational-events.jsonl`. Events survive restarts.

The store records:

- State transitions
- Failure detections
- Recovery attempts and results
- Capability denials
- Diagnostic snapshots

The file rotates when it exceeds 5 MB to prevent unbounded growth.

**Implementation:** `lib/operational/OperationalMemory.ts`

## 11. Security Boundaries

### Capability System

| Capability | Authorized For |
|------------|---------------|
| `health.read` | Anyone (read-only) |
| `health.recover` | Known boot modules only |
| `process.restart` | Specific boot.config.json modules |
| `process.kill` | Same as restart |
| `database.recover` | Database (wait-only, no destructive actions) |
| `configuration.validate` | Anyone (read-only) |
| `runtime.probe` | Anyone (read-only) |
| `diagnostic.snapshot` | Anyone (read-only) |

Every authorization check is logged. Denied actions are counted.

### Separation of Concerns

```
identity ≠ permission ≠ policy ≠ execution ≠ causality ≠ observation
```

The recovery system observes reality and acts through explicit capabilities. It is not a monolithic autonomous script.

**Implementation:** `lib/operational/CapabilityAuthorizer.ts`

## 12. Diagnostic Snapshot

The `npm run hydi:diagnose` command produces a complete operational snapshot:

- Repository identity (path, remote, branch, commit, clean state)
- Runtime (Node version, platform, PID, uptime)
- Component states with evidence chains
- Dependency graph with critical path
- Persistence mode (local vs cloud)
- Recovery state (active recoveries, success rate)
- Active incidents
- Security state (capabilities, denied actions)
- Overall system state

Output is human-readable by default, or JSON with `--json`.

**Implementation:** `lib/operational/DiagnosticSnapshot.ts`, `scripts/hydi-diagnose.js`

## 13. Self-Recovery Command

The `npm run hydi:recover` command:

1. Runs health checks
2. Identifies unhealthy components
3. Sorts by recovery order (dependencies first)
4. Attempts bounded recovery for each
5. Verifies postconditions
6. Reports final state

Usage:

```bash
npm run hydi:recover                                    # auto-recover all unhealthy
npm run hydi:recover -- --component=protoforge-core     # recover specific
npm run hydi:recover -- --dry-run                       # diagnose only
npm run hydi:recover -- --json                          # JSON output
```

**Implementation:** `scripts/hydi-recover.js`

## 14. Module Layout

```
lib/operational/
├── types.ts                      — Core type system
├── SystemStateModel.ts           — Component state tracking
├── DependencyGraphBuilder.ts     — Architecture graph from boot.config.json
├── HealthProvenanceChecker.ts    — Reality-based health checks with evidence
├── CapabilityAuthorizer.ts       — Security boundaries and command allowlist
├── RecoveryEngine.ts             — Bounded, capability-based recovery
├── IncidentCorrelator.ts         — Root cause analysis
├── OperationalMemory.ts          — Durable event log
├── DiagnosticSnapshot.ts         — Self-diagnostic output
└── OperationalIntelligence.ts    — Orchestrator tying it all together

scripts/
├── hydi-diagnose.js              — npm run hydi:diagnose
└── hydi-recover.js               — npm run hydi:recover

tests/unit/
├── operational-state-model.test.ts
├── operational-dependency-graph.test.ts
├── operational-capability-auth.test.ts
├── operational-incident-correlator.test.ts
├── operational-memory.test.ts
└── operational-no-false-greens.test.ts
```

## 15. Performance

The operational intelligence system is designed to be lightweight:

- Health checks are run on-demand, not in a polling loop
- No 100ms timers (the Phase 2 event-bus leak fix is preserved)
- Operational memory uses batched writes (every 5 seconds)
- File rotation prevents unbounded growth
- Diagnostic snapshot runs in <2 seconds for a cold check

## 16. Relationship to Existing Infrastructure

The Phase 3 operational intelligence system builds on existing infrastructure:

- `scripts/health-check.js` — the existing config-derived health checker remains as-is. The new `HealthProvenanceChecker` is a TypeScript implementation that adds evidence chains and integrates with the state model.
- `lib/health/` — the existing health collectors and poller remain for the Next.js health endpoint. The new system is additive.
- `boot.config.json` — remains the source of truth for module configuration. The dependency graph is derived from it.
- `modules/recovery-engine.js` — the existing recovery engine is standalone (not boot-reachable, uses arbitrary shell execution). It is NOT used by Phase 3. The new `RecoveryEngine.ts` replaces its role with bounded, capability-based recovery.

No existing systems were replaced without evidence. The new system is additive and integrates with the existing boot and health infrastructure.
