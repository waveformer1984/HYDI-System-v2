'use strict';

const OutcomeCorrelation = require('../../../src/hydi-v3/OutcomeCorrelation');

describe('OutcomeCorrelation', () => {
  it('compares expected vs observed value', () => {
    const oc = new OutcomeCorrelation();
    const rec = { expectedValue: 100, expectedStrategic: 1, expectedOperational: 1, createdAt: Date.now() };
    const evidence = [{ weight: 1, confidence: 1, relevance: 1, data: { value: 120 } }];
    const result = oc.correlate(rec, evidence);
    expect(result.predictionAccuracy).toBeGreaterThan(0.7);
    expect(result.valueCreated).toBe(20);
    expect(result.forecastError).toBe(20);
  });

  it('handles zero expected value', () => {
    const oc = new OutcomeCorrelation();
    const rec = { expectedValue: 0 };
    const evidence = [{ weight: 1, confidence: 1, relevance: 1, data: { value: 5 } }];
    const result = oc.correlate(rec, evidence);
    expect(result.predictionAccuracy).toBe(0);
    expect(result.valueCreated).toBe(5);
  });

  it('weights evidence by confidence and relevance', () => {
    const oc = new OutcomeCorrelation();
    const rec = { expectedValue: 100 };
    const evidence = [
      { weight: 1, confidence: 1, relevance: 1, data: { value: 100 } },
      { weight: 1, confidence: 0.5, relevance: 0.5, data: { value: 0 } },
    ];
    const result = oc.correlate(rec, evidence);
    expect(result.observedValue).toBeGreaterThan(0);
    expect(result.observedValue).toBeLessThan(100);
  });

  it('records and returns prediction history', () => {
    const oc = new OutcomeCorrelation();
    const rec = { expectedValue: 10 };
    oc.recordPrediction(rec, { observedValue: 12, predictionAccuracy: 0.8 });
    expect(oc.getPredictionHistory().length).toBe(1);
    expect(oc.getPredictionHistory()[0].accuracy).toBe(0.8);
  });
});
