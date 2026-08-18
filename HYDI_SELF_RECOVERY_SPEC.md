# HYDI Self-Recovery Specification

**Phase 3 — Bounded, Observable, Evidence-Driven Autonomy**

## 1. Scope

This specification defines the behavior of HYDI's self-recovery system. It covers:
- What failures are detected
- How failures are classified
- What recovery actions are authorized
- How recovery is bounded
- How recovery is verified
- How escalation works
- What evidence is recorded

## 2. Failure Detection

### 2.1 Detectable Failures

| Failure Type | Detection Method | Resulting State |
|--------------|-----------------|-----------------|
| Process exit | Port not listening | `UNAVAILABLE` |
| Wrong process on port | Process identity check (PID → cmdline) | `UNAVAILABLE` |
| Endpoint failure | HTTP probe to health URL | `UNAVAILABLE` |
| Functional health failure | Response body validation (error page detection) | `DEGRADED` |
| Dependency failure | Upstream component state check | `BLOCKED` |
| Database failure | REST API + write/read/delete test | `UNAVAILABLE` or `DEGRADED` |
| Persistence failure | Env var presence check | `UNKNOWN` |
| Ollama failure | `/api/tags` reachability + model count | `UNAVAILABLE` |
| Bridge failure | `/api/chat` route reachability | `UNAVAILABLE` |
| Configuration/security failure | Capability authorization check | `BLOCKED` |

### 2.2 Classification Rules

- A component with a failed upstream dependency is `BLOCKED`, not `UNAVAILABLE`.
- A component that responds but with an error page is `DEGRADED`, not `HEALTHY`.
- A component with no evidence is `UNKNOWN`, not `HEALTHY`.
- A component that failed recovery is `FAILED`, not `UNAVAILABLE`.

### 2.3 No False Greens

The system MUST NOT report `HEALTHY` for:
- A port occupied by the wrong process
- An endpoint returning an error page
- A component whose dependencies are down
- A component with no evidence chain
- A component that was restarted but not verified

## 3. Recovery Actions

### 3.1 Action Types

| Action | Description | Authorized Targets |
|--------|-------------|-------------------|
| `restart_process` | Kill existing process on port, spawn new from boot.config.json | `protoforge-core`, `heidi-web`, `heidi-mobile-chat` |
| `wait_for_dependency` | Do nothing locally; wait for upstream recovery | `database`, `ollama` |
| `escalate` | Signal for human intervention; no further auto-recovery | Any component after exhausting retries |
| `no_action` | Component is healthy or recovery not applicable | Any |

### 3.2 Command Allowlist

Recovery commands are derived from `boot.config.json` — never from user input or AI output.

```typescript
ALLOWED_RESTART_TARGETS = new Set([
  'protoforge-core',
  'heidi-web',
  'heidi-mobile-chat',
]);
```

The recovery engine reads `mod.command` and `mod.args` from the boot config. It does NOT accept arbitrary command strings.

### 3.3 Bounded Retry

