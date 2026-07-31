# Final 24-Hour Soak Results

## Candidate

- Commit: `de9cbc1`
- Tag: `v0.9.0-rc.3`
- Branch: `release/v0.9.0`

## 24-Hour Wall-Clock Run

**Not executed in this session.** The runtime environment cannot support an unattended 24-hour process.

The qualified command is:

```bash
SOAK_MS=86400000 SOAK_ITERS=99999999 node scripts/op-validation.js
```

It must be run on a dedicated CI host or long-lived VM.

## Short-Cycle Validation

`scripts/op-validation.js` was executed on `v0.9.0-rc.3` with a controlled short cycle to exercise the harness.

| Metric | Value |
|--------|-------|
| Total iterations | 2,000 |
| Failures | 71 (expected crash-recovery failures) |
| Unexpected failures | 0 |

### Scenario Results

| Scenario | Iterations | Failures | Mean Latency (ms) |
|----------|-----------|----------|-------------------|
| federationJoinLeave | 500 | 0 | 0.0105 |
| snapshotRestore | 500 | 0 | 0.0207 |
| marketplaceInstallRemove | 500 | 0 | 0.0170 |
| crashRecover | 500 | 71 | 0.0227 |

### Resource Audit

| Resource | Delta |
|----------|-------|
| heapUsed | +41,048 bytes |
| heapTotal | -262,144 bytes |
| handles | 0 |
| requests | 0 |
| listeners | 0 |

## Required 24-Hour Evidence

The CI run must capture:

- [ ] Start timestamp
- [ ] End timestamp
- [ ] Machine/environment details
- [ ] Node and dependency versions
- [ ] Resource samples over time
- [ ] Fault events
- [ ] Recovery events
- [ ] Final ArchitectureGuard state

## Acceptance

Pending. 24-hour wall-clock soak is a release blocker.
