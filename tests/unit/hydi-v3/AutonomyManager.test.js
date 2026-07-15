const HYDIAutonomyManager = require('../../../src/hydi-v3');
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

describe('HYDIAutonomyManager', () => {
  let manager;
  let coreLoop;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-autonomy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    coreLoop = createFakeCoreLoop();
    manager = new HYDIAutonomyManager({
      coreLoop,
      config: {
        dataPath,
        enableGracefulShutdown: false,
        enableMemoryIntegrity: false,
        enableSecurity: true,
        enableObservability: false,
      },
    });
    await manager.start();
  });

  afterEach(async () => {
    await manager.stop();
    manager.destroy();
    await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  });

  test('starts and stops cleanly', async () => {
    expect(manager._started).toBe(true);
    await manager.stop();
    expect(manager._stopped).toBe(true);
  });

  test('creates and executes missions', async () => {
    const missionId = await manager.createMission('unit', 'unit mission');
    manager.missionPlanner.addTask(missionId, { type: 'automation', description: 'unit task' });
    await manager.executeMission(missionId);
    const tasks = await coreLoop.getPendingTasks();
    expect(tasks.length).toBe(1);
  });

  test('security audit passes for new modules', async () => {
    const report = await manager.runSecurityAudit();
    expect(report.passed).toBe(true);
  });

  test('memory integrity scan passes', async () => {
    const result = await manager.runMemoryIntegrity();
    expect(result.passed).toBe(true);
  });

  test('performance benchmarks run', async () => {
    const report = await manager.runPerformanceBenchmarks();
    expect(report.total).toBeGreaterThan(0);
    expect(report.passed).toBeGreaterThan(0);
  });
});
