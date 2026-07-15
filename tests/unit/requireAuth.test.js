'use strict';

const { createHmac } = require('crypto');
const { requireAuth } = require('../../lib/auth/requireAuth');
const { generateDeviceSecret, deriveSigningKey, signDeviceToken } = require('../../lib/auth/deviceAuth');
const rateLimitModule = require('../../lib/rate-limit');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  return res;
}

function mockReq(headers = {}) {
  return { headers, socket: { remoteAddress: '127.0.0.1' } };
}

function mockSupabase(deviceRow) {
  const auditRows = [];
  return {
    _auditRows: auditRows,
    from(table) {
      if (table === 'auth_audit_log') {
        return { insert: async (row) => { auditRows.push(row); return { error: null }; } };
      }
      if (table === 'devices') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: deviceRow, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function signServiceToken(secret) {
  const ts = Date.now().toString();
  const requestId = 'req-1';
  const service = 'test-caller';
  const payload = `${ts}:${requestId}:${service}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

describe('requireAuth', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    rateLimitModule.__reset();
    process.env = { ...OLD_ENV, HYDI_SERVICE_SECRET: 'test-master-secret' };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('grants owner role for a valid legacy service token', async () => {
    const req = mockReq({ 'x-hydi-service-token': signServiceToken('test-master-secret') });
    const res = mockRes();
    const supabase = mockSupabase(null);

    const result = await requireAuth(req, res, supabase, { permission: 'worker:control', routeName: 'test-route' });
    expect(result.ok).toBe(true);
    expect(result.role).toBe('owner');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects an invalid service token with 401 and logs auth_failure', async () => {
    const req = mockReq({ 'x-hydi-service-token': 'garbage' });
    const res = mockRes();
    const supabase = mockSupabase(null);

    const result = await requireAuth(req, res, supabase, { permission: 'worker:control', routeName: 'test-route' });
    expect(result.ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(supabase._auditRows.some((r) => r.event_type === 'auth_failure')).toBe(true);
  });

  it('resolves an approved device token to its registered role', async () => {
    const secret = generateDeviceSecret();
    const signingKey = deriveSigningKey(secret);
    const supabase = mockSupabase({ device_id: 'phone-1', role: 'viewer', status: 'approved', secret_hash: signingKey });
    const token = signDeviceToken('phone-1', signingKey);
    const req = mockReq({ 'x-hydi-device-token': token });
    const res = mockRes();

    const result = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'test-route' });
    expect(result.ok).toBe(true);
    expect(result.role).toBe('viewer');
    expect(result.deviceId).toBe('phone-1');
  });

  it('returns 403 when the resolved role lacks the required permission', async () => {
    const secret = generateDeviceSecret();
    const signingKey = deriveSigningKey(secret);
    const supabase = mockSupabase({ device_id: 'phone-1', role: 'viewer', status: 'approved', secret_hash: signingKey });
    const token = signDeviceToken('phone-1', signingKey);
    const req = mockReq({ 'x-hydi-device-token': token });
    const res = mockRes();

    const result = await requireAuth(req, res, supabase, { permission: 'worker:control', routeName: 'test-route' });
    expect(result.ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(supabase._auditRows.some((r) => r.event_type === 'permission_denied')).toBe(true);
  });

  it('rejects a revoked device with 401', async () => {
    const secret = generateDeviceSecret();
    const signingKey = deriveSigningKey(secret);
    const supabase = mockSupabase({ device_id: 'phone-1', role: 'operator', status: 'revoked', secret_hash: signingKey });
    const token = signDeviceToken('phone-1', signingKey);
    const req = mockReq({ 'x-hydi-device-token': token });
    const res = mockRes();

    const result = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'test-route' });
    expect(result.ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rate-limits after the configured max requests per window', async () => {
    const supabase = mockSupabase(null);
    for (let i = 0; i < 5; i++) {
      const req = mockReq({ 'x-hydi-service-token': signServiceToken('test-master-secret') });
      const res = mockRes();
      // eslint-disable-next-line no-await-in-loop
      await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'rate-test', rateMax: 5 });
    }
    const req = mockReq({ 'x-hydi-service-token': signServiceToken('test-master-secret') });
    const res = mockRes();
    const result = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'rate-test', rateMax: 5 });
    expect(result.ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('denies with 401 when no credentials are supplied at all', async () => {
    const req = mockReq({});
    const res = mockRes();
    const supabase = mockSupabase(null);

    const result = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'test-route' });
    expect(result.ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
