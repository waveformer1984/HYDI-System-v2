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

let mockNotifications = [];
let mockPrefs = {};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async () => ({ error: null })) };
      if (table === 'notifications') {
        return {
          select: jest.fn(() => {
            let rows = mockNotifications;
            const chain = {
              is: jest.fn((field, value) => {
                rows = rows.filter((n) => n[field] === value);
                return chain;
              }),
              order: jest.fn(() => chain),
              limit: jest.fn(async () => ({ data: rows, error: null })),
            };
            return chain;
          }),
          update: jest.fn((patch) => ({
            eq: jest.fn((_f, id) => ({
              select: jest.fn(() => ({
                single: jest.fn(async () => {
                  const found = mockNotifications.find((n) => n.id === id);
                  if (!found) return { data: null, error: { message: 'not found' } };
                  Object.assign(found, patch);
                  return { data: found, error: null };
                }),
              })),
            })),
          })),
        };
      }
      if (table === 'notification_preferences') {
        return {
          upsert: jest.fn((row) => ({
            select: jest.fn(() => ({
              single: jest.fn(async () => {
                mockPrefs[row.device_id] = row;
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
  handler = require('../../api/notifications/index.js').default;
});

beforeEach(() => {
  mockNotifications = [
    { id: 'n1', category: 'worker_failure', title: 'Worker down', read_at: null },
    { id: 'n2', category: 'task_completed', title: 'Done', read_at: '2026-07-15T00:00:00Z' },
  ];
  mockPrefs = {};
  require('../../lib/rate-limit').__reset();
});

describe('api/notifications/index.js', () => {
  it('rejects unauthenticated GET requests', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('lists all notifications with an unread_count', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.notifications).toHaveLength(2);
    expect(payload.unread_count).toBe(1);
  });

  it('filters to unread only when ?unread=true', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { 'x-hydi-service-token': makeServiceToken() }, query: { unread: 'true' } }, res);
    expect(res.json.mock.calls[0][0].notifications).toHaveLength(1);
  });

  it('marks a notification as read', async () => {
    const res = makeRes();
    await handler({
      method: 'POST', headers: { 'x-hydi-service-token': makeServiceToken() }, body: { action: 'mark_read', id: 'n1' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].notification.read_at).toBeTruthy();
  });

  it('rejects an unknown category in preferences with 400', async () => {
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { action: 'preferences', device_id: 'phone-1', categories: { not_a_real_category: false } },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('updates preferences for a device', async () => {
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { action: 'preferences', device_id: 'phone-1', categories: { worker_failure: false } },
    }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockPrefs['phone-1'].categories.worker_failure).toBe(false);
  });

  it('returns 400 for an unknown action', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: { 'x-hydi-service-token': makeServiceToken() }, body: { action: 'nonsense' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
