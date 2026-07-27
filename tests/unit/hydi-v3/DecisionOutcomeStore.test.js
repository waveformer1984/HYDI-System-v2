'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const DecisionOutcomeStore = require('../../../src/hydi-v3/DecisionOutcomeStore');

let counter = 0;

function makePath() {
  const n = counter++;
  return path.join(os.tmpdir(), `dos-test-${process.pid}-${n}`);
}

describe('DecisionOutcomeStore', () => {
  let store;
  let dataPath;

  beforeEach(async () => {
    dataPath = makePath();
    fs.mkdirSync(dataPath, { recursive: true });
    store = new DecisionOutcomeStore({ dataPath });
    await store.start();
  });

  afterEach(async () => {
    if (store) await store.destroy();
    try {
      fs.rmSync(dataPath, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
    store = null;
  });

  it('starts and stops cleanly', () => {
    const health = store.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.recommendations).toBe(0);
    expect(health.outcomes).toBe(0);
  });

  it('records a recommendation with a permanent id', () => {
    const id = store.recordRecommendation({
      action: 'Increase Resonate outreach',
      reason: 'High-value opportunity',
      originatingAgent: 'Sales Manager',
      strategicObjective: 'resonate',
      confidence: 0.81,
      expectedValue: 5000,
      expectedOutcome: 'Revenue increase',
    });
    expect(typeof id).toBe('string');
    const rec = store.getRecommendation(id);
    expect(rec.action).toBe('Increase Resonate outreach');
    expect(rec.confidence).toBe(0.81);
    expect(Array.isArray(rec.confidenceHistory)).toBe(true);
    expect(rec.confidenceHistory.length).toBe(1);
  });

  it('requires an action', () => {
    expect(() => store.recordRecommendation({ reason: 'No action' })).toThrow('action');
  });

  it('records owner decision and rejects delayed', () => {
    const id = store.recordRecommendation({ action: 'Hire designer' });
    store.recordDecision(id, 'approved');
    let rec = store.getRecommendation(id);
    expect(rec.ownerDecision).toBe('approved');
    expect(rec.status).toBe('approved');

    const id2 = store.recordRecommendation({ action: 'Buy software' });
    store.recordDecision(id2, 'rejected');
    rec = store.getRecommendation(id2);
    expect(rec.ownerDecision).toBe('rejected');
    expect(rec.executionStatus).toBe('cancelled');
  });

  it('records outcome and appends confidence history', () => {
    const id = store.recordRecommendation({ action: 'Run campaign', confidence: 0.8 });
    store.recordDecision(id, 'approved');
    store.recordOutcome(id, {
      type: 'successful',
      actual: 6000,
      expected: 5000,
      adjustedConfidence: 0.85,
      confidenceDelta: 0.05,
      lesson: 'Campaign exceeded target',
    });
    const rec = store.getRecommendation(id);
    expect(rec.observedOutcome.type).toBe('successful');
    expect(rec.lessonsLearned).toBe('Campaign exceeded target');
    expect(rec.executionStatus).toBe('completed');
    expect(store.getConfidenceHistory(id).length).toBe(1); // only creation
  });

  it('finds recommendations by query', () => {
    const id1 = store.recordRecommendation({ action: 'A', strategicObjective: 'resonate', confidence: 0.5 });
    store.recordRecommendation({ action: 'B', strategicObjective: 'manufacturing', confidence: 0.6 });
    const resonate = store.findRecommendations({ strategicObjective: 'resonate' });
    expect(resonate.length).toBe(1);
    expect(resonate[0].id).toBe(id1);
  });

  it('lists awaiting outcomes', () => {
    const id1 = store.recordRecommendation({ action: 'Approved' });
    store.recordRecommendation({ action: 'Pending' });
    store.recordDecision(id1, 'approved');
    const awaiting = store.getAwaitingOutcomes();
    expect(awaiting.length).toBe(1);
    expect(awaiting[0].id).toBe(id1);
  });

  it('survives restart', async () => {
    const id = store.recordRecommendation({
      action: 'Persist me',
      originatingAgent: 'Test',
      confidence: 0.7,
      expectedValue: 100,
    });
    store.recordDecision(id, 'approved');
    store.recordOutcome(id, { type: 'successful', actual: 120 });
    await store.flush();
    await store.destroy();

    store = new DecisionOutcomeStore({ dataPath });
    await store.start();
    const rec = store.getRecommendation(id);
    expect(rec.action).toBe('Persist me');
    expect(rec.ownerDecision).toBe('approved');
    expect(rec.observedOutcome.type).toBe('successful');
    expect(store.getOutcomes().length).toBe(1);
  });

  it('leaves no timers after destroy', async () => {
    store.recordRecommendation({ action: 'One' });
    await store.destroy();
    expect(store._persistTimer).toBeNull();
  });
});
