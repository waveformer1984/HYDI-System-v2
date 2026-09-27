/**
 * Model-flatline isolation tests.
 *
 * Contract being proven: a failed/hung/Ollama-down model path must degrade
 * model capability WITHOUT killing the ProtoForge control plane. The control
 * plane is only allowed to exit when the failure is genuinely fatal
 * (uncaught exception, rejection storm).
 */
const { installProcessGuard } = require('../../src/process-guard');
const { checkModelHealthAxis } = require('../../src/health/protoforge-health');

describe('process guard — model failure isolation', () => {
  const makeGuard = (opts = {}) => {
    const logs = [];
    const exits = [];
    return {
      logs,
      exits,
      guard: installProcessGuard({
        log: (line) => logs.push(line),
        exit: (code) => exits.push(code),
        now: opts.now || (() => 1_000_000),
        maxRejectionsPerMinute: opts.maxRejectionsPerMinute ?? 3,
      }),
    };
  };

  test('model-path unhandled rejection does NOT kill the control plane', () => {
    const { logs, exits, guard } = makeGuard();
    guard._onUnhandledRejection(new Error('Ollama ECONNREFUSED'));
    expect(exits).toEqual([]);                     // process stayed alive
    expect(logs[0]).toMatch(/unhandledRejection/);
    expect(logs[0]).toMatch(/Ollama/);
    guard.uninstall();
  });

  test('rejection storm (>max/min) is fatal — state itself is unsafe', () => {
    const { logs, exits, guard } = makeGuard({ maxRejectionsPerMinute: 3 });
    for (let i = 0; i < 4; i++) guard._onUnhandledRejection(new Error('boom'));
    expect(exits).toEqual([1]);                   // storm → exit
    expect(logs.some(l => l.includes('storm'))).toBe(true);
    guard.uninstall();
  });

  test('uncaughtException stays fatal and LOUD', () => {
    const { logs, exits, guard } = makeGuard();
    guard._onUncaughtException(new Error('ENOENT: control plane state corrupt'));
    expect(exits).toEqual([1]);
    expect(logs[0]).toMatch(/uncaughtException \(fatal\)/);
    expect(logs[0]).toMatch(/ENOENT/);
    guard.uninstall();
  });
});

describe('model-health axis — separate from service status', () => {
  const fakeHeartbeat = (status) => ({ getStatus: () => status });

  test('all models healthy → model=HEALTHY', () => {
    const m = checkModelHealthAxis(fakeHeartbeat({ running: true, failedModels: [] }));
    expect(m.state).toBe('HEALTHY');
  });

  test('models failing → model=DEGRADED (service unaffected)', () => {
    const m = checkModelHealthAxis(fakeHeartbeat({
      running: true,
      failedModels: [['local-llama', 3], ['gpt-4-local', 5]],
    }));
    expect(m.state).toBe('DEGRADED');
    expect(m.failedModels.length).toBe(2);
  });

  test('heartbeat not running → model=UNAVAILABLE, not UNVERIFIED', () => {
    const m = checkModelHealthAxis(fakeHeartbeat({ running: false }));
    expect(m.state).toBe('UNAVAILABLE');
  });

  test('no heartbeat in process → model=UNVERIFIED, never throws', () => {
    const m = checkModelHealthAxis(null);
    expect(m.state).toBe('UNVERIFIED');
    expect(m.evidence).toMatch(/not available/);
  });
});
