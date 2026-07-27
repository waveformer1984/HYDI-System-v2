#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */
/**
 * Deliverable 5 of the HYDI Operational Readiness Certification (Phase 22):
 * a showcase of HYDI acting as a real executive system for one realistic
 * scenario — active Resonate development nearing a customer-facing milestone.
 *
 * Every step below calls an existing subsystem directly (ExecutiveOperatingSystem
 * for analysis and recommendations, TrustEngine for reasoning/justification,
 * ExecutionGateway for safe, approval-gated execution, AuditLedger for the
 * trail). Nothing here recomputes what those subsystems already compute, and
 * nothing is fabricated: approval state, audit records, and evidence counts
 * are all the real return values of the real calls.
 *
 * Usage:
 *   node scripts/hydi-demo.js
 *   npm run hydi-demo
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../src/hydi-v3/OperatorSession');

const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-demo-${Date.now()}`);
  await fs.mkdir(dataPath, { recursive: true });
  const session = new OperatorSession({ dataPath, logger: SILENT });
  await session.start();

  // Seed one realistic scenario: active Resonate development, plus the
  // milestone it is building toward, expressed as a scored opportunity so
  // priority-ranking has something real to rank.
  session.eventBus.emit('CommitCreated', {
    project: 'Resonate',
    message: 'Feature complete: real-time waveform rendering for release build',
  }, 'GitSensor');

  session.memory.put({
    type: 'opportunity',
    name: 'Resonate milestone completion — customer release',
    value: 8000,
    effort: 2,
    status: 'open',
    tags: ['resonate'],
  });

  // 1. Analyze current business state.
  const briefing = session.briefing();

  // 2 & 3. Identify the highest-value action and why (ExecutiveOperatingSystem's
  // own recommendation ranking + TrustEngine's provenance — not recomputed here).
  const top = briefing.recommendations[0];
  const priority = {
    rank: 1,
    action: top.action,
    reason: top.reason,
    expectedOutcome: top.expectedOutcome,
    confidence: top.confidence,
    strategicObjective: top.provenance ? top.provenance.objective || null : null,
  };

  // 4 & 5. Create the recommended action and route it through ExecutionGateway.
  // 'update-markdown' is a review-required action class (ACTION_CLASSES in
  // ExecutionGateway.js), matching the spec's "prepare release checklist" example.
  const action = {
    type: 'update-markdown',
    adapter: 'documentation',
    params: {
      file: 'release-checklist.md',
      note: `Prepare release checklist: ${top.action}`,
    },
    requestingAgent: 'ExecutiveOperatingSystem',
    recommendationId: top.id || null,
  };
  const executionResult = await session.executionGateway.execute(action);

  // 6. Report the real approval requirement — never fabricate approval.
  const approval = {
    required: executionResult.status === 'awaiting-approval',
    status: executionResult.status,
    actionId: executionResult.id,
  };

  // 7. Real audit trail + chain verification.
  const auditTrail = session.executionGateway
    .getAuditTrail({ limit: 5 })
    .map((r) => ({ id: r.id, category: r.category, actor: r.actor, at: r.at }));
  const auditChainVerified = session.executionGateway.verifyAuditChain();

  // 9. What evidence will be needed later — the real (currently empty, since
  // nothing has executed yet) evidence summary, plus TrustEngine's own
  // justification text, which already answers "what would make this trustworthy".
  const evidenceSummary = top.id ? session.evidenceEngine.getEvidenceSummary(top.id) : { evidence: [] };
  const justification = session.executiveOS.trustEngine.formatJustification(top, session.executionGateway.adapters);

  const report = {
    generatedAt: new Date().toISOString(),
    priority,
    recommendedAction: action,
    approval,
    auditTrail,
    auditChainVerified,
    evidenceOnFile: evidenceSummary.evidence ? evidenceSummary.evidence.length : 0,
    justification,
  };

  console.log(JSON.stringify(report, null, 2));

  await session.destroy();
  await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
