'use strict';

/**
 * Deterministic in-process stand-in for Stripe, for tests and keyless local
 * demos. It keeps Stripe-shaped objects (customers, prices, checkout
 * sessions, subscriptions, invoices, charges) and emits Stripe-shaped,
 * HMAC-signed webhook events, so the real normalization code
 * (stripe-normalize.js) and the real webhook pipeline are what get tested.
 *
 * It never moves money and is refused outside NODE_ENV=test unless
 * BILLING_PROVIDER=fake is set explicitly (see lib/billing/http.js).
 */

const { createHmac, timingSafeEqual, randomBytes } = require('crypto');
const { BillingError } = require('../errors');
const { normalizeStripeEvent, describeStripeEvent, subscriptionSnapshot } = require('./stripe-normalize');

const SIG_HEADER = 'x-fake-billing-signature';

function rid(prefix) {
  return `${prefix}_fake_${randomBytes(8).toString('hex')}`;
}

function sec(date) {
  return Math.floor(date.getTime() / 1000);
}

function addInterval(date, interval, count) {
  const d = new Date(date.getTime());
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + count);
  else d.setUTCMonth(d.getUTCMonth() + count);
  return d;
}

class FakeBillingProvider {
  /** @param {{ secret?: string, clock?: () => Date }} [opts] */
  constructor(opts = {}) {
    this.name = 'stripe'; // emulates Stripe: rows are stored with provider='stripe'
    this.mode = 'fake';
    this.secret = opts.secret || 'fake_webhook_secret';
    this.clock = opts.clock || (() => new Date());
    this.outage = false;
    this.customers = new Map();
    this.prices = new Map();
    this.sessions = new Map();
    this.subscriptions = new Map();
    this.invoices = new Map();
    this.events = [];
    this.calls = [];
  }

  setOutage(on) { this.outage = !!on; }

  _guard(op) {
    this.calls.push(op);
    if (this.outage) throw new BillingError('provider_unavailable', `billing provider request failed: simulated outage during ${op}`, 503);
  }

  // ---- adapter API ------------------------------------------------------

  async createCustomer({ tenantId, name, email }) {
    this._guard('createCustomer');
    const id = rid('cus');
    this.customers.set(id, { id, name, email, metadata: { hydi_tenant_id: tenantId } });
    return { providerCustomerId: id };
  }

  registerPrice({ unitAmountMinor, currency, interval, intervalCount = 1 }) {
    const id = rid('price');
    this.prices.set(id, { id, unit_amount: unitAmountMinor, currency, recurring: { interval, interval_count: intervalCount } });
    return id;
  }

  async createPrice(args) {
    this._guard('createPrice');
    return { providerPriceId: this.registerPrice(args) };
  }

  async createCheckoutSession({ providerCustomerId, providerPriceId, trialDays, successUrl, cancelUrl, metadata }) {
    this._guard('createCheckoutSession');
    if (!this.prices.has(providerPriceId)) throw new BillingError('provider_rejected', `No such price: ${providerPriceId}`, 422);
    const id = rid('cs');
    this.sessions.set(id, {
      id, object: 'checkout.session', status: 'open', payment_status: 'unpaid', customer: providerCustomerId,
      subscription: null, metadata: { ...metadata }, success_url: successUrl, cancel_url: cancelUrl,
      _price: providerPriceId, _trialDays: trialDays || 0,
    });
    return { sessionId: id, url: `https://checkout.fake.local/${id}` };
  }

  async retrieveCheckoutSession(sessionId) {
    this._guard('retrieveCheckoutSession');
    const s = this.sessions.get(sessionId);
    if (!s) throw new BillingError('provider_rejected', 'No such checkout session', 422);
    return { sessionId: s.id, status: s.status, paymentStatus: s.payment_status, providerSubscriptionId: s.subscription, providerCustomerId: s.customer, metadata: s.metadata };
  }

  async createPortalSession({ providerCustomerId }) {
    this._guard('createPortalSession');
    return { url: `https://billing.fake.local/portal/${providerCustomerId}` };
  }

  async retrieveSubscription(id) {
    this._guard('retrieveSubscription');
    const sub = this.subscriptions.get(id);
    if (!sub) throw new BillingError('provider_rejected', `No such subscription: ${id}`, 422);
    return subscriptionSnapshot(sub);
  }

