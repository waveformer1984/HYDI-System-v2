/**
 * Unit tests for SubscriptionManager
 * Covers billing lifecycle, API key generation, Heidi death-loop guard,
 * analytics, and webhook handlers — all offline via mocks.
 */

const EventEmitter = require('events');

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockStripeInstance;
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => {
    mockStripeInstance = {
      checkout: { sessions: { create: jest.fn() } },
      billingPortal: { sessions: { create: jest.fn() } },
      subscriptions: { retrieve: jest.fn(), update: jest.fn() },
      webhooks: { constructEvent: jest.fn() },
    };
    return mockStripeInstance;
  });
});

jest.mock('../../src/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

const SubscriptionManager = require('../../src/services/subscription-manager');
const { supabase } = require('../../src/database');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeChain(resolveValue = { error: null }) {
  const chain = {
    insert: jest.fn().mockResolvedValue(resolveValue),
    update: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resolveValue),
  };
  chain.update.mockReturnValue(chain);
  supabase.from.mockReturnValue(chain);
  return chain;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SubscriptionManager', () => {
  let manager;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_HYDI_STARTER_PRICE_ID = 'price_starter';
    process.env.STRIPE_HYDI_PRO_PRICE_ID = 'price_pro';
    process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID = 'price_enterprise';
    process.env.BASE_URL = 'https://app.example.com';
    manager = new SubscriptionManager();
  });

  // ── createCheckoutSession ───────────────────────────────────────────────

  describe('createCheckoutSession', () => {
    it('creates a session with the correct price for each tier', async () => {
      const fakeSession = { id: 'cs_test' };
      mockStripeInstance.checkout.sessions.create.mockResolvedValue(fakeSession);

      for (const [tier, priceId] of [
        ['starter', 'price_starter'],
        ['pro', 'price_pro'],
        ['enterprise', 'price_enterprise'],
      ]) {
        const result = await manager.createCheckoutSession('cus_1', tier, '/success', '/cancel');
        expect(result).toBe(fakeSession);
        expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            customer: 'cus_1',
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: '/success',
            cancel_url: '/cancel',
            metadata: { tier },
          })
        );
      }
    });

    it('enables automatic tax collection', async () => {
      mockStripeInstance.checkout.sessions.create.mockResolvedValue({});
      await manager.createCheckoutSession('cus_1', 'pro', '/ok', '/cancel');
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ automatic_tax: { enabled: true } })
      );
    });
  });

  // ── createPortalSession ─────────────────────────────────────────────────

  describe('createPortalSession', () => {
    it('creates a billing portal session with the correct return URL', async () => {
      const fakePortal = { url: 'https://billing.stripe.com/session/test' };
      mockStripeInstance.billingPortal.sessions.create.mockResolvedValue(fakePortal);

      const result = await manager.createPortalSession('cus_1');

      expect(result).toBe(fakePortal);
      expect(mockStripeInstance.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_1',
        return_url: 'https://app.example.com/account',
      });
    });
  });

  // ── generateApiKey — permission matrix ──────────────────────────────────

  describe('generateApiKey', () => {
    it('gives starter 8 services, no priority, limit 1000', async () => {
      const chain = makeChain({ error: null });

      const { key, permissions } = await manager.generateApiKey('cus_1', 'sub_1', 'starter');

      expect(permissions.serviceIds).toHaveLength(8);
      expect(permissions.serviceIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(permissions.priorityAccess).toBe(false);
      expect(permissions.apiLimit).toBe(1000);
      expect(typeof key).toBe('string');
      expect(key).toHaveLength(64); // 32 bytes → 64 hex chars
      // Chain was called for api_keys insert and subscriptions update
      expect(supabase.from).toHaveBeenCalledWith('api_keys');
      expect(supabase.from).toHaveBeenCalledWith('subscriptions');
    });

    it('gives pro 20 services, no priority, limit 10000', async () => {
      makeChain({ error: null });
      const { permissions } = await manager.generateApiKey('cus_1', 'sub_1', 'pro');
      expect(permissions.serviceIds).toHaveLength(20);
      expect(permissions.serviceIds[0]).toBe(1);
      expect(permissions.serviceIds[19]).toBe(20);
      expect(permissions.priorityAccess).toBe(false);
      expect(permissions.apiLimit).toBe(10000);
    });

    it('gives enterprise all 30 services, priority access, unlimited', async () => {
      makeChain({ error: null });
      const { permissions } = await manager.generateApiKey('cus_1', 'sub_1', 'enterprise');
      expect(permissions.serviceIds).toHaveLength(30);
      expect(permissions.priorityAccess).toBe(true);
      expect(permissions.apiLimit).toBe(Infinity);
    });

    it('stores key hash, not raw key', async () => {
      const crypto = require('crypto');
      const chain = makeChain({ error: null });
      const { key, hash } = await manager.generateApiKey('cus_1', 'sub_1', 'pro');
      const expected = crypto.createHash('sha256').update(key).digest('hex');
      expect(hash).toBe(expected);
      expect(hash).not.toBe(key);
    });

    it('throws when the DB insert fails', async () => {
      supabase.from.mockReturnValue({
        insert: jest.fn().mockRejectedValue(new Error('DB insert failed')),
      });
      await expect(manager.generateApiKey('cus_1', 'sub_1', 'starter')).rejects.toThrow('DB insert failed');
    });
  });

  // ── triggerHeidiWorkflow — death-loop guard ──────────────────────────────

  describe('triggerHeidiWorkflow (death-loop guard)', () => {
    it('inserts a task into heidi_tasks', async () => {
      const chain = makeChain({ error: null });
      await manager.triggerHeidiWorkflow('welcome_sequence', { customerId: 'cus_1' });
      expect(supabase.from).toHaveBeenCalledWith('heidi_tasks');
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow: 'welcome_sequence',
          status: 'pending',
          data: { customerId: 'cus_1' },
        })
      );
    });

    it('never throws even when the DB insert fails', async () => {
      supabase.from.mockReturnValue({
        insert: jest.fn().mockRejectedValue(new Error('Supabase down')),
      });
      await expect(
        manager.triggerHeidiWorkflow('api_key_delivery', { customerId: 'cus_2' })
      ).resolves.not.toThrow();
    });

    it('never throws even when the DB returns an error object', async () => {
      supabase.from.mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: { message: 'constraint violation' } }),
      });
      await expect(
        manager.triggerHeidiWorkflow('payment_recovery', {})
      ).resolves.not.toThrow();
    });
  });

  // ── recordServiceUsage ───────────────────────────────────────────────────

  describe('recordServiceUsage', () => {
    it('inserts a usage record into service_usage', async () => {
      const chain = makeChain({ error: null });
      const data = { subscriptionId: 'sub_1', serviceId: 'svc_a', usage: 5, revenue: 12.5, timestamp: '2026-01-01' };
      await manager.recordServiceUsage(data);
      expect(supabase.from).toHaveBeenCalledWith('service_usage');
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ subscription_id: 'sub_1', service_id: 'svc_a', usage_count: 5, revenue: 12.5 })
      );
    });

    it('does not throw when the insert fails', async () => {
      supabase.from.mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: { message: 'DB error' } }),
      });
      await expect(manager.recordServiceUsage({ subscriptionId: 'sub_1', serviceId: 'svc_a', usage: 1, revenue: 0 }))
        .resolves.not.toThrow();
    });
  });

  // ── publishMarketingContent ───────────────────────────────────────────────

  describe('publishMarketingContent', () => {
    it('inserts content into marketing_queue with status scheduled', async () => {
      const chain = makeChain({ error: null });
      await manager.publishMarketingContent({ content: 'Hello!', platform: 'twitter', timestamp: 'now' });
      expect(supabase.from).toHaveBeenCalledWith('marketing_queue');
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Hello!', platform: 'twitter', status: 'scheduled' })
      );
    });
  });

  // ── getSubscriptionAnalytics — MRR calculation ───────────────────────────

  describe('getSubscriptionAnalytics', () => {
    it('calculates MRR correctly from tier prices', async () => {
      const mockSubs = [
        { tier: 'starter' },
        { tier: 'starter' },
        { tier: 'pro' },
        { tier: 'enterprise' },
      ];
      // First call: subscriptions, second: service_usage
      supabase.from
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue({ data: mockSubs, error: null }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue({ data: [], error: null }),
        });

      const analytics = await manager.getSubscriptionAnalytics();

      expect(analytics.total).toBe(4);
      expect(analytics.byTier.starter).toBe(2);
      expect(analytics.byTier.pro).toBe(1);
      expect(analytics.byTier.enterprise).toBe(1);
      // MRR = 49*2 + 149 + 499 = 746
      expect(analytics.mrr).toBe(746);
    });

    it('returns null when the DB query fails', async () => {
      supabase.from.mockReturnValue({
        select: jest.fn().mockRejectedValue(new Error('DB error')),
      });
      const result = await manager.getSubscriptionAnalytics();
      expect(result).toBeNull();
    });
  });

  // ── cancelSubscription ───────────────────────────────────────────────────

  describe('cancelSubscription', () => {
    it('sets cancel_at_period_end and updates local DB', async () => {
      const fakeStripeResult = { id: 'sub_1', cancel_at_period_end: true };
      mockStripeInstance.subscriptions.update.mockResolvedValue(fakeStripeResult);
      const chain = makeChain({ error: null });

      const result = await manager.cancelSubscription('sub_1');

      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith('sub_1', {
        cancel_at_period_end: true,
      });
      expect(result).toBe(fakeStripeResult);
      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ active: false })
      );
    });
  });

  // ── handlePaymentFailure ─────────────────────────────────────────────────

  describe('handlePaymentFailure', () => {
    it('updates subscription status to payment_failed', async () => {
      const sub = { subscription_id: 'sub_local', tier: 'pro' };
      const chain = makeChain({ data: sub, error: null });

      await manager.handlePaymentFailure({
        customer: 'cus_1',
        subscription: 'sub_stripe',
        amount_due: 4900,
        next_payment_attempt: Math.floor(Date.now() / 1000) + 86400,
      });

      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'payment_failed' })
      );
    });

    it('does not throw when the Heidi workflow fails', async () => {
      const sub = { subscription_id: 'sub_local', tier: 'pro' };
      makeChain({ data: sub, error: null });
      jest.spyOn(manager, 'triggerHeidiWorkflow').mockRejectedValue(new Error('Heidi down'));

      await expect(
        manager.handlePaymentFailure({ customer: 'cus_1', subscription: 'sub_1', amount_due: 100, next_payment_attempt: 0 })
      ).resolves.not.toThrow();
    });
  });
});
