'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../../../src/hydi-v3/OperatorSession');
const OutcomeCorrelation = require('../../../src/hydi-v3/OutcomeCorrelation');
const OutcomeEvaluator = require('../../../src/hydi-v3/OutcomeEvaluator');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

/**
 * The evidence layer decides what counts as a measurement. Phase 20 established
 * that only measured values may move confidence; these tests pin the boundary
 * between classifying an outcome and quantifying it, because conflating the two
 * is how the previous ground-truth inversion got in.
 */
describe('evidence measurement integrity', () => {
  let session;
  let dataPath;
  let store;
  let evidence;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-ev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    session = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10 });
    await session.start();
    store = session.decisionOutcomeStore;
    evidence = session.evidenceEngine;
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    session = null;
  });

  function recommend(expectedValue = 10000) {
    return store.recordRecommendation({
      action: 'Ship Resonate beta', expectedValue, confidence: 0.5, strategicObjective: 'resonate',
    });
  }

  function numericEvidence(value, source = 'stripe') {
    return { source, type: 'revenue', weight: 1, confidence: 1, relevance: 1, at: Date.now(), data: { value } };
  }

  describe('qualitative evidence classifies but does not quantify', () => {
    test('an owner confirmation records a success without inventing a value', () => {
      // Previously this recorded actual = 0 against an expectation of 10000,
      // so a confirmed success also booked a revenue impact of -10000.
      const id = recommend();
      const result = evidence.submitManualReview(id, 'Yes');

      expect(result.outcomeType).toBe('successful');
      expect(result.observedValue).toBeNull();

      const rec = store.getRecommendation(id);
      expect(rec.observedOutcome.actual).toBeNull();
      expect(rec.observedOutcome.impacts.revenue).toBeNull();
      expect(rec.observedOutcome.measured).toBe(false);
    });

    test('a confirmed success never books a negative revenue impact', () => {
      for (const answer of ['Yes', 'Partially']) {
        const id = recommend();
        evidence.submitManualReview(id, answer);
        const impact = store.getRecommendation(id).observedOutcome.impacts.revenue;
        expect(impact === null || impact >= 0).toBe(true);
      }
    });

    test('qualitative evidence does not dilute a real measurement', () => {
      // The weighted mean previously included non-numeric evidence as zero, so
      // confirming a success dragged 9500 down to roughly 4872.
      const id = recommend();
      evidence.addEvidence(id, numericEvidence(9500));
      const result = evidence.submitManualReview(id, 'Yes');

      expect(result.observedValue).toBe(9500);
      expect(store.getRecommendation(id).observedOutcome.impacts.revenue).toBe(-500);
    });
  });

  describe('measured evidence', () => {
    test('a numeric measurement is recorded as measured with a real impact', () => {
      const id = recommend();
      evidence.addEvidence(id, numericEvidence(9500));
      const result = evidence.evaluateRecommendation(id);

      expect(result.outcomeType).toBe('successful');
      expect(result.observedValue).toBe(9500);
      const rec = store.getRecommendation(id);
      expect(rec.observedOutcome.measured).toBe(true);
      expect(rec.observedOutcome.impacts.revenue).toBe(-500);
    });

    test('evidence carrying no number is inconclusive, not a failure', () => {
      // Scoring a ratio off a missing measurement read "not measured" as
      // "measured zero" and classified the recommendation as failed.
      const id = recommend();
      evidence.addEvidence(id, {
        source: 'note', type: 'observation', weight: 1, confidence: 1, relevance: 1,
        at: Date.now(), data: { comment: 'looked fine' },
      });
      const result = evidence.evaluateRecommendation(id);

      expect(result.outcomeType).toBeNull();
      expect(store.getRecommendation(id).observedOutcome).toBeNull();
    });

    test('no evidence records no outcome at all', () => {
      const id = recommend();
      const result = evidence.evaluateRecommendation(id);
      expect(result.outcomeType).toBeNull();
      expect(store.getRecommendation(id).observedOutcome).toBeNull();
    });
  });

  describe('correlation is dimensionally sound', () => {
    test('variance is scale-free so the inconclusive threshold means something', () => {
      // Raw squared deviations in currency units reached tens of millions
      // against a threshold of 0.8, so any spread looked contradictory.
      const correlation = new OutcomeCorrelation();
      const result = correlation.correlate(
        { expectedValue: 10000 },
        [numericEvidence(9000), numericEvidence(9500), numericEvidence(10000)],
      );
      expect(result.evidenceVariance).toBeGreaterThanOrEqual(0);
      expect(result.evidenceVariance).toBeLessThanOrEqual(1);
    });

    test('consistent large values are not treated as contradictory', () => {
      const evaluator = new OutcomeEvaluator();
      const result = evaluator.evaluate(
        { expectedValue: 10000 },
        [numericEvidence(9800), numericEvidence(10100)],
      );
      expect(result.outcomeType).toBe('successful');
    });

    test('genuinely contradictory evidence is still flagged', () => {
      const evaluator = new OutcomeEvaluator();
      const result = evaluator.evaluate(
        { expectedValue: 10000 },
        [numericEvidence(100), numericEvidence(19900)],
      );
      expect(result.outcomeType).toBeNull();
      expect(result.classification).toContain('Inconclusive');
    });

    test('strategic impact stays inside its 0-1 scale', () => {
      // Subtracting a 0-1 target from a monetary value saturated to +/-1 for
      // any real amount of money, making the field meaningless.
      const correlation = new OutcomeCorrelation();
      for (const value of [1, 500, 10000, 1000000]) {
        const result = correlation.correlate({ expectedValue: 10000 }, [numericEvidence(value)]);
        expect(result.strategicImpact).toBeGreaterThanOrEqual(-1);
        expect(result.strategicImpact).toBeLessThanOrEqual(1);
      }
      const accurate = correlation.correlate({ expectedValue: 10000 }, [numericEvidence(10000)]);
      const wildlyOff = correlation.correlate({ expectedValue: 10000 }, [numericEvidence(1)]);
      expect(accurate.strategicImpact).toBeGreaterThan(wildlyOff.strategicImpact);
    });

    test('correlation reports whether anything was measured', () => {
      const correlation = new OutcomeCorrelation();
      const withNumber = correlation.correlate({ expectedValue: 100 }, [numericEvidence(50)]);
      const without = correlation.correlate({ expectedValue: 100 }, [
        { source: 'manual', weight: 1, confidence: 1, relevance: 1, data: { answer: 'yes' } },
      ]);

      expect(withNumber.hasMeasuredValue).toBe(true);
      expect(withNumber.numericEvidenceCount).toBe(1);
      expect(without.hasMeasuredValue).toBe(false);
      expect(without.observedValue).toBeNull();
    });
  });

  describe('the loop is fed and stays honest', () => {
    test('evidence drains the awaiting-outcome queue', async () => {
      // Phase 20 left recommendations awaiting a measurement with nothing to
      // supply one. This is the path that closes that gap.
      const id = recommend();
      store.recordDecision(id, 'approved');
      await session.executionGateway.execute({
        type: 'create-report', requestingAgent: 'Ops', params: { title: 'x' }, recommendationId: id,
      });
      expect(store.getAwaitingOutcomes().map((r) => r.id)).toContain(id);

      evidence.addEvidence(id, numericEvidence(9500));
      evidence.evaluateRecommendation(id);

      expect(store.getAwaitingOutcomes().map((r) => r.id)).not.toContain(id);
    });

    test('re-evaluating the same recommendation cannot ratchet confidence', () => {
      const id = recommend();
      evidence.addEvidence(id, numericEvidence(9500));
      evidence.evaluateRecommendation(id);
      const settled = store.getRecommendation(id).confidence;

      for (let i = 0; i < 10; i++) evidence.evaluateRecommendation(id);

      expect(store.getRecommendation(id).confidence).toBe(settled);
      expect(store.getOutcomes({ recommendationId: id })).toHaveLength(1);
    });
  });
});
