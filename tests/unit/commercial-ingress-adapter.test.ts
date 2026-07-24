import { EventBus } from '../../lib/event-bus/EventBus';
import * as eventBusModule from '../../lib/event-bus';
import {
  adaptStripeConnectEvent,
  publishCommercialEvent,
  createCommercialBusEvent,
} from '../../lib/commercial/ingress-adapter';

describe('Commercial Ingress Adapter', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ maxHistory: 100, logToConsole: false });
    // Override the singleton used by publishCommercialEvent.
    jest.spyOn(eventBusModule, 'getEventBus').mockReturnValue(bus);
  });

  afterEach(() => {
    bus.clear();
    jest.restoreAllMocks();
  });

  it('creates a valid commercial BusEvent', () => {
    const event = createCommercialBusEvent(
      'payment.received',
      { amount: 100 },
      { source: 'stripe-connect-webhook' }
    );

    expect(event.type).toBe('payment.received');
    expect(event.version).toBe(1);
    expect(event.source).toBe('stripe-connect-webhook');
    expect(event.payload).toEqual({ amount: 100 });
    expect(event.correlationId).toBeDefined();
    expect(event.traceId).toBeDefined();
  });

  it('publishes a commercial event to the EventBus', async () => {
    const handler = jest.fn();
    bus.subscribe('customer.created', handler);

    await publishCommercialEvent(
      'customer.created',
      { customer_id: 'cus-123', email: 'a@b.com' },
      { source: 'manual' }
    );

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.type).toBe('customer.created');
    expect(event.source).toBe('manual');
    expect(event.version).toBe(1);
  });

  it('adapts payment_intent.succeeded to payment.received', () => {
    const stripeEvent = {
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_1',
          amount: 10000,
          currency: 'USD',
          description: 'Payment for galactic_bytes',
          receipt_email: 'user@example.com',
          latest_charge: 'ch_1',
          charges: {
            data: [
              {
                destination: 'acct_123',
                billing_details: { name: 'User' },
              },
            ],
          },
          metadata: { revenue_stream: 'galactic_bytes' },
        },
      },
    };

    const { type, payload, source } = adaptStripeConnectEvent(stripeEvent);

    expect(type).toBe('payment.received');
    expect(source).toBe('stripe-connect-webhook');
    expect(payload).toMatchObject({
      stripe_event_id: 'evt_1',
      payment_intent_id: 'pi_1',
      amount: 100,
      currency: 'usd',
      revenue_stream: 'galactic_bytes',
      connect_account_id: 'acct_123',
      customer_email: 'user@example.com',
      customer_name: 'User',
    });
  });

  it('adapts payment_intent.payment_failed to payment.failed', () => {
    const stripeEvent = {
      id: 'evt_2',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_2',
          amount: 5000,
          currency: 'usd',
          customer: 'cus_123',
          last_payment_error: { message: 'card declined' },
          metadata: {},
        },
      },
    };

    const { type, payload } = adaptStripeConnectEvent(stripeEvent);

    expect(type).toBe('payment.failed');
    expect(payload).toMatchObject({
      payment_intent_id: 'pi_2',
      amount: 50,
      error_message: 'card declined',
    });
  });

  it('adapts charge.refunded to refund.completed', () => {
    const stripeEvent = {
      id: 'evt_3',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_3',
          amount_refunded: 2500,
          currency: 'usd',
          refunds: { data: [{ reason: 'requested_by_customer' }] },
        },
      },
    };

    const { type, payload } = adaptStripeConnectEvent(stripeEvent);

    expect(type).toBe('refund.completed');
    expect(payload).toMatchObject({
      charge_id: 'ch_3',
      refund_amount: 25,
      reason: 'requested_by_customer',
    });
  });

  it('adapts payout.created and payout.paid', () => {
    const created = {
      id: 'evt_4',
      type: 'payout.created',
      data: { object: { id: 'po_1', destination: 'acct_123', amount: 10000, currency: 'usd' } },
    };
    const paid = {
      id: 'evt_5',
      type: 'payout.paid',
      data: { object: { id: 'po_1', destination: 'acct_123', amount: 10000, currency: 'usd' } },
    };

    const createdResult = adaptStripeConnectEvent(created);
    const paidResult = adaptStripeConnectEvent(paid);

    expect(createdResult.type).toBe('payout.created');
    expect(paidResult.type).toBe('payout.paid');
    expect(createdResult.payload).toMatchObject({ payout_id: 'po_1', amount: 100 });
  });
});
