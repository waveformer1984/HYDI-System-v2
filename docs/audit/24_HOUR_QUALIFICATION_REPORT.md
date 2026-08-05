# HYDI 24-Hour Endurance Qualification Report

## Executive Summary

The 24-hour endurance qualification completed successfully on `release/v0.9.0` (commit `99ff58f`).

- **Result:** PASS
- **Target:** `http://localhost:3000/api/health`
- **Duration:** 24.00h requested, 24.00h actual (86400.678s)
- **Probes:** 2840 / 2840 successful (100.00%)
- **Success threshold:** 99.5%
- **Average latency:** 3.15ms
- **p95 latency:** 5ms
- **Max latency:** 184ms

Resilience and recovery were **not tested** because the run was not executed with `--chaos`.

## Environment

| Property | Value |
| --- | --- |
| Harness | `scripts/soak-test.js` |
| Branch | `release/v0.9.0` |
| Commit | `99ff58f` |
| Node | `v24.11.1` |
| Platform | `win32` / `x64` |
| CPU cores | 12 |
| Total memory | 15.70 GiB |

## Operational Metrics

| Metric | Value |
| --- | --- |
| Uptime | 86400.678s |
| Restart count | 0 |
| Exception count | 0 |
| Unhandled rejection count | 0 |
| Avg system CPU | 23.94% |
| Avg harness CPU | 1.3% |
| Avg heap used | 10.9MB |
| Avg RSS | 45.2MB |
| Heap trend | +82.57KB/h |
| RSS trend | -1.17MB/h |
| Avg process count | 471.57 |
| Avg disk used | 98.22% |
| PostgreSQL TCP connect | 1.83ms |
| Redis TCP connect | 1.92ms |

## Findings

| Classification | Finding | Evidence |
| --- | --- | --- |
| VERIFIED | Health endpoint availability | 2840/2840 probes returned 2xx |
| VERIFIED | Response latency | avg 3.15ms, p95 5ms, max 184ms |
| VERIFIED | Polling reliability | 2840 of 2840 scheduled cycles delivered |
| VERIFIED | Harness memory trend | heap +82.57KB/h, RSS -1.17MB/h |
| VERIFIED | System telemetry | 1421 samples of CPU/memory/process/disk |
| VERIFIED | Dependency reachability | PostgreSQL and Redis TCP connect probes |
| NOT TESTED | Service memory leaks | harness measures its own process only |
| NOT TESTED | Database query correctness | no queries issued by harness |
| NOT TESTED | Supervisor/recovery/chaos | run without `--chaos` |

## Artifacts

All artifacts are preserved in:

`C:\Users\Owner\HYDI_System\artifacts\soak\2026-08-03T17-22-06-162Z`

The artifact manifest with SHA-256 hashes is in `docs/audit/QUALIFICATION_ARTIFACT_MANIFEST.json`.

## Certification Decision

- **Endurance Qualification:** PASS
- **Resilience Qualification:** NOT TESTED
- **Production Certification:** PENDING — the 24h endurance run verifies stability but does not certify failure recovery.
