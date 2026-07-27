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
const HYDIContinuousRuntime = require('../src/hydi-v3/HYDIContinuousRuntime');

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

function sensorState(session) {
  const sensors = (session.sensors || []).map((sensor) =>
    (typeof sensor.healthCheck === 'function' ? sensor.healthCheck() : { ok: true }));
  if (sensors.length === 0) return 'offline';
  const degraded = sensors.filter((h) => h.ok === false);
  return degraded.length > 0 ? `degraded (${degraded.length} of ${sensors.length})` : 'healthy';
}

function signalState(session) {
  const coverage = session.signalCoverage || SignalCoverage.audit({ registry: session.eventBus.registry });
  const issues = coverage.dropped.length || coverage.double.length || coverage.unknown.length || coverage.orphan.length;
  return issues ? 'orphaned' : 'covered';
}

function auditState(session) {
  if (!session.auditLedger) return 'not initialized';
  const verify = session.auditLedger.verify();
  return verify.ok ? 'chain verified' : `chain broken at record ${verify.failedAt}`;
}

function learningState(session) {
  if (!session.evidenceEngine) return 'not initialized';
  const awaiting = session.evidenceEngine.getAwaitingEvidence ? session.evidenceEngine.getAwaitingEvidence().length : 0;
  return awaiting > 0 ? `awaiting ${awaiting} measurement${awaiting === 1 ? '' : 's'}` : 'no measured outcomes recorded';
}

function lastRecommendation(session) {
  if (!session.recommendationTracker) return 'none';
  const recent = session.recommendationTracker.getRecentRecommendations(1);
  return recent.length ? (recent[0].action || 'unknown') : 'none';
}

function lastDecision(session) {
  if (session.executiveOS && session.executiveOS.lastBriefing) {
    return session.executiveOS.lastBriefing.executiveSummary || 'briefing generated';
  }
  if (session.executiveOS && Array.isArray(session.executiveOS.decisions) && session.executiveOS.decisions.length) {
    const last = session.executiveOS.decisions[session.executiveOS.decisions.length - 1];
    return last.summary || 'decision recorded';
  }
  return 'none';
}

function buildSummary(report, session) {
  const sensors = sensorState(session);
  const signals = signalState(session);
  const audit = auditState(session);
  const learning = learningState(session);
  const lastRec = lastRecommendation(session);
  const lastDec = lastDecision(session);

  let system = 'READY';
  if (report.status !== 'ready') {
    system = 'FAILED';
  } else if (sensors === 'offline') {
    system = 'DEGRADED — no sensors active';
  } else if (sensors.startsWith('degraded')) {
    system = 'DEGRADED — sensor degraded';
  } else if (signals === 'orphaned') {
    system = 'DEGRADED — signal coverage issues';
  } else if (!audit.startsWith('chain verified')) {
    system = 'DEGRADED — audit chain broken';
  }

  return {
    system,
    boot: report.status === 'ready' ? 'Complete' : 'Failed',
    sensors,
    signals,
    audit,
    learning,
    lastRecommendation: lastRec,
    lastExecutiveDecision: lastDec,
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

function renderOperatingState(status, session) {
  const lines = [
    'HYDI OPERATING STATE',
    '',
    `Runtime: ${status.state}`,
    `Uptime: ${status.uptime}ms`,
    `Events processed: ${status.eventsProcessed}`,
    `Recommendations: ${status.recommendations}`,
    `Pending approvals: ${status.pendingApprovals}`,
    `Awaiting measurements: ${status.awaitingMeasurements}`,
    `Audit entries: ${status.auditEntries}`,
    `Learning updates: ${status.learningUpdates}`,
    `Last verified action: ${status.lastVerifiedAction || 'none'}`,
  ];
  if (session && typeof session.certify === 'function') {
    const report = session.certify();
    return appendIssues(lines, report).join('\n');
  }
  return lines.join('\n');
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
    `Last executive decision: ${s.lastExecutiveDecision}`,
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

  if (command === 'readiness') {
    const report = await boot({ dataPath, logger: { log: () => {}, warn: () => {}, error: () => {} } });
    const { session } = report;
    try {
      console.log(renderReadiness(report, session));
    } finally {
      if (session && typeof session.destroy === 'function') {
        await session.destroy().catch(() => {});
      }
    }
    const summary = buildSummary(report, session);
    process.exit(summary.system === 'READY' ? 0 : 1);
  }

  const runtime = new HYDIContinuousRuntime({ dataPath, logger: { log: () => {}, warn: () => {}, error: () => {} } });
  let status;
  try {
    await runtime.start();
    status = runtime.getStatus();
    console.log(renderOperatingState(status, runtime.session));
  } finally {
    await runtime.stop().catch(() => {});
  }
  process.exit(status && status.state === 'READY' ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
