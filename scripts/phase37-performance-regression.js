#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs').promises;
const { execFileSync } = require('child_process');

const reportPath = path.resolve(__dirname, '../reports/business-os/phase37-regression-baseline.md');

const BASELINE = {
  targetHz: 10,
  expectedCyclesMin: 45,
  expectedCycleMsMax: 200,
  finalHeapGrowthRatioMax: 0.10,
  queueDepthMax: 0,
  activeCountMax: 0,
  retainedTelemetryEntriesMax: 0,
  overall: 'PASS',
};

async function main() {
  const script = path.resolve(__dirname, 'phase36-stability-test.js');
  const duration = process.env.DURATION_MS || '5000';
  const stdout = execFileSync(process.execPath, ['--expose-gc', script], {
    cwd: path.resolve(__dirname),
    env: { ...process.env, DURATION_MS: duration },
    timeout: 30000,
    encoding: 'utf8',
  });
  const report = JSON.parse(stdout.trim());

  const avgCycleMs = report.durationMs / report.cycles;
  const checks = {
    cycles: report.cycles >= BASELINE.expectedCyclesMin,
    cadence: avgCycleMs <= BASELINE.expectedCycleMsMax,
    heap: report.finalHeapGrowthRatio <= BASELINE.finalHeapGrowthRatioMax,
    peak: report.peakMemoryOk,
    noMonotonicLeak: report.noMonotonicLeak,
    queue: report.queueDepth <= BASELINE.queueDepthMax,
    active: report.activeCount <= BASELINE.activeCountMax,
    retained: report.retainedTelemetryEntries <= BASELINE.retainedTelemetryEntriesMax,
    overallPass: report.overall === 'PASS',
  };
  const allPass = Object.values(checks).every(Boolean);

  const result = {
    overall: allPass ? 'PASS' : 'FAIL',
    phase36Report: report,
    checks,
    baseline: BASELINE,
  };

  console.log(JSON.stringify(result, null, 2));

  const md = `# Phase 37 — Performance Regression Baseline

Generated: ${new Date().toISOString()}

## Phase 36 Run

- Duration: ${report.durationMs}ms
- Target cadence: ${report.targetHz} Hz
- Cycles: ${report.cycles}
- Average cycle time: ${avgCycleMs.toFixed(1)}ms
- Final heap growth ratio: ${(report.finalHeapGrowthRatio * 100).toFixed(2)}%
- Peak memory OK: ${report.peakMemoryOk ? 'PASS' : 'FAIL'}
- No monotonic leak: ${report.noMonotonicLeak ? 'PASS' : 'FAIL'}
- Queue depth: ${report.queueDepth}
- Active tasks: ${report.activeCount}
- Retained telemetry: ${report.retainedTelemetryEntries}

## Regression Checks

| Check | Status |
|-------|--------|
| Cycles within expected range | ${checks.cycles ? 'PASS' : 'FAIL'} |
| Cycle cadence <= ${BASELINE.expectedCycleMsMax}ms | ${checks.cadence ? 'PASS' : 'FAIL'} |
| Final heap growth <= ${(BASELINE.finalHeapGrowthRatioMax * 100).toFixed(0)}% | ${checks.heap ? 'PASS' : 'FAIL'} |
| Peak memory OK | ${checks.peak ? 'PASS' : 'FAIL'} |
| No monotonic heap growth | ${checks.noMonotonicLeak ? 'PASS' : 'FAIL'} |
| Queue drained | ${checks.queue ? 'PASS' : 'FAIL'} |
| No active tasks | ${checks.active ? 'PASS' : 'FAIL'} |
| Telemetry flushed | ${checks.retained ? 'PASS' : 'FAIL'} |
| Phase 36 stability overall PASS | ${checks.overallPass ? 'PASS' : 'FAIL'} |

## Overall

**${result.overall}**
`;

  await fs.writeFile(reportPath, md, 'utf8');

  if (!allPass) process.exit(1);
}

main().catch((e) => {
  console.error(JSON.stringify({ overall: 'FAIL', error: e instanceof Error ? e.message : String(e) }, null, 2));
  process.exit(1);
});
