'use strict';

const { createHash } = require('crypto');
const { BillingError } = require('../billing/errors');

const PRODUCT_KEY = 'galactic_bytes_first_product';
const REVENUE_STREAM = 'galactic_bytes';
const IDEMPOTENCY_RE = /^[A-Za-z0-9_\-:.]{8,200}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function orderIdFor(key) {
  return `gb_${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

class GalacticBytesCommerce {
  constructor({ store, provider, board, env = process.env, clock = () => new Date(), appUrl } = {}) {
    if (!store) throw new Error('GalacticBytesCommerce requires a store');
    this.store = store;
    this.provider = provider;
    this.board = board;
    this.env = env;
    this.clock = clock;
    this.appUrl = String(appUrl || env.BILLING_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  }

  _priceId() {
    const live = this.provider && this.provider.mode === 'live';
    const name = live ? 'GALACTIC_BYTES_STRIPE_PRICE_ID_LIVE' : 'GALACTIC_BYTES_STRIPE_PRICE_ID_TEST';
    const value = String(this.env[name] || '').trim();
    if (!value) throw new BillingError('product_not_configured', `${name} is not set`, 503);
    if (!value.startsWith('price_')) throw new BillingError('product_not_configured', `${name} must be a Stripe Price ID`, 503);
    return value;
  }

  async startCheckout({ email, idempotencyKey }) {
    if (!this.provider || typeof this.provider.createOneTimeCheckoutSession !== 'function') {
      throw new BillingError('provider_not_configured', 'one-time checkout provider is not configured', 503);
    }
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail) || normalizedEmail.length > 320) {
      throw new BillingError('invalid_request', 'a valid email is required', 400);
    }
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_RE.test(idempotencyKey)) {
      throw new BillingError('invalid_idempotency_key', 'idempotency_key must be 8-200 safe characters', 400);
    }

    const orderId = orderIdFor(idempotencyKey);
    let order = await this.store.findOne('checkout_sessions', { id: orderId });
    if (order && order.customer_email !== normalizedEmail) {
      throw new BillingError('idempotency_key_reused', 'idempotency_key was already used for another order', 409);
    }
    if (!order) {
      order = await this.store.insert('checkout_sessions', {
        id: orderId,
        customer_email: normalizedEmail,
        status: 'pending',
        created_at: this.clock(),
      }, { ignoreConflict: true }) || await this.store.findOne('checkout_sessions', { id: orderId });
    }

    const metadata = {
      hydi_product_key: PRODUCT_KEY,
      hydi_revenue_stream: REVENUE_STREAM,
      hydi_order_id: orderId,
    };
    const session = await this.provider.createOneTimeCheckoutSession({
      providerPriceId: this._priceId(),
      customerEmail: normalizedEmail,
      successUrl: `${this.appUrl}/galactic-bytes/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${this.appUrl}/galactic-bytes/cancel`,
      metadata,
      idempotencyKey: `galactic-bytes-${orderId}`,
    });
    await this.store.update('checkout_sessions', { id: orderId }, { stripe_session_id: session.sessionId });
    return { order_id: orderId, url: session.url };
  }

  async handleCheckoutCompleted(event, meta = {}) {
    const metadata = event.metadata || {};
    if (metadata.hydi_product_key !== PRODUCT_KEY || metadata.hydi_revenue_stream !== REVENUE_STREAM) return 'ignored';
    if (event.mode !== 'payment' || event.paymentStatus !== 'paid') {
      throw new BillingError('invalid_payment_state', 'Galactic Bytes checkout is not a paid one-time payment', 422);
    }
    if (!Number.isSafeInteger(event.amountTotalMinor) || event.amountTotalMinor < 0 || !event.currency) {
      throw new BillingError('invalid_payment_amount', 'Galactic Bytes checkout is missing its provider amount', 422);
    }

    const order = await this.store.findOne('checkout_sessions', { id: metadata.hydi_order_id });
    if (!order) throw new BillingError('order_not_found', 'Galactic Bytes order was not found', 422);
    if (order.stripe_session_id && order.stripe_session_id !== event.sessionId) {
      throw new BillingError('order_mismatch', 'Galactic Bytes order does not match the checkout session', 422);
    }

    await this.store.update('checkout_sessions', { id: order.id }, {
      stripe_session_id: event.sessionId,
      amount: event.amountTotalMinor / 100,
      currency: event.currency,
      status: 'completed',
      completed_at: this.clock(),
    });

    const marker = await this.store.findOne('billing_audit_events', {
      action: 'galactic_bytes.manual_delivery_posted',
      target_type: 'checkout_session',
      target_id: order.id,
    });
    if (!marker) {
      const result = this.board && await this.board.post(
        'ops',
        `NEW ORDER — deliver manually\nOrder: ${order.id}\nAmount: ${event.currency.toUpperCase()} ${(event.amountTotalMinor / 100).toFixed(2)}\nStripe session: ${event.sessionId}`,
        null,
        { sender: 'ProtoForge' },
      );
      if (!result || result.ok !== true) throw new Error('Forge Board delivery notice failed');
      await this.store.insert('billing_audit_events', {
        actor_type: 'system',
        actor_id: 'galactic-bytes-checkout',
        action: 'galactic_bytes.manual_delivery_posted',
        target_type: 'checkout_session',
        target_id: order.id,
        reason: meta.eventId ? `stripe event ${meta.eventId}` : null,
        created_at: this.clock(),
      });
    }
    return 'processed';
  }
}

module.exports = { GalacticBytesCommerce, PRODUCT_KEY, REVENUE_STREAM, orderIdFor };
