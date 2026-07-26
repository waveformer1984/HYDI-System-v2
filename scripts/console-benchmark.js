#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */
/**
 * Performance benchmark for the Phase 15 Local Operations Console.
 *
 * Measures the three targets called out in the phase spec:
 *   - OperatorSession startup:            < 2000 ms
 *   - Executive briefing generation:      < 500 ms
 *   - Recommendation / dashboard refresh: < 250 ms
 *
 * Each measurement uses a fresh temporary data directory so results are not
 * skewed by an existing large persisted history. Prints a JSON report and
 * exits non-zero if any target is missed.
 *
 * Usage:
 *   node scripts/console-benchmark.js
 *   npm run benchmark:console
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../src/hydi-v3/OperatorSession');

const TARGETS = {
  startupUnderMs: 2000,
  briefingUnderMs: 500,
  recommendationRefreshUnderMs: 250,
};

const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

async function measure(label, fn) {
  const start = Date.now();
  const result = await fn();
  return { label, elapsed: Date.now() - start, result };
}

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-console-benchmark-${Date.now()}`);
  await fs.mkdir(dataPath, { recursive: true });

  const session = new OperatorSession({ dataPath, logger: SILENT });

  const startup = await measure('startup', () => session.start());
  const briefing = await measure('briefing', () => session.ask('good morning'));
  const recommendationRefresh = await measure('recommendationRefresh', async () => {
    session.consoleAPI.getApprovals();
    session.consoleAPI.getHealth();
    session.consoleAPI.getAgents();
    return session.conversationEngine.buildBusinessHealth();
  });

  await session.destroy();
  await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});

  const checks = {
    startup: startup.elapsed < TARGETS.startupUnderMs,
    briefing: briefing.elapsed < TARGETS.briefingUnderMs,
    recommendationRefresh: recommendationRefresh.elapsed < TARGETS.recommendationRefreshUnderMs,
  };

  const report = {
    runAt: Date.now(),
    targets: TARGETS,
    measurements: {
      startupMs: startup.elapsed,
      briefingMs: briefing.elapsed,
      recommendationRefreshMs: recommendationRefresh.elapsed,
    },
    checks,
    meetsAllTargets: Object.values(checks).every(Boolean),
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.meetsAllTargets ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
