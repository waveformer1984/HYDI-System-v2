'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const RecommendationTracker = require('../../../src/hydi-v3/RecommendationTracker');
const DecisionOutcomeStore = require('../../../src/hydi-v3/DecisionOutcomeStore');

let counter = 0;

function makePath() {
  const n = counter++;
  return path.join(os.tmpdir(), `rec-tracker-test-${process.pid}-${n}`);
}

describe('RecommendationTracker', () => {
  let tracker;
  let dataPath;

  beforeEach(async () => {
    dataPath = makePath();
    fs.mkdirSync(dataPath, { recursive: true });
    const store = new DecisionOutcomeStore({ dataPath });
    await store.start();
    tracker = new RecommendationTracker({ decisionOutcomeStore: store, dataPath });
    await tracker.start();
  });

  afterEach(async () => {
    if (tracker) await tracker.destroy();
    try {
      fs.rmSync(dataPath, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
    tracker = null;
  });

  it('assigns a permanent id and tracks lifecycle', () => {
    const id = tracker.track({
      action: 'Test action',
      reason: 'Because',
      originatingAgent: 'Agent',
      expectedValue: 123,
    });
    expect(typeof id).toBe('string');

    tracker.recordDecision(id, 'approved');
    tracker.recordExecution(id, { status: 'completed', completedAt: Date.now() });
    tracker.recordOutcome(id, { type: 'successful', actual: 150 });

    const rec = tracker.getRecommendation(id);
    expect(rec.ownerDecision).toBe('approved');
    expect(rec.executionStatus).toBe('completed');
    expect(rec.observedOutcome.type).toBe('successful');
  });

  it('keeps source id separate from recommendation id', () => {
    const recId = tracker.track({ id: 'opportunity-42', action: 'Capture 42' });
    const rec = tracker.getRecommendation(recId);
    expect(rec.sourceId).toBe('opportunity-42');
    expect(rec.id).not.toBe('opportunity-42');
  });

  it('returns awaiting outcomes', () => {
    const id1 = tracker.track({ action: 'A' });
    const id2 = tracker.track({ action: 'B' });
    tracker.recordDecision(id1, 'approved');
    tracker.recordDecision(id2, 'rejected');
    const awaiting = tracker.getAwaitingOutcomes();
    expect(awaiting.length).toBe(1);
    expect(awaiting[0].action).toBe('A');
  });

  it('returns recent recommendations', () => {
    tracker.track({ action: 'Old', createdAt: Date.now() - 1000 });
    tracker.track({ action: 'New', createdAt: Date.now() });
    const recent = tracker.getRecentRecommendations(10, Date.now() - 500);
    expect(recent.length).toBe(1);
    expect(recent[0].action).toBe('New');
  });

  it('updates confidence', () => {
    const id = tracker.track({ action: 'A', confidence: 0.5 });
    tracker.updateConfidence(id, 0.7, 'manual review');
    const rec = tracker.getRecommendation(id);
    expect(rec.confidence).toBe(0.7);
    expect(rec.confidenceHistory.length).toBe(2);
  });
});
