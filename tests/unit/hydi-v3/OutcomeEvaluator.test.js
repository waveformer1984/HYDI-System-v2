'use strict';

const OutcomeEvaluator = require('../../../src/hydi-v3/OutcomeEvaluator');

describe('OutcomeEvaluator', () => {
  it('returns insufficient evidence when no evidence is provided', () => {
    const evaluator = new OutcomeEvaluator();
    const result = evaluator.evaluate({ expectedValue: 100 }, []);
    expect(result.classification).toBe('Insufficient Evidence');
    expect(result.outcomeType).toBeNull();
  });

  it('classifies confirmed success from manual yes', () => {
    const evaluator = new OutcomeEvaluator();
    const result = evaluator.evaluate({ expectedValue: 100 }, [
      { source: 'manual', type: 'manual-confirmation', data: { answer: 'yes' }, weight: 1, confidence: 1, relevance: 1 },
    ]);
    expect(result.classification).toBe('Confirmed Success');
    expect(result.outcomeType).toBe('successful');
  });

  it('classifies partial success from manual partial', () => {
    const evaluator = new OutcomeEvaluator();
    const result = evaluator.evaluate({ expectedValue: 100 }, [
      { source: 'manual', type: 'manual-confirmation', data: { answer: 'partially' }, weight: 1, confidence: 1, relevance: 1 },
    ]);
    expect(result.classification).toBe('Partial Success');
    expect(result.outcomeType).toBe('partially successful');
  });

  it('classifies negative from manual no', () => {
    const evaluator = new OutcomeEvaluator();
    const result = evaluator.evaluate({ expectedValue: 100 }, [
      { source: 'manual', type: 'manual-confirmation', data: { answer: 'no' }, weight: 1, confidence: 1, relevance: 1 },
    ]);
    expect(result.classification).toBe('Negative');
    expect(result.outcomeType).toBe('failed');
  });

  it('classifies confirmed success from automatic evidence that matches expectation', () => {
    const evaluator = new OutcomeEvaluator();
    const result = evaluator.evaluate({ expectedValue: 100 }, [
      { source: 'git', type: 'CommitCreated', weight: 1, confidence: 1, relevance: 1, measurementType: 'quantitative', data: { value: 120 } },
    ]);
    expect(result.classification).toBe('Confirmed Success');
  });

  it('classifies partial success when observed is a fraction of expected', () => {
    const evaluator = new OutcomeEvaluator();
    const result = evaluator.evaluate({ expectedValue: 100 }, [
      { source: 'filesystem', type: 'FileCreated', weight: 1, confidence: 1, relevance: 1, measurementType: 'quantitative', data: { value: 60 } },
    ]);
    expect(result.classification).toBe('Partial Success');
    expect(result.outcomeType).toBe('partially successful');
  });

  it('returns inconclusive when evidence is contradictory', () => {
    const evaluator = new OutcomeEvaluator();
    const result = evaluator.evaluate({ expectedValue: 100 }, [
      { source: 'git', type: 'CommitCreated', weight: 1, confidence: 1, relevance: 1, measurementType: 'quantitative', data: { value: 120 } },
      { source: 'manufacturing', type: 'PrinterFailed', weight: 1, confidence: 1, relevance: 1, measurementType: 'quantitative', data: { value: -120 } },
    ]);
    expect(result.classification).toBe('Inconclusive');
    expect(result.outcomeType).toBeNull();
  });
});
