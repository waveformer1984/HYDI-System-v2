'use strict';

const mockSendNotification = jest.fn(async () => ({}));
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: (...args) => mockSendNotification(...args),
}));

const { createNotification, deliverPush } = require('../../lib/notifications/notify');

function mockSupabase({ notifications = [], subscriptions = [], preferences = {} } = {}) {
  const updates = [];
  return {
    updates,
    from(table) {
      if (table === 'notifications') {
        return {
          insert: (row) => ({
            select: () => ({
              single: async () => {
                const inserted = { id: 'notif-1', created_at: new Date().toISOString(), ...row };
                notifications.push(inserted);
                return { data: inserted, error: null };
              },
            }),
          }),
          update: (patch) => ({ eq: async (_f, id) => { updates.push({ id, patch }); return { error: null }; } }),
        };
      }
      if (table === 'push_subscriptions') {
        return {
          select: () => ({
            eq: (field1, value1) => {
              const filters = { [field1]: value1 };
              const chain = {
                eq: (field2, value2) => { filters[field2] = value2; return chain; },
                then: (resolve) => resolve({
                  data: subscriptions.filter((s) => Object.entries(filters).every(([k, v]) => s[k] === v)),
                  error: null,
                }),
              };
              return chain;
            },
          }),
        };
      }
      if (table === 'notification_preferences') {
        return {
          select: () => ({
            eq: (_field, deviceId) => ({
              maybeSingle: async () => ({ data: preferences[deviceId] ? { categories: preferences[deviceId] } : null, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe('createNotification', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    mockSendNotification.mockClear();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => { process.env = OLD_ENV; });

  it('rejects an unknown category', async () => {
    const supabase = mockSupabase();
    await expect(createNotification(supabase, { category: 'not_a_real_category', title: 'x' }))
      .rejects.toThrow(/unknown notification category/);
  });

  it('assigns critical severity to worker_failure and operational to task_completed', async () => {
    const supabase = mockSupabase();
    const n1 = await createNotification(supabase, { category: 'worker_failure', title: 'Worker down' });
    expect(n1.severity).toBe('critical');
    const n2 = await createNotification(supabase, { category: 'task_completed', title: 'Done' });
    expect(n2.severity).toBe('operational');
  });

  it('creates the notification even when no VAPID keys are configured (graceful degradation)', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const supabase = mockSupabase({ subscriptions: [{ device_id: 'phone-1', active: true, endpoint: 'e', p256dh: 'p', auth: 'a' }] });
    const notification = await createNotification(supabase, { category: 'build_completed', title: 'Build OK', device_id: 'phone-1' });
    expect(notification.id).toBe('notif-1');
    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(supabase.updates).toHaveLength(0); // no delivered_at write since nothing was delivered
  });

  it('pushes to active subscriptions when VAPID keys are configured and the category is enabled', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    const supabase = mockSupabase({
      subscriptions: [{ device_id: 'phone-1', active: true, endpoint: 'e', p256dh: 'p', auth: 'a' }],
    });
    const notification = await createNotification(supabase, { category: 'security_event', title: 'Alert', device_id: 'phone-1' });
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(supabase.updates.some((u) => u.id === notification.id && u.patch.delivered_at)).toBe(true);
  });

  it('respects a device preference that has disabled the category', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    const supabase = mockSupabase({
      subscriptions: [{ device_id: 'phone-1', active: true, endpoint: 'e', p256dh: 'p', auth: 'a' }],
      preferences: { 'phone-1': { security_event: false } },
    });
    await createNotification(supabase, { category: 'security_event', title: 'Alert', device_id: 'phone-1' });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
