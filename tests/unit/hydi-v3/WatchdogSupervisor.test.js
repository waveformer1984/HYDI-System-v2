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
    const agent = {
      getStatus: () => ({ timestamp: Date.now() - 1000, activeLoopCount: 0, retryCount: 0 }),
    };
    const deadEvent = new Promise((resolve) => {
      watchdog.on('agent_dead', resolve);
    });
    watchdog.registerAgent('agent-1', agent);
    watchdog.start();

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('agent_dead was not emitted in time')), 2000);
    });
    const dead = await Promise.race([deadEvent, timeout]);
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
    const recoveredEvent = new Promise((resolve) => {
      watchdog.on('agent_recovered', resolve);
    });
    watchdog.registerAgent('agent-1', agent);
    watchdog.start();

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('agent_recovered was not emitted in time')), 2000);
    });
    await Promise.race([recoveredEvent, timeout]);
    expect(stopped).toBe(true);
    expect(started).toBe(true);
  });
});
