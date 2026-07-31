#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const HYDIContinuousRuntime = require('../src/hydi-v3/HYDIContinuousRuntime');

const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

function say(who, text) {
  console.log(`${who}: ${text}`);
}

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-operator-demo-${Date.now()}`);
  await fs.mkdir(dataPath, { recursive: true });

  const runtime = new HYDIContinuousRuntime({ dataPath, ownerPriority: 'resonate', logger: SILENT });
  try {
    await runtime.start();

    say('Operator', 'Good morning, HYDI.');
    const greeting = await runtime.session.ask('good morning');
    say('HEIDI', greeting.text.split('\n')[0]);
    say('HEIDI', 'ProtoForge has new activity today.');

    say('Operator', 'What changed?');
    runtime.processEvent('CommitCreated', { project: 'ProtoForge', message: 'Add operator demo flow' }, 'GitSensor');
    runtime.processEvent('FileModified', { project: 'ProtoForge', relPath: 'src/hydi-v3/scripts.md' }, 'FilesystemMonitor');
    runtime.processEvent('PrinterOffline', { equipmentId: 'printer-mk4', equipmentName: 'Printer MK4' }, 'PrinterSensor');
    runtime.processEvent('RevenueReceived', { amount: 9500, currency: 'USD', customer: 'Acme Corp' }, 'RevenueSensor');
    const changes = await runtime.session.ask('what changed');
    say('HEIDI', changes.text);

    const briefing = runtime.session.executiveOS.morningBriefing();
    const topRec = briefing.recommendations.find((r) => r.recommendationId) || briefing.recommendations[0];
    if (!topRec || !topRec.recommendationId) {
      say('HEIDI', 'No recommendation available today.');
      return;
    }

    const beforeConfidence = runtime.session.recommendationTracker.getRecommendation(topRec.recommendationId).confidence;
    const exec = await runtime.session.executionGateway.execute({
      type: 'update-markdown',
      adapter: 'documentation',
      requestingAgent: 'ExecutiveOperatingSystem',
      recommendationId: topRec.recommendationId,
      params: { file: 'operator-demo-update.md', content: 'Operator demo continuity update.' },
    });

    say('HEIDI', `Production risk increased due to printer downtime. I recommend: ${topRec.action} (confidence ${(topRec.confidence * 100).toFixed(0)}%).`);
    say('Operator', 'Approve recommendation.');
    const approved = await runtime.session.approvalCenter.approve(exec.id);
    say('HEIDI', `Approved. Action ${exec.id} recorded as ${approved.result ? approved.result.status : 'completed'}.`);

    say('Operator', 'Record outcome.');
    const outcome = runtime.session.businessOutcomeEngine.recordOutcome(topRec.recommendationId, {
      value: 1200,
      measured: true,
      provenance: 'operator-measurement',
      type: 'successful',
      lesson: 'Customer payment and recovery actions produced measurable value.',
    });
    const afterRec = runtime.session.recommendationTracker.getRecommendation(topRec.recommendationId);
    const afterConfidence = afterRec.confidence;
    say('HEIDI', `Measured improvement recorded. Confidence adjusted from ${(beforeConfidence * 100).toFixed(0)}% to ${(afterConfidence * 100).toFixed(0)}% (delta ${outcome.confidenceDelta.toFixed(4)}).`);

    say('Operator', 'Memory review.');
    const memory = await runtime.session.ask('learning');
    say('HEIDI', memory.text);
  } finally {
    await runtime.shutdown().catch(() => {});
    await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
