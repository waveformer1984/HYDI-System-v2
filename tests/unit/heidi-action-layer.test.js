/**
 * Unit tests for HeidiActionLayer
 * External APIs (Stripe, Resend, Supabase, fs, child_process) are mocked.
 */

jest.mock('../../src/database', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockResolvedValue({ error: null }),
    }),
  },
}));

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(),
    readFile: jest.fn().mockResolvedValue('{}'),
    writeFile: jest.fn().mockResolvedValue(),
    access: jest.fn().mockResolvedValue(),
  },
}));

jest.mock('child_process', () => ({
  spawn: jest.fn().mockImplementation(() => {
    const EventEmitter = require('events');
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: jest.fn(), end: jest.fn() };
    setTimeout(() => proc.emit('close', 0), 10);
    return proc;
  }),
}));

const HeidiActionLayer = require('../../src/actions/HeidiActionLayer');
const { supabase } = require('../../src/database');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLayer(cfg = {}) {
  return new HeidiActionLayer({
    enableRevenueActions: true,
    enableScriptExecution: true,
    stripeSecretKey: 'sk_test_fake',
    emailApiKey: 'resend_fake',
    ...cfg,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HeidiActionLayer', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Constructor ───────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('applies default config values', () => {
      const layer = new HeidiActionLayer();
      expect(layer.config.maxConcurrentActions).toBe(10);
      expect(layer.config.actionTimeout).toBe(30000);
      expect(layer.config.enableRevenueActions).toBe(true);
      expect(layer.config.enableScriptExecution).toBe(true);
    });

    it('registers 10 built-in actions on init', () => {
      expect(makeLayer().actions.size).toBe(10);
    });

    it('starts with zero revenue', () => {
      const layer = makeLayer();
      expect(layer.revenue.generated).toBe(0);
      expect(layer.revenue.failed).toBe(0);
      expect(layer.revenue.pending).toBe(0);
    });

    it('starts with empty action history', () => {
      expect(makeLayer().actionHistory).toHaveLength(0);
    });
  });

  // ── registerAction ────────────────────────────────────────────────────────

  describe('registerAction', () => {
    it('adds a custom action handler', () => {
      const layer = makeLayer();
      const handler = jest.fn().mockResolvedValue({ result: 'custom' });
      layer.registerAction('custom_action', handler);
      expect(layer.actions.has('custom_action')).toBe(true);
    });

    it('overwrites an existing action handler', () => {
      const layer = makeLayer();
      const newHandler = jest.fn();
      layer.registerAction('send_email', newHandler);
      expect(layer.actions.get('send_email').handler).toBe(newHandler);
    });
  });

  // ── validateActionParams ──────────────────────────────────────────────────

  describe('validateActionParams', () => {
    const cases = [
      ['stripe_payment', { amount: 100 }, 'paymentMethodId'],
      ['send_email', { subject: 'hi' }, 'to'],
      ['update_database', { operation: 'insert' }, 'table'],
      ['launch_script', {}, 'script'],
      ['generate_offer', {}, 'type'],
      ['deploy_page', { content: '<div/>' }, 'pageId'],
      ['create_checkout', { price: 99 }, 'productName'],
      ['refund_payment', { amount: 50 }, 'paymentIntentId'],
      ['send_webhook', { data: {} }, 'url'],
    ];

    test.each(cases)('%s throws for missing param %s', (actionType, params, missingParam) => {
      expect(() => makeLayer().validateActionParams(actionType, params))
        .toThrow(`Missing required parameter: ${missingParam}`);
    });

    it('does not throw for unknown action types', () => {
      expect(() => makeLayer().validateActionParams('unknown_action', {})).not.toThrow();
    });

    it('does not throw when all required params are present', () => {
      expect(() => makeLayer().validateActionParams('send_email', { to: 'a@b.com', subject: 'hi' }))
        .not.toThrow();
    });
  });

  // ── generateOffer ──────────────────────────────────────────────────────────

  describe('generateOffer', () => {
    it('generates an offer with default title/description/price', async () => {
      const layer = makeLayer();
      const result = await layer.generateOffer({ type: 'starter' }, {});
      expect(result.offer.type).toBe('starter');
      expect(result.offer.title).toContain('Starter');
      expect(result.offer.price).toBe(29);
      expect(result.offer.id).toMatch(/^offer_/);
    });

    it('respects custom title, description, and price', async () => {
      const layer = makeLayer();
      const result = await layer.generateOffer({
        type: 'custom',
        title: 'My Deal',
        description: 'Best deal ever',
        price: 999,
      }, {});
      expect(result.offer.title).toBe('My Deal');
      expect(result.offer.description).toBe('Best deal ever');
      expect(result.offer.price).toBe(999);
    });
  });

  // ── generateOfferTitle ────────────────────────────────────────────────────

  describe('generateOfferTitle', () => {
    const cases = [
      ['starter', 'Starter'],
      ['pro', 'Professional'],
      ['enterprise', 'Enterprise'],
      ['custom', 'Custom'],
      ['unknown', 'Special Offer'],
    ];

    test.each(cases)('type %s includes expected word', (type, expected) => {
      expect(makeLayer().generateOfferTitle(type)).toContain(expected);
    });
  });

  // ── calculateOfferPrice ───────────────────────────────────────────────────

  describe('calculateOfferPrice', () => {
    it('returns 29 for starter', () => {
      expect(makeLayer().calculateOfferPrice('starter')).toBe(29);
    });

    it('returns 99 for pro', () => {
      expect(makeLayer().calculateOfferPrice('pro')).toBe(99);
    });

    it('returns 299 for enterprise', () => {
      expect(makeLayer().calculateOfferPrice('enterprise')).toBe(299);
    });

    it('returns 0 for custom', () => {
      expect(makeLayer().calculateOfferPrice('custom')).toBe(0);
    });

    it('returns 49 for unknown type', () => {
      expect(makeLayer().calculateOfferPrice('unknown_xyz')).toBe(49);
    });
  });

  // ── generateOfferTerms ────────────────────────────────────────────────────

  describe('generateOfferTerms', () => {
    it('returns monthly billing terms for starter', () => {
      expect(makeLayer().generateOfferTerms('starter')).toContain('Monthly');
    });

    it('returns a money-back guarantee for pro', () => {
      expect(makeLayer().generateOfferTerms('pro')).toContain('money back');
    });

    it('returns annual billing terms for enterprise', () => {
      expect(makeLayer().generateOfferTerms('enterprise')).toContain('Annual');
    });

    it('returns fallback for unknown type', () => {
      expect(makeLayer().generateOfferTerms('unknown')).toBe('Standard terms apply');
    });
  });

  // ── trackRevenue ──────────────────────────────────────────────────────────

  describe('trackRevenue', () => {
    it('adds positive amounts to revenue.generated', () => {
      const layer = makeLayer();
      layer.trackRevenue(100);
      layer.trackRevenue(50);
      expect(layer.revenue.generated).toBe(150);
    });

    it('adds absolute value of negative amounts to revenue.failed', () => {
      const layer = makeLayer();
      layer.trackRevenue(-75);
      expect(layer.revenue.failed).toBe(75);
    });

    it('increments pending count for zero amount', () => {
      const layer = makeLayer();
      layer.trackRevenue(0);
      expect(layer.revenue.pending).toBe(1);
    });

    it('emits revenue_tracked event', () => {
      const layer = makeLayer();
      const handler = jest.fn();
      layer.on('revenue_tracked', handler);
      layer.trackRevenue(49.99);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ amount: 49.99, total: 49.99 }));
    });
  });

  // ── executeAction ─────────────────────────────────────────────────────────

  describe('executeAction', () => {
    it('calls the registered handler for a known action', async () => {
      const layer = makeLayer();
      const handler = jest.fn().mockResolvedValue({ result: 'done', revenue: 0 });
      layer.registerAction('test_action', handler);
      await layer.executeAction('test_action', { param: 'x' }, {});
      expect(handler).toHaveBeenCalled();
    });

    it('throws for unknown action type', async () => {
      await expect(makeLayer().executeAction('nonexistent', {}, {}))
        .rejects.toThrow('Unknown action type: nonexistent');
    });

    it('emits action_completed on success', async () => {
      const layer = makeLayer();
      const handler = jest.fn().mockResolvedValue({ revenue: 0 });
      layer.registerAction('ok_action', handler);
      const onComplete = jest.fn();
      layer.on('action_completed', onComplete);
      await layer.executeAction('ok_action', {}, {});
      expect(onComplete).toHaveBeenCalled();
    });

    it('emits action_failed and re-throws on handler error', async () => {
      const layer = makeLayer();
      layer.registerAction('fail_action', jest.fn().mockRejectedValue(new Error('boom')));
      const onFail = jest.fn();
      layer.on('action_failed', onFail);
      await expect(layer.executeAction('fail_action', {}, {})).rejects.toThrow('boom');
      expect(onFail).toHaveBeenCalled();
    });

    it('tracks revenue when result includes positive revenue', async () => {
      const layer = makeLayer();
      layer.registerAction('rev_action', jest.fn().mockResolvedValue({ revenue: 99 }));
      await layer.executeAction('rev_action', {}, {});
      expect(layer.revenue.generated).toBe(99);
    });
  });

  // ── getStatus ─────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns object with expected shape', () => {
      const status = makeLayer().getStatus();
      expect(status).toHaveProperty('active');
      expect(status).toHaveProperty('registered');
      expect(status).toHaveProperty('revenue');
      expect(status.registered).toBe(10);
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears action history and revenue on reset', async () => {
      const layer = makeLayer();
      layer.trackRevenue(100);
      layer.actionHistory.push({ id: 'test' });
      await layer.reset();
      expect(layer.revenue.generated).toBe(0);
      expect(layer.actionHistory).toHaveLength(0);
    });
  });
});
