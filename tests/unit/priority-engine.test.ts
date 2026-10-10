/**
 * PriorityEngine unit tests — deterministic scoring + governance override.
 */

import { PriorityEngine, ConditionAssessment } from '../../lib/heidi/PriorityEngine';

const BASE: ConditionAssessment = {
  impact: 5,
  urgency: 5,
  confidence: 1.0,
  reversibility: 1.0,
  autonomyLevel: 0,
  estimatedEffort: 5,
  dependencyHealth: 1.0,
  revenueEffect: 0,
  humanRequired: false,
};

describe('PriorityEngine', () => {
  const engine = new PriorityEngine();

  it('ranks higher-impact work above lower-impact at equal inputs', () => {
    const r = engine.prioritize([
      { item: 'low', assessment: { ...BASE, impact: 2 } },
      { item: 'high', assessment: { ...BASE, impact: 9 } },
    ], 2);
    expect(r.ranked.map(x => x.item)).toEqual(['high', 'low']);
    expect(r.ranked[0].score).toBeGreaterThan(r.ranked[1].score);
  });

  it('prohibited work is refused regardless of score', () => {
    const r = engine.prioritize([
      { item: 'banned', assessment: { ...BASE, impact: 10, urgency: 10, prohibited: true, prohibitionReason: 'policy' } },
      { item: 'ok', assessment: { ...BASE, impact: 1 } },
    ], 5);
    expect(r.refused).toHaveLength(1);
    expect(r.refused[0].reason).toBe('policy');
    expect(r.refused[0].score).toBe(0);
    expect(r.ranked.map(x => x.item)).toEqual(['ok']);
  });

  it('autonomy requirement above current level refuses, not ranks', () => {
    const r = engine.prioritize([
      { item: 'r3', assessment: { ...BASE, autonomyLevel: 4 } },
    ], 2);
    expect(r.ranked).toHaveLength(0);
    expect(r.refused[0].reason).toContain('autonomy:4>2');
  });

  it('human-required work is deferred, never ranked as autonomous', () => {
    const r = engine.prioritize([
      { item: 'human', assessment: { ...BASE, humanRequired: true } },
    ], 2);
    expect(r.ranked).toHaveLength(0);
    expect(r.deferred).toHaveLength(1);
    expect(r.deferred[0].reason).toBe('human_required');
  });

  it('unhealthy dependencies degrade autonomyFit', () => {
    const r = engine.prioritize([
      { item: 'healthy', assessment: { ...BASE, dependencyHealth: 1.0 } },
      { item: 'sick', assessment: { ...BASE, dependencyHealth: 0.2 } },
    ], 2);
    expect(r.ranked[0].item).toBe('healthy');
    expect(r.ranked[0].breakdown.autonomyFit).toBeGreaterThan(r.ranked[1].breakdown.autonomyFit);
  });

  it('revenue effect boosts score without overriding governance', () => {
    const r = engine.prioritize([
      { item: 'flat', assessment: { ...BASE } },
      { item: 'money', assessment: { ...BASE, revenueEffect: 8 } },
    ], 2);
    expect(r.ranked[0].item).toBe('money');
    expect(r.ranked[0].score).toBeGreaterThan(r.ranked[1].score);
  });

  it('deterministic — same inputs produce identical ranking', () => {
    const items = [
      { item: 'a', assessment: { ...BASE, impact: 3 } },
      { item: 'b', assessment: { ...BASE, impact: 7, estimatedEffort: 9 } },
      { item: 'c', assessment: { ...BASE, impact: 5, confidence: 0.4 } },
    ];
    const r1 = engine.prioritize(items, 2);
    const r2 = engine.prioritize(items, 2);
    expect(r1.ranked.map(x => x.item)).toEqual(r2.ranked.map(x => x.item));
    expect(r1.ranked.map(x => x.score)).toEqual(r2.ranked.map(x => x.score));
  });
});
