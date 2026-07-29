const HealthSupervisor = require('../../../src/hydi-v3/HealthSupervisor');
const FaultCorrelationEngine = require('../../../src/hydi-v3/FaultCorrelationEngine');
const RecoveryCoordinator = require('../../../src/hydi-v3/RecoveryCoordinator');
const ResourceLeakDetector = require('../../../src/hydi-v3/ResourceLeakDetector');
const DeadlockDetector = require('../../../src/hydi-v3/DeadlockDetector');
const OperationsDashboard = require('../../../src/hydi-v3/OperationsDashboard');

describe('Health supervisor', () => {
  let hs;
  afterEach(() => { if (hs) hs.stop(); });

  test('tracks subsystem health and reports state changes', () => {
    hs = new HealthSupervisor({ intervalMs: 100 });
    const changes = [];
    hs.on('state_changed', (e) => changes.push(e));
    hs.register('cpu');
    hs.record('cpu', 0.9);
    hs.record('cpu', 0.1);
    hs.record('cpu', 0.1);
    hs.record('cpu', 0.1);
    const status = hs.getStatus();
    expect(status.subsystems[0].state).toBe('critical');
    expect(changes.length).toBeGreaterThan(0);
  });

  test('overall health degrades when subsystems degrade', () => {
    hs = new HealthSupervisor({ intervalMs: 100 });
    hs.register('a');
    hs.register('b');
    hs.record('a', 0.9);
    hs.record('b', 0.9);
    hs.record('a', 0.4);
    hs.record('b', 0.4);
    const status = hs.getStatus();
    expect(status.state).toBe('degraded');
  });
});

describe('Fault correlation', () => {
  test('correlates related faults within the time window', () => {
    const fce = new FaultCorrelationEngine({ windowMs: 5000 });
    fce.ingest({ subsystem: 'db', type: 'connection_error', severity: 'error' });
    fce.ingest({ subsystem: 'api', type: 'timeout', severity: 'warning', context: { traceId: 'x' } });
    fce.ingest({ subsystem: 'worker', type: 'timeout', severity: 'warning', context: { traceId: 'x' } });
    const correlations = fce.getCorrelations({ minConfidence: 0 });
    expect(correlations.length).toBeGreaterThan(0);
    expect(correlations[0].events.length).toBeGreaterThan(1);
  });
});

describe('Recovery coordinator', () => {
  test('selects and executes a recovery strategy', async () => {
    const rc = new RecoveryCoordinator({ maxRetries: 1 });
    const handler = jest.fn().mockResolvedValue({ success: true });
    rc.registerStrategy('restart', handler, { applicable: (c) => c.rootCause === 'db' });
    const correlation = { id: 'c1', rootCause: 'db', confidence: 0.8 };
    const result = await rc.recover(correlation);
    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  test('tracks recovery success rate', async () => {
    const rc = new RecoveryCoordinator({ maxRetries: 1 });
    rc.registerStrategy('noop', () => ({ success: true }));
    await rc.recover({ id: 'c2', confidence: 0.5 });
    expect(rc.successRate()).toBe(1);
  });
});

describe('Resource leak detector', () => {
  let rld;
  afterEach(() => { if (rld) rld.stop(); });

  test('samples memory and detects growth', () => {
    rld = new ResourceLeakDetector({ intervalMs: 50, minSamples: 3, growthThreshold: 0.01 });
    const leaks = [];
    rld.on('leak_detected', (l) => leaks.push(l));
    rld.track('fd', () => 10);
    for (let i = 0; i < 5; i++) {
      rld.sample();
      const holder = rld.trackers.get('fd');
      // simulate growth between samples by overriding value
      rld.trackers.set('fd', { ...holder, value: () => 10 + (i + 1) * 100 });
    }
    expect(rld.getTrend()).not.toBeNull();
    expect(leaks.some((l) => l.kind === 'fd')).toBe(true);
  });
});

describe('Deadlock detector', () => {
  test('detects a simple circular wait', () => {
    const dd = new DeadlockDetector();
    dd.hold('A', 'r1');
    dd.hold('B', 'r2');
    const w1 = dd.wait('A', 'r2');
    expect(w1.success).toBe(true);
    const w2 = dd.wait('B', 'r1');
    expect(w2.success).toBe(false);
    expect(w2.error).toBe('deadlock_detected');
  });

  test('clears waits after release', () => {
    const dd = new DeadlockDetector();
    dd.hold('A', 'r1');
    dd.hold('B', 'r2');
    dd.wait('A', 'r2');
    dd.release('B', 'r2');
    const w2 = dd.wait('B', 'r1');
    expect(w2.success).toBe(true);
  });
});

describe('Operations dashboard', () => {
  test('renders a snapshot with all metrics', () => {
    const ops = new OperationsDashboard();
    ops.recordLatency(100, { taskId: 't1' });
    ops.recordLatency(200, { taskId: 't2' });
    ops.recordForecast({ taskId: 't1', completionProbability: 0.9 });
    ops.recordOutcome({ taskId: 't1', success: true });
    ops.recordExecution({ planned: true, success: true });
    ops.recordExecution({ planned: true, success: false });
    ops.recordRollback({ taskId: 't1' });

    const render = ops.render();
    expect(render.meanLatency).toBe(150);
    expect(render.rollbackFrequency).toBe(1);
    expect(render.plannerAccuracy).toBe(0.5);
    expect(render.forecastAccuracy).toBe(1);
  });

  test('records and retrieves a trace from goal to execution', () => {
    const ops = new OperationsDashboard();
    const trace = {
      id: 'trace-1',
      goalId: 'g1',
      steps: ['plan', 'assign', 'execute', 'complete'],
      status: 'completed',
    };
    ops.recordTrace(trace);
    expect(ops.getTrace('trace-1').status).toBe('completed');
    expect(ops.render().traceCount).toBe(1);
  });
});
