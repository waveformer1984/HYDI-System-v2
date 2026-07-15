const SelfHealingEngine = require('../../../src/hydi-v3/SelfHealingEngine');

describe('SelfHealingEngine', () => {
  let healing;

  beforeEach(() => {
    healing = new SelfHealingEngine({ baseBackoffMs: 10, maxBackoffMs: 50, maxAttempts: 3 });
  });

  afterEach(() => {
    healing.destroy();
  });

  test('diagnoses database disconnect', () => {
    const plan = healing.diagnose({ type: 'database_disconnect' });
    expect(plan.action).toBe('reconnect_database');
  });

  test('heals with provided action', async () => {
    const result = await healing.heal(
      { type: 'api_failure', target: 'redis' },
      { retry_with_backoff: async () => ({ success: true }) }
    );
    expect(result.success).toBe(true);
    expect(result.attempt).toBe(1);
  });

  test('escalates after max attempts', async () => {
    let escalated = false;
    healing.on('escalated', () => { escalated = true; });
    for (let i = 0; i < 5; i++) {
      await healing.heal(
        { type: 'api_failure', target: 'redis' },
        { retry_with_backoff: async () => ({ success: false }) }
      );
    }
    expect(escalated).toBe(true);
  });

  test('calculates backoff with jitter', () => {
    const backoff = healing.calculateBackoff(2);
    expect(backoff).toBeGreaterThanOrEqual(20);
    expect(backoff).toBeLessThanOrEqual(1050);
  });
});