Every recovery action has:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxAttempts` | 3 | Maximum retry attempts (never infinite) |
| `cooldownMs` | 5000 | Minimum time between attempts |
| `graceMs` | from boot config | Time to wait before checking postcondition |

After `maxAttempts` failures, the component is marked `FAILED` and the escalation path is triggered.

### 3.4 Causal Recovery

Recovery operates from the dependency graph. If component A depends on B, and B is down:

1. B is recovered first (lower `recoveryOrder`)
2. A is only recovered after B is healthy
3. If B cannot be recovered, A is marked `BLOCKED`

This prevents cascading restarts of dependents when the root cause is upstream.

### 3.5 Idempotent Recovery

If `recover()` is called on a component that is already `HEALTHY`:
1. The current state is verified
2. No restart is performed
3. A no-op record is returned
4. The component is NOT restarted

### 3.6 Concurrent Recovery Prevention

Only one recovery can be active per component at a time. If `recover()` is called while a recovery is in progress, a no-op record is returned.

## 4. Recovery Verification

### 4.1 Postcondition

After each recovery attempt, the engine:
1. Waits for the grace period
2. Re-runs the full health check suite (`HealthProvenanceChecker.checkAll()`)
3. Reads the new component state from the state model
4. Records the evidence chain

### 4.2 Success Criteria

Recovery is successful ONLY when:
- Component state is `HEALTHY`
- Evidence chain includes passing checks for port, process identity, health endpoint, and dependencies
- The functional probe (if applicable) succeeded

### 4.3 Failure Criteria

Recovery is failed when:
- All attempts exhausted and state is not `HEALTHY`
- The postcondition check itself failed
- The capability was denied

A restart command returning exit code 0 is NOT sufficient for success.

## 5. Escalation

When all recovery attempts are exhausted:

1. The component state is set to `FAILED`
2. An escalation event is logged with the escalation path
3. The incident correlator marks the incident as `escalated`
4. No further automatic recovery is attempted for this component until a human intervenes or the system is restarted

The escalation path is:
> "escalate to human operator — all recovery attempts exhausted"

## 6. Operational Event Recording

### 6.1 Event Types

| Event Type | When Recorded |
|------------|---------------|
| `state_transition` | Component state changes |
| `failure_detected` | Component transitions to UNAVAILABLE/FAILED/BLOCKED |
| `recovery_started` | Recovery attempt begins |
| `recovery_step` | Individual step within a recovery attempt |
| `recovery_completed` | Recovery attempt finishes (success or failure) |
| `recovery_failed` | All recovery attempts exhausted |
| `incident_correlated` | Failure correlated with an existing incident |
| `capability_denied` | Recovery action denied by capability system |
| `probe_executed` | Health probe executed |
| `diagnostic_snapshot` | Diagnostic snapshot produced |

### 6.2 Event Structure

Every event includes:
- `id` — unique event ID (UUID)
- `timestamp` — ISO timestamp
- `type` — event type
- `component` — which component this event pertains to
- `previousState` / `newState` — for state transitions
- `cause` — what triggered the event
- `evidence` — supporting evidence chain
- `action` / `actionResult` — for recovery events
- `recoveryAttempt` — attempt number (1-based)
- `correlationId` — links related events into one incident

### 6.3 Durable Storage

Events are stored in `.hydi-operational/operational-events.jsonl` (append-only JSONL). The file rotates at 5 MB. Events survive restarts.

## 7. Incident Correlation

### 7.1 Correlation Rules

1. If component A fails and its dependency B already has an active incident, A's failure is added to B's incident.
2. If component A fails and no upstream dependency has an incident, a new incident is created with A as the root cause.
3. Duplicate failures for the same component are added to the existing incident.

### 7.2 Incident Lifecycle

```
active → resolved (root component returns to HEALTHY)
active → escalated (all recovery attempts exhausted)
```

### 7.3 Diagnostic Output

For each incident, the correlator produces:
- Root cause and root component
- Affected components
- All events in the incident
- Resolution (if resolved)

## 8. Security Boundaries

### 8.1 Capability Matrix

| Capability | Authorized | Scope |
|------------|-----------|-------|
| `health.read` | Always | All components |
| `health.recover` | Boot modules only | Specific module IDs |
| `process.restart` | Boot modules only | Specific module IDs |
| `process.kill` | Same as restart | Specific module IDs |
| `database.recover` | Always (wait-only) | Database |
| `configuration.validate` | Always (read-only) | All |
| `runtime.probe` | Always (read-only) | All |
| `diagnostic.snapshot` | Always (read-only) | All |

### 8.2 Prohibited Actions

The recovery system MUST NOT:
- Execute arbitrary shell commands
- Accept command strings from user input or AI output
- Restart processes not listed in `boot.config.json`
- Modify credentials or secrets
- Perform live payment operations
- Delete production data
- Alter Git history
- Push branches
- Bypass the capability authorization check

### 8.3 Audit Trail

Every capability check is logged. Denied actions are counted and recorded as `capability_denied` events.

## 9. Stop Conditions

The recovery system stops and reports (rather than bypassing) if:

| Condition | Action |
|-----------|--------|
| Recovery requires unrestricted shell execution | Stop, report `BLOCKED` |
| Capability boundary is ambiguous | Stop, report `BLOCKED` |
| Service cannot be safely restarted | Stop, report `FAILED` |
| Database recovery risks data loss | Stop, report `BLOCKED` |
| Production credentials are discovered | Stop, report `BLOCKED` |
| Dependency graph cannot be established | Stop, report `UNKNOWN` |
| Health provenance cannot be proven | Stop, report `UNKNOWN` |
| AI output is being used as source of truth | Stop, report `UNKNOWN` |
| Autonomous recovery would exceed policy | Stop, report `BLOCKED` |

## 10. CLI Interface

### 10.1 Diagnose

```bash
npm run hydi:diagnose              # human-readable snapshot
npm run hydi:diagnose -- --json    # JSON snapshot
```

Exit codes:
- `0` — overall state is `HEALTHY`
- `1` — overall state is not `HEALTHY`
- `2` — diagnostic failed

### 10.2 Recover

```bash
npm run hydi:recover                                    # auto-recover all unhealthy
npm run hydi:recover -- --component=protoforge-core     # recover specific
npm run hydi:recover -- --dry-run                       # diagnose only
npm run hydi:recover -- --json                          # JSON output
```

Exit codes:
- `0` — final state is `HEALTHY`
- `1` — final state is not `HEALTHY`
- `2` — recovery failed

## 11. Test Coverage

Phase 3 requires tests for:

| Test Area | Test File | Tests |
|-----------|-----------|-------|
| State transitions | `operational-state-model.test.ts` | 9 |
| Dependency graph | `operational-dependency-graph.test.ts` | 9 |
| Capability authorization | `operational-capability-auth.test.ts` | 11 |
| Incident correlation | `operational-incident-correlator.test.ts` | 7 |
| Operational memory | `operational-memory.test.ts` | 6 |
| No false greens | `operational-no-false-greens.test.ts` | 9 |

**Total: 51 tests across 6 suites, all passing.**

The "no false greens" test suite specifically verifies:
- No component reports HEALTHY without evidence
- In-process modules report UNKNOWN, not HEALTHY
- Database health requires write/read evidence, not just reachability
- Failed dependencies result in BLOCKED, not HEALTHY
- Recovery does not declare success without postcondition verification
- Recovery is idempotent
- Recovery respects retry budget
- Recovery is denied for unauthorized targets
