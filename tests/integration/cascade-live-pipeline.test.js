/**
 * protoforge-core's live CASCADE entry point -- CascadeCompleteV2
 * .processEvent, which POST /cascade/event and the infrastructure-alert
 * handler both call -- running the six-layer lib/pipeline end to end.
 *
 * Real components throughout: CASCADE's source adapters, schema lock and
 * classifier; the gateway's RawLedgerAdapter (over an in-memory stand-in
 * for the Supabase table client) and its file Outbox; KiloEngine; the
 * real PolicyEngine under the fixed replay-test policy; and the
 * /pipeline/metrics handler protoforge-core serves, read over HTTP by
 * /api/mobile-status. Only the network edges are faked.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { createHmac, randomUUID } = require('crypto');

const CascadeCompleteV2 = require('../../modules/cascade-complete-v2').constructor;
const { RawLedgerAdapter } = require('../../protoforge/hydi-gateway/src/adapters/raw-ledger');
const { Outbox } = require('../../protoforge/hydi-gateway/src/outbox/outbox');
const { PolicyEngine } = require('../../lib/protoforge/policy-engine');
const { STAGES } = require('../../lib/pipeline');
const { defaultMetrics, metricsHandler } = require('../../lib/pipeline/metrics');
const { policy } = require('../fixtures/pipeline/policy.json');

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'system_dashboard') {
        return { select: jest.fn(() => ({ single: jest.fn(async () => ({ data: { current_status: 'OK', escalation_level: 'NONE' }, error: null })) })) };
      }
      if (table === 'financial_ledger') {
        return { select: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

/** In-memory stand-in for the Supabase client's raw_event_ledger table. */
function fakeLedgerClient({ failInserts = false } = {}) {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    from: () => ({
      select: () => ({
        eq: (_col, fingerprint) => ({ maybeSingle: async () => ({ data: rows.get(fingerprint) || null }) }),
      }),
      insert: (row) => ({
        select: () => ({
          single: async () => {
            if (failInserts) return { data: null, error: { message: 'connection refused', code: '08006' } };
            if (rows.has(row.fingerprint)) return { data: null, error: { message: 'duplicate key', code: '23505' } };
            const stored = { ...row, id: `row-${++seq}`, created_at: '2026-09-24T00:00:00.000Z' };
            rows.set(row.fingerprint, stored);
            return { data: stored, error: null };
          },
        }),
      }),
    }),
  };
}

function fixedPolicyFactory() {
  const store = { loadPolicy: async () => policy, recordDecision: async () => null, recordOutcome: async () => {}, destroy: async () => {} };
  return async () => {
    const engine = new PolicyEngine(store);
    await engine.init(null);
    return engine;
  };
}

function liveCascade(ledger) {
  const cascade = new CascadeCompleteV2({ pipeline: { ledger, policyEngineFactory: fixedPolicyFactory() } });
  const emitted = [];
  cascade.on('pipeline_trace', (e) => emitted.push(e));
  cascade.start();
  return { cascade, emitted };
}

/** A raw system event shaped the way CASCADE's SystemAdapter reads it. */
function systemEvent(data, id = randomUUID()) {
  return { id, type: 'error', payload: { component: 'integration-test' }, data };
}

const savedEnv = {};
let cascades = [];

beforeAll(() => {
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PROTOFORGE_CORE_URL', 'HYDI_SERVICE_SECRET']) savedEnv[key] = process.env[key];
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  // CASCADE's sub-components start unref-less cleanup intervals in their
  // constructors (pre-existing); stop() clears what it can and the
  // integration suite runs with --forceExit.
  for (const c of cascades) c.stop();
  cascades = [];
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  jest.restoreAllMocks();
});

function track(pair) {
  cascades.push(pair.cascade);
  return pair;
}

