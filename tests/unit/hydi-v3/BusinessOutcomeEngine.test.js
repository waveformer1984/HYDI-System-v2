'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const BusinessOutcomeEngine = require('../../../src/hydi-v3/BusinessOutcomeEngine');
const DecisionOutcomeStore = require('../../../src/hydi-v3/DecisionOutcomeStore');

let counter = 0;

function makePath() {
  const n = counter++;
  return path.join(os.tmpdir(), `boe-test-${process.pid}-${n}`);
}

describe('BusinessOutcomeEngine', () => {
  let engine;
  let store;
  let dataPath;

  beforeEach(async () => {
    dataPath = makePath();
    fs.mkdirSync(dataPath, { recursive: true });
    store = new DecisionOutcomeStore({ dataPath });
    await store.start();
    engine = new BusinessOutcomeEngine({ decisionOutcomeStore: store, dataPath });
    await engine.start();
  });

  afterEach(async () => {
    if (engine) await engine.destroy();
    try {
      fs.rmSync(dataPath, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
    engine = null;
  });

  it('classifies outcomes by value ratio', () => {
    expect(engine.classifyOutcome(100, 100)).toBe('successful');
    expect(engine.classifyOutcome(100, 80)).toBe('successful');
    expect(engine.classifyOutcome(100, 60)).toBe('partially successful');
    expect(engine.classifyOutcome(100, 20)).toBe('failed');
  });

  it('computes impacts', () => {
    const rec = { expectedValue: 100, expectedCompletion: 0, expectedStrategic: 1, expectedOperational: 1, createdAt: 0 };
    const observed = { value: 120, completedAt: 1000, strategic: 2, operational: 0 };
    const impacts = engine.computeImpacts(rec, observed);
    expect(impacts.revenue).toBe(20);
    expect(impacts.schedule).toBe(1000);
    expect(impacts.strategic).toBe(1);
    expect(impacts.operational).toBe(-1);
  });

  it('records an outcome and calibrates confidence', () => {
    const id = store.recordRecommendation({ action: 'Run campaign', confidence: 0.8, expectedValue: 100 });
    const result = engine.recordOutcome(id, { value: 120 });
    expect(result.observedOutcome.type).toBe('successful');
    expect(result.adjustedConfidence).toBeGreaterThan(0.8);
    expect(result.lesson).toContain('met expectation');
  });

  it('records failure and reduces confidence', () => {
    const id = store.recordRecommendation({ action: 'Ship release', confidence: 0.8, expectedValue: 100 });
    const result = engine.recordOutcome(id, { value: 0 });
    expect(result.observedOutcome.type).toBe('failed');
    expect(result.adjustedConfidence).toBeLessThan(0.8);
  });

  it('observes an action entry with recommendationId', () => {
    const id = store.recordRecommendation({ action: 'Email outreach', confidence: 0.7, expectedValue: 10 });
    const result = engine.observeAction({
      recommendationId: id,
      status: 'completed',
      completedAt: Date.now(),
    });
    expect(result.observedOutcome.type).toBe('successful');
  });

  it('ignores actions without recommendationId', () => {
    const result = engine.observeAction({ status: 'completed' });
    expect(result).toBeNull();
  });

  it('observes a workflow outcome', () => {
    const wf = { id: 'wf-1', title: 'Prototype', expectedValue: 50, type: 'research' };
    const result = engine.observeWorkflow(wf, 60);
    expect(result.observedOutcome.type).toBe('successful');
  });
});
