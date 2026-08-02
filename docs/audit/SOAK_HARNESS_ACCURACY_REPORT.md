# Soak Harness Accuracy Report

**Date:** 2026-08-02
**Subject:** `scripts/soak-test.js` — what it claimed, what it did, what it does now.

---

## 1. Prior State

### What the file claimed

```js
/**
 * 24-Hour Stability Soak Test
 *
 * Simulates production workload with failures and verifies auto-recovery.
 *
 * Scenarios:
 * - Steady request load (1 req/30s)
 * - Network blips (5s downtime every hour)
 * - Database reconnects (simulate connection loss)
 * - Random worker crashes (verify restart)
 * - Memory leak detection (monitor heap)
 */
```

### What it actually did

**Classification: VERIFIED** by source inspection and execution.

| Claim | Reality |
|---|---|
| "verifies auto-recovery" | No recovery was ever verified. |
| "Network blips (5s downtime every hour)" | `await new Promise(r => setTimeout(r, 5000))`. No network was touched. |
| "Database reconnects (simulate connection loss)" | **Not implemented at all.** No such code existed. |
| "Random worker crashes (verify restart)" | **Not implemented at all.** No such code existed. |
| "Steady request load" | Accurate — HTTP GET to `/api/health` every 30 s. |
| "Memory leak detection (monitor heap)" | Partially accurate — tracked the *harness's own* heap, not any service. |

The most serious item was `simulateNetworkBlip()`:

```js
logger.warn('🌊 Injecting network blip (5s downtime)...');
// In real env: iptables -A OUTPUT -d localhost -p tcp --dport 3000 -j DROP
// For now: just log the injection
await new Promise((r) => setTimeout(r, 5000));
logger.info('✅ Network recovered');
```

The harness logged a fault injection and a recovery, having performed neither.
A reader of those logs would reasonably conclude that network-interruption
recovery had been exercised and passed. Two of the five advertised scenarios did
not exist in any form.

The pass criterion was `successRate >= 99.5%` over health polls — a statement
about endpoint availability only, reported under the heading "SOAK TEST REPORT"
with no scope qualification.

---

## 2. Current State — Declared Scope

The scope is now stated in the file header and reproduced in every report.

### VERIFIED by a default run

Measured directly by the harness:

- Health endpoint availability and HTTP status over the window
- Request success rate and failure count
- Response latency — avg / min / max / p95
- Polling reliability — delivered vs. scheduled probe cycles
- Harness memory trend — heap and RSS, least-squares slope per hour
- System CPU and memory utilisation, sampled as interval deltas
- OS process count; harness libuv handle and request counts
- Disk utilisation of the working filesystem, where the platform reports it
- TCP connect reachability and latency for PostgreSQL and Redis
- Uncaught exception and unhandled rejection counts within the harness

### NOT VERIFIED by a default run

- Supervisor recovery
- Process restart behaviour
- Network interruption recovery
- Database failover or recovery
- Redis recovery
- Bridge recovery
- Chaos or resilience behaviour of any kind

These appear in every report as explicit `NOT TESTED` findings with the reason
*"chaos mode was not enabled; run with --chaos to exercise this"* — not as
absent sections a reader might overlook.

### Deliberate scope limits

Three further limits are declared in each report rather than left implicit:

| Limit | Reported as |
|---|---|
| Only the harness process is instrumented for memory | `NOT TESTED` — "Memory leak absence in services under test" |
| Dependency checks are TCP connect probes, not queries | `VERIFIED` but explicitly labelled "socket reachability, not query execution or data integrity" |
| Overall stability is a derived judgement | `INFERRED` — "not a direct measurement of stability" |

---

## 3. Accuracy Controls

### Simulation is never reported as injection

`simulateNetworkBlip()` was deleted, not rewritten. A regression test asserts
that neither the identifier nor the string `"Injecting network blip"` returns to
the file.

### Unmeasurable values are `null`, never `0`

A `0` is a measurement; a `null` is the absence of one, and the reporter treats
them differently. An unreachable dependency yields `tcpConnectMs: null`, not
`0 ms` — a test asserts this specifically. Previously `getHandleMetrics()`
returned a hardcoded `{ count: 0 }` placeholder presented as a real reading.

### Short windows do not produce trends

Extrapolating a brief window to an hourly rate produces confident nonsense. An
early verification run of this very harness reported:

```
Harness heap: avg 6.4MB   trend +702.863 MB/h
```

from a 12-second window. That was my own inaccuracy, found during verification
and fixed: trends are now suppressed below a 10-minute window and the finding is
classified `PENDING`, not `VERIFIED`:

```
PENDING    Harness memory trend
           sample window 0.2m is below the 10m minimum; no trend reported
           because short-window extrapolation is not meaningful
```

### Pass results carry a scope caveat

Every terminal result prints the basis and the limits of the conclusion:

```
RESULT: PASS
Basis:  success rate 100.00% >= 99.5%
Scope:  This result covers endurance only. It is not evidence of recovery,
        resilience, or failover behaviour.
```

### Early termination is recorded

`SIGINT`/`SIGTERM` set a `stopReason` and `completedFullDuration: false` in the
report metadata, so a soak stopped at hour 3 cannot be presented as 24 hours.

---

## 4. Outputs

Each run writes a timestamped directory under `reports/soak/`:

| File | Contents |
|---|---|
| `report.json` | Full machine-readable report with classified findings |
| `events.jsonl` | One line per probe, plus chaos and exception events |
| `metrics.jsonl` | One line per metric sample |

These are gitignored — they are run evidence, not source.

---

## 5. Verification Evidence

Executed 2026-08-02 against the live local stack:

```
-- Endurance ------------------------------------------------------
Requests: 3   Success: 3 (100%)   Failures: 0
Latency:  avg 44.33ms   p95 87ms   max 87ms

-- Chaos ----------------------------------------------------------
DISABLED (default). Chaos mode disabled (default). No failure was injected
and no recovery behaviour was exercised.

-- Findings -------------------------------------------------------
  VERIFIED   Health endpoint availability
  VERIFIED   Response latency
  VERIFIED   Polling reliability
  PENDING    Harness memory trend
  NOT TESTED Memory leak absence in services under test
  VERIFIED   System CPU / memory / process count / disk utilisation
  VERIFIED   PostgreSQL and Redis reachability
  NOT TESTED Database / Redis query correctness and failover
  INFERRED   Sustained stability over the run window
  NOT TESTED supervisor recovery
  NOT TESTED process restart
  NOT TESTED network interruption recovery
  NOT TESTED database recovery
  NOT TESTED Redis recovery
  NOT TESTED bridge recovery
```

Regression coverage: `tests/unit/validation-tooling-integrity.test.js`,
suites *"soak harness: chaos is opt-in"*, *"soak harness: documented scope
matches implementation"*, *"soak harness: operational metrics are generated
correctly"*.

---

## 6. Outstanding

| Item | Classification |
|---|---|
| A full 24-hour run has not been executed | **NOT TESTED** — the harness is now capable of it; the run itself remains outstanding evidence. |
| Service-process memory instrumentation | Not implemented; declared `NOT TESTED` in every report rather than approximated. |
| Dependency *query* latency (as opposed to TCP connect) | Not implemented; `pg` is available should this be wanted later. |
