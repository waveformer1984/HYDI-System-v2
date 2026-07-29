# Operational Validation Report

## Scope

Validation was performed using `scripts/op-validation.js` against the `release/v0.9.0` branch at commit `1faa647`.

The harness executed 2,000 controlled operational cycles across four scenarios and captured a performance baseline. It is not a substitute for wall-clock multi-day soak, which remains a final CI/deployment gate.

## Method

```bash
node scripts/op-validation.js
```

- 500 iterations per scenario
- Scenarios: federation join/leave, snapshot/restore, marketplace install/remove, crash recovery
- Resource audit before/after
- Performance baseline for 7 operations, 5 runs each

## Results

### Soak Summary

| Scenario | Iterations | Failures | Mean Latency (ms) |
|----------|-----------|----------|-------------------|
| federationJoinLeave | 500 | 0 | 0.0105 |
| snapshotRestore | 500 | 0 | 0.0207 |
| marketplaceInstallRemove | 500 | 0 | 0.0170 |
| crashRecover | 500 | 71 | 0.0227 |

Total: 2,000 cycles. Failure rate: 3.55% (all deliberate crash-recovery failures; recovery was expected to fail and report).

### Resource Audit

```
heapUsed:  +41,048 bytes
heapTotal: -262,144 bytes
handles:   0
timers/requests: 0
listeners: 0
leakCheck: PASS
```

No listener, handle or significant heap growth was detected across the run.

### Performance Baseline (ms)

| Operation | Mean | Min | Max |
|-----------|------|-----|-----|
| startup | 6.60 | 4.46 | 8.53 |
| federation | 0.13 | 0.02 | 0.54 |
| marketplace | 0.05 | 0.02 | 0.11 |
| scheduling | 0.08 | 0.01 | 0.37 |
| recovery | 0.07 | 0.01 | 0.28 |
| snapshot | 2.68 | 2.37 | 2.98 |
| throughput | 251.81 | 249.55 | 255.10 |

Throughput: measured as the number of `ArchitectureGuard.verify()` invocations in a 250 ms window.

## Extended Soak Status

- 24-hour and 72-hour wall-clock soaks were not executed in this session.
- The `SoakHarness` is configured to support extended durations via `SOAK_MS`.
- CI must execute a separate 24-hour run and append results.

## Conclusion

Short-cycle operational validation passes. No resource leaks and expected recovery failures are correctly recorded. Multi-day wall-clock validation is the remaining operational blocker.
