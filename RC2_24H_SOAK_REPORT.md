# RC2 24-Hour Soak Report

## Scope

The 24-hour continuous soak was not executed in this session because the available runtime environment does not support an unattended 24-hour wall-clock test. Instead, a configurable `SoakHarness` was run for a shorter, instrumented duration to validate the harness and to establish a baseline for the 24-hour run.

## Environment

- Branch: `release/v0.9.0`
- Commit: `1faa647` (validation base) / `TBD` after security fix
- Version: `0.9.0-rc.2`
- Node: process runtime
- Workload: `scripts/op-validation.js`
- Monitored: process memory, handles, requests, listeners, throughput, failure rate

## 24-Hour Run Command

```bash
set SOAK_MS=86400000
node scripts/op-validation.js
```

This command is staged for a CI or dedicated host and will record results to `data/op-validation.json`.

## Short-Cycle Validation Results

| Metric | Value |
|--------|-------|
| Duration | controlled short run |
| Total iterations | 2,000 |
| Failures | 71 (expected crash-recovery failures) |
| Unexpected failures | 0 |
| Mean latency (federation) | 0.0105 ms |
| Mean latency (snapshot) | 0.0207 ms |
| Mean latency (marketplace) | 0.0170 ms |
| Mean latency (crashRecover) | 0.0227 ms |

### Scenario Breakdown

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

No resource leak detected.

## 24-Hour Status

- Not executed.
- The `SoakHarness` is validated and ready for a 24-hour run.
- CI should run `SOAK_MS=86400000 node scripts/op-validation.js` and append the produced `data/op-validation.json`.

## Recommendation

The short-cycle soak passes. The 24-hour wall-clock soak is a **release blocker** until completed.
