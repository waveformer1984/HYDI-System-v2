'use strict';

const { createHmac } = require('crypto');

const SERVICE_SECRET = 'test-service-secret';

function makeServiceToken(secret = SERVICE_SECRET) {
  const ts = Date.now().toString();
  const requestId = 'req-1';
  const service = 'jest';
  const sig = createHmac('sha256', secret).update(`${ts}:${requestId}:${service}`).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

let mockDeviceRows = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') {
        return { insert: jest.fn(async () => ({ error: null })) };
      }
      if (table === 'devices') {
        return {
          select: jest.fn((cols, opts) => {
            if (opts && opts.head) {
              return Promise.resolve({ count: mockDeviceRows.length, error: null });
            }
            return {
              order: jest.fn(async () => ({ data: mockDeviceRows, error: null })),
              eq: jest.fn((field, value) => ({
                maybeSingle: async () => ({ data: mockDeviceRows.find((d) => d[field] === value) || null, error: null }),
              })),
            };
          }),
          insert: jest.fn((row) => ({
            select: jest.fn(() => ({
              single: jest.fn(async () => {
                const inserted = { id: `dev-${mockDeviceRows.length + 1}`, created_at: new Date().toISOString(), ...row };
                mockDeviceRows.push(inserted);
                return { data: inserted, error: null };
              }),
            })),
          })),
          update: jest.fn((patch) => ({
            eq: jest.fn((field, value) => ({
              select: jest.fn(() => ({
                single: jest.fn(async () => {
                  const found = mockDeviceRows.find((d) => d[field] === value);
                  if (!found) return { data: null, error: { message: 'not found' } };
                  Object.assign(found, patch);
                  return { data: found, error: null };
                }),
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

let handler;

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  handler = require('../../api/devices/index.js').default;
});

beforeEach(() => {
  mockDeviceRows = [];
  require('../../lib/rate-limit').__reset();
});

describe('api/devices/index.js', () => {
  it('bootstraps the first device as an approved owner using the master service token', async () => {
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { action: 'register', device_id: 'phone-1', requested_role: 'owner' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const payload = res.json.mock.calls[0][0];
    expect(payload.device.status).toBe('approved');
    expect(payload.device.role).toBe('owner');
    expect(typeof payload.secret).toBe('string');
    expect(payload.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('registers a second device as pending, even requesting owner, since bootstrap only applies once', async () => {
    mockDeviceRows.push({ device_id: 'phone-1', role: 'owner', status: 'approved' });
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: {},
      body: { action: 'register', device_id: 'phone-2', requested_role: 'owner' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].device.status).toBe('pending');
  });

  it('defaults an unrecognized requested_role to viewer', async () => {
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: {},
      body: { action: 'register', device_id: 'phone-3', requested_role: 'superadmin' },
    }, res);

    expect(res.json.mock.calls[0][0].device.role).toBe('viewer');
  });

  it('rejects registration without a device_id', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { action: 'register' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects listing devices without owner credentials', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('lists devices for an authenticated owner', async () => {
    mockDeviceRows.push({ device_id: 'phone-1', role: 'owner', status: 'approved', device_name: null, last_seen_at: null, created_at: 'now' });
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].devices).toHaveLength(1);
  });

  it('approves a pending device and assigns its role', async () => {
    mockDeviceRows.push({ device_id: 'phone-2', role: 'viewer', status: 'pending' });
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { action: 'approve', device_id: 'phone-2', role: 'operator' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].device.status).toBe('approved');
    expect(res.json.mock.calls[0][0].device.role).toBe('operator');
  });

  it('revokes a device', async () => {
    mockDeviceRows.push({ device_id: 'phone-2', role: 'operator', status: 'approved' });
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { action: 'revoke', device_id: 'phone-2', reason: 'lost phone' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].device.status).toBe('revoked');
  });
});
