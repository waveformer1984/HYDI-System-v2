const HYDIAutonomyManager = require('../../../src/hydi-v3');
const ChaosRunner = require('../../../src/hydi-v3/ChaosRunner');
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

describe('ChaosRunner', () => {
  let manager;
  let coreLoop;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-chaos-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    coreLoop = createFakeCoreLoop();
    manager = new HYDIAutonomyManager({
      coreLoop,
      config: {
        dataPath,
        enableGracefulShutdown: false,
        enableMemoryIntegrity: true,
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
    await manager.destroy();
    await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  });

  test('getScenarioHandler returns a handler for known scenarios and undefined otherwise', () => {
    const runner = new ChaosRunner();
    expect(typeof runner.getScenarioHandler('power_loss')).toBe('function');
    expect(runner.getScenarioHandler('unknown')).toBeUndefined();
  });

  test('runScenario returns a recovery report', async () => {
    const runner = new ChaosRunner();
    const result = await runner.runScenario('power_loss', manager);

    expect(result.name).toBe('power_loss');
    expect(result.injected).toBe(true);
    expect(result.recovered).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.evidence).toBeDefined();
  });

  test('runAll runs every scenario and reports recovery', async () => {
    const runner = new ChaosRunner();
    const report = await runner.runAll(manager);

    expect(report.total).toBe(runner.scenarioNames.length);
    expect(report.failed).toBe(0);
    expect(report.allPassed).toBe(true);

    for (const result of report.results) {
      expect(result.injected).toBe(true);
      expect(result.recovered).toBe(true);
      expect(result.evidence).toBeDefined();
    }
  });
});
