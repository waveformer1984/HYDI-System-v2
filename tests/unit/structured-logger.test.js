'use strict';

describe('structured-logger', () => {
  let consoleLogSpy;

  beforeEach(() => {
    jest.resetModules();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  function loadFreshLogger(env = {}) {
    const prevEnv = { ...process.env };
    Object.assign(process.env, { NODE_ENV: 'production', LOG_LEVEL: 'DEBUG', LOG_FILE: '', ...env });
    // eslint-disable-next-line global-require -- intentional fresh require per test for a clean singleton
    const mod = require('../../lib/structured-logger');
    process.env = prevEnv;
    return mod;
  }

  function lastLoggedJSON() {
    const jsonCall = [...consoleLogSpy.mock.calls].reverse().find(([line]) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    });
    return jsonCall ? JSON.parse(jsonCall[0]) : null;
  }

  test('emits JSON with timestamp/level/component/message in production mode', () => {
    const logger = loadFreshLogger();
    logger.info('Service started', { port: 3458 });

    const entry = lastLoggedJSON();
    expect(entry).toMatchObject({
      level: 'INFO',
      component: 'app',
      message: 'Service started',
      port: 3458,
    });
    expect(entry.timestamp).toEqual(expect.any(String));
  });

  test('respects level filtering', () => {
    const logger = loadFreshLogger({ LOG_LEVEL: 'WARN' });
    logger.debug('should not appear');
    logger.info('should not appear either');
    logger.warn('should appear');

    const entries = consoleLogSpy.mock.calls
      .map(([line]) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('should appear');
  });

  test('redacts secret-shaped values embedded in the message', () => {
    const logger = loadFreshLogger();
    logger.error('Stripe call failed with key sk_live_abcdefghijklmnop');

    const entry = lastLoggedJSON();
    expect(entry.message).not.toContain('sk_live_abcdefghijklmnop');
    expect(entry.message).toContain('[REDACTED]');
  });

  test('redacts secret-shaped values inside metadata strings', () => {
    const logger = loadFreshLogger();
    logger.info('Webhook received', { signature: 'whsec_1234567890abcdef', note: 'ok' });

    const entry = lastLoggedJSON();
    expect(entry.signature).toBe('[REDACTED]');
    expect(entry.note).toBe('ok');
  });

  test('redacts metadata values whose key name looks sensitive, regardless of shape', () => {
    const logger = loadFreshLogger();
    logger.info('Auth attempt', { password: 'hunter2', apiKey: 'not-secret-shaped-but-named-sensitive', userId: 'u1' });

    const entry = lastLoggedJSON();
    expect(entry.password).toBe('[REDACTED]');
    expect(entry.apiKey).toBe('[REDACTED]');
    expect(entry.userId).toBe('u1');
  });

  test('redacts secrets nested inside objects and arrays', () => {
    const logger = loadFreshLogger();
    logger.info('Batch processed', {
      results: [{ token: 'Bearer abcdefghijklmnopqrst' }, { ok: true }],
    });

    const entry = lastLoggedJSON();
    expect(entry.results[0].token).toBe('[REDACTED]');
    expect(entry.results[1].ok).toBe(true);
  });

  test('redacts Error objects (message and stack) passed as metadata', () => {
    const logger = loadFreshLogger();
    const err = new Error('failed with key sk_live_abcdefghijklmnop');
    logger.error('Operation failed', { error: err });

    const entry = lastLoggedJSON();
    expect(entry.error.message).not.toContain('sk_live_abcdefghijklmnop');
    expect(entry.error.name).toBe('Error');
  });

  test('child() stamps a fixed component and bindings on every entry without mutating the parent', () => {
    const logger = loadFreshLogger();
    const child = logger.child({ component: 'HeidiOrchestrator', bindings: { workerId: 'w1' } });

    child.info('Task claimed', { taskId: 't1' });
    let entry = lastLoggedJSON();
    expect(entry.component).toBe('HeidiOrchestrator');
    expect(entry.workerId).toBe('w1');
    expect(entry.taskId).toBe('t1');

    logger.info('Parent still default component');
    entry = lastLoggedJSON();
    expect(entry.component).toBe('app');
    expect(entry.workerId).toBeUndefined();
  });

  test('withCorrelationId attaches the id to logs emitted inside, including nested async calls', async () => {
    const logger = loadFreshLogger();
    const id = logger.generateCorrelationId();

    await logger.withCorrelationId(id, async () => {
      await Promise.resolve();
      logger.info('inside correlated scope');
    });

    const entry = lastLoggedJSON();
    expect(entry.correlationId).toBe(id);
  });

  test('logs emitted outside withCorrelationId have no correlationId', () => {
    const logger = loadFreshLogger();
    logger.info('uncorrelated');

    const entry = lastLoggedJSON();
    expect(entry.correlationId).toBeUndefined();
  });

  test('generateCorrelationId returns unique values', () => {
    const logger = loadFreshLogger();
    const a = logger.generateCorrelationId();
    const b = logger.generateCorrelationId();
    expect(a).not.toBe(b);
    expect(a).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
  });
});
