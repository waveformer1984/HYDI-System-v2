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
    heartbeat.registerPublisher('service-1', () => ({ timestamp: Date.now() - 1000 }));
    heartbeat.start();
    // Wait for the real event rather than racing a fixed sleep against the
    // engine's own internal timer tick, which flakes under CI load when the
    // two land at approximately the same wall-clock time.
    const missing = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for heartbeat_missing')), 2000);
      heartbeat.once('heartbeat_missing', (event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
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