  async setCancellation({ providerSubscriptionId, immediate, cancelAtPeriodEnd }) {
    this._guard('setCancellation');
    const sub = this.subscriptions.get(providerSubscriptionId);
    if (!sub) throw new BillingError('provider_rejected', 'No such subscription', 422);
    if (immediate) {
      this._end(sub);
      this._emit('customer.subscription.deleted', sub);
    } else {
      sub.cancel_at_period_end = !!cancelAtPeriodEnd;
      this._emit('customer.subscription.updated', sub);
    }
    return subscriptionSnapshot(sub);
  }

  async createRefund({ paymentIntent, amountMinor }) {
    this._guard('createRefund');
    const inv = [...this.invoices.values()].find((i) => i.payment_intent === paymentIntent);
    if (!inv) throw new BillingError('provider_rejected', 'No such payment_intent', 422);
    const r = this.refund(inv.id, amountMinor);
    return { providerRefundId: r.id, status: 'succeeded' };
  }

  async findInvoiceForPaymentIntent(paymentIntent) {
    this._guard('findInvoiceForPaymentIntent');
    const inv = [...this.invoices.values()].find((i) => i.payment_intent === paymentIntent);
    return inv ? inv.id : null;
  }

  verifyWebhook(rawBody, headers) {
    const sig = headers[SIG_HEADER];
    if (!sig) throw new BillingError('invalid_signature', `missing ${SIG_HEADER} header`, 400);
    const expected = createHmac('sha256', this.secret).update(rawBody).digest();
    let given;
    try { given = Buffer.from(String(sig), 'hex'); } catch (_) { given = Buffer.alloc(0); }
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new BillingError('invalid_signature', 'webhook signature verification failed', 400);
    }
    return JSON.parse(rawBody.toString('utf8'));
  }

  describeEvent(event) { return describeStripeEvent(event); }

  normalizeEvent(event) { return normalizeStripeEvent(event); }

  // ---- simulation helpers (test/demo only) ------------------------------

  /** Produces the raw bytes + headers Stripe would POST for `event`. */
  deliver(event, { tamper = false } = {}) {
    const rawBody = Buffer.from(JSON.stringify(event));
    const sig = createHmac('sha256', this.secret).update(rawBody).digest('hex');
    const body = tamper ? Buffer.from(JSON.stringify({ ...event, livemode: !event.livemode })) : rawBody;
    return { rawBody: body, headers: { [SIG_HEADER]: sig } };
  }

  _emit(type, object) {
    const event = {
      id: rid('evt'), object: 'event', type, created: sec(this.clock()), livemode: false,
      data: { object: JSON.parse(JSON.stringify(object)) },
    };
    this.events.push(event);
    return event;
  }

  _end(sub) {
    sub.status = 'canceled';
    sub.canceled_at = sec(this.clock());
    sub.ended_at = sec(this.clock());
    sub.cancel_at_period_end = false;
  }

  _invoice(sub, { paid, amount }) {
    const id = rid('in');
    const pi = rid('pi');
    const now = this.clock();
    const item = sub.items.data[0];
    const inv = {
      id, object: 'invoice', customer: sub.customer, currency: this.prices.get(item.price.id).currency,
      amount_paid: paid ? amount : 0, amount_due: amount, total_taxes: [], created: sec(now),
      status: paid ? 'paid' : 'open', status_transitions: { paid_at: paid ? sec(now) : null },
      parent: { subscription_details: { subscription: sub.id } },
      payment_intent: pi, hosted_invoice_url: `https://invoice.fake.local/${id}`,
      lines: { data: [{ period: { start: item.current_period_start, end: item.current_period_end } }] },
      _charge: { id: rid('ch'), amount_refunded: 0, refunds: [] },
    };
    this.invoices.set(id, inv);
    return inv;
  }

  /**
   * Customer finishes hosted checkout. With paymentSucceeds=false the
   * subscription is created `incomplete` and checkout does NOT complete —
   * which is what Stripe does when the first payment fails.
   * Returns the emitted events in Stripe's (not guaranteed) order.
   */
  completeCheckout(sessionId, { paymentSucceeds = true } = {}) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('unknown session');
    const price = this.prices.get(s._price);
    const now = this.clock();
    const trialing = paymentSucceeds && s._trialDays > 0;
    const periodEnd = trialing ? new Date(now.getTime() + s._trialDays * 86400000) : addInterval(now, price.recurring.interval, price.recurring.interval_count);
    const sub = {
      id: rid('sub'), object: 'subscription', customer: s.customer, metadata: { ...s.metadata },
      status: paymentSucceeds ? (trialing ? 'trialing' : 'active') : 'incomplete',
      cancel_at_period_end: false, cancel_at: null, canceled_at: null, ended_at: null,
      trial_end: trialing ? sec(periodEnd) : null,
      items: { data: [{ price: { id: price.id }, current_period_start: sec(now), current_period_end: sec(periodEnd) }] },
    };
    this.subscriptions.set(sub.id, sub);
    const out = [this._emit('customer.subscription.created', sub)];
    const inv = this._invoice(sub, { paid: paymentSucceeds, amount: trialing ? 0 : price.unit_amount });
    if (paymentSucceeds) {
      s.status = 'complete';
      s.payment_status = trialing ? 'no_payment_required' : 'paid';
      s.subscription = sub.id;
      out.push(this._emit('invoice.paid', this._publicInvoice(inv)));
      out.push(this._emit('checkout.session.completed', this._publicSession(s)));
    } else {
      out.push(this._emit('invoice.payment_failed', this._publicInvoice(inv)));
    }
    return { events: out, subscriptionId: sub.id, invoiceId: inv.id };
  }

  /** Renewal at period end. Failure moves the subscription to past_due. */
  renew(subscriptionId, { paymentSucceeds = true } = {}) {
    const sub = this.subscriptions.get(subscriptionId);
    const item = sub.items.data[0];
    const price = this.prices.get(item.price.id);
    const out = [];
    if (paymentSucceeds) {
      const start = new Date(item.current_period_end * 1000);
      item.current_period_start = sec(start);
      item.current_period_end = sec(addInterval(start, price.recurring.interval, price.recurring.interval_count));
      sub.status = 'active';
      sub.trial_end = sub.trial_end && sub.trial_end > sec(this.clock()) ? sub.trial_end : null;
      const inv = this._invoice(sub, { paid: true, amount: price.unit_amount });
      out.push(this._emit('invoice.paid', this._publicInvoice(inv)));
    } else {
      sub.status = 'past_due';
      const inv = this._invoice(sub, { paid: false, amount: price.unit_amount });
      out.push(this._emit('invoice.payment_failed', this._publicInvoice(inv)));
    }
    out.push(this._emit('customer.subscription.updated', sub));
    return out;
  }

  /** Provider-side terminal transition (dunning exhausted, or period-end cancel). */
  endSubscription(subscriptionId) {
    const sub = this.subscriptions.get(subscriptionId);
    this._end(sub);
    return [this._emit('customer.subscription.deleted', sub)];
  }

  refund(invoiceId, amountMinor) {
    const inv = this.invoices.get(invoiceId);
    const r = { id: rid('re'), amount: amountMinor, status: 'succeeded', created: sec(this.clock()) };
    inv._charge.refunds.push(r);
    inv._charge.amount_refunded += amountMinor;
    const event = this._emit('charge.refunded', {
      id: inv._charge.id, object: 'charge', payment_intent: inv.payment_intent, currency: inv.currency,
      amount: inv.amount_paid, amount_refunded: inv._charge.amount_refunded, refunds: { data: inv._charge.refunds },
    });
    return { id: r.id, event };
  }

  dispute(invoiceId, { closedStatus } = {}) {
    const inv = this.invoices.get(invoiceId);
    const obj = { id: rid('dp'), object: 'dispute', payment_intent: inv.payment_intent, amount: inv.amount_paid, status: closedStatus || 'needs_response' };
    return this._emit(closedStatus ? 'charge.dispute.closed' : 'charge.dispute.created', obj);
  }

  _publicSession(s) {
    const { _price, _trialDays, ...pub } = s; // eslint-disable-line no-unused-vars
    return pub;
  }

  _publicInvoice(inv) {
    const { _charge, ...pub } = inv; // eslint-disable-line no-unused-vars
    return pub;
  }
}

module.exports = { FakeBillingProvider, FAKE_SIGNATURE_HEADER: SIG_HEADER };
