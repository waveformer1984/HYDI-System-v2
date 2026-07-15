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

let mockSubsystemRows = [];
let mockWorkerRows = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'hydi_subsystem_status') {
        return { select: jest.fn(async () => ({ data: mockSubsystemRows, error: null })) };
      }
      if (table === 'hydi_status_events') {
        return {
          select: jest.fn(() => ({
            order: jest.fn(() => ({ limit: jest.fn(async () => ({ data: [], error: null })) })),
          })),
        };
      }
      if (table === 'worker_status') {
        return { select: jest.fn(async () => ({ data: mockWorkerRows, error: null })) };
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
  handler = require('../../api/status/system.js').default;
});

beforeEach(() => {
  mockSubsystemRows = [];
  mockWorkerRows = [];
  require('../../lib/rate-limit').__reset();
});

describe('api/status/system.js', () => {
  it('rejects unauthenticated requests', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('reports overall_status offline when nothing has ever heartbeat-ed', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.health_score).toBe(0);
    expect(payload.overall_status).toBe('offline');
    expect(payload.offline_subsystems).toHaveLength(8);
  });

  it('computes a healthy overall status when every subsystem is fresh and healthy', async () => {
    const now = new Date().toISOString();
    mockSubsystemRows = [
      'hydi_core', 'ursula', 'rave_voice', 'botforge', 'worker_fleet', 'memory', 'database', 'deployment',
    ].map((subsystem) => ({ subsystem, status: 'healthy', last_heartbeat: now }));

    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.health_score).toBe(100);
    expect(payload.overall_status).toBe('healthy');
    expect(payload.offline_subsystems).toHaveLength(0);
  });

  it('summarizes worker counts by status and includes the full worker list', async () => {
    mockWorkerRows = [
      { worker_id: 'sync-1', worker_type: 'sync', status: 'idle', last_heartbeat: null, processed_count: 5, error_count: 0 },
      { worker_id: 'sync-2', worker_type: 'sync', status: 'idle', last_heartbeat: null, processed_count: 2, error_count: 0 },
      { worker_id: 'audit-1', worker_type: 'audit', status: 'busy', last_heartbeat: null, processed_count: 1, error_count: 0 },
      { worker_id: 'security-1', worker_type: 'security_identity', status: 'error', last_heartbeat: null, processed_count: 0, error_count: 3 },
    ];
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.active_workers).toEqual({ idle: 2, busy: 1, error: 1, stopped: 0 });
    expect(payload.workers).toHaveLength(4);
    expect(payload.workers[3]).toMatchObject({ worker_id: 'security-1', worker_type: 'security_identity', status: 'error', error_count: 3 });
  });

  it('returns 405 for non-GET methods', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: { 'x-hydi-service-token': makeServiceToken() } }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
