#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

/**
 * `hydi status` and `hydi readiness` command-line surface.
 *
 * This script is a thin shell over `HYDIOperationalBoot`. It boots the full
 * HYDI executive stack, prints a human-readable status or readiness report, and
 * then drains the session. No logic is duplicated from the operational boot
 * sequence, the session, or the briefing renderer.
 *
 * Usage:
 *   node scripts/hydi-cli.js status
 *   node scripts/hydi-cli.js readiness
 *   node scripts/hydi-cli.js status --data-path ./data
 */

const path = require('path');
const { boot, statusText } = require('../src/hydi-v3/HYDIOperationalBoot');
const SignalCoverage = require('../src/hydi-v3/SignalCoverage');

function parseFlags(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const flags = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--data-path' && args[i + 1]) {
      flags.dataPath = args[i + 1];
      i++;
    }
  }
  return { command, flags };
}

function renderStatus(report, session) {
  const coverage = SignalCoverage.audit({ registry: session.eventBus.registry });
  const dashboard = session.evidenceEngine ? session.evidenceEngine.getMeasuredLearningDashboard() : { pendingEvidence: 0 };
  const audit = session.auditLedger ? session.auditLedger.verify() : { ok: false };

  let lastAction = 'none';
  if (session.executionGateway) {
    const executed = session.executionGateway.getAuditTrail({ category: 'action-executed' });
    const last = executed.sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    if (last) {
      const payload = last.payload || {};
      lastAction = `${payload.type || 'action'} ${payload.status || 'completed'}`;
    }
  }

  const lines = [
    'HYDI STATUS',
    '',
    `System: ${report.status.toUpperCase()}`,
    `Sensors: ${session.sensors.length} active`,
    `Signals: ${coverage.matrix.length} covered`,
    `Orphaned: ${coverage.orphan.length}`,
    `Learning: Awaiting ${dashboard.pendingEvidence} measured outcomes`,
    `Audit: ${audit.ok ? 'Healthy' : 'Degraded'}`,
    `Last action: ${lastAction}`,
  ];

  if (report.warnings.length) {
    lines.push('', 'Warnings:');
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  if (report.failures.length) {
    lines.push('', 'Failures:');
    for (const f of report.failures) lines.push(`  - ${f.step}: ${f.error}`);
  }

  return lines.join('\n');
}

async function main() {
  const { command, flags } = parseFlags(process.argv);
  const dataPath = flags.dataPath
    ? path.resolve(process.cwd(), flags.dataPath)
    : path.resolve(__dirname, '..', 'data');

  if (!command || (command !== 'status' && command !== 'readiness')) {
    console.error('Usage: hydi <status|readiness> [--data-path <dir>]');
    process.exit(1);
  }

  const report = await boot({ dataPath, logger: { log: () => {}, warn: () => {}, error: () => {} } });
  const { session } = report;

  try {
    if (command === 'status') {
      console.log(renderStatus(report, session));
    } else {
      console.log('HYDI READINESS');
      console.log(statusText(report));
    }
  } finally {
    if (session && typeof session.destroy === 'function') {
      await session.destroy().catch(() => {});
    }
  }

  process.exit(report.status === 'ready' ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
