'use strict';

const TrustEngine = require('../../../src/hydi-v3/TrustEngine');

describe('TrustEngine', () => {
  test('computeConfidence is high for complete data', () => {
    const te = new TrustEngine();
    const entity = {
      name: 'Big Deal', value: 1000, effort: 2, risk: 0.1, tags: ['resonate'], updatedAt: Date.now(),
    };
    expect(te.computeConfidence(entity)).toBeGreaterThan(0.8);
  });

  test('computeConfidence is low for sparse data', () => {
    const te = new TrustEngine();
    expect(te.computeConfidence({ name: 'X' })).toBeLessThan(0.5);
  });

  test('generateProvenance includes sources and assumptions', () => {
    const so = { get: () => ({ id: 'resonate', name: 'Resonate' }) };
    const te = new TrustEngine({ strategicObjectives: so });
    const rec = { action: 'Prepare release', reason: 'Flagship ready', objective: 'resonate', expectedImpact: 'High' };
    const p = te.generateProvenance(rec);
    expect(p.sources.length).toBeGreaterThan(0);
    expect(p.confidence).toBeLessThanOrEqual(1);
  });

  test('iDontKnow returns zero-confidence recommendation', () => {
    const te = new TrustEngine();
    const rec = te.iDontKnow('Missing sales data');
    expect(rec.confidence).toBe(0);
    expect(rec.action).toContain("don't");
    expect(rec.provenance.confidence).toBe(0);
  });

  test('formatJustification answers the seven trust questions', () => {
    const te = new TrustEngine();
    const rec = { action: 'X', reason: 'Y', expectedOutcome: 'Z', risk: 0.2, effort: 1 };
    const text = te.formatJustification(rec);
    expect(text).toContain('Why am I recommending this?');
    expect(text).toContain('Why is it safe?');
    expect(text).toContain('What data did I use?');
    expect(text).toContain('Can I undo it?');
  });
});
