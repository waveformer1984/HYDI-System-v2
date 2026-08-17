#!/usr/bin/env node
'use strict';

const HYDIAutonomyManager = require('../src/hydi-v3');

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
  const coreLoop = createFakeCoreLoop();
  const manager = new HYDIAutonomyManager({
    coreLoop,
    config: {
      enableGracefulShutdown: false,
      enableMemoryIntegrity: true,
      enableSecurity: true,
      enableObservability: true,
    },
  });

  await manager.start();

  const testReport = await manager.runTestSuite();
  const perfReport = await manager.runPerformanceBenchmarks();

  await manager.stop();

  const report = {
    timestamp: new Date().toISOString(),
    tests: testReport,
    performance: perfReport,
    status: manager.getStatus(),
  };

  console.log(JSON.stringify(report, null, 2));

  const failed = (testReport.failed || 0) + (perfReport.failed || 0);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
