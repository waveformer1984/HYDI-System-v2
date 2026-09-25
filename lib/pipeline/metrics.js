'use strict';

/**
 * Per-stage latency and outcome metrics for lib/pipeline.
 *
 * Process-wide and in memory, the same single-long-lived-process
 * assumption lib/realtime/eventBus.js and lib/rate-limit.js document. Each
 * stage keeps a fixed-size window of recent durations, so memory stays
 * bounded no matter how many events flow through. api/mobile-status.js
 * reports snapshot(); it reads zeros until something in this process
 * actually runs the pipeline.
 */

const STAGES = Object.freeze(['ingestion', 'ledger', 'cascade', 'kilo', 'protoforge', 'emission']);
const WINDOW = 200;

function emptyStage() {
  return { count: 0, errors: 0, skipped: 0, lastMs: null, durations: [] };
}

function createMetrics() {
  let stages;
  let outcomes;
  let runs;
  let lastRunAt;

  function reset() {
    stages = Object.fromEntries(STAGES.map((s) => [s, emptyStage()]));
    outcomes = {};
    runs = 0;
    lastRunAt = null;
  }
  reset();

  function recordStage(stage, status, durationMs) {
    const entry = stages[stage];
    if (!entry) return;
    if (status === 'skipped') {
      entry.skipped += 1;
      return;
    }
    entry.count += 1;
    if (status === 'error') entry.errors += 1;
    entry.lastMs = durationMs;
    entry.durations.push(durationMs);
    if (entry.durations.length > WINDOW) entry.durations.shift();
  }

  function recordRun(outcome, at) {
    runs += 1;
    lastRunAt = at;
    outcomes[outcome] = (outcomes[outcome] || 0) + 1;
  }

  function round(ms) {
    return ms === null ? null : Math.round(ms * 100) / 100;
  }

  /** Compact, 3G-safe summary: count, errors, last/avg/p95 ms per stage. */
  function snapshot() {
    const out = {};
    for (const stage of STAGES) {
      const { count, errors, skipped, lastMs, durations } = stages[stage];
      const sorted = [...durations].sort((a, b) => a - b);
      const avg = sorted.length ? sorted.reduce((sum, d) => sum + d, 0) / sorted.length : null;
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : null;
      out[stage] = { n: count, errors, skipped, last_ms: round(lastMs), avg_ms: round(avg), p95_ms: round(p95) };
    }
    return { runs, last_run_at: lastRunAt, outcomes: { ...outcomes }, stages: out };
  }

  return { recordStage, recordRun, snapshot, reset };
}

const defaultMetrics = createMetrics();

/**
 * Express handler for protoforge-core's GET /pipeline/metrics, which
 * heidi-web's /api/mobile-status reads (the pipeline runs in
 * protoforge-core, a different process). Counts and timings only.
 */
function metricsHandler(metrics = defaultMetrics) {
  return (req, res) => {
    res.json({ status: 'ok', pipeline: metrics.snapshot(), timestamp: new Date().toISOString() });
  };
}

module.exports = { STAGES, WINDOW, createMetrics, defaultMetrics, metricsHandler };
