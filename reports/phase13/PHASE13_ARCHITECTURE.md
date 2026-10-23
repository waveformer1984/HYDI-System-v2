# Phase 13 — Live Operational Integration Architecture

## Authority Map

| Concern | Owner | Reason |
|---------|-------|--------|
| Observation | `RuntimeObserver` | Already authoritative; owns all probes, manifests, container state |
| Health aggregation | `HealthAggregator` | Existing summary component |
| Observation normalization | `RuntimeObservationAdapter` (new) | Translates raw probes to decision-engine schema without duplicating probes |
| Decision selection | `HeidiDecisionEngine` | Pure, deterministic, policy-aware decision component |
| Authorization | `AutonomyPolicy` + `HeidiExecutive.run()` | Single policy check before any action |
| Execution | `HeidiExecutive` / `ControlledExecutor` | Existing allowlisted capability executor is the only execution path |
| Verification | `HeidiExecutive.verify()` + `RuntimeObserver` | Post-action health checks through the same probe layer |
| Incident memory | `IncidentStore` | Existing durable append-only incident store |
| Decision memory | `DecisionRecord` | New append-only decision record |
| Audit | `AuditLog` | Existing redacted audit log |

## Data Flow

```
RuntimeObserver
      ↓
HealthAggregator
      ↓
RuntimeObservationAdapter
      ↓
HeidiDecisionEngine
      ↓
  (INCIDENT / CORRELATION / IMPACT / ACTION)
      ↓
HeidiExecutive.operationalCycle()
      ↓
  PolicyEngine / AutonomyPolicy
      ↓
ControlledExecutor
      ↓
RuntimeObserver (verification)
      ↓
IncidentStore + DecisionRecord + AuditLog
```

## Why This Architecture

- `HeidiExecutive` remains the single control plane. It already owns policy, approval, execution, audit, and recovery. `HeidiDecisionEngine` is a subordinate decision component, not a second executive.
- `RuntimeObserver` is not replaced. The adapter only normalizes its output.
- `HeidiDecisionEngine` does NOT execute. It returns a `selected_action` (capability + parameters). `HeidiExecutive.run()` performs the actual policy-authorization-execution cycle.
- `MissionEngine` is used only to bound the decision/execution loop, not to duplicate `HeidiExecutive`'s execution authority.
- `ControlledExecutor` remains the only component that invokes `child_process.execFile`. No new execution primitive is added.

## Modes

- `DECISION_ONLY`: observe, classify, correlate, assess, select, evaluate authorization, but never execute. Produces decision records.
- `SHADOW`: same as `DECISION_ONLY` while the real system is observed; collects `what would HEIDI have done` evidence.
- `CONTROLLED`: only after `DECISION_ONLY` and `SHADOW` pass. Executes L3/L4 auto-recover actions that already exist in `CapabilityRegistry` and are authorized.

## Safety

- `OperationalLoop` is bounded: `maxCycles`, `cycleIntervalMs`, `maxActionsPerCycle`, `perActionCooldownMs`, `emergencyStop` function.
- Unknown capabilities remain `FORBIDDEN`.
- `MaintenanceMode` suppresses expected incidents.
- `PredictiveIntelligence` emits warnings only.
