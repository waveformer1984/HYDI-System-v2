'use strict';

// Mock stripe before SubscriptionManager is loaded
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/test' }),
      },
    },
    billingPortal: {
      sessions: {
        create: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/test' }),
      },
    },
    subscriptions: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'sub_test',
        items: { data: [{ id: 'si_test', amount: 9900 }] },
      }),
      update: jest.fn().mockResolvedValue({ id: 'sub_test', cancel_at_period_end: true }),
    },
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({ type: 'test.event', data: { object: {} } }),
    },
  }));
});

// Prevent real Supabase calls
jest.mock('../../src/database', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn().mockResolvedValue({ data: [], error: null }),
      upsert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({ data: { id: 'user_1' }, error: null }),
        })),
      })),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: null, error: null }) })),
      })),
      update: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) })),
    })),
  },
}));

const SubscriptionManager = require('../../src/services/subscription-manager');

describe('SubscriptionManager', () => {
  let manager;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
    process.env.STRIPE_HYDI_STARTER_PRICE_ID = 'price_starter';
    process.env.STRIPE_HYDI_PRO_PRICE_ID = 'price_pro';
    process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID = 'price_enterprise';
    process.env.BASE_URL = 'https://test.hydi.ai';
    manager = new SubscriptionManager();
  });

  afterEach(() => {
    if (manager && typeof manager.destroy === 'function') {
      return manager.destroy();
    }
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('creates instance with stripe client', () => {
      expect(manager).toBeDefined();
      expect(manager.stripe).toBeDefined();
    });
  });

  describe('createCheckoutSession', () => {
    test.each(['starter', 'pro', 'enterprise'])('creates session for %s tier', async (tier) => {
      const session = await manager.createCheckoutSession(
        'cus_test', tier,
        'https://test.hydi.ai/success', 'https://test.hydi.ai/cancel'
      );
      expect(session.id).toBe('cs_test');
    });
  });

  describe('createPortalSession', () => {
    test('returns portal url', async () => {
      const session = await manager.createPortalSession('cus_test');
      expect(session.url).toContain('stripe.com');
    });
  });

  describe('generateApiKey', () => {
    test('starter grants 8 services', async () => {
      const { permissions } = await manager.generateApiKey('cus_1', 'starter');
      expect(permissions.serviceIds).toHaveLength(8);
      expect(permissions.priorityAccess).toBe(false);
    });

    test('pro grants 20 services', async () => {
      const { permissions } = await manager.generateApiKey('cus_2', 'pro');
      expect(permissions.serviceIds).toHaveLength(20);
    });

    test('enterprise grants 30 services with priority', async () => {
      const { permissions } = await manager.generateApiKey('cus_3', 'enterprise');
      expect(permissions.serviceIds).toHaveLength(30);
      expect(permissions.priorityAccess).toBe(true);
    });

    test('key is a 64-char hex string', async () => {
      const { key } = await manager.generateApiKey('cus_1', 'pro');
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    test('resolves the users row via upsert and returns its id', async () => {
      const { userId } = await manager.generateApiKey('cus_1', 'starter');
      expect(userId).toBe('user_1');
    });
  });

  describe('cancelSubscription', () => {
    test('returns cancel_at_period_end=true', async () => {
      const result = await manager.cancelSubscription('sub_test');
      expect(result.cancel_at_period_end).toBe(true);
    });
  });

  describe('triggerHeidiWorkflow', () => {
    test('resolves without throwing (death loop guard swallows errors)', async () => {
      await expect(
        manager.triggerHeidiWorkflow('test_flow', { customerId: 'cus_test' })
      ).resolves.not.toThrow();
    });
  });
});
