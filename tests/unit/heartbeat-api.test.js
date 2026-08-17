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

let mockStatusRows = {};
const upserts = [];
const eventInserts = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'hydi_status_events') {
        return { insert: jest.fn(async (row) => { eventInserts.push(row); return { error: null }; }) };
      }
      if (table === 'hydi_subsystem_status') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn((field, value) => ({
              maybeSingle: async () => ({ data: mockStatusRows[value] || null, error: null }),
            })),
          })),
          upsert: jest.fn((row) => ({
            select: jest.fn(() => ({
              single: jest.fn(async () => {
                mockStatusRows[row.subsystem] = row;
                upserts.push(row);
                return { data: row, error: null };
              }),
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
  handler = require('../../api/heartbeat.js').default;
});

beforeEach(() => {
  mockStatusRows = {};
  upserts.length = 0;
  eventInserts.length = 0;
  require('../../lib/rate-limit').__reset();
});

describe('api/heartbeat.js', () => {
  it('rejects unauthenticated requests', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { subsystem: 'hydi_core' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects an unknown subsystem name', async () => {
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { subsystem: 'not_a_real_subsystem' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('records a healthy heartbeat and logs a status_event on first report', async () => {
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { subsystem: 'hydi_core', status: 'healthy' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.status).toBe('healthy');
    expect(payload.health_score).toBe(100);
    expect(eventInserts).toHaveLength(1);
    expect(eventInserts[0].to_status).toBe('healthy');
  });

  it('does not log a duplicate status_event when status is unchanged', async () => {
    mockStatusRows.hydi_core = { status: 'healthy' };
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { subsystem: 'hydi_core', status: 'healthy' },
    }, res);

    expect(eventInserts).toHaveLength(0);
  });

  it('logs a transition event when status changes', async () => {
    mockStatusRows.hydi_core = { status: 'healthy' };
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { subsystem: 'hydi_core', status: 'critical' },
    }, res);

    expect(eventInserts).toHaveLength(1);
    expect(eventInserts[0].from_status).toBe('healthy');
    expect(eventInserts[0].to_status).toBe('critical');
  });

  it('rejects an invalid status value', async () => {
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { subsystem: 'hydi_core', status: 'super-duper' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
