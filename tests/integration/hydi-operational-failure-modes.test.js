'use strict';

/**
 * Deliverable 6 of the HYDI Operational Readiness Certification (Phase 22):
 * HYDI must fail safely. Each test here intentionally breaks one assumption
 * (a missing sensor, a corrupted store, an unregistered event, a rejected
 * approval, a simulated run, a recommendation with no evidence) and checks
 * that the system degrades honestly — no crash, no fabricated confidence,
 * no silent data loss — rather than that it recovers into some new behavior
 * invented for this test file.
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../../src/hydi-v3/OperatorSession');
const SignalCoverage = require('../../src/hydi-v3/SignalCoverage');

const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

describe('HYDI operational failure modes', () => {
  let dataPath;
  let session;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-failure-modes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('missing sensors: a default session with none configured still reports healthy', async () => {
    session = new OperatorSession({ dataPath, logger: SILENT });
    await session.start();
    const health = session.healthCheck();
    expect(health.ok).toBe(true);
    expect(session.sensors.length).toBe(0);
  });

  test('corrupted BusinessMemory persistence is archived and recovered from empty state, not crashed', async () => {
    await fs.writeFile(path.join(dataPath, 'business-memory.json'), '{ this is not valid json', 'utf8');
    session = new OperatorSession({ dataPath, logger: SILENT });
    await expect(session.start()).resolves.toBeTruthy();
    expect(session.memory.getStatus().total).toBe(0);
    const files = await fs.readdir(dataPath);
    expect(files.some((f) => f.startsWith('business-memory.json.corrupt.'))).toBe(true);
  });

  test('an unregistered event type does not crash the bus and is flagged unknown by SignalCoverage', async () => {
    session = new OperatorSession({ dataPath, logger: SILENT });
    await session.start();
    expect(() => session.eventBus.emit('TotallyUnrecognizedEventType', { foo: 'bar' }, 'test')).not.toThrow();
    const coverage = SignalCoverage.audit({ registry: session.eventBus.registry });
    expect(coverage.unknown).toContain('TotallyUnrecognizedEventType');
  });

  test('a rejected approval is recorded as rejected and audited; the action never runs', async () => {
    session = new OperatorSession({ dataPath, logger: SILENT });
    await session.start();
    const targetFile = path.join(dataPath, 'reject-test.md');
    const action = {
      type: 'update-markdown', // review-required
      adapter: 'documentation',
      params: { file: 'reject-test.md', note: 'should never land' },
    };
    const result = await session.executionGateway.execute(action);
    expect(result.status).toBe('awaiting-approval');

    const rejected = session.executionGateway.reject(result.id);
    expect(rejected.status).toBe('rejected');

    const trail = session.executionGateway.getAuditTrail({ subjectId: result.id });
    expect(trail.some((r) => r.category === 'action-rejected')).toBe(true);
    await expect(fs.access(targetFile)).rejects.toBeTruthy();
  });

  test('a simulated execution previews the adapter without mutating state or fabricating a real run', async () => {
    session = new OperatorSession({ dataPath, logger: SILENT });
    await session.start();
    const targetFile = path.join(dataPath, 'simulate-test-report.md');
    const action = {
      type: 'create-report', // autonomous — reaches _runEntry directly, unlike review-required types
      adapter: 'documentation',
      params: { file: 'simulate-test-report.md', content: 'draft content' },
    };
    const result = await session.executionGateway.execute(action, { simulate: true });
    expect(result.status).toBe('completed');
    expect(result.result.simulated).toBe(true);
    await expect(fs.access(targetFile)).rejects.toBeTruthy();
  });

  test('evaluating a recommendation with no attached evidence degrades gracefully, never fabricating confidence', async () => {
    session = new OperatorSession({ dataPath, logger: SILENT });
    await session.start();
    const recId = session.recommendationTracker.track({
      action: 'Untested lead follow-up',
      reason: 'No supporting evidence has been collected yet.',
      confidence: 0.5,
    });

    const summary = session.evidenceEngine.getEvidenceSummary(recId);
    expect(summary.evidence).toEqual([]);

    const evaluation = await session.evidenceEngine.evaluateRecommendation(recId);
    expect(evaluation).toBeTruthy();
    expect(evaluation.hasMeasuredValue).toBeFalsy();
  });
});
