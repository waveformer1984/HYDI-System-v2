# Operational Qualification Report

## Executive Summary

- **Command:** `npm run operational-qualification`
- **Duration:** 1,806,210 ms (~30 minutes)
- **Qualification type:** quick
- **Chaos enabled:** false
- **Overall status:** **FAIL**
- **Summary:** Stack started and stopped successfully, metrics were collected, but workload execution failed and a resource leak was detected.

## Qualification Phases

| Phase | Result | Evidence |
|-------|--------|----------|
| Stack startup | **PASS** | Orchestrator reported `started`; all services launched |
| Stack shutdown | **PASS** | Orchestrator reported `stopped` with no errors |
| Workload execution | **FAIL** | 972 / 1,458 failed (33.3% success) |
| Metrics collection | **PASS** | 61 samples over 1,800,398 ms |
| Failure injection | **NOT TESTED** | Chaos disabled |

## Workload Execution

### Statistics

| Metric | Value |
|--------|-------|
| Total executions | 1,458 |
| Successful | 486 |
| Failed | 972 |
| Success rate | 33.33% |
| Average duration | 815 ms |

### Representative Failures

| Workload | Error | Root cause (tentative) |
|----------|-------|------------------------|
| `conversation` | `Conversation request failed: 400` | Request body likely missing required fields or unauthenticated |
| `memory-storage` | `Memory storage request failed: 500` | Internal error in memory-storage endpoint |
| `memory-retrieval` | `Memory retrieval request failed: 405` | HTTP method not allowed |
| `supervisor-status` | `request to http://localhost:9999/status failed, reason: ` | Wrong port/service for supervisor health |

## Metrics

### CPU

- Samples: 61
- Min: 30.15%
- Max: 99.93%
- Avg: 63.04%
- P95: 99.33%

### Memory

- System used %: avg 82.74%, max 95.54%
- Harness heap: avg 12.98 MB, max 17.32 MB
- **Harness heap trend: 9.23 MB/hr** (threshold 5 MB/hr)
- **Resource leak: YES**

### Process / Handles

- Process count: 407–425
- Harness handles: 16–25

### Disk

- Used: avg 97.56%, min 97.54%, max 97.8%

### Dependency Latency

| Dependency | Avg (ms) | Min (ms) | Max (ms) | P95 (ms) |
|------------|----------|----------|----------|----------|
| PostgreSQL | 3.69 | 1.42 | 56.96 | 3.72 |
| Redis | 3.82 | 1.48 | 56.85 | 4.17 |

## Acceptance Criteria

| Criterion | Result | Evidence |
|-----------|--------|----------|
| Stack starts successfully | **PASS** | Orchestrator reported `started` |
| Stack stops gracefully | **PASS** | Orchestrator reported `stopped` |
| Workload success rate >= 99% | **FAIL** | 486/1458 succeeded (33.33%) |
| No resource leaks (harness process) | **FAIL** | 9.23 MB/hr trend exceeds 5 MB/hr threshold |
| All failure scenarios recover | **NOT TESTED** | Chaos disabled |
| Recovery time within target | **NOT TESTED** | Chaos disabled |
| Data integrity maintained across faults | **NOT TESTED** | No durable state snapshot/diff performed |

## Recommendations

1. **Fix workload request construction** in the qualification harness or the API routes:
   - `conversation` must provide a valid request body.
   - `memory-storage` must not return 500.
   - `memory-retrieval` must accept the HTTP method used.
   - `supervisor-status` must target the correct URL/port.
2. **Investigate the harness heap growth** (9.23 MB/hr). Sample handles are stable (16–25), so the leak is likely in retained event/workload objects inside the harness.
3. **Re-run with chaos enabled** (`--chaos`) only after the basic workload success rate is green, to avoid masking failures.

## Commands Executed

```text
npm run operational-qualification
```

## Conclusion

**FAIL.** The HYDI stack can start and stop, and operational metrics are stable, but the 33.3% workload success rate and the harness process memory leak are release blockers. Do not proceed to 1-hour/24-hour soak tests until these issues are resolved and a re-run passes.
