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
    const missingEvent = new Promise((resolve) => {
      heartbeat.on('heartbeat_missing', resolve);
    });
    heartbeat.registerPublisher('service-1', () => ({ timestamp: Date.now() - 1000 }));
    heartbeat.start();

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('heartbeat_missing was not emitted in time')), 2000);
    });
    const missing = await Promise.race([missingEvent, timeout]);
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
