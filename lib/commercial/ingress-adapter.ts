import { randomUUID } from 'crypto';
import { getEventBus } from '../event-bus';
import { validateBusEvent } from '../event-bus/validation';
import type { BusEvent, PublishOptions } from '../event-bus/types';

export type CommercialEventType =
  | 'customer.created'
  | 'customer.updated'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'invoice.generated'
  | 'invoice.paid'
  | 'payment.received'
  | 'payment.failed'
  | 'refund.completed'
  | 'payout.created'
  | 'payout.paid'
  | 'license.issued'
  | 'license.revoked'
  | 'entitlement.changed'
  | 'usage.recorded'
  | 'financial_ledger.entry_recorded'
  | 'marketplace.purchase'
  | 'forgefinder.job.completed'
  | 'manual.adjustment';

export interface IngressAdapterOptions {
  source: string;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  priority?: 'high' | 'normal' | 'low';
  version?: number;
}

export function createCommercialBusEvent<T = unknown>(
  type: CommercialEventType,
  payload: T,
  options: IngressAdapterOptions
): BusEvent<T> {
  const id = randomUUID();
  const event: BusEvent<T> = {
    id,
    version: options.version ?? 1,
    type,
    payload,
    priority: options.priority ?? 'normal',
    timestamp: new Date().toISOString(),
    source: options.source,
    correlationId: options.correlationId ?? id,
    traceId: options.traceId ?? id,
    causationId: options.causationId,
    handlerCount: 0,
  };

  const validation = validateBusEvent(event);
  if (!validation.valid) {
    const summary = validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
    throw new Error(`Invalid commercial event: ${summary}`);
  }

  return event;
}

export async function publishCommercialEvent<T = unknown>(
  type: CommercialEventType,
  payload: T,
  options: IngressAdapterOptions
): Promise<BusEvent<T>> {
  const bus = getEventBus();
  const publishOptions: PublishOptions = {
    source: options.source,
    priority: options.priority,
    version: options.version,
    correlationId: options.correlationId,
    traceId: options.traceId,
    causationId: options.causationId,
  };

  return bus.publish(type, payload, publishOptions);
}

export interface StripePaymentSucceededPayload {
  stripe_event_id: string;
  payment_intent_id: string;
  charge_id?: string | null;
  amount: number;
  currency: string;
  revenue_stream: string;
  connect_account_id: string;
  customer_email?: string | null;
  customer_name?: string | null;
  customer_id?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StripePayoutPayload {
  stripe_event_id: string;
  payout_id: string;
  destination: string;
  amount: number;
  currency: string;
  status: 'created' | 'paid';
}

export function adaptStripeConnectEvent(stripeEvent: {
  id: string;
  type: string;
  data: { object: any };
}): { type: CommercialEventType; payload: unknown; source: string; correlationId: string } {
  const source = 'stripe-connect-webhook';
  const correlationId = stripeEvent.id;

  switch (stripeEvent.type) {
    case 'payment_intent.succeeded': {
      const pi = stripeEvent.data.object;
      return {
        type: 'payment.received',
        source,
        correlationId,
        payload: {
          stripe_event_id: stripeEvent.id,
          payment_intent_id: pi.id,
          charge_id: pi.latest_charge ?? null,
          amount: (pi.amount ?? 0) / 100,
          currency: (pi.currency ?? 'usd').toLowerCase(),
          revenue_stream: determineRevenueStream(pi),
          connect_account_id: pi?.charges?.data?.[0]?.destination ?? null,
          customer_email: pi.receipt_email ?? null,
          customer_name: pi?.charges?.data?.[0]?.billing_details?.name ?? null,
          customer_id: pi.customer ?? null,
          description: pi.description ?? null,
          metadata: pi.metadata ?? {},
        } as StripePaymentSucceededPayload,
      };
    }

    case 'payment_intent.payment_failed': {
      const pi = stripeEvent.data.object;
      return {
        type: 'payment.failed',
        source,
        correlationId,
        payload: {
          stripe_event_id: stripeEvent.id,
          payment_intent_id: pi.id,
          amount: (pi.amount ?? 0) / 100,
          currency: (pi.currency ?? 'usd').toLowerCase(),
          revenue_stream: determineRevenueStream(pi),
          customer_id: pi.customer ?? null,
          error_message: pi.last_payment_error?.message ?? 'unknown',
        },
      };
    }

    case 'charge.refunded': {
      const charge = stripeEvent.data.object;
      return {
        type: 'refund.completed',
        source,
        correlationId,
        payload: {
          stripe_event_id: stripeEvent.id,
          charge_id: charge.id,
          refund_amount: (charge.amount_refunded ?? 0) / 100,
          currency: (charge.currency ?? 'usd').toLowerCase(),
          reason: charge.refunds?.data?.[0]?.reason ?? 'customer_request',
        },
      };
    }

    case 'payout.created': {
      const payoutCreated = stripeEvent.data.object;
      return {
        type: 'payout.created',
        source,
        correlationId,
        payload: {
          stripe_event_id: stripeEvent.id,
          payout_id: payoutCreated.id,
          destination: payoutCreated.destination,
          amount: (payoutCreated.amount ?? 0) / 100,
          currency: (payoutCreated.currency ?? 'usd').toLowerCase(),
          status: 'created',
        } as StripePayoutPayload,
      };
    }

    case 'payout.paid': {
      const payoutPaid = stripeEvent.data.object;
      return {
        type: 'payout.paid',
        source,
        correlationId,
        payload: {
          stripe_event_id: stripeEvent.id,
          payout_id: payoutPaid.id,
          destination: payoutPaid.destination,
          amount: (payoutPaid.amount ?? 0) / 100,
          currency: (payoutPaid.currency ?? 'usd').toLowerCase(),
          status: 'paid',
        } as StripePayoutPayload,
      };
    }

    default:
      throw new Error(`Unsupported Stripe event type: ${stripeEvent.type}`);
  }
}

function determineRevenueStream(paymentIntent: any): string {
  if (paymentIntent.metadata?.revenue_stream) {
    return paymentIntent.metadata.revenue_stream;
  }
  if (paymentIntent.metadata?.project_code) {
    return paymentIntent.metadata.project_code;
  }

  const desc = (paymentIntent.description || '').toLowerCase();
  if (desc.includes('galactic') || desc.includes('bytes')) return 'galactic_bytes';
  if (desc.includes('detailer') || desc.includes('bot')) return 'detailer_bot';
  if (desc.includes('lipi')) return 'lipi_v2';
  if (desc.includes('protogrance') || desc.includes('aromatic')) return 'protogrance_aromatics';
  if (desc.includes('rezonate')) return 'rezonate';
  if (desc.includes('waveformer') || desc.includes('studio')) return 'waveformer_studio';

  return 'galactic_bytes';
}
