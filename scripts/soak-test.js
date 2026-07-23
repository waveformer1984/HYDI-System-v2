#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const HYDIAutonomyManager = require('../src/hydi-v3');
const SoakTest = require('../src/hydi-v3/SoakTest');

function createFakeCoreLoop() {
  const activeLoops = new Map();
  return {
    isRunning: false,
    activeLoops,
    config: { maxConcurrentLoops: 5 },
    getStatus: () => ({
      timestamp: Date.now(),
      cpu: 0.2,
      memory: 0.3,
      queueDepth: 0,
      activeLoopCount: activeLoops.size,
      retryCount: 0,
      dbConnections: 0,
    }),
    getAvailableResources: () => ({ cpu: 0.8, memory: 0.7 }),
    getMemoryUsage: () => 0.3,
    getPendingTasks: async () => [],
    takeAction: async () => ({ success: true, result: 'ok' }),
    on: () => {},
    metrics: { loopsCompleted: 0, loopsFailed: 0, revenueGenerated: 0 },
  };
}

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-soak-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const coreLoop = createFakeCoreLoop();
  const manager = new HYDIAutonomyManager({
    coreLoop,
    config: {
      dataPath,
      enableGracefulShutdown: false,
      enableMemoryIntegrity: false,
      enableSecurity: true,
      enableObservability: false,
      enableHeartbeat: false,
      enableWatchdog: true,
      enableSelfHealing: true,
      enableReflection: false,
      enableDistributedCompute: false,
    },
  });

  await manager.start();

  const report = await SoakTest.runSoak(manager, 24 * 60 * 60 * 1000, {
    simulated: true,
    tickCount: 100,
    leakThreshold: 0.01,
    degradationThreshold: 0.2,
  });

  await manager.stop();
  manager.destroy();
  await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});

  console.log(JSON.stringify(report, null, 2));

  process.exit(report.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
