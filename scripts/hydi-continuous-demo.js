#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const HYDIContinuousRuntime = require('../src/hydi-v3/HYDIContinuousRuntime');

const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-continuous-demo-${Date.now()}`);
  await fs.mkdir(dataPath, { recursive: true });

  const runtime = new HYDIContinuousRuntime({ dataPath, ownerPriority: 'resonate', logger: SILENT });
  try {
    await runtime.start();
    const status = runtime.getStatus();
    console.log(`Runtime: ${status.state}`);
    console.log(`Uptime: ${status.uptime}ms`);
    console.log('');

    console.log('Injecting real activity signals (SIMULATED sources for demonstration)...');
    runtime.processEvent('CommitCreated', { project: 'ProtoForge', message: 'Add continuous runtime wiring' }, 'GitSensor');
    runtime.processEvent('FileCreated', { project: 'ProtoForge', relPath: 'docs/phase25.md' }, 'FilesystemMonitor');
    runtime.processEvent('FileModified', { project: 'ProtoForge', relPath: 'src/hydi-v3/HYDIContinuousRuntime.js' }, 'FilesystemMonitor');
    runtime.processEvent('PrinterOffline', { equipmentId: 'printer-mk4', equipmentName: 'Printer MK4' }, 'PrinterSensor');
    runtime.processEvent('RevenueReceived', { amount: 9500, currency: 'USD', customer: 'Acme Corp' }, 'RevenueSensor');
    console.log(`Events processed: ${runtime.getStatus().eventsProcessed}`);
    console.log('');

    const briefing = runtime.session.executiveOS.morningBriefing();
    console.log('BRIEFING');
    console.log(briefing.executiveSummary);
    console.log('');

    const topRec = briefing.recommendations.find((r) => r.recommendationId) || briefing.recommendations[0];
    if (!topRec || !topRec.recommendationId) {
      console.log('No tracked recommendation produced; nothing to execute.');
      return;
    }
    console.log(`Recommendation: ${topRec.action} (confidence ${(topRec.confidence * 100).toFixed(0)}%)`);
    console.log(`Provenance sources: ${(topRec.provenance && topRec.provenance.sources.length) || 0}`);
    console.log('');

    const beforeConfidence = runtime.session.recommendationTracker.getRecommendation(topRec.recommendationId).confidence;
    const execRequest = await runtime.session.executionGateway.execute({
      type: 'update-markdown',
      adapter: 'documentation',
      requestingAgent: 'ExecutiveOperatingSystem',
      recommendationId: topRec.recommendationId,
      params: {
        file: 'phase25-continuity-update.md',
        content: 'Phase 25 continuity report generated from real executive signals.',
      },
    });
    console.log(`Execution status: ${execRequest.status} (id: ${execRequest.id})`);

    if (execRequest.status !== 'awaiting-approval') {
      console.log('Expected awaiting approval; aborting.');
      return;
    }

    const approved = await runtime.session.executionGateway.approve(execRequest.id);
    console.log(`Executed: ${approved.status} (${approved.approved ? 'approved' : 'not approved'})`);
    console.log('');

    const review = runtime.session.evidenceEngine.requestManualReview(topRec.recommendationId);
    console.log(`Measured outcome requested: ${review.question}`);
    const outcome = runtime.session.businessOutcomeEngine.recordOutcome(topRec.recommendationId, {
      value: 1200,
      measured: true,
      provenance: 'manual-measurement',
      type: 'successful',
    });
    const afterRec = runtime.session.recommendationTracker.getRecommendation(topRec.recommendationId);
    console.log(`Learning updated: confidence ${beforeConfidence.toFixed(4)} -> ${afterRec.confidence.toFixed(4)} (delta ${outcome.confidenceDelta.toFixed(4)})`);
    console.log('');

    const final = runtime.getStatus();
    console.log('FINAL STATUS');
    console.log(`Runtime: ${final.state}`);
    console.log(`Recommendations: ${final.recommendations}`);
    console.log(`Audit entries: ${final.auditEntries}`);
    console.log(`Learning updates: ${final.learningUpdates}`);
    console.log(`Last verified action: ${final.lastVerifiedAction || 'none'}`);
  } finally {
    await runtime.shutdown().catch(() => {});
    await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
