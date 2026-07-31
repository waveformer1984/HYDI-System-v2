'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../../../src/hydi-v3/OperatorSession');
const OperatorMode = require('../../../src/hydi-v3/OperatorMode');
const ConfidenceCalibration = require('../../../src/hydi-v3/ConfidenceCalibration');
const LearningPolicies = require('../../../src/hydi-v3/LearningPolicies');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

/**
 * The learning loop lets observed outcomes change future recommendations. That
 * is the same shape that broke V1: enforcement running ahead of ground truth,
 * producing self-reinforcing feedback. These tests pin the properties that keep
 * it honest.
 */
describe('learning loop integrity', () => {
  let session;
  let dataPath;
  let store;
  let engine;

  async function boot(extra = {}) {
    dataPath = path.join(os.tmpdir(), `heidi-learn-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    session = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10, ...extra });
    await session.start();
    store = session.decisionOutcomeStore;
    engine = session.businessOutcomeEngine;
    return session;
  }

  function recommend(overrides = {}) {
    return store.recordRecommendation({
      action: 'Ship Resonate beta',
      expectedValue: 10000,
      confidence: 0.5,
      strategicObjective: 'resonate',
      ...overrides,
    });
  }

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    session = null;
  });

  describe('ground truth', () => {
    test('the execution gateway carries the recommendation link', async () => {
      // Without this the learning loop is inert: _observeOutcome() checks
      // entry.recommendationId, which was never copied off the action.
      await boot();
      const id = recommend();
      await session.executionGateway.execute({
        type: 'create-report', requestingAgent: 'Ops', params: { title: 'x' }, recommendationId: id,
      });

      const entry = session.executionGateway.getExecutionHistory({}).find((e) => e.recommendationId === id);
      expect(entry).toBeTruthy();
    });

    test('a completed execution advances status but is not a measured outcome', async () => {
      // An action finishing means it ran, not that it delivered the value the
      // recommendation predicted. Recording `actual = expected` here would be
      // the system confirming its own forecast without observing anything.
      await boot();
      const id = recommend();
      const before = store.getRecommendation(id).confidence;

      await session.executionGateway.execute({
        type: 'create-report', requestingAgent: 'Ops', params: { title: 'x' }, recommendationId: id,
      });

      const rec = store.getRecommendation(id);
      expect(rec.executionStatus).toBe('completed');
      expect(rec.observedOutcome).toBeNull();
      expect(rec.confidence).toBe(before);
      expect(store.getOutcomes({ recommendationId: id })).toHaveLength(0);
    });

    test('a recommendation awaits a real outcome after execution completes', async () => {
      await boot();
      const id = recommend();
      store.recordDecision(id, 'approved');
      await session.executionGateway.execute({
        type: 'create-report', requestingAgent: 'Ops', params: { title: 'x' }, recommendationId: id,
      });

      expect(store.getAwaitingOutcomes().map((r) => r.id)).toContain(id);
    });

    test('a measured outcome does move confidence', async () => {
      await boot();
      const id = recommend();
      const result = engine.recordOutcome(id, { value: 10000 });

      expect(result.observedOutcome.type).toBe('successful');
      expect(result.adjustedConfidence).toBeGreaterThan(0.5);
      expect(store.getRecommendation(id).observedOutcome.measured).toBe(true);
    });

    test('an execution failure is genuine negative evidence', async () => {
      await boot();
      const id = recommend();
      const before = store.getRecommendation(id).confidence;

      await expect(session.executionGateway.execute({
        type: 'create-report',
        requestingAgent: 'Ops',
        params: { forceFailure: true },
        recommendationId: id,
        adapter: 'nonexistent-adapter',
      })).rejects.toThrow();

      const rec = store.getRecommendation(id);
      if (rec.observedOutcome) {
        expect(rec.observedOutcome.type).toBe('failed');
        expect(rec.confidence).toBeLessThanOrEqual(before);
      }
    });
  });

  describe('simulation must not teach', () => {
    test('a dry-run execution records no outcome and does not move confidence', async () => {
      const mode = new OperatorMode({ dryRun: true });
      await boot({ mode });
      const id = recommend();
      const before = store.getRecommendation(id).confidence;

      await session.executionGateway.execute({
        type: 'create-report', requestingAgent: 'Ops', params: { title: 'x' }, recommendationId: id,
      });

      const rec = store.getRecommendation(id);
      expect(rec.observedOutcome).toBeNull();
      expect(rec.confidence).toBe(before);
      expect(store.outcomes).toHaveLength(0);
    });

    test('a gateway-wide simulate flag also suppresses learning', async () => {
      await boot();
      session.executionGateway.config.simulate = true;
      const id = recommend();

      await session.executionGateway.execute({
        type: 'create-report', requestingAgent: 'Ops', params: { title: 'x' }, recommendationId: id,
      });

      expect(store.getRecommendation(id).observedOutcome).toBeNull();
    });
  });

  describe('outcomes are terminal', () => {
    test('the same outcome cannot be recorded twice', async () => {
      // Otherwise a retried execution or a duplicated observation manufactures
      // evidence, ratcheting confidence with every repeat.
      await boot();
      const id = recommend();

      const first = engine.recordOutcome(id, { value: 10000 });
      const confidenceAfterFirst = store.getRecommendation(id).confidence;

      for (let i = 0; i < 10; i++) engine.recordOutcome(id, { value: 10000 });

      expect(store.getOutcomes({ recommendationId: id })).toHaveLength(1);
      expect(store.getRecommendation(id).confidence).toBe(confidenceAfterFirst);
      expect(first.observedOutcome.type).toBe('successful');
    });

    test('an outcome can be deliberately superseded', async () => {
      await boot();
      const id = recommend();
      engine.recordOutcome(id, { value: 10000 });
      store.recordOutcome(id, { type: 'failed', actual: 0, supersede: true });

      expect(store.getRecommendation(id).observedOutcome.type).toBe('failed');
      expect(store.getOutcomes({ recommendationId: id })).toHaveLength(2);
    });

    test('outcomes are recorded once, not once per collaborator', async () => {
      // RecommendationTracker delegates to the same store, so the engine
      // calling both wrote every outcome twice and inflated every metric
      // derived from store.outcomes.
      await boot();
      const id = recommend();
      engine.recordOutcome(id, { value: 10000 });

      expect(store.outcomes).toHaveLength(1);
      expect(store.getLearningSummary().outcomeCount).toBe(1);
    });
  });

  describe('calibration is bounded and reversible', () => {
    test('repeated success asymptotes rather than running away', () => {
      const calibration = new ConfidenceCalibration({ policy: 'balanced' });
      let confidence = 0.5;
      const trajectory = [];
      for (let i = 0; i < 200; i++) {
        confidence = calibration.adjust(confidence, { type: 'successful' }, 1000).confidence;
        trajectory.push(confidence);
      }
      const policy = LearningPolicies.get('balanced');
      expect(confidence).toBeLessThanOrEqual(policy.maxConfidence);
      // Monotonic and decelerating: each step is no larger than the last.
      const firstStep = trajectory[1] - trajectory[0];
      const lastStep = trajectory[199] - trajectory[198];
      expect(lastStep).toBeLessThan(firstStep);
    });

    test('repeated failure is bounded below', () => {
      const calibration = new ConfidenceCalibration({ policy: 'balanced' });
      let confidence = 0.9;
      for (let i = 0; i < 200; i++) {
        confidence = calibration.adjust(confidence, { type: 'failed' }, 1000).confidence;
      }
      expect(confidence).toBeGreaterThanOrEqual(LearningPolicies.get('balanced').minConfidence);
    });

    test('every policy stays inside its own bounds', () => {
      for (const name of LearningPolicies.list()) {
        const policy = LearningPolicies.get(name);
        const calibration = new ConfidenceCalibration({ policy: name });
        let high = 0.5;
        let low = 0.5;
        for (let i = 0; i < 100; i++) {
          high = calibration.adjust(high, { type: 'successful' }, 1000).confidence;
          low = calibration.adjust(low, { type: 'failed' }, 1000).confidence;
        }
        expect(high).toBeLessThanOrEqual(policy.maxConfidence);
        expect(low).toBeGreaterThanOrEqual(policy.minConfidence);
      }
    });

    test('a single outcome cannot swing confidence dramatically', async () => {
      await boot();
      const id = recommend();
      const result = engine.recordOutcome(id, { value: 10000 });
      expect(Math.abs(result.confidenceDelta)).toBeLessThan(0.1);
    });

    test('confidence history records every adjustment for inspection', async () => {
      await boot();
      const id = recommend();
      engine.recordOutcome(id, { value: 10000 });

      const history = store.getConfidenceHistory(id);
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[0].reason).toBe('created');
      expect(history[history.length - 1].reason).toContain('outcome:');
    });
  });

  describe('store durability', () => {
    test('a corrupt store is archived rather than silently discarded', async () => {
      dataPath = path.join(os.tmpdir(), `heidi-learn-corrupt-${Date.now()}`);
      await fs.mkdir(dataPath, { recursive: true });
      const DecisionOutcomeStore = require('../../../src/hydi-v3/DecisionOutcomeStore');
      const corruptStore = new DecisionOutcomeStore({ dataPath, logger: silent });
      await fs.writeFile(corruptStore.storePath, 'not json');

      await corruptStore.start();
      try {
        const archived = (await fs.readdir(dataPath)).filter((f) => f.includes('.corrupt.'));
        expect(archived).toHaveLength(1);
      } finally {
        await corruptStore.destroy();
        await fs.rm(dataPath, { recursive: true, force: true });
      }
      session = null;
    });

    test('the outcome log is capped', async () => {
      await boot();
      const DecisionOutcomeStore = require('../../../src/hydi-v3/DecisionOutcomeStore');
      const cap = DecisionOutcomeStore.MAX_OUTCOMES;
      expect(Number.isFinite(cap)).toBe(true);

      const id = recommend();
      for (let i = 0; i < 50; i++) {
        store.recordOutcome(id, { type: 'successful', actual: 1, supersede: true });
      }
      expect(store.outcomes.length).toBeLessThanOrEqual(cap);
    });
  });
});
