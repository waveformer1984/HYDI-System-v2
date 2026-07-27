#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

/**
 * `hydi status` and `hydi readiness` command-line surface.
 *
 * This script is a thin shell over `HYDIOperationalBoot`. It boots the full
 * HYDI executive stack, prints an operator-friendly status or readiness report,
 * and then drains the session. No logic is duplicated from the operational boot
 * sequence, the session, or the briefing renderer.
 *
 * Usage:
 *   node scripts/hydi-cli.js status
 *   node scripts/hydi-cli.js readiness
 *   node scripts/hydi-cli.js status --data-path ./data
 */

const path = require('path');
const { boot } = require('../src/hydi-v3/HYDIOperationalBoot');
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

function buildSummary(report, session) {
  const coverage = SignalCoverage.audit({ registry: session.eventBus.registry });
  const sensorCheck = report.checks.find((c) => c.name === 'Sensors');
  const auditCheck = report.checks.find((c) => c.name === 'Audit Ledger');
  const dashboard = session.evidenceEngine
    ? session.evidenceEngine.getMeasuredLearningDashboard()
    : { pendingEvidence: 0 };

  const hasSignalIssues = coverage.dropped.length || coverage.double.length || coverage.unknown.length;
  let lastRecommendation = 'none';
  if (session.recommendationTracker) {
    const recent = session.recommendationTracker.getRecentRecommendations(1);
    if (recent.length) lastRecommendation = recent[0].action || 'unknown';
  }

  return {
    system: report.status.toUpperCase(),
    boot: report.status === 'ready' ? 'Complete' : 'Failed',
    sensors: sensorCheck && sensorCheck.status === 'healthy' ? 'healthy' : 'degraded',
    signals: hasSignalIssues ? 'warning' : 'covered',
    audit: auditCheck && auditCheck.status === 'healthy' ? 'healthy' : 'degraded',
    learning: dashboard.pendingEvidence > 0 ? 'waiting for measured outcomes' : 'no measured outcomes recorded',
    lastRecommendation,
  };
}

function appendIssues(lines, report) {
  if (report.warnings.length) {
    lines.push('', 'Warnings:');
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  if (report.failures.length) {
    lines.push('', 'Failures:');
    for (const f of report.failures) lines.push(`  - ${f.step}: ${f.error}`);
  }
  return lines;
}

function renderStatus(report, session) {
  const s = buildSummary(report, session);
  const lines = [
    'HYDI SYSTEM STATUS',
    '',
    `System: ${s.system}`,
    `Boot: ${s.boot}`,
    `Sensors: ${s.sensors}`,
    `Signals: ${s.signals}`,
    `Audit: ${s.audit}`,
    `Learning: ${s.learning}`,
    `Last recommendation: ${s.lastRecommendation}`,
  ];
  return appendIssues(lines, report).join('\n');
}

function renderReadiness(report, session) {
  const s = buildSummary(report, session);
  const lines = [
    'HYDI SYSTEM READINESS',
    '',
    `System: ${s.system}`,
    `Boot: ${s.boot}`,
    `Sensors: ${s.sensors}`,
    `Signals: ${s.signals}`,
    `Audit: ${s.audit}`,
    `Learning: ${s.learning}`,
    `Last recommendation: ${s.lastRecommendation}`,
    '',
    'Checks:',
  ];
  for (const check of report.checks) {
    const state = check.status === 'healthy' ? 'OK' : 'NOT OK';
    lines.push(`  ${check.name}: ${state}${check.detail ? ` (${check.detail})` : ''}`);
  }
  return appendIssues(lines, report).join('\n');
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
    console.log(command === 'status' ? renderStatus(report, session) : renderReadiness(report, session));
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
