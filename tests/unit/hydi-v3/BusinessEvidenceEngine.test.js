'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const DecisionOutcomeStore = require('../../../src/hydi-v3/DecisionOutcomeStore');
const RecommendationTracker = require('../../../src/hydi-v3/RecommendationTracker');
const ConfidenceCalibration = require('../../../src/hydi-v3/ConfidenceCalibration');
const BusinessOutcomeEngine = require('../../../src/hydi-v3/BusinessOutcomeEngine');
const BusinessEvidenceEngine = require('../../../src/hydi-v3/BusinessEvidenceEngine');

let counter = 0;

function makePath() {
  const n = counter++;
  return path.join(os.tmpdir(), `bee-test-${process.pid}-${n}`);
}

async function makeEngine() {
  const dataPath = makePath();
  fs.mkdirSync(dataPath, { recursive: true });
  const store = new DecisionOutcomeStore({ dataPath });
  await store.start();
  const tracker = new RecommendationTracker({ decisionOutcomeStore: store, dataPath });
  await tracker.start();
  const calibration = new ConfidenceCalibration({ policy: 'balanced' });
  const outcomeEngine = new BusinessOutcomeEngine({
    decisionOutcomeStore: store,
    confidenceCalibration: calibration,
    recommendationTracker: tracker,
    dataPath,
  });
  await outcomeEngine.start();
  const evidenceEngine = new BusinessEvidenceEngine({
    recommendationTracker: tracker,
    businessOutcomeEngine: outcomeEngine,
    dataPath,
    autoEvaluate: false,
  });
  await evidenceEngine.start();
  return { evidenceEngine, tracker, outcomeEngine, store, dataPath };
}

async function cleanup(eng) {
  await eng.evidenceEngine.destroy();
  await eng.outcomeEngine.destroy();
  try {
    fs.rmSync(eng.dataPath, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
}

describe('BusinessEvidenceEngine', () => {
  it('requests manual review for a recommendation', async () => {
    const eng = await makeEngine();
    const id = eng.tracker.track({ action: 'Increase outreach', expectedValue: 100 });
    const review = eng.evidenceEngine.requestManualReview(id);
    expect(review.question).toContain('Increase outreach');
    expect(review.options).toContain('Yes');
    await cleanup(eng);
  });

  it('records confirmed success from manual review without inventing a measured value', async () => {
    const eng = await makeEngine();
    const id = eng.tracker.track({ action: 'Ship release', confidence: 0.8, expectedValue: 100 });
    const before = eng.tracker.getRecommendation(id).confidence;
    const result = eng.evidenceEngine.submitManualReview(id, 'yes');
    expect(result.classification).toBe('Confirmed Success');
    const rec = eng.tracker.getRecommendation(id);
    expect(rec.confidence).toBe(before); // qualitative evidence does not move confidence
    expect(rec.observedOutcome.measured).toBe(false);
    expect(rec.observedOutcome.actual).toBeNull();
    await cleanup(eng);
  });

  it('records negative from manual review without inventing a measured value', async () => {
    const eng = await makeEngine();
    const id = eng.tracker.track({ action: 'Run campaign', confidence: 0.8, expectedValue: 100 });
    const before = eng.tracker.getRecommendation(id).confidence;
    const result = eng.evidenceEngine.submitManualReview(id, 'no');
    expect(result.classification).toBe('Negative');
    const rec = eng.tracker.getRecommendation(id);
    expect(rec.confidence).toBe(before); // qualitative evidence does not move confidence
    expect(rec.observedOutcome.measured).toBe(false);
    expect(rec.observedOutcome.actual).toBeNull();
    await cleanup(eng);
  });

  it('evaluates automatic evidence to confirmed success', async () => {
    const eng = await makeEngine();
    const id = eng.tracker.track({ action: 'Hire designer', expectedValue: 100, confidence: 0.7 });
    eng.evidenceEngine.addEvidence(id, { source: 'git', weight: 1, confidence: 1, relevance: 1, measurementType: 'quantitative', data: { value: 120 }, tags: [] });
    const result = eng.evidenceEngine.evaluateRecommendation(id);
    expect(result.classification).toBe('Confirmed Success');
    expect(eng.tracker.getRecommendation(id).observedOutcome).not.toBeNull();
    await cleanup(eng);
  });

  it('does not record an outcome for insufficient evidence', async () => {
    const eng = await makeEngine();
    const id = eng.tracker.track({ action: 'Vague goal', expectedValue: 100 });
    const result = eng.evidenceEngine.evaluateRecommendation(id);
    expect(result.classification).toBe('Insufficient Evidence');
    expect(eng.tracker.getRecommendation(id).observedOutcome).toBeNull();
    await cleanup(eng);
  });

  it('surfaces recommendations lacking evidence', async () => {
    const eng = await makeEngine();
    const id1 = eng.tracker.track({ action: 'One', expectedValue: 100 });
    const id2 = eng.tracker.track({ action: 'Two', expectedValue: 100 });
    eng.evidenceEngine.addEvidence(id1, { source: 'git', weight: 1, confidence: 1, relevance: 1, data: { value: 1 } });
    const lacking = eng.evidenceEngine.getRecommendationsLackingEvidence(10000);
    expect(lacking.some((r) => r.id === id2)).toBe(true);
    expect(lacking.some((r) => r.id === id1)).toBe(false);
    await cleanup(eng);
  });

  it('returns dashboard data', async () => {
    const eng = await makeEngine();
    eng.tracker.track({ action: 'KPI test', expectedValue: 100 });
    const dashboard = eng.evidenceEngine.getDashboardData();
    expect(typeof dashboard.evidenceQuality).toBe('number');
    expect(dashboard.topKPIs).toBeDefined();
    await cleanup(eng);
  });
});
