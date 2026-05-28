'use strict';

const { PolicyEngine, evaluateRules, matchCondition } = require('../../lib/protoforge/policy-engine');

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
