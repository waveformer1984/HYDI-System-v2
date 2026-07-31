'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const DecisionOutcomeStore = require('../../../src/hydi-v3/DecisionOutcomeStore');
const RecommendationTracker = require('../../../src/hydi-v3/RecommendationTracker');
const ConfidenceCalibration = require('../../../src/hydi-v3/ConfidenceCalibration');
const BusinessOutcomeEngine = require('../../../src/hydi-v3/BusinessOutcomeEngine');
const BusinessEventBus = require('../../../src/hydi-v3/BusinessEventBus');
const BusinessEvidenceEngine = require('../../../src/hydi-v3/BusinessEvidenceEngine');
const { RevenueSensor, JSONLedgerAdapter, CSVLedgerAdapter, MockRevenueAdapter } = require('../../../src/hydi-v3/RevenueSensor');

const logger = { log: () => {}, error: () => {} };

let tmpRoot;

beforeAll(async () => {
  tmpRoot = path.join(os.tmpdir(), `hydi-phase21-${Date.now()}`);
  await fs.mkdir(tmpRoot, { recursive: true });
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function buildEngines(subdir, policy = 'strict') {
  const dataPath = path.join(tmpRoot, subdir);
  await fs.mkdir(dataPath, { recursive: true });

  const store = new DecisionOutcomeStore({ dataPath, logger });
  await store.start();

  const tracker = new RecommendationTracker({ decisionOutcomeStore: store, logger });
  await tracker.start();

  const calibration = new ConfidenceCalibration({ policy });
  const outcomeEngine = new BusinessOutcomeEngine({
    decisionOutcomeStore: store,
    confidenceCalibration: calibration,
    recommendationTracker: tracker,
    dataPath,
    logger,
  });
  await outcomeEngine.start();

  const bus = new BusinessEventBus({ logger });
  const evidenceEngine = new BusinessEvidenceEngine({
    eventBus: bus,
    recommendationTracker: tracker,
    businessOutcomeEngine: outcomeEngine,
    logger,
  });
  await evidenceEngine.start();

  return { store, tracker, outcomeEngine, evidenceEngine, bus, calibration, dataPath };
}

async function makeApprovedRec(tracker, overrides = {}) {
  const recId = tracker.track({
    action: 'Generate revenue',
    expectedValue: 1000,
    expectedOutcome: '1000 USD revenue',
    strategicObjective: 'revenue',
    supportingSignals: ['revenue'],
    ...overrides,
  });
  tracker.recordDecision(recId, 'approved');
  return tracker.getRecommendation(recId);
}

describe('Measured Learning', () => {
  it('Git activity never changes monetary value', async () => {
    const { evidenceEngine, tracker } = await buildEngines('git-activity');
    const rec = await makeApprovedRec(tracker);
    const before = rec.confidence;

    evidenceEngine.addEvidence(rec.id, {
      source: 'git',
      type: 'CommitCreated',
      at: Date.now(),
      weight: 0.7,
      confidence: 0.9,
      relevance: 0.8,
      measurementType: 'activity',
      data: { value: 1 },
      tags: ['git'],
    });

    const result = evidenceEngine.evaluateRecommendation(rec.id);
    const after = tracker.getRecommendation(rec.id).confidence;

    expect(result.classification).toBe('Inconclusive');
    expect(result.hasMeasuredValue).toBe(false);
    expect(after).toBe(before);
  });

  it('Manual approval never invents revenue', async () => {
    const { evidenceEngine, tracker } = await buildEngines('manual-only');
    const rec = await makeApprovedRec(tracker);
    const before = rec.confidence;

    const result = evidenceEngine.submitManualReview(rec.id, 'Yes');
    const observed = tracker.getRecommendation(rec.id).observedOutcome;

    expect(result.outcomeType).toBe('successful');
    expect(result.hasMeasuredValue).toBe(false);
    expect(observed.measured).toBe(false);
    expect(observed.measurementType).toBe('qualitative');
    expect(observed.actual).toBe(null);
    expect(observed.impacts.revenue).toBe(null);
    expect(tracker.getRecommendation(rec.id).confidence).toBe(before);
  });

  it('JSON ledger updates confidence correctly', async () => {
    const { evidenceEngine, tracker, bus } = await buildEngines('json-ledger');
    const rec = await makeApprovedRec(tracker);
    const before = rec.confidence;

    const filePath = path.join(tmpRoot, 'json-ledger', 'revenue.json');
    await fs.writeFile(filePath, JSON.stringify([{ id: 'j1', amount: 950, currency: 'USD', date: '2026-07-26' }]));

    const sensor = new RevenueSensor({
      eventBus: bus,
      adapters: [new JSONLedgerAdapter({ path: filePath, idKey: 'id', amountKey: 'amount', currencyKey: 'currency', dateKey: 'date' })],
      logger,
    });
    await sensor.scan();

    console.log('DEBUG all evidence:', evidenceEngine.collector.evidence.map((e) => ({ id: e.id, source: e.source, measurementType: e.measurementType, value: e.data && e.data.value, tags: e.tags })));
    console.log('DEBUG rec:', { id: rec.id, createdAt: rec.createdAt, strategicObjective: rec.strategicObjective, supportingSignals: rec.supportingSignals });
    console.log('DEBUG getEvidence:', evidenceEngine.collector.getEvidence(rec.id, rec).map((e) => ({ id: e.id, source: e.source, measurementType: e.measurementType, value: e.data && e.data.value, tags: e.tags })));

    const result = evidenceEngine.evaluateRecommendation(rec.id);
    console.log('DEBUG result:', result);
    const observed = tracker.getRecommendation(rec.id).observedOutcome;

    expect(result.hasMeasuredValue).toBe(true);
    expect(result.observedValue).toBe(950);
    expect(observed.measured).toBe(true);
    expect(observed.measurementType).toBe('quantitative');
    expect(tracker.getRecommendation(rec.id).confidence).toBeGreaterThan(before);
  });

  it('CSV ledger updates confidence correctly', async () => {
    const { evidenceEngine, tracker, bus } = await buildEngines('csv-ledger');
    const rec = await makeApprovedRec(tracker);
    const before = rec.confidence;

    const filePath = path.join(tmpRoot, 'csv-ledger', 'revenue.csv');
    await fs.writeFile(filePath, 'id,amount,currency,date\n' + 'c1,950,USD,2026-07-26');

    const sensor = new RevenueSensor({
      eventBus: bus,
      adapters: [new CSVLedgerAdapter({ path: filePath })],
      logger,
    });
    await sensor.scan();

    const result = evidenceEngine.evaluateRecommendation(rec.id);
    expect(result.hasMeasuredValue).toBe(true);
    expect(result.observedValue).toBe(950);
    expect(tracker.getRecommendation(rec.id).confidence).toBeGreaterThan(before);
  });

  it('Mixed qualitative/quantitative evidence behaves according to policy', async () => {
    // Strict: measurement determines outcome type; manual does not overrule.
    const { evidenceEngine, tracker } = await buildEngines('mixed-strict', 'strict');
    const rec = await makeApprovedRec(tracker);

    evidenceEngine.submitManualReview(rec.id, 'Yes');
    evidenceEngine.addEvidence(rec.id, {
      source: 'financial',
      type: 'RevenueReceived',
      at: Date.now(),
      weight: 1.0,
      confidence: 0.95,
      relevance: 1.0,
      measurementType: 'quantitative',
      currency: 'USD',
      unit: 'USD',
      precision: 0.01,
      data: { value: 500, description: 'partial payment' },
      tags: ['financial', 'revenue', 'USD'],
    });

    const result = evidenceEngine.evaluateRecommendation(rec.id);
    const observed = tracker.getRecommendation(rec.id).observedOutcome;

    expect(result.observedValue).toBe(500);
    expect(observed.type).toBe('partially successful');
    expect(observed.measurementType).toBe('quantitative');
  });

  it('Unknown values remain unknown', async () => {
    const { evidenceEngine, tracker } = await buildEngines('unknown-value');
    const rec = await makeApprovedRec(tracker);

    evidenceEngine.addEvidence(rec.id, {
      source: 'financial',
      type: 'RevenueReceived',
      at: Date.now(),
      weight: 1.0,
      confidence: 0.95,
      relevance: 1.0,
      measurementType: 'quantitative',
      data: { value: undefined },
      tags: ['financial', 'revenue'],
    });

    const result = evidenceEngine.evaluateRecommendation(rec.id);
    expect(result.observedValue).toBe(null);
    expect(result.hasMeasuredValue).toBe(false);
  });

  it('Zero values remain zero', async () => {
    const { evidenceEngine, tracker } = await buildEngines('zero-value');
    const rec = await makeApprovedRec(tracker);

    evidenceEngine.addEvidence(rec.id, {
      source: 'financial',
      type: 'RevenueReceived',
      at: Date.now(),
      weight: 1.0,
      confidence: 0.95,
      relevance: 1.0,
      measurementType: 'quantitative',
      data: { value: 0 },
      tags: ['financial', 'revenue'],
    });

    const result = evidenceEngine.evaluateRecommendation(rec.id);
    const observed = tracker.getRecommendation(rec.id).observedOutcome;

    expect(result.observedValue).toBe(0);
    expect(observed.actual).toBe(0);
    expect(observed.impacts.revenue).toBe(-1000);
  });

  it('Duplicate measurements are ignored', async () => {
    const { evidenceEngine, tracker, bus } = await buildEngines('duplicate');
    const rec = await makeApprovedRec(tracker);

    const sensor = new RevenueSensor({
      eventBus: bus,
      adapters: [new MockRevenueAdapter({ transactions: [{ id: 'd1', amount: 900, currency: 'USD', at: Date.now() }] })],
      logger,
    });

    await sensor.scan();
    await sensor.scan();

    const evidence = evidenceEngine.collector.getEvidence(rec.id, rec);
    const financial = evidence.filter((e) => e.source === 'financial');
    expect(financial.length).toBe(1);

    const result1 = evidenceEngine.evaluateRecommendation(rec.id);
    const confidence1 = tracker.getRecommendation(rec.id).confidence;
    const result2 = evidenceEngine.evaluateRecommendation(rec.id);

    expect(result2.classification).toBe(result1.classification);
    expect(tracker.getRecommendation(rec.id).confidence).toBe(confidence1);
  });

  it('Corrupt ledgers are archived safely', async () => {
    const bus = new BusinessEventBus({ logger });
    const filePath = path.join(tmpRoot, 'corrupt-ledger.json');
    await fs.writeFile(filePath, 'this is not json');

    const sensor = new RevenueSensor({
      eventBus: bus,
      adapters: [new JSONLedgerAdapter({ path: filePath })],
      logger,
    });

    const corruptPromise = new Promise((resolve) => sensor.once('ledger-corrupt', resolve));
    await sensor.scan();
    const event = await corruptPromise;

    expect(event.error).toContain('JSON');
    const files = await fs.readdir(tmpRoot);
    expect(files.some((f) => f.startsWith('corrupt-ledger.json.corrupt.'))).toBe(true);
  });

  it('Restart preserves learning state', async () => {
    const dataPath = path.join(tmpRoot, 'restart');
    await fs.mkdir(dataPath, { recursive: true });

    const store1 = new DecisionOutcomeStore({ dataPath, logger });
    await store1.start();
    const tracker1 = new RecommendationTracker({ decisionOutcomeStore: store1, logger });
    await tracker1.start();
    const recId = tracker1.track({ action: 'Generate revenue', expectedValue: 1000, expectedOutcome: '1000 USD', strategicObjective: 'revenue' });
    tracker1.recordDecision(recId, 'approved');
    await tracker1.flush();
    await store1.destroy();

    const store2 = new DecisionOutcomeStore({ dataPath, logger });
    await store2.start();
    const recovered = store2.getRecommendation(recId);
    expect(recovered.action).toBe('Generate revenue');
    expect(recovered.ownerDecision).toBe('approved');
    await store2.destroy();
  });

  it('All evidence remains traceable through the audit ledger', async () => {
    const { evidenceEngine, tracker } = await buildEngines('audit');
    const rec = await makeApprovedRec(tracker);

    evidenceEngine.addEvidence(rec.id, {
      source: 'financial',
      type: 'RevenueReceived',
      at: Date.now(),
      weight: 1.0,
      confidence: 0.95,
      relevance: 1.0,
      measurementType: 'quantitative',
      data: { value: 1200 },
      tags: ['financial', 'revenue'],
    });

    evidenceEngine.evaluateRecommendation(rec.id);
    const observed = tracker.getRecommendation(rec.id).observedOutcome;

    expect(observed.provenance).toContain('evidence-evaluation:');
    expect(observed.provenance).toContain('financial');
  });
});
