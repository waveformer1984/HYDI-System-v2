#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const path = require('path');
const HYDIContinuousRuntime = require('../src/hydi-v3/HYDIContinuousRuntime');
const ExecutiveDashboard = require('../src/hydi-v3/ExecutiveDashboard');

const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

function parseArgs(argv) {
  const flags = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--data-path' && argv[i + 1]) { flags.dataPath = argv[i + 1]; i += 1; }
    else if (arg === '--json') flags.json = true;
    else if (arg === '--refresh') flags.refresh = true;
    else if (arg === '--interval' && argv[i + 1]) { flags.interval = Number(argv[i + 1]); i += 1; }
  }
  return flags;
}

function formatConnector(c) {
  return `${c.name}: ${c.state} (${c.metrics.emitted} emitted, ${c.metrics.errors} errors)`;
}

function render(snapshot) {
  const rt = snapshot.runtime;
  const lines = [
    'HYDI OPERATIONAL DASHBOARD',
    `Timestamp: ${new Date(snapshot.timestamp).toISOString()}`,
    '',
    `Runtime: ${rt.state}`,
    `Uptime: ${rt.uptime}ms`,
    `Events processed: ${rt.eventsProcessed}`,
    `Recommendations: ${rt.recommendations}`,
    `Pending approvals: ${rt.pendingApprovals}`,
    `Awaiting measurements: ${rt.awaitingMeasurements}`,
    `Audit entries: ${rt.auditEntries}`,
    `Learning updates: ${rt.learningUpdates}`,
    `Last verified action: ${rt.lastVerifiedAction || 'none'}`,
    '',
    'Connectors:',
    ...(snapshot.connectors.length ? snapshot.connectors.map(formatConnector) : ['  none configured']),
    '',
    `Audit chain: ${snapshot.audit.verified ? 'verified' : 'broken'}`,
    `Trust — avg confidence: ${snapshot.trust.averageConfidence !== null ? (snapshot.trust.averageConfidence * 100).toFixed(0) + '%' : 'N/A'}`,
    `Trust — success rate: ${snapshot.trust.recommendationSuccessRate !== null ? (snapshot.trust.recommendationSuccessRate * 100).toFixed(0) + '%' : 'N/A'}`,
    `Learning backlog: ${snapshot.learningBacklog}`,
    '',
    'Recent measured outcomes:',
    ...(snapshot.measuredOutcomes.length ? snapshot.measuredOutcomes.map((o) => `  - ${o.action}: ${o.outcome}`) : ['  none']),
  ];
  return lines.join('\n');
}

async function main() {
  const flags = parseArgs(process.argv);
  const dataPath = flags.dataPath
    ? path.resolve(process.cwd(), flags.dataPath)
    : path.resolve(__dirname, '..', 'data');
  const interval = Number.isFinite(flags.interval) ? flags.interval : 5000;

  const cwd = process.cwd();
  const runtime = new HYDIContinuousRuntime({
    dataPath,
    logger: SILENT,
    healthIntervalMs: 10000,
    connectors: [
      { type: 'local-process', name: 'process', enabled: true },
      { type: 'filesystem', name: 'filesystem', enabled: true, roots: { [path.basename(cwd)]: cwd } },
      { type: 'git', name: 'git', enabled: true, cwd, project: path.basename(cwd), pollIntervalMs: 60000 },
    ],
  });
  await runtime.start();
  const dashboard = new ExecutiveDashboard(runtime);

  async function show() {
    const snapshot = dashboard.snapshot();
    if (flags.json) {
      console.log(JSON.stringify(snapshot, null, 2));
    } else {
      if (flags.refresh && process.stdout.isTTY) console.clear();
      console.log(render(snapshot));
    }
  }

  await show();
  if (!flags.refresh) {
    await runtime.shutdown();
    return;
  }

  const timer = setInterval(show, interval);
  const shutdown = async () => {
    clearInterval(timer);
    await runtime.shutdown().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
