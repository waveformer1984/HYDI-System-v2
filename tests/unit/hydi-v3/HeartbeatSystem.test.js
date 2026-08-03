const HeartbeatSystem = require('../../../src/hydi-v3/HeartbeatSystem');

describe('HeartbeatSystem', () => {
  let heartbeat;

  beforeEach(() => {
    heartbeat = new HeartbeatSystem({ checkIntervalMs: 100, missingThresholdMs: 200 });
  });

  afterEach(() => {
    heartbeat.destroy();
  });

  test('publishes and retrieves heartbeat', () => {
    heartbeat.publish('service-1', { timestamp: Date.now(), healthScore: 0.9 });
    expect(heartbeat.getHeartbeat('service-1').healthScore).toBe(0.9);
  });

  test('detects missing heartbeat', async () => {
    let missing = null;
    const missingEvent = new Promise((resolve) => {
      heartbeat.on('heartbeat_missing', (m) => {
        missing = m;
        resolve(m);
      });
    });
    heartbeat.registerPublisher('service-1', () => ({ timestamp: Date.now() - 1000 }));
    heartbeat.start();
    // Wait for the actual event instead of racing a fixed sleep against the
    // engine's own interval tick — under parallel-worker CPU contention a
    // fixed 250ms sleep can lose that race even though the check interval
    // (100ms) and missing threshold (200ms) both fired correctly.
    await Promise.race([
      missingEvent,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    expect(missing).not.toBeNull();
    expect(missing[0].serviceId).toBe('service-1');
  });

  test('publishAll calls provider functions', async () => {
    const provider = jest.fn().mockResolvedValue({ cpu: 0.1, memory: 0.2 });
    heartbeat.registerPublisher('service-1', provider);
    await heartbeat.publishAll();
    expect(provider).toHaveBeenCalled();
    expect(heartbeat.getHeartbeat('service-1')).toBeDefined();
  });
});
