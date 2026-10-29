'use strict';

/**
 * Read-only trace routes for protoforge-core (src/server.js):
 *   GET /pipeline/traces?limit=   recent runs, newest first, + Heidi link status
 *   GET /pipeline/traces/:id      one run by trace_id
 * Stage statuses, classification and decision only -- never the event
 * payload. Traces live in memory (the last 50 runs since start); a trace
 * that has aged out is still summarised on the Heidi task it opened.
 */

function traceSummary(t) {
  return {
    trace_id: t.trace_id,
    started_at: t.started_at,
    fingerprint: t.fingerprint,
    outcome: t.outcome,
    duration_ms: t.duration_ms,
    stages: t.stages,
  };
}

/**
 * @param {object} app  express app
 * @param {{ getPipeline: () => { getRecentTraces: Function, getTrace: Function }, linker?: { status: Function } }} deps
 */
function mountTraceRoutes(app, { getPipeline, linker = null }) {
  app.get('/pipeline/traces', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const traces = getPipeline().getRecentTraces().slice(-limit).reverse().map(traceSummary);
    res.json({ status: 'ok', traces, heidi_link: linker ? linker.status() : null });
  });
  app.get('/pipeline/traces/:traceId', (req, res) => {
    const t = getPipeline().getTrace(String(req.params.traceId));
    if (!t) return res.status(404).json({ status: 'error', message: 'trace not in the recent window (last 50 runs since protoforge-core started)' });
    res.json({ status: 'ok', trace: traceSummary(t) });
  });
}

module.exports = { mountTraceRoutes, traceSummary };
