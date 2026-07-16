/**
 * Regression test: workers/SecurityIdentityWorker.js used to fall back to a
 * hardcoded, publicly-known JWT signing secret ('dev-secret-change-in-production')
 * whenever JWT_SECRET wasn't configured. This worker is registered in
 * WorkerOrchestrator.js (i.e. part of the live worker set once started) and
 * signs/verifies real auth JWTs (processAuthentication / validateToken) --
 * anyone reading the public source could forge a valid token. It must fail
 * closed instead.
 */
const SecurityIdentityWorker = require('../../workers/SecurityIdentityWorker');

describe('SecurityIdentityWorker', () => {
  const originalSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  it('refuses to initialize when JWT_SECRET is unset (fails closed, no hardcoded fallback)', () => {
    delete process.env.JWT_SECRET;
    const worker = new SecurityIdentityWorker('test-worker');
    expect(() => worker.initialize()).toThrow('Missing JWT_SECRET');
  });

  it('does not carry a hardcoded default secret in securityConfig', () => {
    delete process.env.JWT_SECRET;
    const worker = new SecurityIdentityWorker('test-worker');
    expect(worker.securityConfig.jwtSecret).toBeNull();
    expect(worker.securityConfig.jwtSecret).not.toBe('dev-secret-change-in-production');
  });
});
