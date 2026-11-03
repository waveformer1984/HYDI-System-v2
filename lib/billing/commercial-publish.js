'use strict';

/**
 * Fail-soft bridge from Revenue Streams billing events to the commercial EventBus.
 * Billing tables remain source of truth; bus events are the timeline only.
 */

const KIND_TO_COMMERCIAL = Object.freeze({
  'checkout.completed': 'payment.received',
  'invoice.paid': 'invoice.paid',
  'invoice.payment_failed': 'payment.failed',
  'charge.refunded': 'refund.completed',
  'dispute.created': 'entitlement.changed',
  'dispute.closed': 'entitlement.changed',
});

function payloadForKind(kind, normalized, meta) {
  const base = {
    billing_module: true,
    provider_event_id: meta?.eventId || null,
    kind,
  };
  switch (kind) {
    case 'checkout.completed':
      return {
        ...base,
        tenant_id: normalized.tenantId || normalized.metadata?.tenant_id || null,
        session_id: normalized.sessionId || null,
        amount: normalized.amountTotal ?? null,
        currency: normalized.currency || 'usd',
      };
    case 'invoice.paid':
    case 'invoice.payment_failed':
      return {
        ...base,
        tenant_id: normalized.invoice?.tenantId || normalized.invoice?.metadata?.tenant_id || null,
        invoice_id: normalized.invoice?.id || null,
        amount: normalized.invoice?.amountDue ?? null,
        currency: normalized.invoice?.currency || 'usd',
      };
    case 'charge.refunded':
      return {
        ...base,
        tenant_id: normalized.charge?.tenantId || null,
        charge_id: normalized.charge?.id || null,
        amount: normalized.charge?.amountRefunded ?? null,
        currency: normalized.charge?.currency || 'usd',
      };
    case 'dispute.created':
    case 'dispute.closed':
      return {
        ...base,
        tenant_id: normalized.dispute?.tenantId || null,
        dispute_id: normalized.dispute?.id || null,
        status: kind === 'dispute.created' ? 'open' : 'closed',
      };
    default:
      return base;
  }
}

/**
 * @param {object} normalized output of BillingProvider.normalizeEvent
 * @param {{ eventId?: string }} meta
 * @param {{ log?: (msg: string) => void }} [opts]
 */
async function publishBillingCommercialEvent(normalized, meta = {}, opts = {}) {
  const kind = normalized?.kind;
  if (!kind || kind === 'ignored') return { published: false, reason: 'ignored' };
  const type = KIND_TO_COMMERCIAL[kind];
  if (!type) {
    if (kind === 'subscription.snapshot' || kind === 'checkout.expired') {
      const subType = kind === 'subscription.snapshot' ? 'subscription.updated' : 'entitlement.changed';
      const ingress = await import('../commercial/ingress-adapter');
      await ingress.publishCommercialEvent(
        subType,
        payloadForKind(kind, normalized, meta),
        { source: 'billing-revenue-streams', correlationId: meta.eventId || undefined },
      );
      return { published: true, type: subType };
    }
    return { published: false, reason: 'unmapped_kind', kind };
  }
  const ingress = await import('../commercial/ingress-adapter');
  await ingress.publishCommercialEvent(
    type,
    payloadForKind(kind, normalized, meta),
    { source: 'billing-revenue-streams', correlationId: meta.eventId || undefined },
  );
  return { published: true, type };
}

module.exports = { publishBillingCommercialEvent, KIND_TO_COMMERCIAL };
