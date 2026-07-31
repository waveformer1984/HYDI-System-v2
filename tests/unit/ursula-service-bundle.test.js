'use strict';

// UrsulaModelHeartbeat is a real singleton (src/models/heartbeat.js) whose
// .start() spawns local-model health checks -- side effects a unit test
// must not trigger. Mock it the same way the module consumes it: as an
// already-constructed instance with start()/stop().
jest.mock('../../src/models/heartbeat', () => ({
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn(),
}));

const UrsulaServiceBundle = require('../../modules/ursula-service-bundle');

describe('UrsulaServiceBundle', () => {
  describe('constructor', () => {
    // Regression test: the constructor called this.initializeHeartbeat(),
    // which didn't exist anywhere on the class -- every instantiation threw
    // "this.initializeHeartbeat is not a function" immediately.
    test('constructs without throwing and registers services', () => {
      const bundle = new UrsulaServiceBundle();
      expect(bundle.services.size).toBeGreaterThan(0);
    });

    test('wires this.heartbeat to the shared singleton and starts it', () => {
      const heartbeat = require('../../src/models/heartbeat');
      const bundle = new UrsulaServiceBundle({ autoStartHeartbeat: true });
      expect(bundle.heartbeat).toBe(heartbeat);
      expect(heartbeat.start).toHaveBeenCalled();
    });

    test('destroy stops the shared heartbeat', async () => {
      const heartbeat = require('../../src/models/heartbeat');
      const bundle = new UrsulaServiceBundle({ autoStartHeartbeat: true });
      await bundle.destroy();
      expect(heartbeat.stop).toHaveBeenCalled();
    });
  });

  describe('mapStripePriceToTier', () => {
    // Regression test: this used to compare against literal strings like
    // 'price_starter', which no real Stripe price ID (price_1Oxxxx...) ever
    // equals -- every real subscription silently fell back to 'starter'.
    test('maps env-configured price IDs to their tier', () => {
      process.env.STRIPE_HYDI_STARTER_PRICE_ID = 'price_1AAA';
      process.env.STRIPE_HYDI_PRO_PRICE_ID = 'price_1BBB';
      process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID = 'price_1CCC';

      const bundle = new UrsulaServiceBundle();
      expect(bundle.mapStripePriceToTier('price_1AAA')).toBe('starter');
      expect(bundle.mapStripePriceToTier('price_1BBB')).toBe('pro');
      expect(bundle.mapStripePriceToTier('price_1CCC')).toBe('enterprise');
    });

    test('falls back to starter for an unrecognized price ID', () => {
      const bundle = new UrsulaServiceBundle();
      expect(bundle.mapStripePriceToTier('price_unknown')).toBe('starter');
    });
  });

  describe('createSubscription / getSubscriptionByCustomerId', () => {
    test('finds the subscription created for a given customer', () => {
      const bundle = new UrsulaServiceBundle();
      const subscription = bundle.createSubscription('pro', 'cus_123');

      const found = bundle.getSubscriptionByCustomerId('cus_123');
      expect(found).not.toBeNull();
      expect(found.id).toBe(subscription.id);
    });

    test('returns null for a customer with no subscription', () => {
      const bundle = new UrsulaServiceBundle();
      expect(bundle.getSubscriptionByCustomerId('cus_nonexistent')).toBeNull();
    });

    test('emits subscription_created with the shape SubscriptionManager expects', () => {
      const bundle = new UrsulaServiceBundle();
      const listener = jest.fn();
      bundle.on('subscription_created', listener);

      bundle.createSubscription('starter', 'cus_456');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_456', tier: 'starter' })
      );
    });
  });
});