describe('live CASCADE entry point runs the six-layer pipeline', () => {
  it('takes a valid event through all six stages, classifier -> KILO -> policy -> emission', async () => {
    const client = fakeLedgerClient();
    const { cascade, emitted } = track(liveCascade(new RawLedgerAdapter({ client })));

    const result = await cascade.processEvent(systemEvent({ stream_disconnected: true }), 'system');

    expect(result.status).toBe('processed');
    const { trace } = result;
    expect(Object.keys(trace.stages)).toEqual(STAGES);
    for (const stage of STAGES) expect(trace.stages[stage].status).toBe('ok');
    for (const stage of STAGES) expect(typeof trace.stages[stage].duration_ms).toBe('number');

    // [2] the real ledger adapter stored it, and the trace links that row.
    expect(client.rows.size).toBe(1);
    expect(client.rows.has(trace.fingerprint)).toBe(true);
    expect(trace.stages.ledger.hash).toBe(client.rows.get(trace.fingerprint).hash);

    // [3] -> [4]: KILO's truth gate verifies the event against CASCADE's
    // classification, so `verified` proves the classification reached KILO.
    expect(result.classification).toMatchObject({ classification: 'STREAM_BREAK', matched_rules: ['STREAM_BREAK:stream_disconnected'] });
    expect(trace.stages.kilo).toMatchObject({ status: 'ok', verified: true });
    expect(trace.stages.kilo.hypotheses_count).toBeGreaterThan(0);

    // [4] -> [5]: the policy rule that matched keys on the classification
    // and the KILO-derived risk carried in the hypothesis.
    expect(result.decision).toMatchObject({ decision: 'escalate', matched_rule_id: 'escalate-stream-break' });
    expect(result.decision.decision_id).toBe(trace.stages.protoforge.decision_id);

    // [5] -> [6]: the policy decision is what was emitted.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      trace_id: trace.trace_id, fingerprint: trace.fingerprint, outcome: 'escalate', classification: 'STREAM_BREAK', decision: 'escalate',
    });
    expect(cascade.stats.events_processed).toBe(1);
  });

  it('keeps the trace id out of the stored ledger row', async () => {
    const client = fakeLedgerClient();
    const { cascade } = track(liveCascade(new RawLedgerAdapter({ client })));
    const result = await cascade.processEvent(systemEvent({ checksum_mismatch: true }), 'system');
    expect(JSON.stringify([...client.rows.values()])).not.toContain(result.trace_id);
  });

  it('rejects a repeat of the same event as a duplicate without a second ledger row', async () => {
    const client = fakeLedgerClient();
    const { cascade, emitted } = track(liveCascade(new RawLedgerAdapter({ client })));
    const id = randomUUID();

    await cascade.processEvent(systemEvent({ stream_error: 'EPIPE' }, id), 'system');
    const dup = await cascade.processEvent(systemEvent({ stream_error: 'EPIPE' }, id), 'system');

    expect(dup).toMatchObject({ event: 'cascade_event_rejected', reason: 'duplicate_event', action: 'discard' });
    expect(dup.fingerprint).toBe(dup.trace.fingerprint);
    expect(dup.trace.stages.cascade.status).toBe('skipped');
    expect(client.rows.size).toBe(1);
    expect(cascade.stats.duplicate_blocks).toBe(1);
    expect(emitted.map((e) => e.outcome)).toEqual(['escalate', 'duplicate']);
  });

  it('rejects a malformed event cleanly at ingestion, before the ledger', async () => {
    const client = fakeLedgerClient();
    const { cascade } = track(liveCascade(new RawLedgerAdapter({ client })));

    const result = await cascade.processEvent(systemEvent({ stream_error: 'x' }, 'not-a-uuid'), 'system');

    expect(result).toMatchObject({ event: 'cascade_event_rejected', reason: 'schema_violation', action: 'discard' });
    expect(result.violations).toContain('event_id must be valid UUID v4');
    expect(result.trace.stages.ingestion.status).toBe('rejected');
    expect(result.trace.stages.ledger.status).toBe('skipped');
    expect(client.rows.size).toBe(0);
    expect(cascade.stats.schema_violations).toBe(1);
  });

  it('no longer rejects every event for the adapter\'s own metadata fields (#81)', async () => {
    const { cascade } = track(liveCascade(new RawLedgerAdapter({ client: fakeLedgerClient() })));
    const result = await cascade.processEvent(systemEvent({ disconnect: 'server' }), 'system');
    expect(result.violations).toBeUndefined();
    expect(result.status).toBe('processed');
  });

  it('reports an event held in the gateway outbox as queued, not as a ledger error', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-outbox-'));
    try {
      const ledger = new RawLedgerAdapter({ client: fakeLedgerClient({ failInserts: true }), outbox: new Outbox({ dataDir }) });
      const { cascade } = track(liveCascade(ledger));
      const raw = systemEvent({ stream_disconnected: true });

      const result = await cascade.processEvent(raw, 'system');

      expect(result).toMatchObject({ status: 'queued', reason: 'ledger_queued', action: 'retry', event_id: raw.id });
      expect(result.trace.outcome).toBe('queued');
      expect(result.trace.stages.cascade.status).toBe('skipped');
      expect(result.fingerprint).toEqual(expect.any(String));
      const pending = JSON.parse(fs.readFileSync(path.join(dataDir, 'pending.json'), 'utf8'));
      expect(pending.map((p) => p.fingerprint)).toEqual([result.fingerprint]);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('reports a failed ledger append without an outbox as a ledger error, not a crash', async () => {
    const { cascade } = track(liveCascade(new RawLedgerAdapter({ client: fakeLedgerClient({ failInserts: true }) })));
    const result = await cascade.processEvent(systemEvent({ stream_disconnected: true }), 'system');
    expect(result).toMatchObject({ event: 'cascade_processing_error', reason: 'ledger_error', error: 'ledger: connection refused' });
    expect(result.trace.stages.emission.status).toBe('ok');
  });

  it('quarantines an unknown anomaly into CASCADE\'s quarantine store', async () => {
    const { cascade } = track(liveCascade(new RawLedgerAdapter({ client: fakeLedgerClient() })));
    const result = await cascade.processEvent(systemEvent({ weird_signal: true }), 'system');
    expect(result).toMatchObject({ event: 'cascade_event_rejected', reason: 'unknown_anomaly', classification: 'UNKNOWN_ANOMALY', action: 'quarantine' });
    expect(cascade.getQuarantineReport().summary.total_quarantined).toBe(1);
  });

  it('keeps CASCADE\'s low-confidence quarantine for weak sources', async () => {
    const { cascade } = track(liveCascade(new RawLedgerAdapter({ client: fakeLedgerClient() })));
    // UserAdapter: base confidence 0.7, below the 0.75 gate.
    const result = await cascade.processEvent({ id: randomUUID(), type: 'x', payload: { a: 1 }, data: { data_loss: true } }, 'user');
    expect(result).toMatchObject({ event: 'cascade_event_rejected', reason: 'low_confidence', action: 'quarantine' });
    expect(result.confidence).toBeLessThan(0.75);
    expect(cascade.stats.low_confidence_blocks).toBe(1);
  });

  it('turns an unknown source into a processing error, as before', async () => {
    const { cascade } = track(liveCascade(new RawLedgerAdapter({ client: fakeLedgerClient() })));
    const result = await cascade.processEvent({ type: 'x' }, 'bogus');
    expect(result).toMatchObject({ event: 'cascade_processing_error', reason: 'internal_error' });
    expect(result.error).toContain('Unknown adapter type: bogus');
  });

  it('still refuses events while CASCADE is stopped', async () => {
    const cascade = new CascadeCompleteV2({ pipeline: { ledger: new RawLedgerAdapter({ client: fakeLedgerClient() }) } });
    cascades.push(cascade);
    expect(await cascade.processEvent(systemEvent({ disconnect: 1 }), 'system')).toEqual({ error: 'CASCADE not running', status: 'rejected' });
  });
});

