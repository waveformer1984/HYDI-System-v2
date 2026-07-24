const HYDIAutonomyManager = require('../../../src/hydi-v3');
const SoakTest = require('../../../src/hydi-v3/SoakTest');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

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

describe('SoakTest', () => {
  let manager;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-soak-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const coreLoop = createFakeCoreLoop();
    manager = new HYDIAutonomyManager({
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
  });

  afterEach(async () => {
    await manager.stop();
    manager.destroy();
    await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  });

  test('sleep waits for the requested duration', async () => {
    const start = Date.now();
    await SoakTest.sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  test('runSoak collects snapshots and passes for a healthy manager', async () => {
    const report = await SoakTest.runSoak(manager, 1000, {
      simulated: true,
      tickCount: 10,
      leakThreshold: 1.0,
    });

    expect(report.snapshots.length).toBe(11);
    expect(report.leakDetected).toBe(false);
    expect(report.passed).toBe(true);
    expect(report.stats.missions.completed).toBe(10);
    expect(report.stats.memory.growthPerHour).toBe(0);
    expect(report.stats.agentHealth.last).toBeGreaterThanOrEqual(0.9);
  });

  test('runSoak detects a memory leak', async () => {
    let calls = 0;
    manager.coreLoop.getMemoryUsage = () => {
      calls++;
      return 0.3 * calls;
    };

    const report = await SoakTest.runSoak(manager, 1000, {
      simulated: true,
      tickCount: 10,
      leakThreshold: 0.001,
    });

    expect(report.leakDetected).toBe(true);
    expect(report.passed).toBe(false);
    expect(report.stats.memory.growthPerHour).toBeGreaterThan(0);
  });
});
