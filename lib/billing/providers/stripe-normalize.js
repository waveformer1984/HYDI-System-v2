'use strict';

/**
 * Converts Stripe objects/events into the provider-neutral shapes that
 * lib/billing/service.js consumes. Tolerates both the classic and the
 * 2025+ Stripe API shapes (period fields on subscription items, invoice →
 * subscription via `parent.subscription_details`, invoice payments list).
 *
 * Normalized event kinds:
 *   checkout.completed | checkout.expired | subscription.snapshot |
 *   invoice.paid | invoice.payment_failed | charge.refunded |
 *   dispute.created | dispute.closed | ignored
 */

function ts(sec) {
  return typeof sec === 'number' && Number.isFinite(sec) ? new Date(sec * 1000) : null;
}

function idOf(v) {
  if (!v) return null;
  return typeof v === 'string' ? v : (v.id || null);
}

function subscriptionSnapshot(sub) {
  const item = sub.items && Array.isArray(sub.items.data) ? sub.items.data[0] : null;
  const currentPeriodStart = ts(sub.current_period_start != null ? sub.current_period_start : item && item.current_period_start);
  const currentPeriodEnd = ts(sub.current_period_end != null ? sub.current_period_end : item && item.current_period_end);
  const cancelAt = ts(sub.cancel_at);
  return {
    providerSubscriptionId: sub.id,
    providerCustomerId: idOf(sub.customer),
    providerPriceId: item && item.price ? idOf(item.price) : null,
    status: sub.status,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end
      || (!!cancelAt && !!currentPeriodEnd && cancelAt.getTime() <= currentPeriodEnd.getTime() && sub.status !== 'canceled'),
    currentPeriodStart,
    currentPeriodEnd,
    trialEnd: ts(sub.trial_end),
    canceledAt: ts(sub.canceled_at),
    endedAt: ts(sub.ended_at),
    metadata: sub.metadata || {},
  };
}

function invoiceSubscriptionId(inv) {
  if (inv.subscription) return idOf(inv.subscription);
  const details = inv.parent && inv.parent.subscription_details;
  return details ? idOf(details.subscription) : null;
}

function invoicePaymentIntent(inv) {
  if (inv.payment_intent) return idOf(inv.payment_intent);
  const payments = inv.payments && Array.isArray(inv.payments.data) ? inv.payments.data : [];
  for (const p of payments) {
    const pi = p.payment && p.payment.payment_intent;
    if (pi) return idOf(pi);
  }
  return null;
}

function invoiceTax(inv) {
  if (typeof inv.tax === 'number') return inv.tax;
  if (Array.isArray(inv.total_taxes)) return inv.total_taxes.reduce((s, t) => s + (t.amount || 0), 0);
  return null;
}

function normalizeInvoice(inv) {
  const line = inv.lines && Array.isArray(inv.lines.data) ? inv.lines.data[0] : null;
  return {
    providerInvoiceId: inv.id,
    providerCustomerId: idOf(inv.customer),
    providerSubscriptionId: invoiceSubscriptionId(inv),
    paymentIntent: invoicePaymentIntent(inv),
    currency: String(inv.currency || '').toLowerCase(),
    amountPaidMinor: typeof inv.amount_paid === 'number' ? inv.amount_paid : 0,
    amountDueMinor: typeof inv.amount_due === 'number' ? inv.amount_due : 0,
    taxMinor: invoiceTax(inv),
    hostedInvoiceUrl: inv.hosted_invoice_url || null,
    occurredAt: ts((inv.status_transitions && inv.status_transitions.paid_at) || inv.created) || new Date(),
    periodStart: line && line.period ? ts(line.period.start) : null,
    periodEnd: line && line.period ? ts(line.period.end) : null,
  };
}

function normalizeStripeEvent(event) {
  const obj = event.data && event.data.object ? event.data.object : {};
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return {
        kind: 'checkout.completed',
        sessionId: obj.id,
        providerCustomerId: idOf(obj.customer),
        providerSubscriptionId: idOf(obj.subscription),
        paymentStatus: obj.payment_status || null,
        metadata: obj.metadata || {},
      };
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      return { kind: 'checkout.expired', sessionId: obj.id, metadata: obj.metadata || {} };
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      return { kind: 'subscription.snapshot', subscription: subscriptionSnapshot(obj) };
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      return { kind: 'invoice.paid', invoice: normalizeInvoice(obj) };
    case 'invoice.payment_failed':
      return { kind: 'invoice.payment_failed', invoice: normalizeInvoice(obj) };
    case 'charge.refunded':
      return {
        kind: 'charge.refunded',
        charge: {
          paymentIntent: idOf(obj.payment_intent),
          providerInvoiceId: idOf(obj.invoice),
          currency: String(obj.currency || '').toLowerCase(),
          amountRefundedTotalMinor: obj.amount_refunded || 0,
          refunds: (obj.refunds && Array.isArray(obj.refunds.data) ? obj.refunds.data : []).map((r) => ({
            providerRefundId: r.id, amountMinor: r.amount, status: r.status, occurredAt: ts(r.created) || new Date(),
          })),
        },
      };
    case 'charge.dispute.created':
    case 'charge.dispute.closed':
      return {
        kind: event.type === 'charge.dispute.created' ? 'dispute.created' : 'dispute.closed',
        dispute: {
          paymentIntent: idOf(obj.payment_intent),
          amountMinor: obj.amount || 0,
          status: obj.status || null,
        },
      };
    default:
      return { kind: 'ignored' };
  }
}

function describeStripeEvent(event) {
  return {
    id: event.id,
    type: event.type,
    created: ts(event.created) || new Date(),
    livemode: !!event.livemode,
  };
}

module.exports = { normalizeStripeEvent, describeStripeEvent, subscriptionSnapshot, normalizeInvoice };
