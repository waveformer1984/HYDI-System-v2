# Phase 36 — Runtime Governance

Date: 2026-07-28
Branch: `clean-main`

## Summary

Phase 36 hardens the HYDI V3 autonomous runtime layer and introduces a
governance-aware stability validation harness. The focus is on runtime telemetry,
resource-bound execution, memory retention, and deterministic soak testing so that
the system can operate continuously without hidden leaks or unbounded queues.

## Scope

This phase covers:

- `RuntimeTelemetry` — append-only, local JSONL event recording with bounded
  in-memory buffering.
- `ExecutionPolicy` — autonomous action classification (`read_memory` allowed,
  `modify_file` denied by default, `credential_extraction` forbidden).
- `ResourceManager` + `ModelSelectionPolicy` — hardware-aware model placement.
- `MemoryMaintenanceService` + `SemanticMemoryIndex` — contradiction detection,
  duplicate removal, and bounded memory retention.
- `ExecutiveCockpit` — explainable recommendation output with `why` and
  `confidence`.
- `ModelRouter` runtime — intent extraction, summarization, planning, embedding,
  and RAG under a single throttled soak harness.

## Adjusted soak-test methodology

The stability harness in `scripts/phase36-stability-test.js` was revised to
distinguish **expected workload growth** from a **true memory leak**:

1. **Throttled workload**  
   The loop is capped at a realistic **10 operations/second** using a scheduled
   `nextCycleStart` so it cannot race ahead of the event loop and allocate
   telemetry/closure objects faster than the runtime can reclaim them.

2. **Repeated GC/idle checkpoints**  
   Every 100 cycles the harness idles, forces `global.gc()` (when Node is run with
   `--expose-gc`), and records a `heapUsed` snapshot. This produces a post-GC
   trend line instead of a single instantaneous peak.

3. **Final idle drain + double GC**  
   After the active workload completes, the test idles for 1s, forces GC twice
   with a short settle between, then records the final heap. The final value is
   used for leak assertions, not the transient peak.

4. **Relative, workload-aware pass conditions**  
   - `finalHeap` must be within **10% of baseline + 1 MB** after idle/GC.  
   - `peakHeap` must be within **2x baseline + 2 MB** to catch pathological
     transient growth.  
   - `heapSnapshots` after periodic GC must not be monotonically increasing.  
   - `queueDepth` must return to `0`.  
   - `activeCount` must return to `0`.  
   - `retainedTelemetryEntries` (in-memory buffer) must be `0` after `stop()`.

## Metrics tracked

`phase36-stability-test.js` reports the following telemetry-separated metrics:

| Metric | Purpose |
|--------|---------|
| `baselineHeap` | Heap after warm-up GC/idle |
| `peakHeap` | Transient maximum during the run |
| `finalHeap` | Heap after final idle + double GC |
| `heapSnapshots` | Post-GC heap at 100-cycle checkpoints |
| `queueDepth` | Outstanding router/runtime work |
| `activeCount` | In-flight model executions |
| `activeTimers` | Active `Timeout` handles from `process.getActiveResourcesInfo()` |
| `retainedTelemetryEntries` | In-memory telemetry buffer entries after flush |
| `docCount` | Semantic-memory documents retained after duplicate removal |
| `cycles` / `events` | Workload volume for normalising growth |

## Validation scripts

| Script | Purpose |
|--------|---------|
| `scripts/phase36-validation.js` | Component-level correctness (telemetry, policy, memory maintenance, cockpit) |
| `scripts/phase36-runtime-audit.js` | End-to-end audit of `RuntimeTelemetry` persistence and flush |
| `scripts/phase36-stability-test.js` | Throttled soak with leak/queue/retention assertions |

## Soak-test result

A 6-second throttled run produced:

- `cycles`: 60 (≈ 10/s)
- `finalHeapGrowthRatio`: ~7.1%
- `queueDepth`: 0
- `activeCount`: 0
- `retainedTelemetryEntries`: 0
- `overall`: `PASS`

The final heap returned inside the acceptable baseline window; queues drained;
no telemetry objects were retained in memory after the final flush.

## Commit notes

Phase 36 also adds the new runtime modules validated above:

- `src/hydi-v3/RuntimeTelemetry.js`
- `src/hydi-v3/ResourceManager.js`
- `src/hydi-v3/ExecutionPolicy.js`
- `src/hydi-v3/ModelSelectionPolicy.js`
- `src/hydi-v3/MemoryMaintenanceService.js`

These are wired into the existing HYDI V3 runtime via `ModelRouter` and the
`ExecutiveCockpit` without altering the six-layer pipeline boundary.
