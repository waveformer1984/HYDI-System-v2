#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

/**
 * Phase 23 operational end-to-end demonstration.
 *
 * Simulates a ProtoForge morning — git activity, file changes, a printer
 * production delay, a customer payment, and a prior measured outcome — then
 * asks the live HYDI executive stack for a morning briefing. Every number and
 * string in the printed summary comes from the real `ExecutiveOperatingSystem`,
 * `TrustEngine`, `BusinessEvidenceEngine`, `LearningMetrics`, and `AuditLedger`;
 * nothing below invents intelligence. Inputs explicitly marked as SIMULATED.
 *
 * Usage:
 *   node scripts/hydi-operational-demo.js
 *   npm run hydi-operational-demo
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../src/hydi-v3/OperatorSession');

const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-operational-demo-${Date.now()}`);
  await fs.mkdir(dataPath, { recursive: true });

  const session = new OperatorSession({
    dataPath,
    ownerPriority: 'manufacturing',
    logger: SILENT,
  });
  await session.start();

  // Seed a previously measured outcome so the briefing has real learning to show.
  // This is a controlled, simulated historical measurement, not a fabricated
  // business result.
  const priorRecId = session.recommendationTracker.track({
    action: 'Move critical prototype job forward after a production delay',
    reason: 'A prior printer delay required re-prioritisation of prototype work.',
    expectedValue: 1000,
    expectedOutcome: 'Delivery reliability improves for prototype customers.',
    tags: ['manufacturing', 'printer', 'prototype'],
  });
  session.businessOutcomeEngine.recordOutcome(priorRecId, {
    value: 300,
    measured: true,
    type: 'successful',
    lesson: 'Previous production-delay interventions improved delivery reliability by measured evidence.',
  });

  // Seed the highest-priority open action so the briefing has something real to rank.
  session.memory.put({
    id: 'opp_prototype-mk4',
    type: 'opportunity',
    name: 'Move critical prototype job forward',
    value: 12000,
    effort: 2,
    risk: 0.3,
    status: 'open',
    tags: ['manufacturing', 'printer', 'prototype', 'delivery'],
  });

  // SIMULATED morning inputs
  session.eventBus.emit('CommitCreated', {
    project: 'ProtoForge',
    message: 'Add housing STL and MK4 manufacturing gcode',
  }, 'GitSensor');
  session.eventBus.emit('FileCreated', {
    project: 'ProtoForge',
    relPath: 'designs/prototype-housing.stl',
  }, 'FilesystemMonitor');
  session.eventBus.emit('FileModified', {
    project: 'ProtoForge',
    relPath: 'src/manufacturing/gcode-mk4.js',
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

  // Ask the real executive stack for the morning briefing.
  const briefing = session.briefing();
  const equipmentRisk = briefing.risks.find((r) => r.category === 'equipment' && r.severity === 'high');
  const topRec = briefing.recommendations[0];

  const lines = [
    'MORNING EXECUTIVE BRIEFING',
    '',
    'Good morning.',
    '',
  ];

  if (equipmentRisk) {
    lines.push(`Priority: Production delay detected on ${equipmentRisk.name}.`);
    lines.push(`Impact: ${equipmentRisk.detail}`);
  } else {
    lines.push('Priority: No critical production risks detected.');
  }

  if (topRec) {
    lines.push(
      '',
      `Recommended action: ${topRec.action}.`,
      `Reason: ${topRec.reason}`,
      `Confidence: ${typeof topRec.confidence === 'number' ? topRec.confidence.toFixed(2) : topRec.confidence || 'unknown'}`,
      `Evidence: ${topRec.provenance && topRec.provenance.sources && topRec.provenance.sources.length
        ? topRec.provenance.sources.join(', ')
        : 'No sources recorded.'}`,
    );
  } else {
    lines.push('', 'Recommended action: No recommendations available.');
  }

  const revenue = briefing.measuredLearning ? briefing.measuredLearning.revenue : 0;
  const client = session.memory.get('client_acme-corp');
  lines.push(
    '',
    `Revenue update: $${revenue} received from ${client ? client.name : 'customer'} account.`,
  );

  const metrics = session.learningMetrics.computeMetrics({});
  const latestLesson = metrics.recentLessons && metrics.recentLessons[0]
    ? metrics.recentLessons[0].lesson
    : null;
  lines.push(
    '',
    `Learning: ${latestLesson || 'Awaiting measured outcomes.'}`,
  );

  console.log(lines.join('\n'));

  await session.destroy();
  await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
