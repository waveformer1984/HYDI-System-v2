'use strict';
/**
 * Heidi Self-Assessment — the "measure + analyze" stage of the self-improvement loop.
 *
 * Reads recent pipeline events and produces a structured performance assessment plus
 * plain-language findings. Pure analysis (`assess`) is separated from DB I/O so it is
 * deterministic and unit-testable. It NEVER changes the system — it only reports.
 *
 * Usage:
 *   const { assess, assessFromSupabase } = require('./evolution/self-assessment');
 *   const report = await assessFromSupabase(supabase, { windowHours: 24 });
 *   report.findings.forEach(f => console.log(f.severity, f.message));
 *
 * Next stage of the loop (not in this module): feed high-severity findings into
 * evolution/heidi-goals.js as goals for the operator to approve.
 */

function percentile(arr, p) {
  if (!arr || arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}
function round4(n) { return Math.round(n * 10000) / 10000; }

/**
 * Pure: compute an assessment from raw event rows. No DB, no side effects.
 * @param {Array<{verdict?:string, division?:string, elapsed_ms?:number, error?:any, error_message?:any}>} events
 * @param {object} [opts] thresholds + window
 */
function assess(events, opts = {}) {
  const windowHours = opts.windowHours || 24;
  const errorRateThreshold = opts.errorRateThreshold ?? 0.05;
  const divErrorThreshold = opts.divErrorThreshold ?? 0.10;
  const p95LatencyThreshold = opts.p95LatencyThreshold ?? 5000;

  const total = events.length;
  const byVerdict = { 'AUTO-APPROVE': 0, REVIEW: 0, BLOCK: 0, other: 0 };
  const byDivision = {};
  let errorCount = 0;
  const latencies = [];

  for (const e of events) {
    const v = e.verdict || 'other';
    if (byVerdict[v] === undefined) byVerdict.other++; else byVerdict[v]++;
    const div = e.division || 'unknown';
    byDivision[div] = byDivision[div] || { total: 0, errors: 0, latencies: [] };
    byDivision[div].total++;
    const isError = Boolean(e.error || e.error_message);
    if (isError) { errorCount++; byDivision[div].errors++; }
    const lat = Number(e.elapsed_ms);
    if (Number.isFinite(lat)) { latencies.push(lat); byDivision[div].latencies.push(lat); }
  }

  const errorRate = total ? errorCount / total : 0;
  const findings = [];
  if (total === 0) {
    findings.push({ severity: 'info', code: 'idle', message: `No events in the last ${windowHours}h — pipeline idle or telemetry not flowing.` });
  }
  if (errorRate > errorRateThreshold) {
    findings.push({ severity: 'high', code: 'error_rate', message: `Overall error rate ${(errorRate * 100).toFixed(1)}% exceeds ${(errorRateThreshold * 100).toFixed(0)}% — investigate failing tasks.` });
  }

  const divisions = {};
  for (const [div, d] of Object.entries(byDivision)) {
    const er = d.total ? d.errors / d.total : 0;
    const p95 = percentile(d.latencies, 95);
    if (er > divErrorThreshold && d.total >= 5) {
      findings.push({ severity: 'high', code: 'division_errors', division: div, message: `Division "${div}" error rate ${(er * 100).toFixed(1)}% over ${d.total} events — prioritize.` });
    }
    if (p95 !== null && p95 > p95LatencyThreshold) {
      findings.push({ severity: 'moderate', code: 'latency', division: div, message: `Division "${div}" p95 latency ${p95}ms exceeds ${p95LatencyThreshold}ms.` });
    }
    divisions[div] = { total: d.total, error_rate: round4(er), p95_ms: p95 };
  }

  const blockRate = total ? byVerdict.BLOCK / total : 0;
  if (blockRate > 0.2) {
    findings.push({ severity: 'moderate', code: 'block_rate', message: `${(blockRate * 100).toFixed(1)}% of decisions were BLOCK — policy may be too strict or inputs degraded.` });
  }
  if (findings.length === 0) {
    findings.push({ severity: 'info', code: 'ok', message: 'No issues detected against current thresholds.' });
  }

  return {
    window_hours: windowHours,
    total_events: total,
    error_rate: round4(errorRate),
    verdicts: byVerdict,
    latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    divisions,
    findings,
    generated_at: new Date().toISOString(),
  };
}

/**
 * DB-backed: fetch recent events from Supabase and assess them. Thin I/O wrapper.
 * Maps payload.elapsed_ms / payload.error(_message) onto the shape `assess` expects.
 */
async function assessFromSupabase(supabase, opts = {}) {
  const windowHours = opts.windowHours || 24;
  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('heidi_events')
    .select('verdict, division, created_at, payload')
    .gte('created_at', since)
    .limit(opts.limit || 10000);
  if (error) throw new Error(`self-assessment fetch failed: ${error.message}`);
  const events = (data || []).map((e) => ({
    verdict: e.verdict,
    division: e.division,
    elapsed_ms: e.payload && e.payload.elapsed_ms,
    error_message: e.payload && (e.payload.error || e.payload.error_message),
  }));
  return assess(events, { windowHours });
}

module.exports = { assess, assessFromSupabase, percentile };
