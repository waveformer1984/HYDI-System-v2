# Operational Metrics Report

**Date:** 2026-08-02
**Implementation:** `scripts/lib/soak-metrics.js` (`OperationalMetrics`)
**Consumers:** `scripts/soak-test.js`, `operational-qualification/metrics/metrics-collector.js`

A single implementation now serves both harnesses, so soak and qualification
runs produce directly comparable numbers.

---

## 1. Defects in the Prior Collector

`operational-qualification/metrics/metrics-collector.js` contained four
measurement errors. **All classified VERIFIED** by source inspection.

### 1.1 CPU was a since-boot cumulative, not a utilisation

```js
getCpuUsage() {
  const cpus = os.cpus();             // cumulative jiffies since boot
  ...
  return 100 - (100 * idle / total);
}
```

`os.cpus()` returns totals accumulated since boot. Sampling it repeatedly yields
a near-constant figure that converges further as uptime grows. The derived
`trend` was therefore noise, and the leak check keyed off that trend.

**Now:** interval delta between consecutive samples. Both system-wide CPU and
harness-process CPU (via `process.cpuUsage()`) are reported.

### 1.2 Process count returned a CPU core count

```js
getProcessCount() {
  // Note: This is a simplified implementation
  return os.cpus().length; // Approximation
}
```

This reported `16` on a machine running ~475 processes — not an approximation
but a different quantity entirely, published under the label "process count".

**Now:** reads the real process table (`tasklist` on Windows, `ps -e` on POSIX).
Returns `null` if unavailable. A regression test asserts the value exceeds the
core count when it is non-null.

### 1.3 Handle count was a hardcoded zero

```js
getHandleMetrics() {
  return { count: 0 }; // Placeholder
}
```

A placeholder presented as a measurement. Any reader would conclude zero handles
were open.

**Now:** `process._getActiveHandles()` / `_getActiveRequests()`, explicitly
scoped as harness-local, or `null` where unavailable.

### 1.4 "Disk" metrics recursively walked the repo

```js
getDiskMetrics() {
  const size = this.getDirectorySize(process.cwd());  // recurses node_modules
```

This measured repository size, not disk utilisation, and did so by walking
`node_modules` on every sample — slow enough to distort the sampling interval it
was supposed to observe.

**Now:** `fs.statfsSync()` for real filesystem utilisation; `null` where the
platform does not support it.

---

## 2. Metrics Collected

Per the Phase 5 requirement. Sampled on an interval (default 60 s in soak,
30 s in qualification) and written to `metrics.jsonl` with an ISO timestamp.

| Requirement | Field | Status | Notes |
|---|---|---|---|
| CPU usage | `cpu.systemPercent`, `cpu.harnessPercent` | **VERIFIED** | Interval deltas, not cumulative |
| Memory usage | `memory.harnessHeapUsedBytes`, `harnessRssBytes`, `systemUsedPercent` | **VERIFIED** | Harness process + system-wide |
| Process count | `processCount` | **VERIFIED** | Real process table; `null` if unreadable |
| Handle count | `harnessHandles`, `harnessRequests` | **VERIFIED** | Harness-local scope, stated explicitly |
| Response latency | `endurance.latencyMs` | **VERIFIED** | avg / min / max / p95 per probe |
| Restart count | `counters.restarts` | **VERIFIED** | Increments on a confirmed chaos recovery; `0` without `--chaos` |
| Exception count | `counters.exceptions` | **VERIFIED** | `uncaughtException` hook |
| Unhandled rejection count | `counters.unhandledRejections` | **VERIFIED** | `unhandledRejection` hook |
| Database latency | `dependencies.postgres.tcpConnectMs` | **VERIFIED (partial)** | **TCP connect only** — not query latency |
| Redis latency | `dependencies.redis.tcpConnectMs` | **VERIFIED (partial)** | **TCP connect only** |
| Disk usage | `disk.usedPercent`, `totalBytes`, `freeBytes` | **VERIFIED** | Via `statfs`; `null` where unsupported |

### Scope qualification on dependency latency

`tcpConnectMs` measures the time to complete a TCP handshake. It is **not**
query latency and says nothing about query correctness, connection-pool health,
or data integrity. The field is named for what it measures, and reports label it
*"socket reachability, not query execution."* Reporting handshake time as
"database latency" would be exactly the class of inaccuracy this work removes.

---

## 3. Measurement Rules

These are enforced in code, not convention.

**1. Unmeasurable is `null`, never `0`.**
A `0` is a measurement; a `null` is its absence. `OperationalMetrics.stats()`
filters nulls and returns `{samples: 0, min: null, max: null, avg: null, p95: null}`
for an all-null series rather than zeros. An unreachable dependency reports
`tcpConnectMs: null` — asserted by regression test against a closed port.

**2. Trends require an adequate window.**
`trendPerHour(points, windowMs)` returns `null` below `MIN_TREND_WINDOW_MS`
(10 minutes). This was added after a verification run reported
`trend +702.863 MB/h` extrapolated from 12 seconds. Consumers surface the
shortfall as `PENDING`, not as a pass:

> `sample window 0.2m is below the 10m minimum; no trend reported because
> short-window extrapolation is not meaningful`

**3. Inconclusive leak detection is not "no leaks".**
`checkForResourceLeaks()` returns `hasLeaks: null` with a reason when the window
is too short. The report generator maps that to `PENDING`, so a short run cannot
be cited as evidence of leak-freedom.

**4. Trend method is stated.**
Least-squares slope over the full sample set, not a two-half mean difference
(the prior method, which was sensitive to sample placement).

---

## 4. Summary Statistics

`summarise()` emits, per metric family: `samples`, `min`, `max`, `avg`, `p95`,
plus `windowMs`, `trendWindowSufficient` and `minTrendWindowMs` so a reader can
judge whether the trends are usable.

Console output from a live run:

```
-- Operational metrics (3 samples) -------------------------
CPU (system):    avg 97.58%   max 100%
Memory (system): avg 95.06%   max 96.65%
Harness heap:    avg 6.4MB    trend not reported (insufficient sample window)
Process count:   avg 472.67   max 474
Harness handles: avg 4        max 4
Disk used:       avg 97.36%
Postgres TCP:    avg 4.24ms (3 reachable samples)
Redis TCP:       avg 4.14ms (3 reachable samples)
Restarts: 0   Exceptions: 0   Unhandled rejections: 0   Chaos injections: 0
```

Note `(3 reachable samples)` — the sample count is printed alongside each
dependency average so a figure derived from partial reachability is visible as
such.

---

## 5. Observation from Verification

The run above recorded **97.4% disk utilisation** and **95.1% system memory**
on the host. Both are outside normal operating margins and would materially
affect any 24-hour soak executed on this machine. Recorded here as an
**OBSERVED** environmental condition, not a system defect — but a full soak run
on this host would be measuring a resource-constrained environment, and the
results should be read in that light.

---

## 6. Verification

| Check | Result |
|---|---|
| Sample contains every required metric family | **VERIFIED** — regression test |
| Process count is a real table read | **VERIFIED** — asserted `> os.cpus().length` |
| Handle count is not a hardcoded zero | **VERIFIED** — regression test |
| Unreachable dependency yields `null`, not `0` | **VERIFIED** — regression test against a closed port |
| Short window yields no trend | **VERIFIED** — regression test at 2 s and 1 h |
| Stats ignore nulls | **VERIFIED** — regression test |
| Timestamped logs produced | **VERIFIED** — `metrics.jsonl` written per run |
