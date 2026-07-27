'use strict';

/**
 * Phase 23 production failure-mode tests.
 *
 * Each test intentionally breaks one operational assumption and verifies that
 * HYDI degrades honestly: it keeps running, it reports the problem, it does not
 * fabricate confidence, and it never executes or loses audit records.
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../../src/hydi-v3/OperatorSession');
const SignalCoverage = require('../../src/hydi-v3/SignalCoverage');

const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

describe('HYDI production failure modes', () => {
  let dataPath;
  let session;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-production-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('missing sensor: HYDI boots with no sensors and remains healthy', async () => {
    session = new OperatorSession({ dataPath, logger: SILENT });
    await session.start();
    const health = session.healthCheck();
    expect(health.ok).toBe(true);
    expect(session.sensors.length).toBe(0);
  });

  test('unknown event: SignalCoverage detects it and the bus does not crash', async () => {
    session = new OperatorSession({ dataPath, logger: SILENT });
    await session.start();
    expect(() => session.eventBus.emit('TotallyUnrecognizedEventType', { foo: 'bar' }, 'test')).not.toThrow();
    const coverage = SignalCoverage.audit({ registry: session.eventBus.registry });
    expect(coverage.unknown).toContain('TotallyUnrecognizedEventType');
    const audit = session.auditLedger.getEvents({ category: 'unknown-event' });
    expect(audit.length).toBeGreaterThan(0);
  });

  test('bad evidence: non-numeric evidence does not move learning confidence', async () => {
    session = new OperatorSession({ dataPath, logger: SILENT });
    await session.start();
    const recId = session.recommendationTracker.track({
      action: 'Untested delivery optimisation',
      reason: 'No measured baseline exists yet.',
      confidence: 0.5,
    });

    session.evidenceEngine.addEvidence(recId, {
      source: 'manual',
      type: 'gut-feeling',
      at: Date.now(),
      provenance: 'simulation',
      relevance: 0.5,
      weight: 0.5,
      confidence: 0.5,
      measurementType: 'qualitative',
      data: { note: 'Sounds good' },
      tags: ['manual'],
    });

    const before = session.recommendationTracker.getRecommendation(recId).confidence;
    const result = session.evidenceEngine.evaluateRecommendation(recId);
    const after = session.recommendationTracker.getRecommendation(recId).confidence;

    expect(result.hasMeasuredValue).toBeFalsy();
    expect(after).toBe(before);
  });

  test('dry run: no mutation occurs and the result is explicitly simulated', async () => {
    session = new OperatorSession({ dataPath, logger: SILENT });
    await session.start();
    const targetFile = path.join(dataPath, 'dry-run-test-report.md');
    const action = {
      type: 'create-report',
      adapter: 'documentation',
      params: { file: 'dry-run-test-report.md', content: 'should not appear' },
    };
    const result = await session.executionGateway.execute(action, { simulate: true });
    expect(result.status).toBe('completed');
    expect(result.result.simulated).toBe(true);
    await expect(fs.access(targetFile)).rejects.toBeTruthy();
  });

  test('corrupt memory: BusinessMemory archives corruption and restarts empty', async () => {
    await fs.writeFile(path.join(dataPath, 'business-memory.json'), '{ not valid json', 'utf8');
    session = new OperatorSession({ dataPath, logger: SILENT });
    await expect(session.start()).resolves.toBeTruthy();
    expect(session.memory.getStatus().total).toBe(0);
    const files = await fs.readdir(dataPath);
    expect(files.some((f) => f.startsWith('business-memory.json.corrupt.'))).toBe(true);
  });

  test('audit: every executed action has a chained trail', async () => {
    session = new OperatorSession({ dataPath, logger: SILENT });
    await session.start();
    const action = {
      type: 'create-report',
      adapter: 'documentation',
      params: { file: 'audit-test-report.md', content: 'audit trail sample' },
    };
    const result = await session.executionGateway.execute(action);
    expect(result.status).toBe('completed');

    const trail = session.executionGateway.getAuditTrail({ category: 'action-executed' });
    expect(trail.length).toBeGreaterThan(0);
    expect(session.executionGateway.verifyAuditChain().ok).toBe(true);
  });
});
