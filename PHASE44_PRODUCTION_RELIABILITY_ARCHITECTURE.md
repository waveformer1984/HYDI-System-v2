# Phase 44 — Production Reliability, Observability & Operations

## Overview

Phase 44 shifts focus from adding new capabilities to making the HYDI
platform production-grade. It introduces continuous health supervision, fault
correlation, coordinated recovery, resource-leak detection, deadlock detection,
and a unified operations dashboard. These systems do not replace existing
functionality; they observe it, correlate failures, and trigger safe recovery
through the established lifecycle and governance layers.

## Components

| Module | Responsibility |
|--------|---------------|
| `HealthSupervisor.js` | Continuous subsystem health monitoring and degradation detection |
| `FaultCorrelationEngine.js` | Correlate individual alerts into root-cause groups |
| `RecoveryCoordinator.js` | Select and execute approved recovery strategies, track outcomes |
| `ResourceLeakDetector.js` | Sample memory and tracked resources to detect growth |
| `DeadlockDetector.js` | Track resource waits and detect wait-for cycles |
| `OperationsDashboard.js` | Aggregate operational metrics, traces, and recovery history |

## Reliability Architecture

```
[Subsystem]
    |
[HealthSupervisor] -- health samples -- [ResourceLeakDetector]
    |
[FaultCorrelationEngine] -- correlated faults -- [RecoveryCoordinator]
    |
[OperationsDashboard] -- metrics and traces
```

## Health Supervision

`HealthSupervisor` registers named subsystems, records periodic health samples
on a 0–1 scale, and emits `state_changed` when a subsystem moves between
`healthy`, `degraded`, and `critical`. When a subsystem enters `critical`, a
`degradation_recommended` event is emitted for the policy/governance layer to
consider.

No action is taken without policy approval.

## Fault Correlation

`FaultCorrelationEngine` ingests fault events, groups them by shared subsystem
or `traceId`, and produces `correlation_detected` events with:

- grouped events
- inferred root cause
- confidence score

Correlation windows are configurable; stale events are pruned automatically.

## Recovery Coordination

`RecoveryCoordinator` registers recovery strategies with:

- `applicable` filter
- `priority`
- `requiresApproval` flag

Given a correlation, it selects the highest-priority applicable strategy,
retries up to a configured limit, records each attempt, and computes a success
rate. If recovery fails and the fault confidence is above the escalation
threshold, it emits `escalation_required`.

## Resource Leak Detection

`ResourceLeakDetector` periodically samples `process.memoryUsage()` and any
registered tracker functions. It detects relative growth above a threshold and
emits `leak_detected` events. It does not stop leaks; it reports them.

## Deadlock Detection

`DeadlockDetector` maintains a wait-for graph. It tracks which holder owns each
resource and which holders are waiting for which resources. When a `wait` would
create a cycle, it returns `deadlock_detected` and emits an audit event without
blocking the caller. Resource release automatically clears related waits.

## Operations Dashboard

`OperationsDashboard` aggregates data from the reliability modules, the
federation dashboard, and the executive dashboard. It computes and exposes:

- mean and p95 task latency
- recovery success rate
- rollback frequency (per hour)
- planner accuracy
- forecast accuracy
- health status
- fault and trace counts
- resource growth trend
- deadlock graph

It records traces from strategic goals through execution and exposes them for
retrieval.

## Long-Running Validation

Endurance validation is supported through configurable intervals and history
limits. Real multi-hour runs are configured outside unit tests. The unit suite
validates that:

- health can be sampled repeatedly
- faults are correlated over a window
- recovery can be retried and recorded
- growth thresholds are detected
- deadlocks are caught before they occur
- operations metrics can be computed

## Release Readiness

Phase 44 moves toward release readiness by:

- observing all major subsystems continuously
- correlating failures before they cascade
- recovering with audit and policy control
- detecting resource and concurrency issues
- surfacing operational metrics

## Architectural Invariants

The following invariants are now observable through the operations dashboard
and can be checked in CI:

- All remote execution passes through `NodePolicy`.
- All lifecycle changes pass through `LifecycleRegistry`.
- All distributed execution is auditable.
- All strategic planning flows through governance before execution.
- All recovery attempts are recorded and scored.
- No deadlocked resource wait is silently accepted.

## Validation

```bash
npm run reliability-test
npm run fault-test
npm run recovery-test
npm run leak-test
npm run deadlock-test
npm run operations-test
npm run federation-test
npm run lifecycle-test
npm run typecheck
npm test
```

## Known Limitations

- `HealthSupervisor` uses in-memory samples; persistent health history can be
  added in a later phase.
- `ResourceLeakDetector` provides trend detection, not root-cause analysis.
- `DeadlockDetector` does not resolve deadlocks automatically; it reports them
  for the policy layer to handle.
