'use strict';

/**
 * Phase 24: live operation failure tests.
 *
 * These tests exercise failure modes that only appear once real sensors are
 * active: a sensor going offline, an unknown runtime event, a non-measurable
 * evidence item, a corrupt audit ledger, and a restart that must preserve
 * history.
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { boot } = require('../../src/hydi-v3/HYDIOperationalBoot');
const SignalCoverage = require('../../src/hydi-v3/SignalCoverage');

const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

describe('HYDI live operation failures', () => {
  let dataPath;
  let session;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-live-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('sensor disconnected: printer offline is detected as an equipment risk', async () => {
    const report = await boot({
      dataPath,
      simulateManufacturing: true,
      printer: { autoRun: false },
      logger: SILENT,
    });
    expect(report.status).toBe('ready');
    session = report.session;
    expect(session.sensors.some((s) => s.constructor.name === 'PrinterSensor')).toBe(true);

    session.printerSensor.simulateEvent('PrinterOffline');
    const equipment = session.memory.find({ type: 'equipment' });
    const offline = equipment.find((e) => e.status === 'offline');
    expect(offline).toBeTruthy();

    const risks = session.executiveOS.risks();
    expect(risks.some((r) => r.category === 'equipment' && r.severity === 'high')).toBe(true);
  });

  test('unknown event emitted: SignalCoverage records it and the bus does not crash', async () => {
    const report = await boot({ dataPath, simulateManufacturing: true, printer: { autoRun: false }, logger: SILENT });
    expect(report.status).toBe('ready');
    session = report.session;

    expect(() => session.eventBus.emit('UnknownLiveEvent', { source: 'chaos' }, 'test')).not.toThrow();
    const coverage = SignalCoverage.audit({ registry: session.eventBus.registry });
    expect(coverage.unknown).toContain('UnknownLiveEvent');
  });

  test('bad measurement: non-quantitative evidence does not move learning confidence', async () => {
    const report = await boot({ dataPath, logger: SILENT });
    expect(report.status).toBe('ready');
    session = report.session;

    const recId = session.recommendationTracker.track({
      action: 'Test delivery optimisation',
      reason: 'No measured baseline exists yet.',
      confidence: 0.5,
    });

    const before = session.recommendationTracker.getRecommendation(recId).confidence;

    session.evidenceEngine.addEvidence(recId, {
      source: 'manual',
      type: 'gut-feeling',
      measurementType: 'qualitative',
      data: { note: 'Sounds good' },
      relevance: 0.5,
      weight: 0.5,
      confidence: 0.5,
      provenance: 'manual-test',
      tags: ['manual'],
    });

    const after = session.recommendationTracker.getRecommendation(recId).confidence;
    expect(after).toBe(before);
  });

  test('audit corruption: boot reports failure and verification is broken', async () => {
    const tampered = {
      version: 1,
      updatedAt: Date.now(),
      records: [{
        id: 'tampered-1',
        at: Date.now(),
        category: 'test',
        actor: 'test',
        subjectId: 'x',
        payload: { note: 'corrupt' },
        previousHash: null,
        hash: 'invalid-hash',
      }],
    };
    await fs.writeFile(path.join(dataPath, 'audit-ledger.json'), JSON.stringify(tampered), 'utf8');
    const report = await boot({ dataPath, logger: SILENT });
    expect(report.status).toBe('failed');
    if (report.session) {
      session = report.session;
      const verify = session.auditLedger.verify();
      expect(verify.ok).toBe(false);
    }
  });

  test('restart: recommendation history is preserved across sessions', async () => {
    const first = await boot({ dataPath, simulateManufacturing: true, printer: { autoRun: false }, logger: SILENT });
    expect(first.status).toBe('ready');
    session = first.session;
    session.recommendationTracker.track({ action: 'Persist across restart', reason: 'Phase 24 test' });
    await session.destroy();
    session = null;

    const second = await boot({ dataPath, simulateManufacturing: true, printer: { autoRun: false }, logger: SILENT });
    expect(second.status).toBe('ready');
    session = second.session;
    const recent = session.recommendationTracker.getRecentRecommendations(10);
    expect(recent.some((r) => r.action === 'Persist across restart')).toBe(true);
  });
});
