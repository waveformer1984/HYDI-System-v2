'use strict';

/**
 * HEIDI V2 six-layer pipeline, end to end, with one trace per event.
 *
 *   [1] ingestion   protoforge/hydi-gateway validateEvent (structure only)
 *   [2] ledger      RAW EVENT LEDGER append (RawLedgerAdapter, idempotent)
 *   [3] cascade     modules/cascade-classification-v2 (classification only)
 *   [4] kilo        kilo/ KiloEngine.generateHypotheses (no execution)
 *   [5] protoforge  lib/protoforge/auto-gate -> PolicyEngine (fail-closed)
 *   [6] emission    lib/realtime/eventBus publish (no logic)
 *
 * Before this module, these stages existed only as separate pieces: the
 * gateway wrote the ledger but never classified, protoforge-core's
 * CASCADE classified but never read the ledger or called KILO, and the
 * only KILO -> ProtoForge chain was the deprecated replay engine with a
 * passthrough classifier. This composes the existing implementations
 * without reimplementing any stage.
 *
 * Every run returns a trace: one trace_id, and per stage its status,
 * duration and key outputs. The trace carries the ledger fingerprint and
 * the policy decision id, so it links the RAW LEDGER row and the
 * ProtoForge audit row for the same event. The trace_id is deliberately
 * NOT written into the ledger payload: the ledger hash covers the
 * payload, and a random id there would give identical inputs different
 * hashes and break replay determinism.
 *
 * Live: protoforge-core's POST /cascade/event runs this through
 * CascadeCompleteV2.processEvent (modules/cascade-complete-v2.js), which
 * supplies CASCADE's adapters/schema lock as `ingest` and its classifier
 * instance as `classifier`.
 */

const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { validateEvent } = require('../../protoforge/hydi-gateway/src/validate');
const { RawLedgerAdapter, computeFingerprint } = require('../../protoforge/hydi-gateway/src/adapters/raw-ledger');
const CascadeClassificationV2 = require('../../modules/cascade-classification-v2');
const { createKiloEngine } = require('../../kilo/index.js');
const { autoGate } = require('../protoforge/auto-gate');
const { STAGES, defaultMetrics } = require('./metrics');

const RECENT_TRACES = 50;

/** Terminal outcomes a run can end in. */
const OUTCOMES = Object.freeze(['invalid', 'duplicate', 'queued', 'ledger_error', 'quarantined', 'approve', 'reject', 'escalate', 'error']);

function defaultLedger() {
  // Created on first run, not at import: it needs the Supabase env vars.
  return new RawLedgerAdapter();
}

function defaultEmit(type, data) {
  require('../realtime/eventBus').publish(type, data);
}

function defaultPolicyEngineFactory(stream) {
  return require('../protoforge/policy-engine').getPolicyEngine(stream);
}

/**
 * @param {object} [options]
 * @param {object}   [options.ledger]               { append(envelope) } -- default: Supabase RawLedgerAdapter, created on first run
 * @param {Function} [options.policyEngineFactory]  (stream) => Promise<PolicyEngine> -- default: getPolicyEngine
 * @param {Function} [options.emit]                 (type, data) => void -- default: eventBus.publish
 * @param {object}   [options.metrics]              from createMetrics() -- default: process-wide defaultMetrics
 * @param {Function} [options.now]                  monotonic ms clock -- default: performance.now
 * @param {Function} [options.newTraceId]           default: crypto.randomUUID
 * @param {string}   [options.systemState]          KILO severity context: 'operational' | 'degraded' | 'critical'
 * @param {Function} [options.ingest]               (input) => { ok: true, envelope, sourceConfidence? } | { ok: false, reason, violations? }.
 *                                                  Source-specific normalization run inside stage [1] before the gateway's
 *                                                  validateEvent. Default: the input already is a gateway envelope.
 * @param {object}   [options.classifier]           CASCADE classifier instance -- default: a new CascadeClassificationV2.
 *                                                  Pass the running CASCADE's own instance so there is one classifier.
 * @param {number}   [options.minSourceConfidence]  CASCADE's source-confidence gate: an event whose ingest-reported
 *                                                  confidence is below this is quarantined before classification.
 */
