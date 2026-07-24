# HEIDI Self-Improvement System — Phase 1: Telemetry & Metrics Instrumentation

**Status:** ✅ COMPLETE  
**Date:** 2026-06-27  
**Phase:** 1 of 8

---

## Overview

Phase 1 establishes the **foundation for self-improvement**: comprehensive telemetry collection across all HEIDI subsystems. Every decision, action, and outcome is now measurable, enabling future phases to analyze, recommend, and improve.

## What Was Built

### 1. **Database Schema Migration** (`supabase/migrations/20260627000001_heidi_telemetry_foundation.sql`)

Five new Supabase tables with full RLS and indexing:

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `heidi_telemetry` | Raw metric events (append-only log) | `metric_type`, `metric_name`, `value`, `tags`, `metadata`, `session_id` |
| `heidi_metrics_snapshots` | Periodic aggregated metrics | `snapshot_type` (hourly/daily/weekly), `metrics`, `summary` |
| `heidi_performance_baseline` | Baseline metrics for comparison | `baseline_name`, `baseline_version`, `metrics`, `description` |
| `heidi_module_performance` | Per-module stats | `module_name`, `invocations`, `successes`, `failures`, `avg_duration_ms`, `error_rate`, `quality_score` |
| `heidi_drift_detection` | Anomalies & regressions | `drift_type`, `metric_name`, `baseline_value`, `current_value`, `deviation_percent`, `severity` |

**Indexes:** Created on `created_at`, `metric_type`, `metric_name`, `module_name`, `session_id`, `severity` for fast queries.

**RLS:** Service role has full access (allows system automation). User access can be added later per tenant.

---

### 2. **MetricsCollector Class** (`src/telemetry/MetricsCollector.js`)

Unified telemetry client with methods:

```typescript
recordMetric(metricType, metricName, value, tags, metadata)
  // Record a single metric event

trackModuleCall(moduleName, success, durationMs, extra)
  // Track module invocation (success/failure/timing)

createSnapshot(snapshotType)
  // Aggregate all module performance into a snapshot

flush()
  // Send buffered metrics to Supabase

saveSnapshot(snapshotType, metrics)
  // Persist aggregated snapshot to DB

recordDrift(driftType, metricName, baselineValue, currentValue, severity)
  // Record detected drift/anomaly

recordModulePerformance(moduleName)
  // Snapshot a module's performance metrics

getRecentMetrics(limit, metricType)
  // Query recent metrics from DB

getModuleSummary(moduleName)
  // Get performance history for a module
```

**Buffering:** Metrics are buffered in memory and flushed periodically (configurable, default 60s).

**Error Handling:** All Supabase errors are caught and logged (never interrupt the loop).

---

### 3. **InstrumentedHeidiCoreLoop Class** (`src/telemetry/InstrumentedHeidiCoreLoop.js`)

Extends `HeidiCoreLoop` with comprehensive telemetry:

**Instrumented Methods:**
- `executeLoop()` — tracks loop timing, success/failure
- `executeHeidiLoop()` — breaks down 7-phase cycle into individual metrics
- Each phase (Observe→Evaluate→Decide→Act→Measure→Reflect→Adapt) records:
  - Duration (ms)
  - Success/failure
  - Confidence/risk/quality scores
  - Task type and strategy

**Phase Metrics:**
```
observe_duration_ms       — Time to gather state
evaluate_duration_ms      — Time to assess situation
decide_duration_ms        — Time to choose action (with strategy recorded)
act_duration_ms           — Time to execute (with success flag)
measure_duration_ms       — Time to quantify results (quality/impact recorded)
reflect_duration_ms       — Time to analyze performance
adapt_duration_ms         — Time to update strategy
full_loop_duration_ms     — Total with breakdown attached
```

**Lifecycle Events:**
- `loop_started` — Core loop initialization
- `loop_stopped` — Core loop shutdown
- `loop_completed` — Successful loop with duration
- `loop_failed` — Failed loop with error details

