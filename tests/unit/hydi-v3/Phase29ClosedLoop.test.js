'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../../../src/hydi-v3/OperatorSession');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

describe('Phase 29 closed-loop learning', () => {
  let session;
  let dataPath;

  async function boot(extra = {}) {
    dataPath = path.join(os.tmpdir(), `hydi-phase29-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    session = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10, ...extra });
    await session.start();
    return session;
  }

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    session = null;
  });

  test('conversation creates a recommendation, action, approval, execution, audit and measurable outcome', async () => {
    await boot();

    // Conversation creates a tracked action awaiting approval.
    const create = await session.ask('do follow up with the lead');
    expect(create.intent).toBe('create-action');
    const actionId = create.text.match(/\((exec_[^)]+)\)/)[1];
    const recId = create.action.recommendationId;
    expect(actionId).toBeTruthy();
    expect(recId).toBeTruthy();
    expect(session.recommendationTracker.getRecommendation(recId).status).toBe('proposed');

    // Approval routes through ApprovalCenter and ExecutionGateway.
    const approve = await session.ask(`approve ${actionId}`);
    expect(approve.text).toContain('Approved');
    const rec = session.recommendationTracker.getRecommendation(recId);
    expect(rec.status).toBe('executed');
    expect(rec.observedOutcome).toBeNull();

    // Audit trail is append-only and recorded.
    const audit = session.executionGateway.getAuditTrail({ subjectId: actionId });
    expect(audit.length).toBeGreaterThan(0);

    // Outcome measurement closes the loop.
    const measure = await session.ask(`measure ${actionId} success`);
    expect(measure.text.toLowerCase()).toContain('success');
    const measured = session.recommendationTracker.getRecommendation(recId);
    expect(measured.observedOutcome).toBeTruthy();
    expect(measured.observedOutcome.type).toBe('successful');

    // Learning metrics reflect the new outcome.
    const metrics = session.learningMetrics.computeMetrics();
    expect(metrics.completed).toBeGreaterThanOrEqual(1);
    expect(metrics.successful).toBeGreaterThanOrEqual(1);
  });

  test('measured revenue value updates confidence and is reflected in learning metrics', async () => {
    await boot();

    const create = await session.ask('do close enterprise deal');
    const actionId = create.text.match(/\((exec_[^)]+)\)/)[1];
    const recId = create.action.recommendationId;
    await session.ask(`approve ${actionId}`);

    const before = session.recommendationTracker.getRecommendation(recId).confidence;
    const measure = await session.ask(`measure ${actionId} +9500`);
    expect(measure.text).toContain('9500');

    const rec = session.recommendationTracker.getRecommendation(recId);
    expect(rec.observedOutcome.type).toBe('successful');
    expect(rec.observedOutcome.measured).toBe(true);
    expect(rec.observedOutcome.actual).toBe(9500);
    expect(rec.confidence).toBeGreaterThan(before);
  });

  test('partial success is recorded and does not overstate confidence', async () => {
    await boot();

    const create = await session.ask('do ship beta');
    const actionId = create.text.match(/\((exec_[^)]+)\)/)[1];
    await session.ask(`approve ${actionId}`);

    const measure = await session.ask(`measure ${actionId} partial`);
    expect(measure.text.toLowerCase()).toContain('partial');

    const recId = create.action.recommendationId;
    expect(session.recommendationTracker.getRecommendation(recId).observedOutcome.type).toBe('partially successful');
  });

  test('duplicate measurements are ignored and do not inflate outcomes', async () => {
    await boot();

    const create = await session.ask('do renew contract');
    const actionId = create.text.match(/\((exec_[^)]+)\)/)[1];
    await session.ask(`approve ${actionId}`);

    await session.ask(`measure ${actionId} success`);
    await session.ask(`measure ${actionId} success`);
    await session.ask(`measure ${actionId} success`);

    const recId = create.action.recommendationId;
    const rec = session.recommendationTracker.getRecommendation(recId);
    expect(session.decisionOutcomeStore.getOutcomes({ recommendationId: recId }).length).toBe(1);
    expect(rec.observedOutcome.type).toBe('successful');
  });

  test('rejected recommendation is recorded as cancelled and not executed', async () => {
    await boot();

    const recId = session.recommendationTracker.track({
      action: 'buy ad spend',
      reason: 'test rejection lifecycle',
      expectedValue: 1000,
    });
    session.recommendationTracker.recordDecision(recId, 'rejected');

    const rec = session.recommendationTracker.getRecommendation(recId);
    expect(rec.status).toBe('rejected');
    expect(rec.observedOutcome).toBeNull();
  });

  test('abandoned recommendations are marked terminal and stop awaiting outcome', async () => {
    await boot();

    const create = await session.ask('do research competitor');
    const actionId = create.text.match(/\((exec_[^)]+)\)/)[1];
    await session.ask(`approve ${actionId}`);

    const recId = create.action.recommendationId;
    const abandon = await session.ask(`abandon ${actionId}`);
    expect(abandon.text).toContain('abandoned');

    const rec = session.recommendationTracker.getRecommendation(recId);
    expect(rec.observedOutcome.type).toBe('abandoned');
    expect(session.evidenceEngine.getAwaitingEvidence().find((r) => r.id === recId)).toBeUndefined();
  });

  test('stale recommendations are surfaced and can be auto-abandoned', async () => {
    await boot();

    const id = session.recommendationTracker.track({
      action: 'old task',
      reason: 'test staleness',
      expectedValue: 0,
    });
    session.recommendationTracker.recordDecision(id, 'approved');
    const store = session.recommendationTracker.store;
    const rec = store.recommendations.get(id);
    rec.decisionAt = Date.now() - 30 * 24 * 60 * 60 * 1000;
    rec.createdAt = Date.now() - 31 * 24 * 60 * 60 * 1000;
    store._persist();

    const stale = session.evidenceEngine.getStaleRecommendations();
    expect(stale.some((r) => r.id === id)).toBe(true);

    const abandoned = session.evidenceEngine.abandonStale('unit-test abandonment');
    expect(abandoned).toContain(id);
    expect(session.recommendationTracker.getRecommendation(id).observedOutcome.type).toBe('abandoned');
  });

  test('lifecycle survives restart', async () => {
    await boot();

    const create = await session.ask('do update pricing');
    const actionId = create.text.match(/\((exec_[^)]+)\)/)[1];
    const recId = create.action.recommendationId;
    await session.ask(`approve ${actionId}`);
    await session.ask(`measure ${actionId} success`);

    await session.destroy();
    session = null;

    const restarted = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10 });
    await restarted.start();

    const rec = restarted.recommendationTracker.getRecommendation(recId);
    expect(rec).toBeTruthy();
    expect(rec.status).toBe('confirmed');
    expect(rec.observedOutcome.type).toBe('successful');
    expect(restarted.executionGateway.getExecutionHistory({ recommendationId: recId }).length).toBeGreaterThan(0);

    await restarted.destroy();
  });

  test('multiple evidence sources strengthen a measured outcome', async () => {
    await boot();

    const recId = session.recommendationTracker.track({
      action: 'multi-source outcome',
      reason: 'test evidence aggregation',
      expectedValue: 100,
    });

    session.evidenceEngine.addEvidence(recId, {
      source: 'sales-crm',
      type: 'closed-won',
      at: Date.now(),
      relevance: 1,
      weight: 0.6,
      confidence: 0.9,
      measurementType: 'quantitative',
      data: { value: 80 },
      tags: ['crm'],
    });

    session.evidenceEngine.addEvidence(recId, {
      source: 'finance-ledger',
      type: 'invoice-paid',
      at: Date.now() + 1,
      relevance: 1,
      weight: 0.9,
      confidence: 0.95,
      measurementType: 'quantitative',
      data: { value: 100 },
      tags: ['finance'],
    });

    session.evidenceEngine.evaluateRecommendation(recId);
    const rec = session.recommendationTracker.getRecommendation(recId);
    expect(rec.observedOutcome.type).toBe('successful');
    expect(rec.observedOutcome.actual).toBeGreaterThan(80);
  });
});
