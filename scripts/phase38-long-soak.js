#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const FailureTaxonomy = require('../src/hydi-v3/FailureTaxonomy');
const SnapshotStore = require('../src/hydi-v3/SnapshotStore');
const RecoveryManager = require('../src/hydi-v3/RecoveryManager');
const SystemHealthSupervisor = require('../src/hydi-v3/SystemHealthSupervisor');

const silent = { log: () => {}, error: () => {}, warn: () => {} };
const reportPath = path.resolve(__dirname, '../reports/business-os/phase38-long-soak-report.md');

async function main() {
  const durationMs = Number(process.env.SOAK_DURATION_MS) || 30000;
  const dataPath = path.join(os.tmpdir(), `hydi-p38-soak-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dataPath, { recursive: true });

  const store = await new SnapshotStore({ dataPath, logger: silent }).start();
  let healthy = true;
  let recoveryCount = 0;
  let fatal = false;

  const recovery = new RecoveryManager({
    handlers: {
      fallback_model: async () => {
        recoveryCount++;
        healthy = true;
        return { success: true };
      },
      repair_queue: async () => {
        recoveryCount++;
        healthy = true;
        return { success: true };
      },
    },
    logger: silent,
  });

  const supervisor = new SystemHealthSupervisor({
    intervalMs: 1000,
    snapshotIntervalMs: 5000,
    subsystems: {
      model: async () => ({ healthy, symptom: 'model_unavailable' }),
      queue: async () => ({ healthy: true }),
    },
    recovery,
    snapshotStore: store,
    logger: silent,
  });

  supervisor.on('fatal', () => { fatal = true; });

  const start = Date.now();
  supervisor.start();

  let cycle = 0;
  const loop = new Promise((resolve) => {
    const id = setInterval(async () => {
      if (fatal || Date.now() - start >= durationMs) {
        clearInterval(id);
        resolve();
        return;
      }
      cycle++;
      // every 3rd cycle, simulate a 2-second model outage
      if (cycle % 3 === 0) {
        healthy = false;
        await new Promise((r) => setTimeout(r, 2000));
        // supervisor/recovery should restore health before this timeout
      }
    }, 1000);
  });

  await loop;
  supervisor.stop();

  const snapshots = await store.list();
  const report = {
    overall: fatal ? 'FAIL' : 'PASS',
    durationMs: Date.now() - start,
    cycles: cycle,
    recoveryCount,
    fatal,
    snapshotCount: snapshots.length,
    latestSnapshot: snapshots.length ? snapshots[0].hash : null,
  };

  console.log(JSON.stringify(report, null, 2));

  const md = `# Phase 38 — Long Soak Report

Generated: ${new Date().toISOString()}

- Duration: ${report.durationMs}ms
- Cycles: ${report.cycles}
- Recovery events: ${report.recoveryCount}
- Snapshots captured: ${report.snapshotCount}
- Fatal shutdown: ${fatal ? 'YES' : 'NO'}
- Overall: **${report.overall}**
`;

  await fs.writeFile(reportPath, md, 'utf8');
  await fs.rm(dataPath, { recursive: true, force: true });

  if (fatal) process.exit(1);
}

main().catch((e) => {
  console.error(JSON.stringify({ overall: 'FAIL', error: e instanceof Error ? e.message : String(e) }, null, 2));
  process.exit(1);
});