**Module Performance Tracking:**
- Maintains live counters for each module
- Calculates: invocations, successes, failures, avg/min/max duration, error rate, quality score

**Instrumented Subsystems:**
- `instrumentMemorySystem()` — tracks memory operations
- `instrumentOrchestrator()` — tracks task routing performance

**Flushing:**
- Automatic flush every 60s (configurable)
- Manual flush on shutdown (ensures no metrics lost)
- Automatic snapshot creation after flush

---

### 4. **Metrics API Endpoint** (`pages/api/metrics/snapshot.js`)

Query interface for telemetry data:

```bash
# Get recent telemetry events
GET /api/metrics/snapshot?type=telemetry&limit=100

# Get module performance
GET /api/metrics/snapshot?type=module&module=HeidiCoreLoop

# Get detected drift
GET /api/metrics/snapshot?type=drift&limit=50

# Get baselines
GET /api/metrics/snapshot?type=baseline

# Get metric snapshots
GET /api/metrics/snapshot?type=snapshot&limit=20
```

**Response:**
```json
{
  "success": true,
  "type": "telemetry",
  "count": 42,
  "data": [...],
  "summary": {
    "metric_types": ["loop_cycle", "action", "performance"],
    "unique_metrics": 12,
    "avg_value": "125.5",
    "min_value": 50,
    "max_value": 280
  }
}
```

**Summary Calculations:**
- **Telemetry**: metric types, unique metrics, value statistics
- **Module**: quality score averages, invocation counts, error totals, duration stats
- **Drift**: drift types, severity distribution, critical count
- **Baseline**: baseline inventory
- **Snapshot**: snapshot types, latest timestamp, average quality

---

## How to Use Phase 1

### Deploying the Schema

```bash
# Apply migration to Supabase
cd ~/HYDI_System
supabase db push

# Or via SQL Editor if CLI access is blocked:
# 1. Copy migration SQL from supabase/migrations/20260627000001_heidi_telemetry_foundation.sql
# 2. Paste into Supabase console → SQL Editor
# 3. Run
```

### Using MetricsCollector Directly

```javascript
const MetricsCollector = require('./src/telemetry/MetricsCollector');

const metrics = new MetricsCollector();

// Record a metric
metrics.recordMetric(
  'loop_cycle',
  'heidi_core_loop_duration_ms',
  125,
  { agent: 'Hyve', phase: 'decide' },
  { strategy: 'local_first' }
);

// Track module call
metrics.trackModuleCall('HeidiOrchestrator', true, 50, {});

// Flush to database
await metrics.flush();

// Save snapshot
await metrics.saveSnapshot('manual');
```

### Using InstrumentedHeidiCoreLoop

```javascript
const InstrumentedHeidiCoreLoop = require('./src/telemetry/InstrumentedHeidiCoreLoop');

const loop = new InstrumentedHeidiCoreLoop({
  enableAutoActions: true,
  flushInterval: 60000, // 1 minute
  enableDetailedMetrics: true
});

// Start collecting automatically
await loop.start();

// ... run tasks ...

// Shutdown (flushes remaining metrics)
await loop.stop();

// Check telemetry status
console.log(loop.getTelemetryStatus());
```

### Querying Metrics via API

```bash
# Get last 100 telemetry events
curl "https://heidi-pc.tailc50af2.ts.net/api/metrics/snapshot?type=telemetry&limit=100"

# Get module performance for HeidiCoreLoop
curl "https://heidi-pc.tailc50af2.ts.net/api/metrics/snapshot?type=module&module=HeidiCoreLoop"

# Get critical drift alerts
curl "https://heidi-pc.tailc50af2.ts.net/api/metrics/snapshot?type=drift&limit=50"
```

---

## Key Design Decisions

### 1. **Append-Only Telemetry Log**
- Raw events are immutable
- Enables replay/audit trails
- Supports retention policies (archive old data)
- No update/delete complexity

