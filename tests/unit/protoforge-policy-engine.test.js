'use strict';

const { PolicyEngine, evaluateRules, matchCondition, recordOutcome } = require('../../lib/protoforge/policy-engine');
const { StructuredLogger } = require('../../lib/structured-logger');

// ---------------------------------------------------------------------------
// matchCondition — unit tests for operator DSL
// ---------------------------------------------------------------------------
describe('matchCondition — DSL operators', () => {
  test('gte passes when value equals threshold', () => {
    expect(matchCondition({ confidence: { gte: 0.85 } }, { confidence: 0.85 })).toBe(true);
  });
  test('gte fails when value is below threshold', () => {
    expect(matchCondition({ confidence: { gte: 0.85 } }, { confidence: 0.84 })).toBe(false);
  });
  test('lte passes when value equals threshold', () => {
    expect(matchCondition({ risk: { lte: 0.30 } }, { risk: 0.30 })).toBe(true);
  });
  test('lte fails when value exceeds threshold', () => {
    expect(matchCondition({ risk: { lte: 0.30 } }, { risk: 0.31 })).toBe(false);
  });
  test('gt strict', () => {
    expect(matchCondition({ confidence: { gt: 0.85 } }, { confidence: 0.85 })).toBe(false);
    expect(matchCondition({ confidence: { gt: 0.85 } }, { confidence: 0.86 })).toBe(true);
  });
  test('lt strict', () => {
    expect(matchCondition({ risk: { lt: 0.30 } }, { risk: 0.30 })).toBe(false);
    expect(matchCondition({ risk: { lt: 0.30 } }, { risk: 0.29 })).toBe(true);
  });
  test('eq matches exact value', () => {
    expect(matchCondition({ stream: { eq: 'rezonate' } }, { stream: 'rezonate' })).toBe(true);
    expect(matchCondition({ stream: { eq: 'rezonate' } }, { stream: 'galactic_bytes' })).toBe(false);
  });
  test('neq passes on different value', () => {
    expect(matchCondition({ stream: { neq: 'rezonate' } }, { stream: 'galactic_bytes' })).toBe(true);
  });
  test('in passes when value is in array', () => {
    expect(matchCondition({ stream: { in: ['rezonate', 'waveformer_studio'] } }, { stream: 'rezonate' })).toBe(true);
  });
  test('in fails when value not in array', () => {
    expect(matchCondition({ stream: { in: ['rezonate'] } }, { stream: 'galactic_bytes' })).toBe(false);
  });
  test('nin passes when value absent from array', () => {
    expect(matchCondition({ stream: { nin: ['rezonate'] } }, { stream: 'galactic_bytes' })).toBe(true);
  });
  test('multiple fields — ALL must pass (AND semantics)', () => {
    const cond = { confidence: { gte: 0.85 }, risk: { lte: 0.30 } };
    expect(matchCondition(cond, { confidence: 0.90, risk: 0.20 })).toBe(true);
    expect(matchCondition(cond, { confidence: 0.90, risk: 0.40 })).toBe(false);
    expect(matchCondition(cond, { confidence: 0.80, risk: 0.20 })).toBe(false);
  });
  test('missing field returns false', () => {
    expect(matchCondition({ confidence: { gte: 0.85 } }, { risk: 0.10 })).toBe(false);
  });
  test('null field value returns false', () => {
    expect(matchCondition({ confidence: { gte: 0.85 } }, { confidence: null })).toBe(false);
  });
  test('unknown operator throws', () => {
    expect(() => matchCondition({ x: { unknown_op: 1 } }, { x: 1 })).toThrow('Unknown DSL operator');
  });
});

