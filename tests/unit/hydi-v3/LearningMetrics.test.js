'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const LearningMetrics = require('../../../src/hydi-v3/LearningMetrics');
const DecisionOutcomeStore = require('../../../src/hydi-v3/DecisionOutcomeStore');

let counter = 0;

function makePath() {
  const n = counter++;
  return path.join(os.tmpdir(), `lm-test-${process.pid}-${n}`);
}

describe('LearningMetrics', () => {
  let metrics;
  let store;
  let dataPath;

  beforeEach(async () => {
    dataPath = makePath();
    fs.mkdirSync(dataPath, { recursive: true });
    store = new DecisionOutcomeStore({ dataPath });
    await store.start();
    metrics = new LearningMetrics({ decisionOutcomeStore: store, dataPath });
    await metrics.start();
  });

  afterEach(async () => {
    if (metrics) await metrics.destroy();
    try {
      fs.rmSync(dataPath, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
    metrics = null;
  });

  it('returns baseline message when no data', () => {
    const summary = metrics.getLearningSummary(30 * 24 * 60 * 60 * 1000);
    expect(summary.hasBaseline).toBe(false);
    expect(summary.lines[0]).toContain('Learning system still building historical baseline');
  });

  it('computes prediction accuracy and success rate', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) {
      const id = store.recordRecommendation({ action: `Rec ${i}`, originatingAgent: 'Sales', createdAt: now, expectedValue: 100 });
      store.recordDecision(id, 'approved');
      store.recordOutcome(id, { type: i < 4 ? 'successful' : 'failed', actual: i < 4 ? 120 : 0, completedAt: now });
    }
    const dashboard = metrics.getDashboardData();
    expect(dashboard.predictionAccuracy).toBeCloseTo(0.8, 1);
    expect(dashboard.recommendationSuccessRate).toBe(0.8);
    expect(dashboard.total).toBe(5);
    expect(dashboard.successful).toBe(4);
    expect(dashboard.failed).toBe(1);
  });

  it('ranks top agents and lowest confidence areas', () => {
    const now = Date.now();
    const id1 = store.recordRecommendation({ action: 'A', originatingAgent: 'AgentA', strategicObjective: 'resonate', createdAt: now, expectedValue: 100, confidence: 0.9 });
    store.recordOutcome(id1, { type: 'successful', actual: 120, completedAt: now });
    const id2 = store.recordRecommendation({ action: 'B', originatingAgent: 'AgentB', strategicObjective: 'manufacturing', createdAt: now, expectedValue: 100, confidence: 0.4 });
    store.recordOutcome(id2, { type: 'failed', actual: 0, completedAt: now });

    const dashboard = metrics.getDashboardData();
    expect(dashboard.topAgents[0].agent).toBe('AgentA');
    expect(dashboard.lowestConfidenceAreas[0].area).toBe('manufacturing');
  });

  it('tracks confidence drift', () => {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) {
      const id = store.recordRecommendation({ action: `R${i}`, createdAt: now + i, confidence: 0.5 + i * 0.1, expectedValue: 100 });
      store.addConfidenceHistory(id, 0.5 + i * 0.1, 'calibrated');
    }
    const dashboard = metrics.getDashboardData();
    expect(typeof dashboard.confidenceDrift).toBe('number');
  });

  it('reports recent lessons and recommendation history', () => {
    const now = Date.now();
    const id = store.recordRecommendation({ action: 'Lesson test', createdAt: now, expectedValue: 100 });
    store.recordOutcome(id, { type: 'failed', actual: 0, completedAt: now, lesson: 'Do not do this' });
    const dashboard = metrics.getDashboardData();
    expect(dashboard.recentLessons.length).toBeGreaterThan(0);
    expect(dashboard.recommendationHistory.length).toBeGreaterThan(0);
  });
});