### 2. **Periodic Snapshots**
- Aggregated metrics are stored separately
- Enables trending & historical analysis
- Supports daily/weekly/monthly rollups
- Lighter queries than scanning raw events

### 3. **Service Role Access**
- Telemetry collection runs as service role (can't be blocked by RLS)
- Ensures metrics are never lost due to auth issues
- User access can be added in Phase 7 (authorization layer)

### 4. **Non-Blocking Telemetry**
- All database operations are wrapped in try/catch
- Telemetry failures never interrupt the core loop
- Graceful degradation if Supabase is slow/down

### 5. **Buffering + Periodic Flush**
- Reduces database write frequency
- Batches metrics for efficiency
- Configurable flush interval (60s default)
- Manual flush on shutdown ensures no data loss

---

## Metrics Being Collected

### Loop Metrics
```
heidi_core_loop_start            — Loop initialization
heidi_core_loop_stop             — Loop shutdown
heidi_core_loop_duration_ms      — Total execution time
heidi_core_loop_completion       — Successful completion
heidi_core_loop_failure          — Failed execution
```

### Phase Metrics (per loop)
```
heidi_observe_duration_ms        — Observation duration + observation data
heidi_evaluate_duration_ms       — Evaluation duration + confidence/risk scores
heidi_decide_duration_ms         — Decision duration + strategy + confidence
heidi_act_duration_ms            — Action execution duration + success flag
heidi_measure_duration_ms        — Measurement duration + quality/impact scores
heidi_reflect_duration_ms        — Reflection duration
heidi_adapt_duration_ms          — Adaptation duration + count of changes
heidi_full_loop_duration_ms      — Total with phase breakdown
```

### Action Metrics
```
heidi_revenue_action_duration_ms — Revenue action performance
heidi_revenue_action_error       — Revenue action failures
```

### Memory Metrics
```
heidi_memory_store_context       — Context storage operations
heidi_memory_retrieve_context    — Context retrieval operations
heidi_memory_reflection_duration_ms — Reflection cycle timing
```

### Error Metrics
```
heidi_loop_error                 — Loop execution errors
heidi_orchestrator_routing_error — Orchestrator routing errors
heidi_revenue_action_error       — Revenue action errors
```

---

## Next Steps (Phase 2)

Phase 2 will **analyze** this telemetry to build the self-analysis engine:

1. **Pattern Recognition** — What tasks succeed/fail consistently?
2. **Root Cause Analysis** — Why did failures happen?
3. **Capability Assessment** — Where does HEIDI excel vs struggle?
4. **Anomaly Detection** — What's unusual in current behavior?
5. **Trend Analysis** — How is performance changing over time?

Phase 2 will create:
- `HeidiAnalysisEngine` class
- `heidi_analysis_results` table
- `/api/analysis/evaluate` endpoint

---

## Rollout Checklist

- [ ] Run Supabase migration
- [ ] Deploy MetricsCollector to production
- [ ] Update HeidiCoreLoop initialization to use InstrumentedHeidiCoreLoop
- [ ] Test metrics collection in staging
- [ ] Query `/api/metrics/snapshot` endpoint
- [ ] Verify telemetry flowing to Supabase
- [ ] Set up alerting if flush fails (optional)
- [ ] Document baseline for Phase 3 (recommendation generation)

---

## Troubleshooting

### Metrics not showing up
1. Check Supabase connection (verify `SUPABASE_SERVICE_ROLE_KEY`)
2. Verify migration ran: `SELECT * FROM heidi_telemetry LIMIT 1;`
3. Check application logs for flush errors
4. Manually trigger flush: `await loop.flushMetrics()`

### High database load
1. Increase `flushInterval` to reduce write frequency
2. Archive old telemetry data (retention policy)
3. Reduce `samplingRate` if needed (Phase 1 code ready for this)

### Metrics lag
1. Check if flush is actually happening (logs should show)
2. Increase buffer size before flush
3. Check Supabase database performance

---

**PHASE 1 COMPLETE** ✅

Ready for Phase 2: Self-Analysis Engine
