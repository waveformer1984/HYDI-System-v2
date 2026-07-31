'use strict';

const StrategicObjectives = require('../../../src/hydi-v3/StrategicObjectives');

describe('StrategicObjectives', () => {
  test('registers default objectives including Resonate', () => {
    const so = new StrategicObjectives();
    expect(so.get('resonate')).toBeTruthy();
    expect(so.get('resonate').category).toBe('flagship');
    expect(so.getActive().length).toBeGreaterThanOrEqual(5);
  });

  test('score boosts Resonate-tagged entities', () => {
    const so = new StrategicObjectives();
    const base = { value: 1000, effort: 1, risk: 0 };
    const resonate = { ...base, tags: ['resonate'] };
    const regular = { ...base, tags: [] };
    const sRes = so.score(resonate);
    const sReg = so.score(regular);
    expect(sRes.score).toBeGreaterThan(sReg.score);
    expect(sRes.objective).toBe('resonate');
  });

  test('owner priority switches recommendation ranking', () => {
    const so = new StrategicObjectives();
    const manufacturing = { value: 1000, effort: 1, risk: 0, tags: ['printer'] };
    const research = { value: 1000, effort: 1, risk: 0, tags: ['experiment'] };

    so.setOwnerPriority('manufacturing');
    const mfgScore = so.score(manufacturing).score;
    const resScoreMfg = so.score(research).score;
    expect(mfgScore).toBeGreaterThan(resScoreMfg);

    so.setOwnerPriority('research');
    const mfgScoreRes = so.score(manufacturing).score;
    const researchScore = so.score(research).score;
    expect(researchScore).toBeGreaterThan(mfgScoreRes);
  });

  test('scoreRecommendation ranks Resonate actions highest', () => {
    const so = new StrategicObjectives();
    const resonate = { action: 'Prepare Resonate release', reason: 'Flagship launch', expectedImpact: '$1000', requiredEffort: 2, risk: 0.1 };
    const ops = { action: 'Organize archive', reason: 'Operations', expectedImpact: '$500', requiredEffort: 1, risk: 0 };
    const sRes = so.scoreRecommendation(resonate);
    const sOps = so.scoreRecommendation(ops);
    expect(sRes.score).toBeGreaterThan(sOps.score);
    expect(sRes.objective).toBe('resonate');
  });

  test('summarize reports objective health from memory', () => {
    const so = new StrategicObjectives();
    const memory = {
      find: (q) => {
        if (q.tags && q.tags.includes('resonate')) return [{ status: 'active' }, { status: 'completed' }];
        if (q.type === 'opportunity') return [];
        return [];
      },
    };
    const summary = so.summarize(memory);
    const res = summary.find((o) => o.id === 'resonate');
    expect(res.activeEntities).toBe(1);
    expect(res.completedEntities).toBe(1);
    expect(res.health).toBe('stable');
  });
});
