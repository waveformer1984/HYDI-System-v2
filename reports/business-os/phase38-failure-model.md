# Phase 38 — Failure Model and Recovery Taxonomy

Generated: 2026-07-28

## Purpose

Phase 38 treats resilience as a first-class architectural concern. Before adding
recovery code, every failure mode is classified by symptom, detectability,
recovery strategy, and escalation path. This taxonomy becomes the contract for
`RecoveryManager`, `SystemHealthSupervisor`, and the fault-injection framework.

## Failure Classification

| Failure                         | Detected By                                | Recover Automatically | Requires Operator | Fatal | Default Action                     |
| ------------------------------- | ------------------------------------------ | ---------------------:| -----------------:| -----:| ---------------------------------- |
| Model unavailable                 | RuntimeTelemetry / ModelManager health     |                     ✓ |                   |       | Retry + route to fallback model    |
| Snapshot corruption             | SnapshotStore checksum / parse failure     |                     ✓ |                   |       | Restore previous fallback snapshot |
| Memory index corruption         | SemanticMemoryIndex integrity scan         |                     ✓ |                   |       | Rebuild from persisted store       |
| Queue inconsistency             | TaskEngine health / pending mismatch       |                     ✓ |                   |       | Repair queue + reset workers       |
| Policy version mismatch         | ExecutionPolicy hash check                 |                       |                 ✓ |       | Halt autonomous actions, alert     |
| Configuration migration failure   | Startup integrity / schema check           |                       |                 ✓ |       | Halt boot, alert                   |
| Repeated recovery failure       | RecoveryManager attempt counter            |                       |                 ✓ |       | Escalate + disable subsystem       |
| Persistent storage unavailable  | fs / Supabase connectivity check             |                       |                   |     ✓ | Shutdown safely, fail closed       |

## Severity Rules

- **Recoverable (✓ automatic):** The system may retry, rebuild, or switch to a
  fallback without operator approval. Recovery is bounded by attempt limits and
  backoff. Telemetry is emitted for every attempt.
- **Requires Operator:** Autonomous execution stops for the affected subsystem.
  The operator is notified with a clear failure context and recommended action.
  The rest of the system continues to run if safe.
- **Fatal:** The runtime cannot guarantee safety or durability. The process shuts
  down after flushing in-flight state. No speculative recovery is attempted.

## Recovery Lifecycle

```
Detect → Classify → Plan → Attempt → Verify → (Record | Escalate | Fatal)
```

1. **Detect:** `SystemHealthSupervisor` samples subsystems (model health, memory,
   queue, storage, telemetry) on a bounded interval.
2. **Classify:** `FailureTaxonomy` maps a symptom to a `RecoveryTier` and a
   default `RecoveryAction`.
3. **Plan:** `RecoveryManager` builds a concrete plan from the symptom,
   available snapshots, and current subsystem state.
4. **Attempt:** The plan is executed with exponential backoff. Each attempt is
   logged.
5. **Verify:** The supervisor re-samples to confirm the symptom is resolved.
6. **Record / Escalate / Fatal:** Success is recorded; repeated failures
   escalate or become fatal per the taxonomy.

## Snapshot Contract

A system snapshot is a point-in-time serializable bundle containing:

- `at` — timestamp.
- `checksum` — SHA-256 over the snapshot payload.
- `subsystems` — `{ runtime, memory, queues, models, telemetry, resources }`.
- `bundles` — persisted stores referenced by filename, not duplicated inline.
- `previous` — hash of the prior snapshot for chain verification.

Snapshots are immutable, append-only, and named by hash. A corrupt snapshot is
rejected by checksum; recovery falls back to the newest valid prior snapshot.

## Observability

Every recovery event produces a `recovery_event` telemetry row with:

- `symptom`, `tier`, `action`, `attempt`, `success`, `durationMs`, `snapshotHash`.

This makes every recovery decision auditable and replayable.
