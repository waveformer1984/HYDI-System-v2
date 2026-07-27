#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const HYDIContinuousRuntime = require('../src/hydi-v3/HYDIContinuousRuntime');

const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-live-demo-${Date.now()}`);
  const projectPath = path.join(dataPath, 'project');
  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(path.join(projectPath, 'src'), { recursive: true });

  try {
    execSync('git init', { cwd: projectPath, stdio: 'ignore' });
    execSync('git config user.email "demo@hydi.local"', { cwd: projectPath, stdio: 'ignore' });
    execSync('git config user.name "HYDI Demo"', { cwd: projectPath, stdio: 'ignore' });
  } catch (error) {
    console.log('Git not available; filesystem-only live demo.');
  }

  const runtime = new HYDIContinuousRuntime({
    dataPath,
    ownerPriority: 'resonate',
    logger: SILENT,
    healthIntervalMs: 2000,
    connectors: [
      { type: 'filesystem', name: 'filesystem', enabled: true, roots: { ProtoForge: projectPath }, scanIntervalMs: 1000, watch: true },
      { type: 'git', name: 'git', enabled: true, cwd: projectPath, project: 'ProtoForge', pollIntervalMs: 1000 },
      { type: 'local-process', name: 'process', enabled: false },
      { type: 'github', name: 'github', enabled: true },
      { type: 'stripe', name: 'stripe', enabled: true },
    ],
  });

  await runtime.start();
  console.log(`[DEMO] Runtime state: ${runtime.getStatus().state}`);

  await fs.writeFile(path.join(projectPath, 'src', 'feature.md'), 'Live demo feature description.\n', 'utf8');
  console.log('[DEMO] Wrote src/feature.md.');

  if (fs.existsSync ? await fs.stat(path.join(projectPath, '.git')).catch(() => null) : null) {
    try {
      execSync('git add .', { cwd: projectPath, stdio: 'ignore' });
      execSync('git commit -m "Live demo commit"', { cwd: projectPath, stdio: 'ignore' });
      console.log('[DEMO] Committed change.');
    } catch (error) {
      console.log('[DEMO] Git commit skipped.');
    }
  }

  console.log('[DEMO] Waiting for connectors to observe...');
  await sleep(2500);

  const briefing = runtime.session.executiveOS.morningBriefing();
  console.log('[DEMO] Briefing:', briefing.executiveSummary);

  const topRec = briefing.recommendations.find((r) => r.recommendationId) || briefing.recommendations[0];
  if (!topRec || !topRec.recommendationId) {
    console.log('[DEMO] No recommendation produced; demo complete.');
    await runtime.shutdown();
    return;
  }

  console.log(`[DEMO] Recommendation: ${topRec.action} (${(topRec.confidence * 100).toFixed(0)}%)`);
  const before = runtime.session.recommendationTracker.getRecommendation(topRec.recommendationId).confidence;
  const exec = await runtime.session.executionGateway.execute({
    type: 'update-markdown',
    adapter: 'documentation',
    requestingAgent: 'ExecutiveOperatingSystem',
    recommendationId: topRec.recommendationId,
    params: { file: 'live-demo-report.md', content: 'Live demo report generated from real filesystem and git events.' },
  });
  console.log(`[DEMO] Execution status: ${exec.status}`);

  const approved = await runtime.session.approvalCenter.approve(exec.id);
  console.log(`[DEMO] Approved: ${approved.ok}`);

  const outcome = runtime.session.businessOutcomeEngine.recordOutcome(topRec.recommendationId, {
    value: 1200,
    measured: true,
    provenance: 'manual-measurement',
    type: 'successful',
    lesson: 'Real business activity observed through filesystem and git connectors.',
  });
  const after = runtime.session.recommendationTracker.getRecommendation(topRec.recommendationId).confidence;
  console.log(`[DEMO] Learning updated: ${(before * 100).toFixed(0)}% -> ${(after * 100).toFixed(0)}% (delta ${outcome.confidenceDelta.toFixed(4)})`);

  const final = runtime.session.executiveOS.morningBriefing();
  console.log('[DEMO] Updated briefing:', final.executiveSummary);
  console.log(`[DEMO] Final status: ${runtime.getStatus().state}`);

  await runtime.shutdown();
  await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