// ---------------------------------------------------------------------------
// evaluateRules — rule tree evaluation
// ---------------------------------------------------------------------------
describe('evaluateRules — rule tree', () => {
  const baselineRules = {
    default: 'reject',
    rules: [
      {
        id: 'high-confidence-low-risk',
        if: { confidence: { gte: 0.85 }, risk: { lte: 0.30 } },
        then: 'approve',
        priority: 1,
      },
      {
        id: 'budget-auto-approve',
        if: { revenue_impact: { lte: 100 } },
        then: 'approve',
        priority: 2,
      },
      {
        id: 'borderline-escalate',
        if: { confidence: { gte: 0.70 }, risk: { lte: 0.50 } },
        then: 'escalate',
        priority: 3,
      },
    ],
  };

  test('high confidence + low risk → approve (rule 1)', () => {
    const result = evaluateRules(baselineRules, { confidence: 0.90, risk: 0.25, revenue_impact: 200 });
    expect(result.decision).toBe('approve');
    expect(result.matchedRuleId).toBe('high-confidence-low-risk');
  });

  test('low revenue impact → approve via budget rule (rule 2)', () => {
    const result = evaluateRules(baselineRules, { confidence: 0.60, risk: 0.60, revenue_impact: 50 });
    expect(result.decision).toBe('approve');
    expect(result.matchedRuleId).toBe('budget-auto-approve');
  });

  test('borderline confidence + moderate risk → escalate (rule 3)', () => {
    const result = evaluateRules(baselineRules, { confidence: 0.75, risk: 0.45, revenue_impact: 300 });
    expect(result.decision).toBe('escalate');
    expect(result.matchedRuleId).toBe('borderline-escalate');
  });

  test('nothing matches → default reject', () => {
    const result = evaluateRules(baselineRules, { confidence: 0.50, risk: 0.80, revenue_impact: 1000 });
    expect(result.decision).toBe('reject');
    expect(result.matchedRuleId).toBeNull();
  });

  test('priority ordering: rule 1 wins over rule 2 when both could match', () => {
    // confidence 0.90, risk 0.20, revenue_impact 50 — both rule 1 and rule 2 match
    // priority 1 should win
    const result = evaluateRules(baselineRules, { confidence: 0.90, risk: 0.20, revenue_impact: 50 });
    expect(result.matchedRuleId).toBe('high-confidence-low-risk');
  });

  test('empty rules array → default', () => {
    const result = evaluateRules({ default: 'reject', rules: [] }, { confidence: 0.99 });
    expect(result.decision).toBe('reject');
    expect(result.matchedRuleId).toBeNull();
  });

  test('missing default → reject', () => {
    const result = evaluateRules({ rules: [] }, { confidence: 0.99 });
    expect(result.decision).toBe('reject');
  });

  test('rule with no if field matches unconditionally', () => {
    const rules = { default: 'reject', rules: [{ id: 'catch-all', then: 'escalate', priority: 99 }] };
    const result = evaluateRules(rules, { confidence: 0.10 });
    expect(result.decision).toBe('escalate');
    expect(result.matchedRuleId).toBe('catch-all');
  });
});

// ---------------------------------------------------------------------------
// PolicyEngine.evaluate() — integration with no Supabase
// ---------------------------------------------------------------------------
describe('PolicyEngine.evaluate()', () => {
  function makeEngine(policy) {
    const engine = new PolicyEngine('http://localhost', 'fake-key');
    engine._policy = policy;
    return engine;
  }

  test('returns reject with reasoning when no policy loaded', () => {
    const engine = new PolicyEngine('http://localhost', 'fake-key');
    // _policy is null by default
    const decision = engine.evaluate({ id: 'hyp-001', confidence: 0.99, risk: 0.01, revenue_impact: 10 });
    expect(decision.decision).toBe('reject');
    expect(decision.reasoning).toMatch(/no-active-policy/);
  });

  test('approve decision includes correct fields', () => {
    const engine = makeEngine({
      id: 'policy-uuid',
      version: 1,
      name: 'test-policy',
      rules: {
        default: 'reject',
        rules: [{ id: 'auto-approve', if: { confidence: { gte: 0.80 } }, then: 'approve', priority: 1 }],
      },
    });
    const decision = engine.evaluate({ id: 'hyp-002', confidence: 0.90, risk: 0.10, stream: 'rezonate' });
    expect(decision.decision).toBe('approve');
    expect(decision.matchedRuleId).toBe('auto-approve');
    expect(decision.hypothesisId).toBe('hyp-002');
    expect(decision.stream).toBe('rezonate');
    expect(decision.confidence).toBe(0.90);
    expect(decision.decidedAt).toBeDefined();
  });

  test('escalate decision', () => {
    const engine = makeEngine({
      id: 'policy-uuid',
      version: 1,
      name: 'test-policy',
      rules: {
        default: 'reject',
        rules: [{ id: 'escalate-all', then: 'escalate', priority: 1 }],
      },
    });
    const decision = engine.evaluate({ id: 'hyp-003', confidence: 0.50 });
    expect(decision.decision).toBe('escalate');
  });

  test('reasoning string includes policy name and version', () => {
    const engine = makeEngine({
      id: 'policy-uuid',
      version: 2,
      name: 'production-v2',
      rules: {
        default: 'reject',
        rules: [{ id: 'rule-x', if: { confidence: { gte: 0.80 } }, then: 'approve', priority: 1 }],
      },
    });
    const decision = engine.evaluate({ id: 'hyp-004', confidence: 0.85 });
    expect(decision.reasoning).toContain('production-v2');
    expect(decision.reasoning).toContain('v2');
    expect(decision.reasoning).toContain('rule-x');
  });

  test('activePolicy getter returns copy of loaded policy', () => {
    const engine = makeEngine({ id: 'abc', version: 1, name: 'p', rules: {} });
    const ap = engine.activePolicy;
    expect(ap.id).toBe('abc');
    // Modifying the returned copy should not affect internal state
    ap.name = 'mutated';
    expect(engine.activePolicy.name).toBe('p');
  });

  test('activePolicy is null when no policy loaded', () => {
    const engine = new PolicyEngine('http://localhost', 'fake-key');
    expect(engine.activePolicy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// decisionId — self-evaluation feedback loop needs a stable id up front
// ---------------------------------------------------------------------------
describe('PolicyEngine.evaluate() — decisionId', () => {
  function makeEngine(policy) {
    const engine = new PolicyEngine('http://localhost', 'fake-key');
    engine._policy = policy;
    return engine;
  }

  test('every decision gets a decisionId', () => {
    const engine = makeEngine({ id: 'p', version: 1, name: 'n', rules: { default: 'reject', rules: [] } });
    const decision = engine.evaluate({ id: 'hyp-a' });
    expect(typeof decision.decisionId).toBe('string');
    expect(decision.decisionId.length).toBeGreaterThan(0);
  });

  test('two decisions get distinct decisionIds', () => {
    const engine = makeEngine({ id: 'p', version: 1, name: 'n', rules: { default: 'reject', rules: [] } });
    const d1 = engine.evaluate({ id: 'hyp-a' });
    const d2 = engine.evaluate({ id: 'hyp-b' });
    expect(d1.decisionId).not.toBe(d2.decisionId);
  });

  test('rejection with no policy loaded still gets a decisionId', () => {
    const engine = new PolicyEngine('http://localhost', 'fake-key');
    const decision = engine.evaluate({ id: 'hyp-x' });
    expect(typeof decision.decisionId).toBe('string');
  });
});

describe('PolicyEngine.recordDecision() — persists with the client-generated id', () => {
  test('inserts using decisionObj.decisionId as the row id, not a DB default', async () => {
    const engine = new PolicyEngine('http://localhost', 'fake-key');
    let insertedRow;
    engine._client = {
      from: () => ({
        insert: (row) => {
          insertedRow = row;
          return { select: () => ({ single: async () => ({ data: { id: row.id }, error: null }) }) };
        },
      }),
    };

    const decision = engine.evaluate({ id: 'hyp-record' });
    const returnedId = await engine.recordDecision(decision);

    expect(insertedRow.id).toBe(decision.decisionId);
    expect(returnedId).toBe(decision.decisionId);
  });

  test('returns null when the insert errors', async () => {
    const engine = new PolicyEngine('http://localhost', 'fake-key');
    engine._client = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'db down' } }) }) }),
      }),
    };
    const decision = engine.evaluate({ id: 'hyp-err' });
    const result = await engine.recordDecision(decision);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recordOutcome() — standalone self-evaluation backfill