describe('/api/mobile-status reports the live pipeline metrics', () => {
  let server;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  it('reads per-stage counts and timings from protoforge-core\'s /pipeline/metrics after real runs', async () => {
    defaultMetrics.reset();
    // Live CASCADE records into the process-wide metrics, as in protoforge-core.
    const { cascade } = track(liveCascade(new RawLedgerAdapter({ client: fakeLedgerClient() })));
    await cascade.processEvent(systemEvent({ stream_disconnected: true }), 'system');
    await cascade.processEvent(systemEvent({ weird_signal: true }), 'system');

    const app = express();
    app.get('/pipeline/metrics', metricsHandler());
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.PROTOFORGE_CORE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.HYDI_SERVICE_SECRET = 'integration-secret';
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    const handler = require('../../api/mobile-status.js').default;
    const ts = Date.now().toString();
    const sig = createHmac('sha256', 'integration-secret').update(`${ts}:req-1:jest`).digest('hex');
    const res = { status: jest.fn(() => res), json: jest.fn(() => res), setHeader: jest.fn(() => res), end: jest.fn(() => res) };
    require('../../lib/rate-limit').__reset();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': `${ts}.req-1.jest.${sig}` } }, res);

    const { pipeline } = res.json.mock.calls[0][0];
    expect(pipeline.source).toBe('protoforge-core');
    expect(pipeline.runs).toBe(2);
    expect(pipeline.outcomes).toEqual({ escalate: 1, quarantined: 1 });
    for (const stage of STAGES) {
      expect(pipeline.stages[stage]).toEqual(expect.objectContaining({
        n: expect.any(Number), errors: 0, last_ms: expect.any(Number), avg_ms: expect.any(Number), p95_ms: expect.any(Number),
      }));
    }
    expect(pipeline.stages.ingestion.n).toBe(2);
    expect(pipeline.stages.kilo).toMatchObject({ n: 1, skipped: 1 });
    defaultMetrics.reset();
  });
});
