'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const OperatorSession = require('../../src/hydi-v3/OperatorSession');
const HYDIContinuousRuntime = require('../../src/hydi-v3/HYDIContinuousRuntime');

const silent = { log: () => {}, warn: () => {}, error: () => {} };

describe('HYDI operator mistake handling', () => {
  let session;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-mistakes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    session = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10 });
    await session.start();
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    session = null;
  });

  test('approving a stale recommendation produces a warning', async () => {
    const recId = session.recommendationTracker.track({
      action: 'Stale action', expectedValue: 100, confidence: 0.5,
    });
    const exec = await session.executionGateway.execute({
      type: 'update-markdown', recommendationId: recId, requestingAgent: 'test', params: { file: 'x.md' },
    });
    const entry = session.executionGateway.pending.get(exec.id);
    entry.timestamp = Date.now() - 2 * 60 * 60 * 1000;

    const approved = await session.approvalCenter.approve(exec.id);
    expect(approved.warning).toBeTruthy();
    expect(approved.stale).toBe(true);
  });

  test('recording an outcome without measurement does not move learning', () => {
    const recId = session.recommendationTracker.track({
      action: 'Qualitative only', expectedValue: 100, confidence: 0.5,
    });
    const before = session.recommendationTracker.getRecommendation(recId).confidence;
    session.businessOutcomeEngine.recordOutcome(recId, {
      measured: false, type: 'successful', provenance: 'operator-qualitative', lesson: 'Looks good',
    });
    const after = session.recommendationTracker.getRecommendation(recId).confidence;
    expect(after).toBe(before);
  });

  test('conflicting measurement is blocked unless supersede is set', () => {
    const recId = session.recommendationTracker.track({
      action: 'Conflict check', expectedValue: 100, confidence: 0.5,
    });
    session.businessOutcomeEngine.recordOutcome(recId, {
      value: 120, measured: true, provenance: 'manual', type: 'successful',
    });
    const before = session.recommendationTracker.getRecommendation(recId).confidence;
    const second = session.businessOutcomeEngine.recordOutcome(recId, {
      value: 999, measured: true, provenance: 'manual', type: 'successful',
    });
    expect(second.duplicate).toBe(true);
    expect(session.recommendationTracker.getRecommendation(recId).confidence).toBe(before);
  });

  test('unsafe action is blocked by the gateway', async () => {
    await expect(session.executionGateway.execute({
      type: 'delete-file', requestingAgent: 'test', params: { file: 'important.md' },
    })).rejects.toThrow();

    const rejected = session.executionGateway.getExecutionHistory({ status: 'rejected' });
    expect(rejected.length).toBeGreaterThan(0);
  });

  test('shutdown and restart recovers cleanly', async () => {
    const runtime = new HYDIContinuousRuntime({ dataPath, logger: silent, healthIntervalMs: 60000 });
    await runtime.start();
    runtime.processEvent('CommitCreated', { project: 'ProtoForge', message: 'x' }, 'GitSensor');
    await runtime.shutdown();

    const second = new HYDIContinuousRuntime({ dataPath, logger: silent, healthIntervalMs: 60000 });
    await second.start();
    expect(second.getStatus().state).toBe('READY');
    expect(second.session.auditLedger.records.length).toBeGreaterThan(0);
    await second.shutdown();
  });
});
