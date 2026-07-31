# HYDI Operator Runbook

## Architecture Guard

Run before any release or after major changes:

```bash
hydi architecture verify
```

If the score is not 100%, stop the release and address failures.

## Health Checks

```bash
npm run health-check
npm run lifecycle-test
```

Verify all subsystems report healthy.

## Incident Response

### Unhealthy node

1. Check `HealthSupervisor` status.
2. Review `FaultCorrelationEngine` correlated faults.
3. Trigger `RecoveryCoordinator` for the affected subsystem.
4. Verify `LifecycleRegistry` recorded the recovery.

### Leak alarm

1. Run `ResourceAuditor` snapshot before/after the suspected operation.
2. Identify `heap`, `handles`, `listeners` growth.
3. Stop the leaking component, restart or drain traffic.

### Federation incident

1. Verify `NodePolicy` denied the request.
2. Check `FederationGateway` audit records.
3. Revoke trust if necessary through `NodeDiscovery`.

## Rollback

- Use `SnapshotManager.restore` from the latest valid snapshot.
- Validate the restore with `PerformanceBaseline` comparison.
- Confirm `ArchitectureGuard` still passes.
