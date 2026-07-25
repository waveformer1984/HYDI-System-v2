const HYDIAutonomyManager = require('../../../src/hydi-v3');
const GracefulShutdown = require('../../../src/hydi-v3/GracefulShutdown');
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

function minimalConfig(dataPath, extra = {}) {
  return {
    dataPath,
    enableGracefulShutdown: false,
    enableMemoryIntegrity: false,
    enableSecurity: false,
    enableObservability: false,
    enableWatchdog: false,
    enableHeartbeat: false,
    enableSelfHealing: false,
    enableDistributedCompute: false,
    enableReflection: false,
    ...extra,
  };
}

describe('Shutdown and Recovery', () => {
  let manager;
  let coreLoop;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-shutdown-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    coreLoop = createFakeCoreLoop();
    manager = new HYDIAutonomyManager({ coreLoop, config: minimalConfig(dataPath) });
    await manager.start();
  });

  afterEach(async () => {
    await manager.stop().catch(() => {});
    await manager.destroy().catch(() => {});
    await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  });

  async function seedState() {
    const missionId = await manager.createMission('recovery', 'recovery mission');
    const taskId = manager.missionPlanner.addTask(missionId, { type: 'automation', description: 'recovery task' });
    manager.missionPlanner.startTask(taskId, missionId);
    manager.missionPlanner.completeTask(taskId, missionId, { success: true, strategy: 'outreach' });
    const mission = manager.missionPlanner.getMission(missionId);
    await manager.reflectionEngine.reflectOnMission(mission);
    manager.decisionIntelligence.appendDecision({ id: 'recovery_1', confidence: 0.9, timestamp: new Date().toISOString() });
    return { missionId };
  }

  test('graceful shutdown persists all state and restart restores it', async () => {
    await seedState();

    await manager.stop();

    const missionsFile = path.join(dataPath, 'missions', 'missions.json');
    const decisionsFile = path.join(dataPath, 'decisions', 'decision_history.json');
    const reflectionsFile = path.join(dataPath, 'reflections', 'reflections.json');
    const checkpointFile = path.join(dataPath, 'checkpoints', 'latest.json');

    const [missionsRaw, decisions, reflections, checkpoint] = await Promise.all([
      fs.readFile(missionsFile, 'utf8').then(JSON.parse),
      fs.readFile(decisionsFile, 'utf8').then(JSON.parse),
      fs.readFile(reflectionsFile, 'utf8').then(JSON.parse),
      fs.readFile(checkpointFile, 'utf8').then(JSON.parse),
    ]);

    expect(Object.keys(missionsRaw).length).toBe(1);
    expect(Array.isArray(decisions)).toBe(true);
    expect(decisions.length).toBe(1);
    expect(reflections.reflections.length).toBe(1);
    expect(checkpoint.missionCount).toBe(1);
    expect(checkpoint.decisionCount).toBe(1);
    expect(checkpoint.reflectionCount).toBe(1);

    manager = new HYDIAutonomyManager({ coreLoop, config: minimalConfig(dataPath) });
    const start = Date.now();
    await manager.start();
    const recoveryTime = Date.now() - start;

    const status = manager.getStatus();
    expect(status.missions.total).toBe(1);
    expect(status.decisions.totalDecisions).toBe(1);
    expect(status.reflections.totalReflections).toBe(1);
    expect(recoveryTime).toBeLessThan(5000);
  });

  test('repeated start/stop cycles preserve data integrity', async () => {
    await seedState();
    await manager.stop();

    for (let i = 0; i < 3; i++) {
      manager = new HYDIAutonomyManager({ coreLoop, config: minimalConfig(dataPath) });
      await manager.start();
      manager.decisionIntelligence.appendDecision({ id: `cycle_${i}`, confidence: 0.8, timestamp: new Date().toISOString() });
      await manager.stop();
    }

    manager = new HYDIAutonomyManager({ coreLoop, config: minimalConfig(dataPath) });
    await manager.start();
    const status = manager.getStatus();
    expect(status.missions.total).toBe(1);
    expect(status.decisions.totalDecisions).toBe(4);
    expect(status.reflections.totalReflections).toBe(1);
  });

  test('GracefulShutdown coordinator invokes manager stop and flushes state', async () => {
    await seedState();

    const gs = new GracefulShutdown({ flushTimeoutMs: 5000 });
    const stopSpy = jest.spyOn(manager, 'stop');

    gs.addHandler(async () => manager.stop(), 0);
    await gs.shutdown(0, 'test');

    expect(stopSpy).toHaveBeenCalled();
    stopSpy.mockRestore();

    const missionsFile = path.join(dataPath, 'missions', 'missions.json');
    const missionsRaw = await fs.readFile(missionsFile, 'utf8').then(JSON.parse);
    expect(Object.keys(missionsRaw).length).toBe(1);
  });
});
