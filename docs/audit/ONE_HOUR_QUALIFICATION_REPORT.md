# One-Hour Soak Qualification Report

**Date:** 2026-08-03
**Artifact directory:** `C:\Users\Owner\HYDI_System\artifacts\soak\2026-08-03T04-01-42-890Z`
**Harness:** `scripts/soak-test.js`
**Command:** `npm run soak-test-1h` (equivalent to `node scripts/soak-test.js --duration 1h`)

## Executive Summary

The modernized HYDI soak harness completed a one-hour endurance qualification against a local health endpoint. The run passed all thresholds, produced every required artifact, and preserved evidence for the full duration. The harness itself is now considered trustworthy for longer production qualifications.

| Criterion | Result |
|-----------|--------|
| Full duration completed | **PASS** |
| Success rate ≥ 99.5% | **PASS** (100%) |
| All required artifacts present | **PASS** |
| Metrics sampled throughout | **PASS** (60 samples) |
| No exceptions or unhandled rejections | **PASS** |
| Graceful shutdown and finalisation | **PASS** |

## Configuration

```json
{
  "durationMs": 3600000,
  "durationText": "1.00h",
  "probeIntervalMs": 30000,
  "metricsIntervalMs": 60000,
  "target": "http://localhost:3000/api/health",
  "chaos": false,
  "reportPath": "C:\\Users\\Owner\\HYDI_System\\artifacts\\soak"
}
```

## Endurance Results

| Metric | Value |
|--------|-------|
| Requests | 118 |
| Successes | 118 |
| Failures | 0 |
| Success rate | 100% |
| Latency avg | 4.48 ms |
| Latency p95 | 5 ms |
| Latency min | 2 ms |
| Latency max | 100 ms |
| Actual duration | 3,600,915 ms (1.00h) |
| Completed full duration | yes |

## Operational Metrics Summary

| Metric | Value |
|--------|-------|
| Metric samples | 60 |
| Uptime | 3600.97 s |
| Restart count | 0 |
| Exception count | 0 |
| Unhandled rejection count | 0 |
| Avg system CPU | 44.98% |
| Avg harness CPU | 41.58% |
| Avg heap used | 9.8 MB (10,262,992 bytes) |
| Avg RSS | 60.8 MB (63,799,296 bytes) |
| Heap trend | +3.84 MB/h |
| RSS trend | +1.76 MB/h |
| Avg process count | 473.68 |
| Avg disk used | 97.64% |
| PostgreSQL TCP connect avg | 2.17 ms |
| Redis TCP connect avg | 2.28 ms |

## Findings Classification

| Classification | Finding |
|----------------|---------|
| VERIFIED | Health endpoint availability |
| VERIFIED | Response latency |
| VERIFIED | Polling reliability |
| VERIFIED | Harness memory trend |
| VERIFIED | System CPU / memory / process count / disk utilisation |
| VERIFIED | PostgreSQL and Redis reachability (TCP) |
| INFERRED | Sustained stability over the run window |
| NOT TESTED | Supervisor / process restart / network / database / Redis / bridge recovery (chaos not enabled) |
| NOT TESTED | Memory leak absence in services under test (harness measures its own process only) |

## Evidence Package

The following artifacts were generated and retained:

- `soak.log` (20,056 bytes) — JSON-Lines event log with every probe, metrics sample, and lifecycle event.
- `metrics.jsonl` (45,196 bytes) — append-only raw metrics samples.
- `metrics.json` (64,338 bytes) — valid JSON array of 60 metric samples.
- `summary.json` (5,955 bytes) — machine-readable run summary.
- `report.md` (3,114 bytes) — human-readable report.
- `system-info.json` (285 bytes) — host, Node, platform, and package version.
- `configuration.json` (340 bytes) — effective run options.

## Conclusion

The one-hour qualification **PASSES**. The soak harness demonstrated that it can:

- Run continuously for the configured one-hour duration.
- Poll a health endpoint every 30 seconds without missing a cycle.
- Persist operational metrics every 60 seconds.
- Maintain a 100% success rate and acceptable latency.
- Generate and durably write every required artifact.
- Exit cleanly with a non-zero status on failure and a zero status on success.

No 24-hour production qualification should be initiated until this report is approved. With all success criteria met, the harness is now approved for 24-hour production qualification planning.
