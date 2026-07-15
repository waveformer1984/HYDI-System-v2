const TestingFramework = require('../../../src/hydi-v3/TestingFramework');
const MissionPlanner = require('../../../src/hydi-v3/MissionPlanner');
const DecisionIntelligence = require('../../../src/hydi-v3/DecisionIntelligence');
const ReflectionEngine = require('../../../src/hydi-v3/ReflectionEngine');
const HeartbeatSystem = require('../../../src/hydi-v3/HeartbeatSystem');
const SelfHealingEngine = require('../../../src/hydi-v3/SelfHealingEngine');
const DistributedCompute = require('../../../src/hydi-v3/DistributedCompute');
const CheckpointStore = require('../../../src/hydi-v3/CheckpointStore');

describe('TestingFramework', () => {
  let tf;
  let components;

  beforeEach(async () => {
    tf = new TestingFramework();
    components = {
      missionPlanner: new MissionPlanner({ storagePath: '/tmp/hydi-test-tf-missions' }),
      decisionIntelligence: new DecisionIntelligence({ storagePath: '/tmp/hydi-test-tf-decisions' }),
      reflectionEngine: new ReflectionEngine({ storagePath: '/tmp/hydi-test-tf-reflections' }),
      heartbeat: new HeartbeatSystem(),
      watchdog: { registerAgent: jest.fn(), checkAgents: jest.fn() },
      selfHealing: new SelfHealingEngine({ baseBackoffMs: 1, maxBackoffMs: 5, maxAttempts: 2 }),
      distributedCompute: new DistributedCompute(),
      checkpointStore: new CheckpointStore({ storagePath: '/tmp/hydi-test-tf-checkpoints' }),
    };
    await components.missionPlanner.initialize();
    await components.decisionIntelligence.initialize();
    await components.reflectionEngine.initialize();
    await components.checkpointStore.initialize();
  });

  afterEach(() => {
    components.missionPlanner.destroy();
    components.distributedCompute.destroy();
  });

  test('runs mission replay', async () => {
    const result = await tf.runMissionReplay(components);
    expect(result.passed).toBe(true);
  });

  test('runs reflection replay', async () => {
    const result = await tf.runReflectionReplay(components);
    expect(result.passed).toBe(true);
  });

  test('runs distributed execution', async () => {
    const result = await tf.runDistributedExecution(components);
    expect(result.passed).toBe(true);
  });

  test('runs power loss checkpoint', async () => {
    const result = await tf.runPowerLoss(components);
    expect(result.passed).toBe(true);
  });

  test('runAll produces report', async () => {
    const report = await tf.runAll(components);
    expect(report.total).toBeGreaterThan(0);
    expect(report.passed).toBeGreaterThan(0);
  });
});
