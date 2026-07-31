const HYDIAutonomyManager = require('../../src/hydi-v3');
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

describe('HYDI V3 Integration', () => {
  let manager;
  let coreLoop;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-v3-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    await manager.destroy();
    await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  });

  test('manager starts and reports status', () => {
    const status = manager.getStatus();
    expect(status.started).toBe(true);
    expect(status.watchdog).toBeDefined();
    expect(status.missions).toBeDefined();
  });

  test('core loop pending tasks are patched to mission planner', async () => {
    const missionId = await manager.createMission('integration', 'integration mission');
    manager.missionPlanner.addTask(missionId, { type: 'automation', description: 'integration task' });
    manager.missionPlanner.planMission(missionId);
    const tasks = await coreLoop.getPendingTasks();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].description).toBe('integration task');
  });

  test('decision intelligence rejects dangerous actions', async () => {
    const decision = await manager.decisionIntelligence.makeDecision(
      { action: 'delete', confidence: 0.9, reason: 'test' },
      { task: { type: 'system' } }
    );
    expect(decision.valid).toBe(false);
  });

  test('mission completes and reflects', async () => {
    const missionId = await manager.createMission('reflection', 'reflection mission');
    const task = manager.missionPlanner.addTask(missionId, { type: 'revenue', description: 'reflect task' });
    manager.missionPlanner.planMission(missionId);
    manager.missionPlanner.startTask(task, missionId);
    manager.missionPlanner.completeTask(task, missionId, { success: true, strategy: 'outreach' });
    const mission = manager.missionPlanner.getMission(missionId);
    expect(mission.status).toBe('completed');

    const reflection = await manager.reflectionEngine.reflectOnMission(mission);
    expect(reflection).toBeTruthy();
    expect(reflection.missionId).toBe(missionId);
  });

  test('self-healing can recover from database disconnect', async () => {
    const result = await manager.selfHealing.heal(
      { type: 'database_disconnect', target: 'supabase' },
      { reconnect_database: async () => ({ success: true }) }
    );
    expect(result.success).toBe(true);
  });

  test('memory integrity scan passes', async () => {
    const result = await manager.runMemoryIntegrity();
    expect(result.passed).toBe(true);
  });

  test('security audit passes for new modules', async () => {
    const report = await manager.runSecurityAudit();
    expect(report.passed).toBe(true);
  });

  test('distributed compute schedules work and redistributes on failure', () => {
    manager.distributedCompute.deregisterNode('local');
    const nodeA = manager.distributedCompute.registerNode({ cpu: 1, ram: 1, capabilities: ['general'] });
    const nodeB = manager.distributedCompute.registerNode({ cpu: 0.8, ram: 0.8, capabilities: ['general'] });
    const task = { id: 't1', type: 'compute' };
    const assigned = manager.distributedCompute.schedule(task);
    expect([nodeA, nodeB]).toContain(assigned);
    manager.distributedCompute.deregisterNode(assigned);
    const redistributed = manager.distributedCompute.schedule(task);
    expect(redistributed).toBe(nodeB);
  });
});
