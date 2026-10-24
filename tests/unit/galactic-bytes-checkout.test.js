'use strict';

const { StripeBillingProvider } = require('../../lib/billing/providers/stripe-provider');
const { normalizeStripeEvent } = require('../../lib/billing/providers/stripe-normalize');
const { MemoryBillingStore } = require('../../lib/billing/stores/memory-store');
const { BillingService } = require('../../lib/billing/service');
const { liveRevenueSummary } = require('../../lib/billing/live-summary');
const { GalacticBytesCommerce, PRODUCT_KEY, REVENUE_STREAM } = require('../../lib/galactic-bytes/commerce');

describe('Galactic Bytes checkout', () => {
  it('creates a payment-mode Stripe session using only the configured Price ID', async () => {
    const create = jest.fn(async () => ({ id: 'cs_test_gb', url: 'https://checkout.stripe.test/cs_test_gb' }));
    const provider = new StripeBillingProvider({ client: { checkout: { sessions: { create } } } });
    const result = await provider.createOneTimeCheckoutSession({
      providerPriceId: 'price_from_env',
      customerEmail: 'buyer@example.test',
      successUrl: 'https://example.test/galactic-bytes/success',
      cancelUrl: 'https://example.test/galactic-bytes/cancel',
      metadata: { hydi_order_id: 'gb_1' },
      idempotencyKey: 'galactic-bytes-gb_1',
    });

    expect(result).toEqual({ sessionId: 'cs_test_gb', url: 'https://checkout.stripe.test/cs_test_gb' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment',
      customer_email: 'buyer@example.test',
      line_items: [{ price: 'price_from_env', quantity: 1 }],
      payment_intent_data: { metadata: { hydi_order_id: 'gb_1' } },
    }), { idempotencyKey: 'galactic-bytes-gb_1' });
    expect(create.mock.calls[0][0].line_items[0]).not.toHaveProperty('price_data');
  });

  it('stores and processes a live webhook once, records the order, and feeds the phone ledger', async () => {
    const now = new Date('2026-10-22T12:00:00Z');
    const store = new MemoryBillingStore();
    const board = { post: jest.fn(async () => ({ ok: true, id: 'post-1' })) };
    const provider = {
      name: 'stripe',
      mode: 'live',
      createOneTimeCheckoutSession: jest.fn(async () => ({
        sessionId: 'cs_live_gb_1',
        url: 'https://checkout.stripe.test/cs_live_gb_1',
      })),
      verifyWebhook: (payload) => JSON.parse(payload.toString()),
      describeEvent: (event) => ({
        id: event.id,
        type: event.type,
        created: new Date(event.created * 1000),
        livemode: event.livemode,
      }),
      normalizeEvent: normalizeStripeEvent,
    };
    const commerce = new GalacticBytesCommerce({
      store,
      provider,
      board,
      env: { GALACTIC_BYTES_STRIPE_PRICE_ID_LIVE: 'price_live_gb', BILLING_APP_URL: 'https://shop.example.test' },
      clock: () => now,
    });
    const service = new BillingService({
      store,
      provider,
      clock: () => now,
      checkoutCompletedHandler: (event, meta) => commerce.handleCheckoutCompleted(event, meta),
    });

    const checkout = await commerce.startCheckout({ email: 'buyer@example.test', idempotencyKey: 'purchase-0001' });
    const event = {
      id: 'evt_live_gb_1',
      type: 'checkout.session.completed',
      created: 1792666800,
      livemode: true,
      data: {
        object: {
          id: 'cs_live_gb_1',
          mode: 'payment',
          payment_status: 'paid',
          amount_total: 100,
          currency: 'usd',
          customer_details: { email: 'buyer@example.test' },
          payment_intent: 'pi_live_gb_1',
          metadata: {
            hydi_product_key: PRODUCT_KEY,
            hydi_revenue_stream: REVENUE_STREAM,
            hydi_order_id: checkout.order_id,
          },
        },
      },
    };
    const raw = Buffer.from(JSON.stringify(event));
    const first = await service.receiveWebhook(raw, {});
    expect(first).toMatchObject({ duplicate: false });
    await expect(service.processWebhookEvent(first.eventRowId)).resolves.toEqual({ outcome: 'processed' });

    const duplicate = await service.receiveWebhook(raw, {});
    expect(duplicate).toMatchObject({ duplicate: true, status: 'processed' });
    const inbox = await store.findMany('billing_webhook_events');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ provider_event_id: 'evt_live_gb_1', livemode: true, status: 'processed' });

    const order = await store.findOne('checkout_sessions', { id: checkout.order_id });
    expect(order).toMatchObject({
      stripe_session_id: 'cs_live_gb_1',
      amount: 1,
      currency: 'usd',
      status: 'completed',
      customer_email: 'buyer@example.test',
    });
    expect(board.post).toHaveBeenCalledTimes(1);
    expect(board.post).toHaveBeenCalledWith('ops', expect.stringContaining('NEW ORDER — deliver manually'), null, { sender: 'ProtoForge' });

    const summary = await liveRevenueSummary(store, { now: () => now });
    expect(summary.totals.usd).toMatchObject({ paid_cents: 100, net_cents: 100, events: 1 });
  });
});
