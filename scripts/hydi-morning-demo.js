#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

/**
 * Phase 24: live local morning demonstration.
 *
 * Creates a real temporary project workspace, initializes a git repository,
 * modifies real files, simulates a production equipment event, injects a
 * revenue ledger entry, and then asks the full HYDI executive stack for a
 * morning briefing. Every line in the printed summary traces back to a real
 * observed signal, the BusinessSignalInterpreter, and the Executive OS.
 *
 * Usage:
 *   node scripts/hydi-morning-demo.js
 *   npm run hydi:morning-demo
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { execSync } = require('child_process');
const { boot } = require('../src/hydi-v3/HYDIOperationalBoot');
const { JSONLedgerAdapter } = require('../src/hydi-v3/RevenueSensor');

const SILENT = { log: () => {}, warn: console.warn, error: console.error };

async function initGit(workspace) {
  try {
    execSync('git init', { cwd: workspace, stdio: 'ignore' });
    execSync('git config user.email "demo@protoforge.local"', { cwd: workspace, stdio: 'ignore' });
    execSync('git config user.name "HYDI Demo"', { cwd: workspace, stdio: 'ignore' });
    execSync('git add .', { cwd: workspace, stdio: 'ignore' });
    execSync('git commit -m "Initial demo project"', { cwd: workspace, stdio: 'ignore' });
    return true;
  } catch (error) {
    console.warn('[demo] git not available or repository init failed:', error.message);
    return false;
  }
}

async function commitMore(workspace) {
  try {
    execSync('git add .', { cwd: workspace, stdio: 'ignore' });
    execSync('git commit -m "Add toolpaths and update housing"', { cwd: workspace, stdio: 'ignore' });
    return true;
  } catch (error) {
    console.warn('[demo] git commit failed:', error.message);
    return false;
  }
}

async function writeWorkspace(workspace) {
  await fs.mkdir(path.join(workspace, 'designs'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'src', 'manufacturing'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'designs', 'prototype-housing-v3.stl'), 'solid prototype_housing_v3\nendsolid\n');
  await fs.writeFile(path.join(workspace, 'src', 'manufacturing', 'gcode-mk4.js'), '// mk4 toolpaths\n');
  await fs.writeFile(path.join(workspace, 'README.md'), '# ProtoForge housing V3\n');
}

function printBriefing(briefing, session) {
  const lines = [
    'GOOD MORNING HEIDI',
    '',
    "Today's operating picture:",
    '',
    'PROJECT ACTIVITY:',
  ];

  const activity = briefing.recentActivity && briefing.recentActivity.length
    ? briefing.recentActivity
    : ['No recent project activity.'];
  for (const item of activity) lines.push(`- ${item}`);

  lines.push('', 'RISKS:');
  const risks = briefing.risks && briefing.risks.length ? briefing.risks : [];
  if (risks.length === 0) lines.push('- No critical risks detected.');
  for (const r of risks) lines.push(`- [${r.severity}] ${r.name}: ${r.detail}`);

  lines.push('', 'OPPORTUNITIES:');
  const revenue = briefing.measuredLearning && briefing.measuredLearning.revenue
    ? briefing.measuredLearning.revenue
    : 0;
  if (revenue > 0) {
    const clients = session.memory.find ? session.memory.find({ type: 'client' }) : [];
    const customer = clients[0] ? clients[0].name : 'customer';
    lines.push(`- customer/payment signal detected: $${revenue} received from ${customer}`);
  } else {
    lines.push('- No revenue signals observed.');
  }
  if (briefing.priorityActions && briefing.priorityActions.length) {
    for (const a of briefing.priorityActions.slice(0, 3)) {
      lines.push(`- priority action: ${a.name || a.id} (score ${Number(a.score || 0).toFixed(2)})`);
    }
  }

  const rec = briefing.recommendations && briefing.recommendations[0];
  lines.push('', 'RECOMMENDED ACTION:');
  if (rec) {
    lines.push(`- ${rec.action}`);
    lines.push(`  Reason: ${rec.reason}`);
    lines.push(`  Expected outcome: ${rec.expectedOutcome || 'not specified'}`);
  } else {
    lines.push('- No recommendations available.');
  }

  lines.push('', 'Confidence:');
  lines.push(rec && Number.isFinite(rec.confidence) ? `- ${(rec.confidence * 100).toFixed(0)}%` : '- unknown');

  lines.push('', 'Evidence:');
  if (rec && rec.provenance && rec.provenance.sources && rec.provenance.sources.length) {
    lines.push(`- sources: ${rec.provenance.sources.join(', ')}`);
  } else {
    lines.push('- No evidence sources recorded.');
  }
  if (rec) {
    const summary = session.evidenceEngine.getEvidenceSummary(rec.recommendationId);
    const count = summary && Array.isArray(summary.evidence) ? summary.evidence.length : 0;
    lines.push(`- evidence on file: ${count} item${count === 1 ? '' : 's'}`);
  }

  lines.push('', 'Audit:');
  const chain = session.executionGateway.verifyAuditChain();
  lines.push(`- chain verified: ${chain.ok}`);
  const trail = session.executionGateway.getAuditTrail ? session.executionGateway.getAuditTrail({ limit: 5 }) : [];
  lines.push(`- recent audit records: ${trail.length}`);

  console.log(lines.join('\n'));
  return rec;
}

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-morning-demo-${Date.now()}`);
  const workspace = path.join(dataPath, 'ProtoForge');
  await fs.mkdir(workspace, { recursive: true });

  await writeWorkspace(workspace);
  const hasGit = await initGit(workspace);

  const revenuePath = path.join(dataPath, 'revenue.json');
  await fs.writeFile(
    revenuePath,
    JSON.stringify([{
      id: 'pmt-demo-1',
      amount: 9500,
      currency: 'USD',
      customer: 'Acme Corp',
      date: new Date().toISOString(),
      description: 'Prototype housing V3 payment',
    }], null, 2),
    'utf8'
  );

  const report = await boot({
    dataPath,
    ownerPriority: 'manufacturing',
    git: hasGit ? { cwd: workspace, project: 'ProtoForge', pollIntervalMs: 0 } : null,
    filesystem: { roots: { ProtoForge: workspace }, scanIntervalMs: 0, watch: false },
    simulateManufacturing: true,
    printer: { autoRun: false },
    revenue: { adapters: [new JSONLedgerAdapter({ path: revenuePath })], pollMs: 0 },
    logger: SILENT,
  });

  if (report.status !== 'ready' || !report.session) {
    throw new Error(`HYDI boot failed: ${report.failures.map((f) => `${f.step}: ${f.error}`).join('; ')}`);
  }
  const session = report.session;

  // Real filesystem activity after the baseline has been recorded.
  await fs.writeFile(path.join(workspace, 'designs', 'prototype-housing-v3.stl'), 'solid prototype_housing_v3\nfacet\nendfacet\nendsolid\n');
  await fs.writeFile(path.join(workspace, 'src', 'manufacturing', 'gcode-mk4.js'), '// mk4 toolpaths updated\n');
  await fs.appendFile(path.join(workspace, 'README.md'), '\nUpdated for V3 release.\n');
  await fs.writeFile(path.join(workspace, 'src', 'manufacturing', 'toolpaths.js'), '// new toolpaths\n');
  await session.filesystemMonitor.scan();

  if (hasGit) {
    await commitMore(workspace);
    await session.gitSensor.poll();
  } else {
    session.eventBus.emit('CommitCreated', {
      project: 'ProtoForge',
      message: 'Add toolpaths and update housing',
    }, 'GitSensor');
  }

  // Simulated production equipment offline event.
  session.printerSensor.simulateEvent('PrinterOffline');

  // Force revenue re-scan in case the first scan already consumed it.
  if (session.revenueSensor) await session.revenueSensor.scan();

  const briefing = session.briefing();
  const rec = printBriefing(briefing, session);

  // Operator action loop: create, approve, execute, audit, wait for measurement.
  if (rec) {
    const action = {
      type: 'update-markdown',
      adapter: 'documentation',
      params: { file: 'morning-response.md', note: `Address: ${rec.action}` },
      recommendationId: rec.recommendationId,
      requestingAgent: 'ExecutiveOperatingSystem',
    };

    const execResult = await session.executionGateway.execute(action);
    console.log(`\nOperator action loop:`);
    console.log(`- recommendation: ${rec.recommendationId}`);
    console.log(`- execution status: ${execResult.status}`);

    if (execResult.status === 'awaiting-approval') {
      const approved = await session.executionGateway.approve(execResult.id);
      console.log(`- operator approved: ${approved.status}`);
    }

    const trail = session.executionGateway.getAuditTrail({ category: 'action-executed' });
    console.log(`- audit records for executed action: ${trail.length}`);

    const evaluation = session.evidenceEngine.evaluateRecommendation(rec.recommendationId);
    const outcome = evaluation && evaluation.outcomeType ? evaluation.outcomeType : 'awaiting measurement';
    console.log(`- learning outcome: ${outcome}`);
  }

  await session.destroy();
  await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
