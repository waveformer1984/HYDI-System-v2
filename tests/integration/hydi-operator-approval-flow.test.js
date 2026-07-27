'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const OperatorSession = require('../../src/hydi-v3/OperatorSession');

const silent = { log: () => {}, warn: () => {}, error: () => {} };

describe('HYDI operator approval flow', () => {
  let session;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-approval-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    session = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10 });
    await session.start();
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    session = null;
  });

  test('recommendation → explanation → approval → execution → audit', async () => {
    const recId = session.recommendationTracker.track({
      action: 'Publish safety report',
      expectedValue: 5000,
      confidence: 0.6,
      strategicObjective: 'operations',
    });

    const exec = await session.executionGateway.execute({
      type: 'update-markdown',
      recommendationId: recId,
      requestingAgent: 'ExecutiveOperatingSystem',
      params: { file: 'safety-report.md', content: 'Safety status update.' },
    });
    expect(exec.status).toBe('awaiting-approval');

    const explained = session.approvalCenter.explain(exec.id);
    expect(explained.ok).toBe(true);
    expect(explained.recommendation).toBeTruthy();
    expect(explained.whyItExists).toBeTruthy();
    expect(explained.evidence).toBeDefined();
    expect(explained.undoPath).toBeTruthy();
    expect(explained.auditConsequences).toBeTruthy();

    const approved = await session.approvalCenter.approve(exec.id);
    expect(approved.ok).toBe(true);

    const completed = session.executionGateway.getExecutionHistory({ status: 'completed' });
    expect(completed.length).toBeGreaterThan(0);
    expect(completed[0].id).toBe(exec.id);

    const audit = session.auditLedger.getEvents({ subjectId: exec.id });
    const categories = audit.map((e) => e.category);
    expect(categories).toContain('action-approved');
    expect(categories).toContain('action-executed');
  });
});
