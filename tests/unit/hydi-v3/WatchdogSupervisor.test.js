const WatchdogSupervisor = require('../../../src/hydi-v3/WatchdogSupervisor');

describe('WatchdogSupervisor', () => {
  let watchdog;

  beforeEach(() => {
    watchdog = new WatchdogSupervisor({ checkIntervalMs: 100, heartbeatTimeoutMs: 200 });
  });

  afterEach(() => {
    watchdog.destroy();
  });

  test('registers and unregisters agents', () => {
    const agent = { getStatus: () => ({ timestamp: Date.now() }) };
    watchdog.registerAgent('agent-1', agent);
    expect(watchdog.getStatus().agents['agent-1']).toBeDefined();
    watchdog.unregisterAgent('agent-1');
    expect(watchdog.getStatus().agents['agent-1']).toBeUndefined();
  });

  test('marks dead agent when heartbeat times out', async () => {
    let dead = null;
    const agent = {
      getStatus: () => ({ timestamp: Date.now() - 1000, activeLoopCount: 0, retryCount: 0 }),
    };
    watchdog.on('agent_dead', (event) => { dead = event; });
    watchdog.registerAgent('agent-1', agent);
    watchdog.start();
    await new Promise((r) => setTimeout(r, 250));
    expect(dead).not.toBeNull();
    expect(dead.agentId).toBe('agent-1');
  });

  test('recovers agent on restart', async () => {
    let started = false;
    let stopped = false;
    const agent = {
      getStatus: () => ({ timestamp: Date.now() - 1000, activeLoopCount: 0, retryCount: 0 }),
      start: () => { started = true; },
      stop: () => { stopped = true; },
    };
    watchdog.registerAgent('agent-1', agent);
    watchdog.start();
    await new Promise((r) => setTimeout(r, 250));
    expect(stopped).toBe(true);
    expect(started).toBe(true);
  });
});
