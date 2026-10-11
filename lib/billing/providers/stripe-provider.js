'use strict';

/**
 * Stripe implementation of the billing provider adapter.
 *
 * The rest of lib/billing never imports `stripe` directly — swapping
 * providers means writing another object with these methods:
 *   createCustomer, createCheckoutSession, retrieveCheckoutSession,
 *   createPortalSession, retrieveSubscription, setCancellation,
 *   createPrice, createRefund, findInvoiceForPaymentIntent,
 *   verifyWebhook, describeEvent, normalizeEvent
 *
 * Safety: refuses to construct with a live key unless ALLOW_LIVE_STRIPE=true
 * (same rule as lib/revenue/stripe-mode.ts). Hosted Checkout and the hosted
 * Customer Portal are the only places card data is entered — no card data
 * ever touches Hydi.
 */

const { BillingError } = require('../errors');
const { normalizeStripeEvent, describeStripeEvent, subscriptionSnapshot } = require('./stripe-normalize');

function providerUnavailable(err) {
  const e = new BillingError('provider_unavailable', `billing provider request failed: ${err && err.message ? err.message : 'unknown error'}`, 503);
  e.cause = err;
  return e;
}

class StripeBillingProvider {
  /**
   * @param {{ secretKey?: string, webhookSecret?: string, client?: any }} [opts]
   */
  constructor(opts = {}) {
    const key = opts.secretKey || process.env.STRIPE_SECRET_KEY;
    if (!opts.client && !key) throw new BillingError('provider_not_configured', 'STRIPE_SECRET_KEY is not set', 503);
    const isLive = !!key && (key.startsWith('sk_live_') || key.startsWith('rk_live_'));
    if (isLive && process.env.ALLOW_LIVE_STRIPE !== 'true') {
      throw new BillingError('live_mode_not_authorized', 'live Stripe key present but ALLOW_LIVE_STRIPE is not "true"', 503);
    }
    this.name = 'stripe';
    this.mode = isLive ? 'live' : 'test';
    this.webhookSecret = opts.webhookSecret || process.env.BILLING_STRIPE_WEBHOOK_SECRET || '';
    if (opts.client) {
      this.stripe = opts.client;
    } else {
      const Stripe = require('stripe');
      this.stripe = new Stripe(key, { maxNetworkRetries: 2, timeout: 20000 });
    }
  }

  async _call(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err && err.type === 'StripeInvalidRequestError') {
        throw new BillingError('provider_rejected', err.message, 422);
      }
      throw providerUnavailable(err);
    }
  }

  async createCustomer({ tenantId, name, email, idempotencyKey }) {
    const c = await this._call(() => this.stripe.customers.create(
      { name, email, metadata: { hydi_tenant_id: tenantId } },
      { idempotencyKey },
    ));
    return { providerCustomerId: c.id };
  }

  async createCheckoutSession({ providerCustomerId, providerPriceId, trialDays, successUrl, cancelUrl, metadata, idempotencyKey }) {
    const params = {
      mode: 'subscription',
      customer: providerCustomerId,
      line_items: [{ price: providerPriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: metadata.hydi_tenant_id,
      metadata,
      subscription_data: { metadata, ...(trialDays > 0 ? { trial_period_days: trialDays } : {}) },
      allow_promotion_codes: process.env.BILLING_ALLOW_PROMOTION_CODES === 'true',
    };
    const s = await this._call(() => this.stripe.checkout.sessions.create(params, { idempotencyKey }));
    return { sessionId: s.id, url: s.url };
  }

  async retrieveCheckoutSession(sessionId) {
    const s = await this._call(() => this.stripe.checkout.sessions.retrieve(sessionId));
    return {
      sessionId: s.id,
      status: s.status,
      paymentStatus: s.payment_status,
      providerSubscriptionId: typeof s.subscription === 'string' ? s.subscription : (s.subscription && s.subscription.id) || null,
      providerCustomerId: typeof s.customer === 'string' ? s.customer : (s.customer && s.customer.id) || null,
      metadata: s.metadata || {},
    };
  }

  async createPortalSession({ providerCustomerId, returnUrl }) {
    const s = await this._call(() => this.stripe.billingPortal.sessions.create({ customer: providerCustomerId, return_url: returnUrl }));
    return { url: s.url };
  }

  async retrieveSubscription(providerSubscriptionId) {
    const sub = await this._call(() => this.stripe.subscriptions.retrieve(providerSubscriptionId));
    return subscriptionSnapshot(sub);
  }

  /** cancelAtPeriodEnd=false reactivates a pending cancellation. */
  async setCancellation({ providerSubscriptionId, immediate, cancelAtPeriodEnd, idempotencyKey }) {
    const sub = immediate
      ? await this._call(() => this.stripe.subscriptions.cancel(providerSubscriptionId, {}, { idempotencyKey }))
      : await this._call(() => this.stripe.subscriptions.update(providerSubscriptionId, { cancel_at_period_end: !!cancelAtPeriodEnd }, { idempotencyKey }));
    return subscriptionSnapshot(sub);
  }

  async createPrice({ productKey, productName, unitAmountMinor, currency, interval, intervalCount, idempotencyKey }) {
    const p = await this._call(() => this.stripe.prices.create({
      currency,
      unit_amount: unitAmountMinor,
      recurring: { interval, interval_count: intervalCount },
      product_data: { name: productName, metadata: { hydi_product_key: productKey } },
      metadata: { hydi_product_key: productKey },
    }, { idempotencyKey }));
    return { providerPriceId: p.id };
  }

  async createRefund({ paymentIntent, amountMinor, reason, idempotencyKey }) {
    const r = await this._call(() => this.stripe.refunds.create({
      payment_intent: paymentIntent,
      amount: amountMinor,
      metadata: { hydi_reason: String(reason).slice(0, 450) },
    }, { idempotencyKey }));
    return { providerRefundId: r.id, status: r.status };
  }

  async findInvoiceForPaymentIntent(paymentIntent) {
    // 2025+ API: invoices link to payments through the InvoicePayment object.
    if (this.stripe.invoicePayments && this.stripe.invoicePayments.list) {
      const list = await this._call(() => this.stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntent }, limit: 1 }));
      const first = list && list.data && list.data[0];
      if (first && first.invoice) return typeof first.invoice === 'string' ? first.invoice : first.invoice.id;
    }
    return null;
  }

  verifyWebhook(rawBody, headers) {
    if (!this.webhookSecret) throw new BillingError('webhook_not_configured', 'BILLING_STRIPE_WEBHOOK_SECRET is not set', 503);
    const sig = headers['stripe-signature'];
    if (!sig) throw new BillingError('invalid_signature', 'missing stripe-signature header', 400);
    try {
      return this.stripe.webhooks.constructEvent(rawBody, sig, this.webhookSecret);
    } catch (err) {
      throw new BillingError('invalid_signature', 'webhook signature verification failed', 400);
    }
  }

  describeEvent(event) {
    return describeStripeEvent(event);
  }

  normalizeEvent(event) {
    return normalizeStripeEvent(event);
  }
}

module.exports = { StripeBillingProvider };
