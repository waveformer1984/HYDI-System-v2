'use strict';
const { assess } = require('../../evolution/self-assessment');
const { findingsToProposals, proposeGoals } = require('../../evolution/findings-to-goals');

function buildAssessment() {
  const events = [];
  for (let i = 0; i < 10; i++) events.push({ verdict: 'REVIEW', division: 'revenue', elapsed_ms: 200, error_message: i < 4 ? 'boom' : null });
  for (let i = 0; i < 5; i++) events.push({ verdict: 'BLOCK', division: 'revenue', elapsed_ms: 9000 });
  return assess(events);
}

// Minimal stand-in for HeidiGoalEngine (addGoal + allGoals).
function fakeEngine() {
  const goals = [];
  return {
    goals,
    allGoals: () => goals,
    addGoal: async (objective, priority) => {
      const g = { id: 'g' + (goals.length + 1), objective, priority, status: 'active' };
      goals.push(g);
      return g;
    },
  };
}

describe('findings -> goal proposals (recommend stage)', () => {
  test('maps actionable findings to prioritized proposals, excludes info/ok', () => {
    const props = findingsToProposals(buildAssessment());
    expect(props.length).toBeGreaterThanOrEqual(2);
    expect(props.every((p) => p.priority === 'high' || p.priority === 'normal')).toBe(true);
    expect(props.some((p) => p.source.code === 'division_errors' && p.objective.includes('revenue'))).toBe(true);
    expect(props.some((p) => p.severity === 'info')).toBe(false);
  });

  test('clean assessment yields no proposals', () => {
    const clean = assess([{ verdict: 'AUTO-APPROVE', division: 'x', elapsed_ms: 50 }]);
    expect(findingsToProposals(clean)).toHaveLength(0);
  });

  test('approve:false proposes but creates nothing (human-in-the-loop)', async () => {
    const eng = fakeEngine();
    const r = await proposeGoals(eng, buildAssessment(), { approve: false });
    expect(r.applied).toBe(false);
    expect(r.created).toHaveLength(0);
    expect(eng.goals).toHaveLength(0);
    expect(r.proposals.length).toBeGreaterThan(0);
  });

  test('approve:true creates one goal per proposal and dedups on re-run', async () => {
    const eng = fakeEngine();
    const assessment = buildAssessment();
    const expected = findingsToProposals(assessment).length;

    const first = await proposeGoals(eng, assessment, { approve: true });
    expect(first.applied).toBe(true);
    expect(first.created).toHaveLength(expected);
    expect(eng.goals).toHaveLength(expected);
    expect(eng.goals.every((g) => g._source)).toBe(true);

    const second = await proposeGoals(eng, assessment, { approve: true });
    expect(second.created).toHaveLength(0);
    expect(eng.goals).toHaveLength(expected);
  });
});
