/**
 * Regression test: workers/SecurityIdentityWorker.js used to fall back to a
 * hardcoded, publicly-known JWT signing secret ('dev-secret-change-in-production')
 * whenever JWT_SECRET wasn't configured. This worker is registered in
 * WorkerOrchestrator.js (i.e. part of the live worker set once started) and
 * signs/verifies real auth JWTs (processAuthentication / validateToken) --
 * anyone reading the public source could forge a valid token. It must fail
 * closed instead.
 *
 * It also used to unconditionally "simulate" a successful authentication
 * (and issue a real JWT for it) in processAuthentication regardless of the
 * submitted credentials -- there was no credential in the payload to check
 * in the first place. And checkTokenPermission unconditionally returned
 * true with no RBAC implementation behind it. Both must fail closed until
 * real credential verification / permission logic exists (see
 * ISSUES_FOUND.md #44).
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

  it('checkTokenPermission denies by default (no RBAC implementation exists)', async () => {
    const worker = new SecurityIdentityWorker('test-worker');
    const decoded = { email: 'someone@example.com' };
    await expect(worker.checkTokenPermission(decoded, '/some/endpoint', 'read')).resolves.toBe(false);
  });

  it('processAuthentication rejects every attempt and never issues a token (no credential to verify)', async () => {
    const worker = new SecurityIdentityWorker('test-worker');
    const inserted = [];
    worker.supabase = {
      from: (table) => ({
        insert: async (row) => { inserted.push({ table, row }); return { data: row, error: null }; }
      })
    };

    await worker.processAuthentication({
      data: { email: 'attacker@example.com', ip_address: '127.0.0.1', user_agent: 'jest' }
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe('auth_attempts');
    expect(inserted[0].row.success).toBe(false);
    expect(inserted[0].row.failure_reason).toMatch(/no credential verification/i);
  });
});
