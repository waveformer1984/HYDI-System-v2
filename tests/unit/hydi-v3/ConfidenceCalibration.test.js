'use strict';

const ConfidenceCalibration = require('../../../src/hydi-v3/ConfidenceCalibration');
const LearningPolicies = require('../../../src/hydi-v3/LearningPolicies');

describe('ConfidenceCalibration', () => {
  it('increases confidence after success', () => {
    const cal = new ConfidenceCalibration({ policy: 'balanced' });
    const result = cal.adjust(0.8, { type: 'successful', actual: 100, expected: 100 }, 5);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  it('decreases confidence after failure', () => {
    const cal = new ConfidenceCalibration({ policy: 'balanced' });
    const result = cal.adjust(0.8, { type: 'failed', actual: 0, expected: 100 }, 5);
    expect(result.confidence).toBeLessThan(0.8);
    expect(result.confidence).toBeGreaterThanOrEqual(0.05);
  });

  it('partial success changes confidence modestly', () => {
    const cal = new ConfidenceCalibration({ policy: 'balanced' });
    const result = cal.adjust(0.8, { type: 'partially successful', actual: 70, expected: 100 }, 5);
    expect(result.confidence).toBeGreaterThanOrEqual(0.05);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  it('never exceeds configured max confidence', () => {
    const cal = new ConfidenceCalibration({ policy: 'balanced' });
    const result = cal.adjust(0.94, { type: 'successful' }, 100);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  it('never drops below configured min confidence', () => {
    const cal = new ConfidenceCalibration({ policy: 'conservative' });
    const result = cal.adjust(0.12, { type: 'failed' }, 100);
    expect(result.confidence).toBeGreaterThanOrEqual(0.1);
  });

  it('respects different policies', () => {
    const conservative = new ConfidenceCalibration({ policy: 'conservative' });
    const aggressive = new ConfidenceCalibration({ policy: 'aggressive' });
    const c = conservative.adjust(0.5, { type: 'successful' }, 10);
    const a = aggressive.adjust(0.5, { type: 'successful' }, 10);
    expect(a.confidence).toBeGreaterThan(c.confidence);
  });

  it('dampens adjustment when evidence is low', () => {
    const cal = new ConfidenceCalibration({ policy: 'balanced' });
    const withEvidence = cal.adjust(0.5, { type: 'successful' }, 20);
    const without = cal.adjust(0.5, { type: 'successful' }, 1);
    expect(withEvidence.confidence).toBeGreaterThan(without.confidence);
  });

  it('LearningPolicies exposes four named policies', () => {
    const names = LearningPolicies.list();
    expect(names).toEqual(expect.arrayContaining(['conservative', 'balanced', 'aggressive', 'experimental']));
  });
});
