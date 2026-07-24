const fs = require('fs');
const path = require('path');
const PerformanceBenchmark = require('../../../src/hydi-v3/PerformanceBenchmark');
const MissionPlanner = require('../../../src/hydi-v3/MissionPlanner');
const DecisionIntelligence = require('../../../src/hydi-v3/DecisionIntelligence');
const ReflectionEngine = require('../../../src/hydi-v3/ReflectionEngine');
const HeartbeatSystem = require('../../../src/hydi-v3/HeartbeatSystem');

const TEST_STORAGE = '/tmp/hydi-test-perf-benchmark';

describe('PerformanceBenchmark', () => {
  let benchmark;
  let components;

  beforeEach(async () => {
    try {
      fs.rmSync(TEST_STORAGE, { recursive: true, force: true });
    } catch {
      // ignore
    }

    benchmark = new PerformanceBenchmark({ iterations: 20, storagePath: TEST_STORAGE });
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
    components.decisionIntelligence.destroy();
    components.reflectionEngine.destroy();
    components.heartbeat.destroy();
  });

  test('runs all benchmarks', async () => {
    const report = await benchmark.runAll(components);
    expect(report.total).toBeGreaterThan(0);
    expect(report.passed).toBeGreaterThan(0);
  }, 30000);

  test('reports meet targets', async () => {
    await benchmark.runAll(components);
    const targets = benchmark.meetsTargets();
    expect(targets.startup).toBe(true);
    expect(targets.missionPlanning).toBe(true);
    expect(targets.taskDispatch).toBe(true);
  });

  test('getTrend returns trends for all benchmarks', async () => {
    const report = await benchmark.runAll(components);
    expect(report.trends.startup).toBeDefined();
    expect(report.trends.mission_planning).toBeDefined();
    expect(report.trends.task_dispatch).toBeDefined();
    expect(report.trends.reflection_engine).toBeDefined();
    expect(report.trends.queue_latency).toBeDefined();
    expect(report.trends.database).toBeDefined();
    expect(report.trends.memory_usage).toBeDefined();
    expect(typeof report.trends.startup.current).toBe('number');
  });

  test('compareToBaseline uses persisted history', async () => {
    await benchmark.runAll(components);

    const secondBenchmark = new PerformanceBenchmark({ iterations: 20, storagePath: TEST_STORAGE });
    const secondReport = await secondBenchmark.runAll(components);

    expect(secondReport.baselineComparison.startup).toBeDefined();
    expect(secondReport.baselineComparison.startup.status).toMatch(/better|worse|stable|no-baseline/);
    expect(typeof secondReport.baselineComparison.startup.current).toBe('number');
  }, 30000);

  test('generateReport returns json and markdown', async () => {
    await benchmark.runAll(components);

    const jsonReport = await benchmark.generateReport('json');
    expect(jsonReport.results).toBeDefined();
    expect(jsonReport.baselineComparison).toBeDefined();
    expect(jsonReport.trends).toBeDefined();

    const mdReport = await benchmark.generateReport('markdown');
    expect(typeof mdReport).toBe('string');
    expect(mdReport).toContain('Performance Report');
    expect(mdReport).toContain('Baseline Comparison');
    expect(mdReport).toContain('Trends');
  });

  test('persists results to history file', async () => {
    await benchmark.runAll(components);
    const historyPath = path.join(TEST_STORAGE, 'history.json');
    const data = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].runAt).toBeDefined();
  });
});
