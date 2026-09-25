/**
 * Replay determinism for lib/pipeline: recorded ledger input must produce
 * the same pipeline output, run after run (HEIDI_V2_ARCHITECTURE.md's
 * Replay Engine rule: divergence == real drift).
 *
 * tests/fixtures/pipeline/recorded-events.json is replayed through the
 * real six stages -- gateway validation, RAW LEDGER (in memory, same
 * fingerprint/hash code as the Supabase adapter), CASCADE's classifier,
 * KILO, and the real PolicyEngine under a fixed test policy -- and the
 * deterministic view of every trace is compared to golden-traces.json.
 *
 * A change to any stage's behaviour fails this test. If the change is
 * intended, regenerate the golden file and review its diff in the PR:
 *
 *   UPDATE_PIPELINE_GOLDEN=1 npx jest tests/unit/pipeline-replay.test.js
 */

const fs = require('fs');
const path = require('path');
const { createPipeline, deterministicView, STAGES } = require('../../lib/pipeline');
const { createMetrics } = require('../../lib/pipeline/metrics');
const { MemoryLedger } = require('../../lib/pipeline/memory-ledger');
const { PolicyEngine } = require('../../lib/protoforge/policy-engine');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'pipeline');
const GOLDEN = path.join(FIXTURES, 'golden-traces.json');
const { events } = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'recorded-events.json'), 'utf8'));
const { policy } = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'policy.json'), 'utf8'));

function fixedPolicyFactory() {
  const store = {
    loadPolicy: async () => policy,
    recordDecision: async () => null,
    recordOutcome: async () => {},
    destroy: async () => {},
  };
  return async () => {
    const engine = new PolicyEngine(store);
    await engine.init(null);
    return engine;
  };
}

async function replayAll() {
  const emitted = [];
  const pipeline = createPipeline({
    ledger: new MemoryLedger(),
    policyEngineFactory: fixedPolicyFactory(),
    emit: (type, data) => emitted.push({ type, ...data }),
    metrics: createMetrics(),
  });
  const traces = [];
  for (const { envelope } of events) traces.push(await pipeline.run(envelope));
  return { traces, emitted };
}

const savedEnv = {};
beforeAll(() => {
  // auto-gate queues escalations to Supabase when these are set; keep the
  // replay hermetic even if another suite in this worker set them.
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  jest.restoreAllMocks();
});

describe('pipeline replay determinism', () => {
  it('matches the golden traces for the recorded events', async () => {
    const { traces } = await replayAll();
    const actual = events.map((e, i) => ({ label: e.label, ...deterministicView(traces[i]) }));

    if (process.env.UPDATE_PIPELINE_GOLDEN) {
      fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n');
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(actual).toEqual(golden);
  });

  it('produces identical output on a second replay of the same input', async () => {
    const first = await replayAll();
    const second = await replayAll();
    expect(second.traces.map(deterministicView)).toEqual(first.traces.map(deterministicView));
  });

  it('covers every stage outcome the recorded events are meant to exercise', async () => {
    const { traces } = await replayAll();
    const outcomes = new Set(traces.map((t) => t.outcome));
    for (const expected of ['approve', 'escalate', 'reject', 'quarantined', 'invalid', 'duplicate']) {
      expect(outcomes).toContain(expected);
    }
  });
});

describe('pipeline traces', () => {
  it('gives every run a unique trace id and a record for all six stages', async () => {
    const { traces } = await replayAll();
    const ids = traces.map((t) => t.trace_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const trace of traces) {
      expect(Object.keys(trace.stages)).toEqual(STAGES);
      for (const stage of Object.values(trace.stages)) {
        if (stage.status === 'skipped') expect(stage.duration_ms).toBeUndefined();
        else expect(typeof stage.duration_ms).toBe('number');
      }
    }
  });

  it('links the trace to the ledger fingerprint and the policy decision', async () => {
    const { traces } = await replayAll();
    const decided = traces.filter((t) => t.stages.protoforge.status === 'ok');
    expect(decided.length).toBeGreaterThan(0);
    for (const trace of decided) {
      expect(trace.fingerprint).toBe(trace.stages.ledger.fingerprint);
      expect(trace.stages.protoforge.decision_id).toEqual(expect.any(String));
    }
  });

  it('emits exactly one pipeline_trace event per run, carrying its trace id and outcome', async () => {
    const { traces, emitted } = await replayAll();
    expect(emitted).toHaveLength(traces.length);
    emitted.forEach((event, i) => {
      expect(event).toMatchObject({ type: 'pipeline_trace', trace_id: traces[i].trace_id, outcome: traces[i].outcome });
    });
  });
});
