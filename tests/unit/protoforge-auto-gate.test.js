'use strict';

const { autoGate, __setEngineFactory, __resetEngineFactory } = require('../../lib/protoforge/auto-gate');

// ---------------------------------------------------------------------------
// Helpers — build a lightweight mock engine
// ---------------------------------------------------------------------------

function mockEngine(decision) {
  return {
    evaluate: jest.fn(() => ({
      hypothesisId:  decision.hypothesisId  || 'hyp-mock',
      decision:      decision.decision,
      matchedRuleId: decision.matchedRuleId || null,
      confidence:    decision.confidence    ?? 0.80,
      risk:          decision.risk          ?? 0.20,
      revenueImpact: decision.revenueImpact ?? 0,
      stream:        decision.stream        || null,
      reasoning:     decision.reasoning     || 'mock reasoning',
      decidedAt:     new Date().toISOString(),
    })),
    recordDecision: jest.fn().mockResolvedValue('decision-uuid'),
  };
}

function makeFactory(engine) {
  return jest.fn().mockResolvedValue(engine);
}

// ---------------------------------------------------------------------------
// autoGate — core routing
// ---------------------------------------------------------------------------

describe('autoGate — routing by decision', () => {
  afterEach(() => __resetEngineFactory());

  test('approved hypothesis lands in approved array', async () => {
    const engine = mockEngine({ decision: 'approve', matchedRuleId: 'rule-1' });
    const hyp = { id: 'hyp-001', confidence: 0.90, risk: 0.10 };

    const result = await autoGate([hyp], null, { engineFactory: makeFactory(engine) });

    expect(result.approved).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.escalated).toHaveLength(0);
    expect(result.approved[0].hypothesis).toBe(hyp);
    expect(result.approved[0].decision.decision).toBe('approve');
  });

  test('rejected hypothesis lands in rejected array', async () => {
    const engine = mockEngine({ decision: 'reject' });
    const hyp = { id: 'hyp-002', confidence: 0.40, risk: 0.80 };

    const result = await autoGate([hyp], null, { engineFactory: makeFactory(engine) });

    expect(result.rejected).toHaveLength(1);
    expect(result.approved).toHaveLength(0);
    expect(result.escalated).toHaveLength(0);
  });

  test('escalated hypothesis lands in escalated array', async () => {
    const engine = mockEngine({ decision: 'escalate' });
    const hyp = { id: 'hyp-003', confidence: 0.70, risk: 0.45 };

    const result = await autoGate([hyp], null, { engineFactory: makeFactory(engine) });

    expect(result.escalated).toHaveLength(1);
    expect(result.approved).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  test('unknown decision outcome is treated as reject (fail-closed)', async () => {
    const engine = mockEngine({ decision: 'unknown_future_value' });
    const hyp = { id: 'hyp-004', confidence: 0.60 };

    const result = await autoGate([hyp], null, { engineFactory: makeFactory(engine) });

    expect(result.rejected).toHaveLength(1);
    expect(result.approved).toHaveLength(0);
  });

  test('decision is recorded for every hypothesis', async () => {
    const engine = mockEngine({ decision: 'approve' });
    const hyps = [
      { id: 'hyp-005', confidence: 0.90 },
      { id: 'hyp-006', confidence: 0.85 },
    ];

    await autoGate(hyps, null, { engineFactory: makeFactory(engine) });

    expect(engine.recordDecision).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// autoGate — batch gating (mixed outcomes)
// ---------------------------------------------------------------------------

describe('autoGate — batch gating', () => {
  afterEach(() => __resetEngineFactory());

  test('batch of 3 with mixed outcomes is split correctly', async () => {
    const decisions = ['approve', 'reject', 'escalate'];
    let callCount = 0;
    const engine = {
      evaluate: jest.fn(() => {
        const d = decisions[callCount++ % decisions.length];
        return {
          hypothesisId: `hyp-batch-${callCount}`,
          decision: d,
          matchedRuleId: null,
          confidence: 0.80,
          risk: 0.20,
          revenueImpact: 0,
          stream: null,
          reasoning: `batch mock — ${d}`,
          decidedAt: new Date().toISOString(),
        };
      }),
      recordDecision: jest.fn().mockResolvedValue(null),
    };

    const hyps = [
      { id: 'b-001' },
      { id: 'b-002' },
      { id: 'b-003' },
    ];

    const result = await autoGate(hyps, null, { engineFactory: makeFactory(engine) });

    expect(result.approved).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.escalated).toHaveLength(1);
    expect(result.decisions).toHaveLength(3);
  });

  test('all decisions are included in decisions array regardless of outcome', async () => {
    const engine = mockEngine({ decision: 'reject' });
    const hyps = [{ id: 'r-1' }, { id: 'r-2' }, { id: 'r-3' }];

    const result = await autoGate(hyps, null, { engineFactory: makeFactory(engine) });

    expect(result.decisions).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// autoGate — summary counts
// ---------------------------------------------------------------------------

describe('autoGate — summary', () => {
  afterEach(() => __resetEngineFactory());

  test('summary reflects correct counts', async () => {
    const engine = mockEngine({ decision: 'approve' });
    const hyps = [{ id: 'a' }, { id: 'b' }];

    const result = await autoGate(hyps, 'rezonate', { engineFactory: makeFactory(engine) });

    expect(result.summary.total).toBe(2);
    expect(result.summary.approved).toBe(2);
    expect(result.summary.rejected).toBe(0);
    expect(result.summary.escalated).toBe(0);
    expect(result.summary.stream).toBe('rezonate');
  });

  test('summary stream defaults to global when stream is null', async () => {
    const engine = mockEngine({ decision: 'reject' });
    const result = await autoGate([{ id: 'x' }], null, { engineFactory: makeFactory(engine) });
    expect(result.summary.stream).toBe('global');
  });
});

// ---------------------------------------------------------------------------
// autoGate — edge cases
// ---------------------------------------------------------------------------

describe('autoGate — edge cases', () => {
  afterEach(() => __resetEngineFactory());

  test('empty array returns zeroed result without calling engine', async () => {
    const factory = jest.fn();
    const result = await autoGate([], null, { engineFactory: factory });

    expect(result.approved).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(result.escalated).toHaveLength(0);
    expect(result.decisions).toHaveLength(0);
    expect(result.summary.total).toBe(0);
    expect(factory).not.toHaveBeenCalled();
  });

  test('non-array input returns zeroed result', async () => {
    const factory = jest.fn();
    const result = await autoGate(null, null, { engineFactory: factory });

    expect(result.summary.total).toBe(0);
    expect(factory).not.toHaveBeenCalled();
  });

  test('stream is passed to engine factory', async () => {
    const engine = mockEngine({ decision: 'approve' });
    const factory = makeFactory(engine);

    await autoGate([{ id: 'stream-test' }], 'galactic_bytes', { engineFactory: factory });

    expect(factory).toHaveBeenCalledWith('galactic_bytes');
  });

  test('recordDecision failure does not throw or block gating', async () => {
    const engine = {
      evaluate: jest.fn(() => ({
        hypothesisId: 'err-hyp',
        decision: 'approve',
        matchedRuleId: null,
        confidence: 0.9,
        risk: 0.1,
        revenueImpact: 0,
        stream: null,
        reasoning: 'ok',
        decidedAt: new Date().toISOString(),
      })),
      recordDecision: jest.fn().mockRejectedValue(new Error('DB unavailable')),
    };

    const result = await autoGate([{ id: 'safe' }], null, { engineFactory: makeFactory(engine) });

    expect(result.approved).toHaveLength(1);
  });

  test('no-policy engine (fail-closed) rejects all hypotheses', async () => {
    // Simulate an engine that has no policy loaded — returns 'reject' for everything
    const failClosedEngine = {
      evaluate: jest.fn(() => ({
        hypothesisId: 'no-policy-hyp',
        decision: 'reject',
        matchedRuleId: null,
        confidence: 0.99,
        risk: 0.01,
        revenueImpact: 0,
        stream: null,
        reasoning: 'no-active-policy',
        decidedAt: new Date().toISOString(),
      })),
      recordDecision: jest.fn().mockResolvedValue(null),
    };

    const hyps = [
      { id: 'np-1', confidence: 0.99, risk: 0.01 },
      { id: 'np-2', confidence: 0.95, risk: 0.05 },
    ];

    const result = await autoGate(hyps, null, { engineFactory: makeFactory(failClosedEngine) });

    expect(result.rejected).toHaveLength(2);
    expect(result.approved).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// __setEngineFactory / __resetEngineFactory — injection helpers
// ---------------------------------------------------------------------------

describe('engine factory injection', () => {
  afterEach(() => __resetEngineFactory());

  test('__setEngineFactory replaces the internal factory', async () => {
    const engine = mockEngine({ decision: 'approve' });
    const mockFactory = jest.fn().mockResolvedValue(engine);
    __setEngineFactory(mockFactory);

    const result = await autoGate([{ id: 'inject-test' }], null);

    expect(mockFactory).toHaveBeenCalledWith(null);
    expect(result.approved).toHaveLength(1);
  });

  test('__resetEngineFactory clears the injected factory', () => {
    __setEngineFactory(jest.fn());
    __resetEngineFactory();
    // Internal state reset — next call will lazy-require the real factory
    // (no assertion needed beyond no-throw)
  });
});
