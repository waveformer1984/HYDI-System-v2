# RC-1 Architecture Guard

## Purpose

The ArchitectureGuard is a release-hardening mechanism, not a feature. It
continuously verifies that HYDI's architectural invariants still hold as the
codebase evolves. It is intended to run in CI, before releases, and on demand.

## Components

| Module | Responsibility |
|--------|---------------|
| `ArchitectureInvariant.js` | A single executable rule |
| `InvariantRegistry.js` | Default set of HYDI invariants |
| `ArchitectureGuard.js` | Runs invariants and produces a scored report |
| `ArchitectureReport.js` | Renders the report as text or JSON |
| `ArchitectureAudit.js` | Records results to the lifecycle registry |

## Implemented Invariants

### 1. Remote execution passes through `NodePolicy`

- **Why:** No untrusted node can execute work without policy validation.
- **How enforced:** Static source check that `DistributedTaskManager.execute()`
  calls `this.policy.validateAction()` and validates `task.requestedBy`.
- **On violation:** Reported as a failure.

### 2. Lifecycle mutations pass through `LifecycleRegistry`

- **Why:** Every state change must be replayable and auditable.
- **How enforced:** Checks that `DistributedTaskManager`, `FederationGateway`,
  and `GoalManager` call `recordProposal` on a lifecycle registry.
- **On violation:** Reported as a failure.

### 3. Autonomous actions generate governance events

- **Why:** No autonomous action may execute silently.
- **How enforced:** Verifies `StrategicPlanner` and `RecoveryCoordinator`
  validate through `NodePolicy` and record audit proposals.
- **On violation:** Reported as a failure.

### 4. Marketplace installations verify signatures

- **Why:** Only signed, trusted capabilities can be activated.
- **How enforced:** Checks `MarketplaceManager` uses a `signatureVerifier`.
- **On violation:** Reported as a failure.

### 5. Federation nodes authenticate and pass policy

- **Why:** Untrusted nodes cannot join or execute.
- **How enforced:** Verifies `FederationGateway` uses `this.policy.validateAction`
  and emits audit records.
- **On violation:** Reported as manual or failure.

### 6. Public subsystem interfaces expose `ServiceContract`

- **Why:** Versioned, validated contracts prevent incompatible callers.
- **How enforced:** Checks that public subsystems reference `ServiceContract`.
- **On violation:** Reported as a warning.

### 7. Distributed tasks produce execution, policy and lifecycle records

- **Why:** Every distributed action must be fully auditable.
- **How enforced:** Verifies `DistributedTaskManager` emits `_audit`, calls
  `validateAction`, and records `recordProposal`.
- **On violation:** Reported as a failure.

### 8. Rollback-capable operations create recovery points

- **Why:** Recovery and rollback must be observable.
- **How enforced:** Verifies `DistributedTaskManager` and `TaskEngine` support
  rollback/compensation events.
- **On violation:** Reported as manual (requires runtime verification).

### 9. Strategic layer does not execute directly

- **Why:** Strategic planning must flow through the execution fabric and its
  governance gates.
- **How enforced:** Scans `StrategicPlanner`, `MissionPlanner` and `GoalManager`
  for direct `.execute()` or `.run()` calls.
- **On violation:** Reported as a failure.

### 10. Capabilities do not exceed declared permissions

- **Why:** Plugin isolation prevents capability escalation.
- **How enforced:** **Manual verification required.** Runtime sandbox checks are
  not yet automated.
- **On violation:** Reported as manual.

## CLI

```bash
hydi architecture audit    # human-readable report
hydi architecture report   # JSON report
hydi architecture verify   # exit code 1 on failure
```

## Test Commands

```bash
npm run architecture-test
npm run invariant-test
npm run rc1-test
```

## Operator Procedures

- Run `hydi architecture verify` before each release.
- Address all `fail` results before tagging.
- Review `warning` and `manual` results and decide whether they block release.
- Add new invariants to `InvariantRegistry` as new architectural rules emerge.

## Known Manual Checks

- Permission enforcement in the marketplace requires runtime sandbox testing.
- Snapshot/restore recovery validation is not yet fully automated.
- Long-running memory, handle, and timer leak detection is covered by
  `ResourceLeakDetector` and `HealthSupervisor` but requires extended runtime to
  prove.
