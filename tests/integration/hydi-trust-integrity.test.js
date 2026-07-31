'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const OperatorSession = require('../../src/hydi-v3/OperatorSession');
const TrustEngine = require('../../src/hydi-v3/TrustEngine');

const silent = { log: () => {}, warn: () => {}, error: () => {} };

describe('HYDI trust integrity', () => {
  let session;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-trust-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    session = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10 });
    await session.start();
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    session = null;
  });

  test('measured outcomes can affect learning', () => {
    const id = session.recommendationTracker.track({
      action: 'Verify measured learning',
      expectedValue: 1000,
      confidence: 0.5,
      strategicObjective: 'revenue',
    });
    const before = session.recommendationTracker.getRecommendation(id).confidence;

    const outcome = session.businessOutcomeEngine.recordOutcome(id, {
      value: 1200,
      measured: true,
      provenance: 'manual-measurement',
      type: 'successful',
    });

    const after = session.recommendationTracker.getRecommendation(id).confidence;
    expect(outcome.confidenceDelta).not.toBe(0);
    expect(after).not.toBe(before);
    expect(after).toBeGreaterThan(before);
  });

  test('unmeasured outcomes cannot affect learning', () => {
    const id = session.recommendationTracker.track({
      action: 'Verify unmeasured learning',
      expectedValue: 1000,
      confidence: 0.5,
    });
    const before = session.recommendationTracker.getRecommendation(id).confidence;

    session.businessOutcomeEngine.recordOutcome(id, {
      measured: false,
      provenance: 'owner-review',
      type: 'successful',
    });

    const after = session.recommendationTracker.getRecommendation(id).confidence;
    expect(after).toBe(before);
    expect(session.recommendationTracker.getRecommendation(id).observedOutcome.measured).toBe(false);
  });

  test('simulated executions cannot affect learning', async () => {
    const id = session.recommendationTracker.track({
      action: 'Verify simulated learning',
      expectedValue: 1000,
      confidence: 0.5,
    });
    const before = session.recommendationTracker.getRecommendation(id).confidence;

    session.executionGateway.config.simulate = true;
    await session.executionGateway.execute({
      type: 'create-report',
      recommendationId: id,
      requestingAgent: 'test',
      params: { title: 'Simulated report' },
    });

    const after = session.recommendationTracker.getRecommendation(id).confidence;
    expect(after).toBe(before);
    expect(session.recommendationTracker.getRecommendation(id).observedOutcome).toBeNull();
  });

  test('unknown provenance reduces confidence', () => {
    const te = new TrustEngine();
    const complete = {
      name: 'Known deal', value: 1000, effort: 2, risk: 0.1, tags: ['resonate'], updatedAt: Date.now(),
    };
    const unknown = { name: 'Unknown deal' };
    expect(te.computeConfidence(unknown)).toBeLessThan(te.computeConfidence(complete));
    expect(te.computeConfidence(unknown)).toBeLessThan(0.5);
  });
});
