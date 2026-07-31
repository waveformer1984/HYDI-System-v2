'use strict';

/**
 * Phase 23B: a real ProtoForge morning — end-to-end executive simulation.
 *
 * This test boots HYDI through the single canonical entry point
 * (`HYDIOperationalBoot.boot()`), feeds it the four real signal families a
 * production day would produce, and verifies the entire closed loop:
 *
 *   signal → interpretation → recommendation → approval → execution → audit → evidence
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { boot } = require('../../src/hydi-v3/HYDIOperationalBoot');

const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

describe('HYDI morning executive simulation', () => {
  let dataPath;
  let session;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-morning-sim-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('a ProtoForge day produces a closed executive loop', async () => {
    const report = await boot({
      dataPath,
      ownerPriority: 'manufacturing',
      logger: SILENT,
    });
    expect(report.status).toBe('ready');
    session = report.session;

    // Business context: an active prototype with a deadline that has already
    // passed so the risk pipeline has something concrete to rank.
    session.memory.put({
      id: 'project_proto_housing_v3',
      type: 'project',
      name: 'ProtoForge housing prototype V3',
      status: 'active',
      priority: 'high',
      payload: { deadline: Date.now() - 1000 },
    });

    // 1. Morning signals
    session.eventBus.emit('CommitCreated', {
      project: 'ProtoForge',
      message: 'Add gcode and toolpaths for housing prototype V3',
    }, 'GitSensor');

    session.eventBus.emit('FileModified', {
      project: 'ProtoForge',
      relPath: 'designs/prototype-housing-v3.stl',
    }, 'FilesystemMonitor');

    session.eventBus.emit('PrinterOffline', {
      equipmentId: 'printer-mk4',
      equipmentName: 'Printer MK4',
    }, 'PrinterSensor');

    session.eventBus.emit('RevenueReceived', {
      amount: 9500,
      currency: 'USD',
      customer: 'Acme Corp',
    }, 'RevenueSensor');

    // 2. Executive briefing
    const briefing = session.briefing();
    expect(briefing).toBeTruthy();
    expect(Array.isArray(briefing.risks)).toBe(true);
    expect(Array.isArray(briefing.recommendations)).toBe(true);

    // 3. Prioritized risks
    const equipmentRisk = briefing.risks.find((r) => r.category === 'equipment');
    const deadlineRisk = briefing.risks.find((r) => r.category === 'deadline');
    expect(equipmentRisk || deadlineRisk).toBeTruthy();

    // 4. Recommended action with confidence and evidence
    const rec = briefing.recommendations.find((r) => r.recommendationId) || briefing.recommendations[0];
    expect(rec).toBeTruthy();
    expect(typeof rec.recommendationId).toBe('string');
    expect(typeof rec.confidence).toBe('number');
    expect(rec.provenance).toBeTruthy();
    expect(Array.isArray(rec.provenance.sources)).toBe(true);

    // 5. Approval request: route a real action through the gateway.
    const action = {
      type: 'update-markdown',
      adapter: 'documentation',
      params: {
        file: 'morning-response.md',
        note: `Address: ${rec.action}`,
      },
      recommendationId: rec.recommendationId,
      requestingAgent: 'ExecutiveOperatingSystem',
    };
    const execResult = await session.executionGateway.execute(action);
    expect(execResult.status).toBe('awaiting-approval');

    // 6. Audit record
    const audit = session.executionGateway.getAuditTrail({ category: 'action-awaiting-approval' });
    expect(audit.some((record) => record.subjectId === execResult.id)).toBe(true);
    expect(session.executionGateway.verifyAuditChain().ok).toBe(true);

    // 7. Evidence on file for the recommendation
    const evidenceSummary = session.evidenceEngine.getEvidenceSummary(rec.recommendationId);
    expect(evidenceSummary).toBeTruthy();

    // 8. Learning outcome placeholder — no measured outcome yet
    const tracked = session.recommendationTracker.getRecommendation(rec.recommendationId);
    expect(tracked.observedOutcome).toBeFalsy();
    const evaluation = session.evidenceEngine.evaluateRecommendation(rec.recommendationId);
    expect(evaluation).toBeTruthy();
    expect(evaluation.outcomeType || null).toBeNull();
  });
});