function createPipeline(options = {}) {
  let ledger = options.ledger || null;
  const policyEngineFactory = options.policyEngineFactory || defaultPolicyEngineFactory;
  const emit = options.emit || defaultEmit;
  const metrics = options.metrics || defaultMetrics;
  const now = options.now || (() => performance.now());
  const newTraceId = options.newTraceId || (() => crypto.randomUUID());
  const systemState = options.systemState || 'operational';
  const classifier = options.classifier || new CascadeClassificationV2();
  const ingest = options.ingest || ((input) => ({ ok: true, envelope: input }));
  const minSourceConfidence = typeof options.minSourceConfidence === 'number' ? options.minSourceConfidence : null;
  const recent = [];

  async function runStage(trace, stage, fn) {
    const t0 = now();
    let result;
    try {
      result = await fn();
    } catch (error) {
      result = { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
    }
    const durationMs = now() - t0;
    trace.stages[stage] = { ...result, duration_ms: durationMs };
    metrics.recordStage(stage, result.status, durationMs);
    return result;
  }

  function skip(trace, stage) {
    trace.stages[stage] = { status: 'skipped' };
    metrics.recordStage(stage, 'skipped', 0);
  }

  /**
   * Run one event through all six stages. By default the input is a
   * gateway envelope ({ eventId, eventType, source, payload, version?,
   * timestamp? }); with an `ingest` option it is whatever that function
   * normalizes. Never throws; failures are recorded on the returned trace.
   */
  async function run(input) {
    const startedAt = now();
    const trace = {
      trace_id: newTraceId(),
      started_at: new Date().toISOString(),
      fingerprint: null,
      outcome: null,
      stages: {},
    };
    const ctx = {};

    const pending = [...STAGES];
    const next = () => pending.shift();

    // [1] Ingestion: structure only.
    const ingestion = await runStage(trace, next(), async () => {
      const ingested = ingest(input);
      if (!ingested || !ingested.ok) {
        const rejected = { status: 'rejected', reason: (ingested && ingested.reason) || 'ingest_failed' };
        if (ingested && ingested.violations) rejected.violations = ingested.violations;
        return rejected;
      }
      const envelope = ingested.envelope;
      const valid = validateEvent(envelope);
      if (!valid.ok) return { status: 'rejected', reason: valid.error };
      ctx.envelope = envelope;
      const summary = { status: 'ok', event_type: envelope.eventType, source: envelope.source };
      if (typeof ingested.sourceConfidence === 'number') {
        ctx.sourceConfidence = ingested.sourceConfidence;
        summary.source_confidence = ingested.sourceConfidence;
      }
      return summary;
    });
    if (ingestion.status !== 'ok') trace.outcome = ingestion.status === 'error' ? 'error' : 'invalid';

    // [2] RAW EVENT LEDGER: append-only, idempotent on fingerprint.
    if (!trace.outcome) {
      const stage = await runStage(trace, next(), async () => {
        if (!ledger) ledger = defaultLedger();
        const appended = await ledger.append(ctx.envelope);
        const record = appended.record || null;
        if (record) {
          ctx.fingerprint = record.fingerprint;
          ctx.hash = record.hash;
          trace.fingerprint = record.fingerprint;
        } else {
          // A duplicate caught by the table's unique constraint comes back
          // without a record; the fingerprint is still derivable.
          trace.fingerprint = appended.fingerprint
            || computeFingerprint(ctx.envelope.source, ctx.envelope.eventId, ctx.envelope.eventType);
        }
        if (appended.ok && appended.queued) {
          // Durable in the gateway outbox but not yet committed: stop here
          // rather than classify an event the ledger doesn't hold yet.
          return { status: 'rejected', reason: 'queued_in_outbox', fingerprint: trace.fingerprint };
        }
        if (appended.ok) return { status: 'ok', fingerprint: ctx.fingerprint, hash: ctx.hash };
        if (appended.code === '409') return { status: 'rejected', reason: 'duplicate', fingerprint: trace.fingerprint };
        return { status: 'error', error: appended.error || 'ledger append failed' };
      });
      if (stage.status === 'error') trace.outcome = 'ledger_error';
      else if (stage.status === 'rejected') trace.outcome = stage.reason === 'duplicate' ? 'duplicate' : 'queued';
    } else {
      skip(trace, next());
    }

    // [3] CASCADE: classification only. The source-confidence gate is
    // CASCADE's own rule (modules/cascade-complete-v2: quarantine below
    // 0.75), applied before classification as it always was.
    if (!trace.outcome) {
      const stage = await runStage(trace, next(), async () => {
        if (minSourceConfidence !== null && typeof ctx.sourceConfidence === 'number'
            && ctx.sourceConfidence < minSourceConfidence) {
          return {
            status: 'rejected',
            reason: 'low_confidence',
            source_confidence: ctx.sourceConfidence,
            threshold: minSourceConfidence,
            quarantine: true,
          };
        }
        const result = classifier.classify({ payload: ctx.envelope.payload });
        ctx.cascade = result;
        const summary = {
          status: result.quarantine ? 'rejected' : 'ok',
          classification: result.classification,
          confidence: result.confidence,
          matched_rules: result.matched_rules || [],
          quarantine: result.quarantine,
        };
        if (result.quarantine) summary.reason = 'unknown_anomaly';
        return summary;
      });
      if (stage.status === 'error') trace.outcome = 'error';
      else if (stage.status === 'rejected') trace.outcome = 'quarantined';
    } else {
      skip(trace, next());
    }

    // [4] KILO: hypotheses only. A fresh engine per run, seeded with this
    // event's CASCADE result, so one event's history can't leak into the
    // next and replays stay deterministic.
    if (!trace.outcome) {
      const stage = await runStage(trace, next(), async () => {
        const kilo = createKiloEngine({
          cascadeStateSnapshot: {
            [ctx.fingerprint]: { classification: ctx.cascade.classification, quarantined: false },
            systemState,
          },
        });
        const result = kilo.generateHypotheses({
          ...ctx.envelope.payload,
          fingerprint: ctx.fingerprint,
          classification: ctx.cascade.classification,
        });
        ctx.kilo = result;
        return {
          status: 'ok',
          hypotheses_count: result.hypotheses.length,
          confidence: result.confidence,
          verified: Boolean(result.gate_result && result.gate_result.verified),
        };
      });
      if (stage.status === 'error') trace.outcome = 'error';
    } else {
      skip(trace, next());
    }

    // [5] ProtoForge: policy decision on the event's aggregated hypothesis.
    if (!trace.outcome) {
      const stage = await runStage(trace, next(), async () => {
        const payload = ctx.envelope.payload;
        const stream = typeof payload.stream === 'string' ? payload.stream : null;
        const hypothesis = {
          id: ctx.fingerprint,
          event_hash: ctx.hash,
          confidence: ctx.kilo.confidence,
          // Same risk proxy lib/protoforge/replay-engine.ts uses: the less
          // sure CASCADE is, the riskier acting on the event.
          risk: Math.round((1 - ctx.cascade.confidence) * 1000) / 1000,
          revenue_impact: typeof payload.revenue_impact === 'number' ? payload.revenue_impact : 0,
          stream,
          classification: ctx.cascade.classification,
          trace_id: trace.trace_id,
        };
        const gate = await autoGate([hypothesis], stream, { engineFactory: policyEngineFactory });
        const decision = gate.decisions[0];
        return {
          status: 'ok',
          decision: decision.decision,
          matched_rule_id: decision.matchedRuleId,
          decision_id: decision.decisionId,
        };
      });
      // autoGate treats any decision outside approve/reject/escalate as a
      // reject (fail-closed); the trace says the same.
      if (stage.status === 'error') trace.outcome = 'error';
      else trace.outcome = ['approve', 'reject', 'escalate'].includes(stage.decision) ? stage.decision : 'reject';
    } else {
      skip(trace, next());
    }

    // [6] Emission: publish the outcome, whatever it was. No logic here.
    await runStage(trace, next(), async () => {
      emit('pipeline_trace', {
        trace_id: trace.trace_id,
        fingerprint: trace.fingerprint,
        outcome: trace.outcome,
        event_type: ingestion.event_type || null,
        source: ingestion.source || null,
        classification: trace.stages.cascade && trace.stages.cascade.classification,
        decision: trace.stages.protoforge && trace.stages.protoforge.decision,
      });
      return { status: 'ok' };
    });

    trace.duration_ms = now() - startedAt;
    metrics.recordRun(trace.outcome, trace.started_at);
    recent.push(trace);
    if (recent.length > RECENT_TRACES) recent.shift();
    return trace;
  }

  return {
    run,
    getRecentTraces: () => [...recent],
  };
}

/**
 * The parts of a trace that must be identical for identical input: drops
 * the trace id, timestamps, durations and the random decision id. The
 * replay test compares this view across runs and against a golden file.
 */
function deterministicView(trace) {
  const stages = {};
  for (const [name, stage] of Object.entries(trace.stages)) {
    // eslint-disable-next-line no-unused-vars -- destructured only to drop the volatile fields
    const { duration_ms: _d, decision_id: _id, ...rest } = stage;
    stages[name] = rest;
  }
  return { fingerprint: trace.fingerprint, outcome: trace.outcome, stages };
}

module.exports = { createPipeline, deterministicView, OUTCOMES, STAGES };
