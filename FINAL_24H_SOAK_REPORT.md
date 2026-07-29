# Final 24-Hour Soak Report

## Status

**The 24-hour wall-clock soak was not executed in this session.**

The runtime environment does not support an unattended 24-hour process. The `scripts/op-validation.js` harness is ready and the procedure is documented below.

## Baseline / Short-Cycle Evidence

`scripts/op-validation.js` was executed on `v0.9.0-rc.2` with a controlled short cycle to validate the harness and the platform.

| Metric | Value |
|--------|-------|
| Commit | `e68e4e6` (`v0.9.0-rc.2`) |
| Total iterations | 2,000 |
| Failures | 71 (expected crash-recovery failures) |
| Unexpected failures | 0 |

### Scenario Summary

| Scenario | Iterations | Failures | Mean Latency (ms) |
|----------|-----------|----------|-------------------|
| federationJoinLeave | 500 | 0 | 0.0105 |
| snapshotRestore | 500 | 0 | 0.0207 |
| marketplaceInstallRemove | 500 | 0 | 0.0170 |
| crashRecover | 500 | 71 | 0.0227 |

### Resource Delta

| Resource | Delta |
|----------|-------|
| heapUsed | +41,048 bytes |
| heapTotal | -262,144 bytes |
| handles | 0 |
| requests | 0 |
| listeners | 0 |

## 24-Hour Run Procedure

Run on the exact `v0.9.0-rc.2` commit in a dedicated, always-on environment:

Windows:

```powershell
$env:SOAK_MS = 86400000
$env:SOAK_ITERS = 99999999
node scripts/op-validation.js
```

Unix:

```bash
SOAK_MS=86400000 SOAK_ITERS=99999999 node scripts/op-validation.js
```

## Required 24-Hour Evidence

After completion, capture from `data/op-validation.json`:

- [ ] Start timestamp
- [ ] End timestamp
- [ ] Commit hash
- [ ] Operating system
- [ ] Node version
- [ ] Total iterations
- [ ] Unexpected failures (must be 0)
- [ ] Memory samples or final diff
- [ ] Listener/handle/timer counts
- [ ] Federation health
- [ ] Task throughput
- [ ] Recovery events
- [ ] Final ArchitectureGuard score (must be 100%)

## Acceptance Criteria

- [ ] Zero unexpected failures
- [ ] No resource leaks
- [ ] No degraded health state
- [ ] No manual intervention
- [ ] Deterministic final state

## 24-Hour Result

Pending. The command must be executed in a CI or dedicated host before this report can be closed.
