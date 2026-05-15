/**
 * Unit tests for StripeWebhookHandler
 * All Supabase and Stripe calls are mocked — no live services required.
 */

// Mock the database module before requiring the handler
jest.mock('../../src/database', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({}));
});

const StripeWebhookHandler = require('../../src/webhook-handlers/stripe-webhook');
const { supabase } = require('../../src/database');

// Builder for chainable Supabase mock responses
function mockSupabaseChain(resolveValue) {
  const chain = {
    upsert: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resolveValue),
  };
  supabase.from.mockReturnValue(chain);
  return chain;
}

describe('StripeWebhookHandler', () => {
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_HYDI_STARTER_PRICE_ID = 'price_starter';
    process.env.STRIPE_HYDI_PRO_PRICE_ID = 'price_pro';
    process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID = 'price_enterprise';
    handler = new StripeWebhookHandler();
  });

  // ─── getTierFromPriceId ──────────────────────────────────────────────────

  describe('getTierFromPriceId', () => {
    it('returns starter for the starter price ID', () => {
      expect(handler.getTierFromPriceId('price_starter')).toBe('starter');
    });

    it('returns pro for the pro price ID', () => {
      expect(handler.getTierFromPriceId('price_pro')).toBe('pro');
    });

    it('returns enterprise for the enterprise price ID', () => {
      expect(handler.getTierFromPriceId('price_enterprise')).toBe('enterprise');
    });

    it('defaults to starter for an unknown price ID', () => {
      expect(handler.getTierFromPriceId('price_unknown')).toBe('starter');
    });

    it('defaults to starter for undefined', () => {
      expect(handler.getTierFromPriceId(undefined)).toBe('starter');
    });
  });

  // ─── handleEvent routing ─────────────────────────────────────────────────

  describe('handleEvent', () => {
    it('routes checkout.session.completed to handleCheckoutCompleted', async () => {
      const spy = jest.spyOn(handler, 'handleCheckoutCompleted').mockResolvedValue();
      const session = { id: 'cs_test' };
      await handler.handleEvent({ type: 'checkout.session.completed', data: { object: session } });
      expect(spy).toHaveBeenCalledWith(session);
    });

    it('routes invoice.payment_succeeded to handlePaymentSucceeded', async () => {
      const spy = jest.spyOn(handler, 'handlePaymentSucceeded').mockResolvedValue();
      const invoice = { id: 'in_test' };
      await handler.handleEvent({ type: 'invoice.payment_succeeded', data: { object: invoice } });
      expect(spy).toHaveBeenCalledWith(invoice);
    });

    it('routes customer.subscription.created to handleSubscriptionChange', async () => {
      const spy = jest.spyOn(handler, 'handleSubscriptionChange').mockResolvedValue();
      const sub = { id: 'sub_test' };
      await handler.handleEvent({ type: 'customer.subscription.created', data: { object: sub } });
      expect(spy).toHaveBeenCalledWith(sub);
    });

    it('routes customer.subscription.updated to handleSubscriptionChange', async () => {
      const spy = jest.spyOn(handler, 'handleSubscriptionChange').mockResolvedValue();
      const sub = { id: 'sub_test' };
      await handler.handleEvent({ type: 'customer.subscription.updated', data: { object: sub } });
      expect(spy).toHaveBeenCalledWith(sub);
    });

    it('routes customer.subscription.deleted to handleSubscriptionCanceled', async () => {
      const spy = jest.spyOn(handler, 'handleSubscriptionCanceled').mockResolvedValue();
      const sub = { id: 'sub_test' };
      await handler.handleEvent({ type: 'customer.subscription.deleted', data: { object: sub } });
      expect(spy).toHaveBeenCalledWith(sub);
    });

    it('does not throw on unhandled event types', async () => {
      await expect(
        handler.handleEvent({ type: 'payment_intent.created', data: { object: {} } })
      ).resolves.not.toThrow();
    });
  });

  // ─── handlePaymentSucceeded ──────────────────────────────────────────────

  describe('handlePaymentSucceeded', () => {
    it('updates subscription_status to active for the matching customer', async () => {
      const chain = mockSupabaseChain({ data: { id: 'user_1', tier: 'pro' }, error: null });

      await handler.handlePaymentSucceeded({ customer: 'cus_123', subscription: 'sub_abc' });

      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ subscription_status: 'active' })
      );
      expect(chain.eq).toHaveBeenCalledWith('stripe_customer_id', 'cus_123');
    });

    it('does not throw when the DB update returns an error', async () => {
      mockSupabaseChain({ data: null, error: { message: 'DB error' } });

      await expect(
        handler.handlePaymentSucceeded({ customer: 'cus_bad', subscription: 'sub_bad' })
      ).resolves.not.toThrow();
    });
  });

  // ─── handleSubscriptionChange ────────────────────────────────────────────

  describe('handleSubscriptionChange', () => {
    it('updates tier and subscription_status in the DB', async () => {
      const chain = mockSupabaseChain({ data: { id: 'user_1' }, error: null });
      jest.spyOn(handler, 'updateAPIKeyTier').mockResolvedValue();

      const subscription = {
        customer: 'cus_123',
        id: 'sub_abc',
        status: 'active',
        items: { data: [{ price: { id: 'price_pro' } }] },
      };

      await handler.handleSubscriptionChange(subscription);

      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ tier: 'pro', subscription_status: 'active' })
      );
    });

    it('calls updateAPIKeyTier with the resolved tier', async () => {
      mockSupabaseChain({ data: { id: 'user_1' }, error: null });
      const updateSpy = jest.spyOn(handler, 'updateAPIKeyTier').mockResolvedValue();

      await handler.handleSubscriptionChange({
        customer: 'cus_123',
        id: 'sub_abc',
        status: 'active',
        items: { data: [{ price: { id: 'price_enterprise' } }] },
      });

      expect(updateSpy).toHaveBeenCalledWith('user_1', 'enterprise');
    });

    it('does not throw when the DB update returns an error', async () => {
      mockSupabaseChain({ data: null, error: { message: 'DB error' } });

      await expect(
        handler.handleSubscriptionChange({
          customer: 'cus_bad',
          id: 'sub_bad',
          status: 'active',
          items: { data: [] },
        })
      ).resolves.not.toThrow();
    });
  });

  // ─── handleSubscriptionCanceled ──────────────────────────────────────────

  describe('handleSubscriptionCanceled', () => {
    it('downgrades the user to starter tier and sets status to canceled', async () => {
      const chain = mockSupabaseChain({ data: { id: 'user_1' }, error: null });
      jest.spyOn(handler, 'updateAPIKeyTier').mockResolvedValue();

      await handler.handleSubscriptionCanceled({ customer: 'cus_123' });

      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ tier: 'starter', subscription_status: 'canceled' })
      );
      expect(chain.eq).toHaveBeenCalledWith('stripe_customer_id', 'cus_123');
    });

    it('calls updateAPIKeyTier with starter after cancellation', async () => {
      mockSupabaseChain({ data: { id: 'user_1' }, error: null });
      const updateSpy = jest.spyOn(handler, 'updateAPIKeyTier').mockResolvedValue();

      await handler.handleSubscriptionCanceled({ customer: 'cus_123' });

      expect(updateSpy).toHaveBeenCalledWith('user_1', 'starter');
    });

    it('does not throw when the DB update returns an error', async () => {
      mockSupabaseChain({ data: null, error: { message: 'DB error' } });

      await expect(
        handler.handleSubscriptionCanceled({ customer: 'cus_bad' })
      ).resolves.not.toThrow();
    });
  });

  // ─── generateAPIKey ──────────────────────────────────────────────────────

  describe('generateAPIKey', () => {
    it('inserts a hashed API key into the api_keys table', async () => {
      const chain = {
        insert: jest.fn().mockResolvedValue({ error: null }),
      };
      supabase.from.mockReturnValue(chain);

      const key = await handler.generateAPIKey('user_1', 'pro');

      expect(supabase.from).toHaveBeenCalledWith('api_keys');
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user_1',
          tier: 'pro',
          key_hash: expect.any(String),
          name: 'Default API Key',
        })
      );
      // Returns the raw (unhashed) key
      expect(typeof key).toBe('string');
      expect(key.length).toBe(64); // 32 bytes → 64 hex chars
    });

    it('stores a SHA-256 hash, not the raw key', async () => {
      const crypto = require('crypto');
      const chain = { insert: jest.fn().mockResolvedValue({ error: null }) };
      supabase.from.mockReturnValue(chain);

      const key = await handler.generateAPIKey('user_1', 'pro');
      const insertedPayload = chain.insert.mock.calls[0][0];

      const expectedHash = crypto.createHash('sha256').update(key).digest('hex');
      expect(insertedPayload.key_hash).toBe(expectedHash);
      expect(insertedPayload.key_hash).not.toBe(key);
    });

    it('returns null when the DB insert fails', async () => {
      supabase.from.mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: { message: 'DB error' } }),
      });

      const key = await handler.generateAPIKey('user_1', 'pro');
      expect(key).toBeNull();
    });
  });
});