// ---------------------------------------------------------------------------
describe('recordOutcome()', () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    jest.restoreAllMocks();
  });

  test('warns and resolves without throwing when Supabase env vars are missing', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const warnSpy = jest.spyOn(StructuredLogger.prototype, 'warn').mockImplementation(() => {});

    await expect(recordOutcome('decision-1', 'success')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Supabase env vars missing'));
  });

  test('never throws even if the underlying client rejects (network failure)', async () => {
    process.env.SUPABASE_URL = 'http://localhost:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
    jest.spyOn(StructuredLogger.prototype, 'error').mockImplementation(() => {});

    await expect(recordOutcome('decision-2', 'failure', { error: 'boom' })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The promoted action-type-tiered-v1 policy
// (supabase/migrations/20260714150000_promote_action_type_policy.sql) —
// regression test for the exact DSL rules that migration ships, so a future
// edit can't silently change what auto-approves vs. escalates.
// ---------------------------------------------------------------------------
describe('action-type-tiered-v1 policy — real risk tiers', () => {
  const rules = {
    version: '1',
    default: 'escalate',
    rules: [
      {
        id: 'auto-approve-safe-actions',
        if: { action_type: { in: ['fetch_data', 'create_task', 'schedule_event'] } },
        then: 'approve',
        priority: 1,
      },
      {
        id: 'escalate-external-or-write-actions',
        if: { action_type: { in: ['update_database', 'send_email'] } },
        then: 'escalate',
        priority: 2,
      },
    ],
  };

  function decisionFor(actionType) {
    return evaluateRules(rules, { confidence: 0, risk: 1, revenue_impact: 0, action_type: actionType }).decision;
  }

  test.each(['fetch_data', 'create_task', 'schedule_event'])('%s auto-approves', (actionType) => {
    expect(decisionFor(actionType)).toBe('approve');
  });

  test.each(['update_database', 'send_email'])('%s escalates', (actionType) => {
    expect(decisionFor(actionType)).toBe('escalate');
  });

  test('an unknown future action type falls back to escalate, not reject', () => {
    expect(decisionFor('some_future_action_type')).toBe('escalate');
  });

  test('nothing in this policy ever produces a reject decision', () => {
    const allTypes = ['fetch_data', 'create_task', 'schedule_event', 'update_database', 'send_email', 'unknown_type'];
    expect(allTypes.map(decisionFor)).not.toContain('reject');
  });
});
