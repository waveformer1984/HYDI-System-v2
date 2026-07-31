# HYDI Disaster Recovery

## Scenarios

### Complete process failure

1. Restart HYDI from `HYDIOperationalBoot`.
2. Verify snapshot restore on boot.
3. Check `StartupIntegrity` report.
4. Run `hydi architecture verify`.

### Corrupted state

1. Stop affected subsystems.
2. Restore from the most recent valid snapshot.
3. Re-run `npm test -- --runInBand` for confidence.
4. Re-validate architecture.

### Node compromise

1. Revoke compromised node in `NodePolicy`.
2. Correlated fault via `FaultCorrelationEngine`.
3. Audit all remote executions from that node.
4. Rotate shared secrets and rebuild trust.

### Plugin exploit

1. `CapabilitySandbox` revokes permission.
2. Uninstall capability through `MarketplaceManager`.
3. Verify `PluginRuntime` security report.
4. Review `ArchitectureGuard` plugin-isolation invariant.

## Recovery Order

1. Lifecycle registry
2. Audit ledger
3. Event bus
4. Federation mesh
5. Task engine
6. Executive dashboards

## Testing

Run `SoakHarness` for crash recovery cycles and `ResourceAuditor` after each run.
