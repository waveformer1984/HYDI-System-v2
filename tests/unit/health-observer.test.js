'use strict';

/**
 * Unit tests for heidi-core/missions/health-observer.js.
 * http and fs are both mocked -- no real network probes, no real file reads.
 */

jest.mock('http');
jest.mock('fs');

const http = require('http');
const fs = require('fs');
const HealthObserver = require('../../heidi-core/missions/health-observer');

const SAMPLE_CONFIG = {
  modules: [
    { id: 'protoforge-core', type: 'process', enabled: true, health: { url: 'http://127.0.0.1:3005/health' } },
    { id: 'heidi-mobile-chat', type: 'process', enabled: true, health: { url: 'http://127.0.0.1:3006/api/health' } },
    { id: 'disabled-module', type: 'process', enabled: false, health: { url: 'http://127.0.0.1:9999/health' } },
    { id: 'no-health-module', type: 'process', enabled: true },
    { id: 'hydi-orchestrator', type: 'module', enabled: true, health: { url: 'http://ignored' } },
  ],
};

function fakeMemory() {
  return { createMission: jest.fn().mockResolvedValue(42) };
}

/** Make http.get behave as up (200) or down (connection error), per URL. */
function mockProbeResults(resultsByUrl) {
  http.get.mockImplementation((url, opts, cb) => {
    const emitter = { on: jest.fn() };
    const up = resultsByUrl[url] !== false;
    if (up) {
      const res = { statusCode: 200, resume: jest.fn() };
      cb(res);
    } else {
      // Simulate an async connection error via the 'error' handler.
      emitter.on = jest.fn((event, handler) => {
        if (event === 'error') setImmediate(() => handler(new Error('ECONNREFUSED')));
      });
    }
    return { on: emitter.on, destroy: jest.fn() };
  });
}

beforeEach(() => {
  fs.readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CONFIG));
  jest.clearAllMocks();
  fs.readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CONFIG));
});

describe('HealthObserver: module discovery', () => {
  it('watches only enabled process-type modules that declare a health.url', () => {
    const observer = new HealthObserver(fakeMemory(), { log: () => {} });
    const ids = observer.modules.map((m) => m.id);
    expect(ids).toEqual(['protoforge-core', 'heidi-mobile-chat']);
  });
});

describe('HealthObserver: debounce', () => {
  it('does not propose a mission on a single failed probe (below debounceFailures)', async () => {
    mockProbeResults({ 'http://127.0.0.1:3005/health': false, 'http://127.0.0.1:3006/api/health': true });
    const memory = fakeMemory();
    const observer = new HealthObserver(memory, { log: () => {}, debounceFailures: 2 });

    await observer.tick();

    expect(memory.createMission).not.toHaveBeenCalled();
  });

  it('proposes a mission once consecutive failures reach debounceFailures', async () => {
    mockProbeResults({ 'http://127.0.0.1:3005/health': false, 'http://127.0.0.1:3006/api/health': true });
    const memory = fakeMemory();
    const observer = new HealthObserver(memory, { log: () => {}, debounceFailures: 2 });

    await observer.tick(); // failure 1
    await observer.tick(); // failure 2 -- should trigger

    expect(memory.createMission).toHaveBeenCalledTimes(1);
    expect(memory.createMission).toHaveBeenCalledWith(
      expect.stringContaining('protoforge-core'),
      2,
      { action: { type: 'run_script', target: 'scripts/restart-module.js', args: ['protoforge-core'] } },
      'Heidi'
    );
  });

  it('a success in between resets the failure counter (no false trigger from intermittent blips)', async () => {
    const memory = fakeMemory();
    const observer = new HealthObserver(memory, { log: () => {}, debounceFailures: 2 });

    mockProbeResults({ 'http://127.0.0.1:3005/health': false, 'http://127.0.0.1:3006/api/health': true });
    await observer.tick(); // failure 1

    mockProbeResults({ 'http://127.0.0.1:3005/health': true, 'http://127.0.0.1:3006/api/health': true });
    await observer.tick(); // recovers -- counter resets

    mockProbeResults({ 'http://127.0.0.1:3005/health': false, 'http://127.0.0.1:3006/api/health': true });
    await observer.tick(); // failure 1 again (not 3)

    expect(memory.createMission).not.toHaveBeenCalled();
  });
});

describe('HealthObserver: cooldown', () => {
  it('does not propose a second mission for the same module within the cooldown window', async () => {
    mockProbeResults({ 'http://127.0.0.1:3005/health': false, 'http://127.0.0.1:3006/api/health': true });
    const memory = fakeMemory();
    const observer = new HealthObserver(memory, { log: () => {}, debounceFailures: 1, cooldownMs: 60000 });

    await observer.tick(); // triggers mission 1
    await observer.tick(); // still down, still within cooldown -- must not trigger again

    expect(memory.createMission).toHaveBeenCalledTimes(1);
  });

  it('proposes a new mission after the cooldown window elapses', async () => {
    mockProbeResults({ 'http://127.0.0.1:3005/health': false, 'http://127.0.0.1:3006/api/health': true });
    const memory = fakeMemory();
    const observer = new HealthObserver(memory, { log: () => {}, debounceFailures: 1, cooldownMs: 10 });

    await observer.tick(); // triggers mission 1
    await new Promise((r) => setTimeout(r, 20)); // wait past the 10ms cooldown
    await observer.tick(); // should trigger again

    expect(memory.createMission).toHaveBeenCalledTimes(2);
  });
});

describe('HealthObserver: independent per-module state', () => {
  it('tracks failures and cooldowns independently per module', async () => {
    mockProbeResults({ 'http://127.0.0.1:3005/health': false, 'http://127.0.0.1:3006/api/health': false });
    const memory = fakeMemory();
    const observer = new HealthObserver(memory, { log: () => {}, debounceFailures: 1 });

    await observer.tick();

    expect(memory.createMission).toHaveBeenCalledTimes(2);
    const targets = memory.createMission.mock.calls.map((c) => c[2].action.args[0]);
    expect(targets.sort()).toEqual(['heidi-mobile-chat', 'protoforge-core']);
  });
});

describe('HealthObserver: start/stop', () => {
  // useFakeTimers() must run per-test (beforeEach), not directly in the
  // describe body -- that executes during Jest's collection phase, before
  // ANY test runs, making fake timers global for the whole file and
  // stalling the setImmediate-based http mock used by every other test here.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('start() is idempotent', () => {
    const observer = new HealthObserver(fakeMemory(), { log: () => {}, intervalMs: 1000 });
    observer.start();
    const first = observer.timer;
    observer.start();
    expect(observer.timer).toBe(first);
    observer.stop();
  });

  it('stop() clears the timer so no further ticks fire', () => {
    mockProbeResults({});
    const observer = new HealthObserver(fakeMemory(), { log: () => {}, intervalMs: 1000 });
    observer.start();
    observer.stop();
    jest.advanceTimersByTime(5000);
    expect(http.get).not.toHaveBeenCalled();
  });
});
