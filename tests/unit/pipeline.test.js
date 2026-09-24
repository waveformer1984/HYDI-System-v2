/**
 * lib/pipeline failure handling and lib/pipeline/metrics. The happy path
 * and determinism are covered by pipeline-replay.test.js.
 */

const { createPipeline, OUTCOMES } = require('../../lib/pipeline');
const { createMetrics } = require('../../lib/pipeline/metrics');
const { MemoryLedger } = require('../../lib/pipeline/memory-ledger');

const STREAM_BREAK = {
  eventId: 'evt-1',
  eventType: 'stream.disconnected',
  source: 'ursula',
  payload: { stream_disconnected: true, connection_lost: true, websocket_error: '1006', stream_error: 'EPIPE', disconnect: 'server' },
};

function engineWith(decision) {
  return async () => ({
    evaluate: (hyp) => ({ decisionId: 'd-1', hypothesisId: hyp.id, decision, matchedRuleId: null }),
    recordDecision: async () => null,
  });
}

function makePipeline(overrides = {}) {
  const emitted = [];
  const metrics = createMetrics();
  const pipeline = createPipeline({
    ledger: new MemoryLedger(),
    policyEngineFactory: engineWith('reject'),
    emit: (type, data) => emitted.push({ type, ...data }),
    metrics,
    ...overrides,
  });
  return { pipeline, emitted, metrics };
}

describe('lib/pipeline failure handling', () => {
  it('records a ledger error, skips the later stages and still emits', async () => {
    const ledger = { append: async () => ({ ok: false, error: 'db down', code: 'UNKNOWN' }) };
    const { pipeline, emitted } = makePipeline({ ledger });
    const trace = await pipeline.run(STREAM_BREAK);

    expect(trace.outcome).toBe('ledger_error');
    expect(trace.stages.ledger).toMatchObject({ status: 'error', error: 'db down' });
    expect(trace.stages.cascade.status).toBe('skipped');
    expect(trace.stages.protoforge.status).toBe('skipped');
    expect(trace.stages.emission.status).toBe('ok');
    expect(emitted[0]).toMatchObject({ trace_id: trace.trace_id, outcome: 'ledger_error' });
  });

  it('turns a throwing stage into an error outcome instead of rejecting the run', async () => {
    const ledger = { append: async () => { throw new Error('boom'); } };
    const { pipeline } = makePipeline({ ledger });
    const trace = await pipeline.run(STREAM_BREAK);
    expect(trace.outcome).toBe('ledger_error');
    expect(trace.stages.ledger).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('stops at the ledger for an event still sitting in the gateway outbox', async () => {
    const ledger = { append: async () => ({ ok: true, queued: true, fingerprint: 'fp-q', error: 'retrying' }) };
    const { pipeline } = makePipeline({ ledger });
    const trace = await pipeline.run(STREAM_BREAK);
    expect(trace.outcome).toBe('queued');
    expect(trace.fingerprint).toBe('fp-q');
    expect(trace.stages.cascade.status).toBe('skipped');
  });

  it('still reports the fingerprint for a duplicate the ledger returns without a record', async () => {
    const { computeFingerprint } = require('../../protoforge/hydi-gateway/src/adapters/raw-ledger');
    const ledger = { append: async () => ({ ok: false, error: 'Duplicate fingerprint', code: '409' }) };
    const { pipeline } = makePipeline({ ledger });
    const trace = await pipeline.run(STREAM_BREAK);
    expect(trace.outcome).toBe('duplicate');
    expect(trace.fingerprint).toBe(computeFingerprint('ursula', 'evt-1', 'stream.disconnected'));
  });

  it('treats a policy decision outside approve/reject/escalate as a reject, like autoGate', async () => {
    const { pipeline } = makePipeline({ policyEngineFactory: engineWith('maybe') });
    const trace = await pipeline.run(STREAM_BREAK);
    expect(trace.stages.protoforge.decision).toBe('maybe');
    expect(trace.outcome).toBe('reject');
  });

  it('records a policy engine failure as an error outcome', async () => {
    const { pipeline } = makePipeline({ policyEngineFactory: async () => { throw new Error('no policy store'); } });
    const trace = await pipeline.run(STREAM_BREAK);
    expect(trace.outcome).toBe('error');
    expect(trace.stages.protoforge).toMatchObject({ status: 'error', error: 'no policy store' });
    expect(trace.stages.emission.status).toBe('ok');
  });

  it('keeps the outcome when emission itself fails', async () => {
    const { pipeline } = makePipeline({ emit: () => { throw new Error('bus gone'); } });
    const trace = await pipeline.run(STREAM_BREAK);
    expect(trace.outcome).toBe('reject');
    expect(trace.stages.emission).toMatchObject({ status: 'error', error: 'bus gone' });
  });

  it('only ever ends in a known outcome', async () => {
    const { pipeline } = makePipeline();
    for (const env of [STREAM_BREAK, STREAM_BREAK, { eventId: 'x' }, { ...STREAM_BREAK, eventId: 'evt-2', payload: {} }]) {
      expect(OUTCOMES).toContain((await pipeline.run(env)).outcome);
    }
  });

  it('keeps a bounded list of recent traces', async () => {
    const { pipeline } = makePipeline();
    for (let i = 0; i < 60; i++) await pipeline.run({ ...STREAM_BREAK, eventId: `evt-${i}` });
    const recent = pipeline.getRecentTraces();
    expect(recent).toHaveLength(50);
    expect(recent[49].stages.ledger.status).toBe('ok');
  });

  it('never writes the trace id into the ledger payload', async () => {
    const ledger = new MemoryLedger();
    const { pipeline } = makePipeline({ ledger });
    const trace = await pipeline.run(STREAM_BREAK);
    expect(JSON.stringify(ledger.list())).not.toContain(trace.trace_id);
  });
});

describe('lib/pipeline/metrics', () => {
  it('reports per-stage counts, errors, skips and latency', () => {
    const m = createMetrics();
    m.recordStage('ledger', 'ok', 4);
    m.recordStage('ledger', 'error', 10);
    m.recordStage('ledger', 'ok', 1);
    m.recordStage('kilo', 'skipped', 0);
    m.recordRun('approve', '2026-09-24T00:00:00.000Z');

    const snap = m.snapshot();
    expect(snap.runs).toBe(1);
    expect(snap.last_run_at).toBe('2026-09-24T00:00:00.000Z');
    expect(snap.outcomes).toEqual({ approve: 1 });
    expect(snap.stages.ledger).toEqual({ n: 3, errors: 1, skipped: 0, last_ms: 1, avg_ms: 5, p95_ms: 10 });
    expect(snap.stages.kilo).toEqual({ n: 0, errors: 0, skipped: 1, last_ms: null, avg_ms: null, p95_ms: null });
  });

  it('caps each stage at a fixed window of durations', () => {
    const m = createMetrics();
    for (let i = 1; i <= 250; i++) m.recordStage('cascade', 'ok', i);
    const snap = m.snapshot().stages.cascade;
    expect(snap.n).toBe(250);
    // Window keeps the last 200 (51..250), so the average moves with it.
    expect(snap.avg_ms).toBe(150.5);
  });

  it('ignores unknown stage names and resets cleanly', () => {
    const m = createMetrics();
    m.recordStage('nope', 'ok', 1);
    m.recordStage('emission', 'ok', 2);
    m.reset();
    expect(m.snapshot().stages.emission.n).toBe(0);
    expect(m.snapshot().stages).not.toHaveProperty('nope');
  });
});
