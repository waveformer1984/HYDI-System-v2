/**
 * Unit tests for SecurityIdentityWorker's security-critical fixes:
 *  - fails closed on a missing JWT_SECRET instead of signing tokens with a
 *    hardcoded fallback secret sitting in public source control
 *  - checkTokenPermission actually checks permissions instead of always
 *    returning true
 *  - auditAuthentication returns real stats instead of undefined
 *  - the four previously-undefined audit_type handlers no longer throw
 */

jest.mock('../../workers/QueueManager', () => {
  return jest.fn().mockImplementation(() => ({
    registerWorker: jest.fn().mockResolvedValue(undefined),
    updateHeartbeat: jest.fn().mockResolvedValue(undefined),
    startHeartbeat: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
  }));
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: jest.fn() })),
}));

const SecurityIdentityWorker = require('../../workers/SecurityIdentityWorker');

describe('SecurityIdentityWorker - JWT_SECRET fail-closed', () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
    process.env.SUPABASE_URL = originalSupabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
  });

  it('throws on initialize() when JWT_SECRET is unset, rather than using a hardcoded default', () => {
    delete process.env.JWT_SECRET;
    process.env.SUPABASE_URL = 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake_key';

    const worker = new SecurityIdentityWorker('test-worker');
    expect(worker.securityConfig.jwtSecret).toBeFalsy();
    expect(() => worker.initialize()).toThrow('JWT_SECRET is required');
  });

  it('initializes fine once JWT_SECRET is set', () => {
    process.env.JWT_SECRET = 'a-real-secret';
    process.env.SUPABASE_URL = 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake_key';

    const worker = new SecurityIdentityWorker('test-worker-2');
    expect(() => worker.initialize()).not.toThrow();
  });
});

describe('SecurityIdentityWorker - checkTokenPermission', () => {
  let worker;

  beforeEach(() => {
    process.env.JWT_SECRET = 'a-real-secret';
    worker = new SecurityIdentityWorker('test-worker-3');
  });

  it('grants access when no specific permission is required', async () => {
    await expect(
      worker.checkTokenPermission({ email: 'user@example.com' }, '/api/x', undefined)
    ).resolves.toBe(true);
  });

  it('denies access when the user cannot be found', async () => {
    worker.supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    };

    await expect(
      worker.checkTokenPermission({ email: 'ghost@example.com' }, '/api/x', 'write')
    ).resolves.toBe(false);
  });

  it('grants access to admins regardless of the specific permission list', async () => {
    worker.supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { role: 'admin', permissions: [] }, error: null }),
      }),
    };

    await expect(
      worker.checkTokenPermission({ email: 'admin@example.com' }, '/api/x', 'delete')
    ).resolves.toBe(true);
  });

  it('denies access when the required permission is not in the user permission list', async () => {
    worker.supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest
          .fn()
          .mockResolvedValue({ data: { role: 'member', permissions: ['read'] }, error: null }),
      }),
    };

    await expect(
      worker.checkTokenPermission({ email: 'user@example.com' }, '/api/x', 'delete')
    ).resolves.toBe(false);
  });

  it('grants access via a resource:action permission entry', async () => {
    worker.supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest
          .fn()
          .mockResolvedValue({ data: { role: 'member', permissions: ['/api/x:delete'] }, error: null }),
      }),
    };

    await expect(
      worker.checkTokenPermission({ email: 'user@example.com' }, '/api/x', 'delete')
    ).resolves.toBe(true);
  });
});

describe('SecurityIdentityWorker - auditAuthentication', () => {
  let worker;

  beforeEach(() => {
    process.env.JWT_SECRET = 'a-real-secret';
    worker = new SecurityIdentityWorker('test-worker-4');
  });

  it('returns real stats instead of undefined', async () => {
    worker.supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        gte: jest.fn().mockResolvedValue({
          data: [
            { email: 'a@example.com', success: true },
            { email: 'b@example.com', success: false },
            { email: 'b@example.com', success: false },
          ],
          error: null,
        }),
      }),
    };

    const result = await worker.auditAuthentication('all', 'week');

    expect(result.totalAttempts).toBe(3);
    expect(result.failedAttempts).toBe(2);
    expect(result.successRate).toBeCloseTo(1 / 3, 5);
    expect(result.topFailing[0]).toEqual({ identifier: 'b@example.com', count: 2 });
  });

  it('scopes to failed_only when requested', async () => {
    worker.supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        gte: jest.fn().mockResolvedValue({
          data: [
            { email: 'a@example.com', success: true },
            { email: 'b@example.com', success: false },
          ],
          error: null,
        }),
      }),
    };

    const result = await worker.auditAuthentication('failed_only', 'today');
    expect(result.totalAttempts).toBe(1);
    expect(result.failedAttempts).toBe(1);
  });
});

describe('SecurityIdentityWorker - previously-undefined audit handlers', () => {
  let worker;

  beforeEach(() => {
    process.env.JWT_SECRET = 'a-real-secret';
    worker = new SecurityIdentityWorker('test-worker-5');
  });

  it('does not throw for authorization, rate_limiting, session_management, or vulnerability_scan', async () => {
    for (const type of ['auditAuthorization', 'auditRateLimiting', 'auditSessionManagement', 'auditVulnerabilities']) {
      await expect(worker[type]('all', 'today')).resolves.toEqual(
        expect.objectContaining({ implemented: false })
      );
    }
  });
});
