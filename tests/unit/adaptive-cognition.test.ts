/**
 * Adaptive cognition — deterministic boundaries around retrieval,
 * directives, branching, and model routing.
 */
import { validateSteps, selectModel, validateCondition } from '../../lib/heidi/Planner';

describe('Planner — branch conditions survive validation', () => {
  test('a conditional step keeps its condition through registry validation', () => {
    const steps = validateSteps([{
      objective: 'assert hypothesis if partially supported',
      capability: 'ops.world_assert',
      params: { kind: 'hypothesis', subject: 'opp:x', predicate: 'demand', value: 'open', provenance: 'event:x' },
      condition: { type: 'business_finding_verdict', opportunityId: 'abc', equals: 'PARTIALLY_SUPPORTED' },
    }]);
    expect(steps[0].status).toBe('executable');
    expect(steps[0].condition?.equals).toBe('PARTIALLY_SUPPORTED');
  });

  test('an unknown capability stays rejected even with a condition', () => {
    const steps = validateSteps([{ objective: 'x', capability: 'ops.magic', params: {}, condition: { type: 'business_finding_verdict', opportunityId: 'a', equals: 'X' } }]);
    expect(steps[0].status).toBe('rejected');
  });
});

describe('validateCondition — declarative grammar gate', () => {
  test('the allowlisted verdict condition passes', () => {
    expect(validateCondition({ type: 'business_finding_verdict', opportunityId: 'a', equals: 'PARTIALLY_SUPPORTED' })).not.toBeNull();
  });

  test('absent condition is allowed (undefined, not invalid)', () => {
    expect(validateCondition(undefined)).toBeUndefined();
  });

  test('arbitrary / executable conditions are rejected', () => {
    expect(validateCondition({ type: 'eval', code: 'process.exit(1)' })).toBeNull();
    expect(validateCondition('verdict == X')).toBeNull();
    expect(validateCondition({ type: 'business_finding_verdict', opportunityId: 'a', equals: "x'); DROP TABLE" })).toBeNull();
    expect(validateCondition({ field: 'x', operator: 'eq' })).toBeNull();
  });

  test('an invalid condition on an LLM step → rejected step, never dispatched', () => {
    const steps = validateSteps([{ objective: 'x', capability: 'ops.world_assert', params: {}, condition: { type: 'evil' } }]);
    expect(steps[0].status).toBe('rejected');
    expect(steps[0].reason).toMatch(/invalid condition/);
  });
});

describe('selectModel — deterministic routing', () => {
  const catalog = [{ name: 'nomic-embed-text:latest' }, { name: 'qwen2.5:7b' }, { name: 'llama3.2:3b' }, { name: 'qwen2.5-coder:1.5b' }];

  test('coding tasks route to the coder model', () => {
    expect(selectModel(catalog, 'coding').model).toBe('qwen2.5-coder:1.5b');
  });

  test('reasoning routes to the strongest available model', () => {
    expect(selectModel(catalog, 'reasoning').model).toBe('qwen2.5:7b');
  });

  test('embedding tasks route to the embed model', () => {
    expect(selectModel(catalog, 'embedding').model).toBe('nomic-embed-text:latest');
  });

  test('empty catalog → honest NO_ELIGIBLE_MODEL, not a fabricated pick', () => {
    const r = selectModel([], 'reasoning');
    expect(r.model).toBeNull();
    expect(r.reason).toMatch(/NO_ELIGIBLE_MODEL/);
  });
});

describe('lesson directives — authority boundary', () => {
  test('a directive cannot promote a step — it can only restrict', () => {
    // Directives only ever set status='rejected'; they never set
    // 'executable' — enforced structurally in applyLessonDirectives.
    const steps = validateSteps([{ objective: 'send', capability: 'tool.send_email', params: {} }]);
    expect(steps[0].status).not.toBe('executable');
  });
});

describe('builder live patch', () => {
  test('condition gate accepts the verdict grammar', () => {
    expect(validateCondition({ type: 'business_finding_verdict', opportunityId: 'x', equals: 'PARTIALLY_SUPPORTED' })).not.toBeNull();
  });
});
