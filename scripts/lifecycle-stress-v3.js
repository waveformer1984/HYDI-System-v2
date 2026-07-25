const HYDIAutonomyManager = require('../src/hydi-v3/AutonomyManager');

function createFakeCoreLoop() {
  return {
    activeLoops: new Map(),
    metrics: { loopsCompleted: 0, loopsFailed: 0, revenueGenerated: 0 },
    getAvailableResources: () => ({ cpu: 0.8, memory: 0.7 }),
    getMemoryUsage: () => 0.3,
    getPendingTasks: async () => [],
    takeAction: async () => ({ success: true, result: 'ok' }),
    on: () => {},
  };
}

function trackTimers() {
  const active = new Set();
  const originals = {
    setTimeout: global.setTimeout,
    setInterval: global.setInterval,
    setImmediate: global.setImmediate,
    clearTimeout: global.clearTimeout,
    clearInterval: global.clearInterval,
    clearImmediate: global.clearImmediate,
  };
  global.setTimeout = function (...args) { const id = originals.setTimeout(...args); active.add(id); return id; };
  global.setInterval = function (...args) { const id = originals.setInterval(...args); active.add(id); return id; };
  global.setImmediate = function (...args) { const id = originals.setImmediate(...args); active.add(id); return id; };
  global.clearTimeout = function (id) { active.delete(id); return originals.clearTimeout(id); };
  global.clearInterval = function (id) { active.delete(id); return originals.clearInterval(id); };
  global.clearImmediate = function (id) { active.delete(id); return originals.clearImmediate(id); };
  return active;
}

async function main() {
  const ITERATIONS = 10000;
  const activeTimers = trackTimers();

  const manager = new HYDIAutonomyManager({
    coreLoop: createFakeCoreLoop(),
    config: {
      enableGracefulShutdown: false,
      enableMemoryIntegrity: false,
      enableSecurity: false,
      enableObservability: false,
      enableCudaPool: false,
      enableSelfHealing: false,
      enableDistributedCompute: false,
      enableHeartbeat: false,
      dataPath: require('path').join(__dirname, '../data/stress-lifecycle'),
    },
  });

  const memBefore = process.memoryUsage();
  const startTime = Date.now();

  for (let i = 0; i < ITERATIONS; i++) {
    await manager.start();
    await manager.stop();
    const leaks = activeTimers.size;
    if (leaks > 0 && i > 0) {
      console.error(`[STRESS] Leak detected at iteration ${i + 1}: ${leaks} active timers`);
      process.exitCode = 1;
      break;
    }
  }

  await manager.destroy();

  const elapsed = Date.now() - startTime;
  const memAfter = process.memoryUsage();
  const memDelta = memAfter.heapUsed - memBefore.heapUsed;

  const report = {
    iterations: ITERATIONS,
    elapsedMs: elapsed,
    avgIterationMs: elapsed / ITERATIONS,
    heapUsedDeltaBytes: memDelta,
    finalActiveTimers: activeTimers.size,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.finalActiveTimers > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('[STRESS] Failed:', err);
  process.exitCode = 1;
});
