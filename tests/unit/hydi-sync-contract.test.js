'use strict';

const { createHmac } = require('crypto');

const SERVICE_SECRET = 'test-service-secret';

function makeServiceToken(secret = SERVICE_SECRET) {
  const ts = Date.now().toString();
  const sig = createHmac('sha256', secret).update(`${ts}:req-1:jest`).digest('hex');
  return `${ts}.req-1.jest.${sig}`;
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'system_dashboard') {
        return {
          select: jest.fn(() => ({
            single: jest.fn(async () => ({
              data: {
                current_status: 'OK',
                trend_status: 'stable',
                jobs_queued: 0,
                jobs_failed: 0,
                events_last_hour: 12,
              },
              error: null,
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
  handler = require('../../api/hydi/sync.js').default;
});

describe('api/hydi/sync.js GET contract', () => {
  it('returns stable mobile-sync fields when authenticated', async () => {
    const res = makeRes();
    await handler(
      { method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({
      ok: true,
      status: 'OK',
      trend: 'stable',
    });
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('dashboard');
    expect(body).toHaveProperty('timestamp');
    expect(typeof body.summary).toBe('string');
  });
});
