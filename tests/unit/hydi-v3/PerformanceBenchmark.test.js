const PerformanceBenchmark = require('../../../src/hydi-v3/PerformanceBenchmark');
const MissionPlanner = require('../../../src/hydi-v3/MissionPlanner');
const DecisionIntelligence = require('../../../src/hydi-v3/DecisionIntelligence');
const ReflectionEngine = require('../../../src/hydi-v3/ReflectionEngine');
const HeartbeatSystem = require('../../../src/hydi-v3/HeartbeatSystem');

describe('PerformanceBenchmark', () => {
  let benchmark;
  let components;

  beforeEach(async () => {
    benchmark = new PerformanceBenchmark({ iterations: 20 });
    components = {
      missionPlanner: new MissionPlanner({ storagePath: '/tmp/hydi-test-perf-missions' }),
      decisionIntelligence: new DecisionIntelligence({ storagePath: '/tmp/hydi-test-perf-decisions' }),
      reflectionEngine: new ReflectionEngine({ storagePath: '/tmp/hydi-test-perf-reflections' }),
      heartbeat: new HeartbeatSystem(),
    };
    await components.missionPlanner.initialize();
    await components.decisionIntelligence.initialize();
    await components.reflectionEngine.initialize();
  });

  afterEach(() => {
    components.missionPlanner.destroy();
  });

  test('runs all benchmarks', async () => {
    const report = await benchmark.runAll(components);
    expect(report.total).toBeGreaterThan(0);
    expect(report.passed).toBeGreaterThan(0);
  });

  test('reports meet targets', async () => {
    await benchmark.runAll(components);
    const targets = benchmark.meetsTargets();
    expect(targets.startup).toBe(true);
    expect(targets.missionPlanning).toBe(true);
    expect(targets.taskDispatch).toBe(true);
  });
});
