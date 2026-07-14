/**
 * Unit tests for RevenueIngestionWorker's payment_intent.succeeded handling.
 *
 * Confirms the worker unwraps the queued Stripe event payload correctly and
 * delegates to the shared connect-ledger module -- the same fee-split/ledger
 * write api/stripe-connect-webhook.js uses -- so a payment_intent.succeeded
 * event is ledgered correctly regardless of which webhook endpoint queued it.
 */

jest.mock('../../workers/QueueManager', () => {
  return jest.fn().mockImplementation(() => ({
    registerWorker: jest.fn().mockResolvedValue(undefined),
    updateHeartbeat: jest.fn().mockResolvedValue(undefined),
    startHeartbeat: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
    dequeue: jest.fn(),
    getTask: jest.fn(),
    completeTask: jest.fn().mockResolvedValue(undefined),
    enqueue: jest.fn().mockResolvedValue('task_id'),
  }));
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: jest.fn() })),
}));

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({ charges: { retrieve: jest.fn() } }))
);

jest.mock('../../lib/billing/connect-ledger', () => ({
  recordPaymentIntentSucceeded: jest.fn().mockResolvedValue({ transaction_id: 'txn_test' }),
}));

const RevenueIngestionWorker = require('../../workers/RevenueIngestionWorker');
const { recordPaymentIntentSucceeded } = require('../../lib/billing/connect-ledger');

describe('RevenueIngestionWorker - payment_intent.succeeded', () => {
  let worker;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.SUPABASE_URL = 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake_service_key';
    worker = new RevenueIngestionWorker('test-worker');
    worker.supabase = { from: jest.fn() };
  });

  it('unwraps payload.data.object into the PaymentIntent', async () => {
    const paymentIntent = { id: 'pi_123', amount: 5000, currency: 'usd' };

    await worker.handlePaymentIntentSucceeded({
      event_id: 'evt_1',
      event_type: 'payment_intent.succeeded',
      data: { object: paymentIntent },
    });

    expect(recordPaymentIntentSucceeded).toHaveBeenCalledWith(
      paymentIntent,
      expect.objectContaining({ supabase: worker.supabase, stripe: worker.stripe })
    );
  });

  it('routes payment_intent.succeeded through the switch in processNextTask', async () => {
    const paymentIntent = { id: 'pi_456', amount: 2500, currency: 'usd' };
    const task = {
      payload: {
        event_id: 'evt_2',
        event_type: 'payment_intent.succeeded',
        data: { object: paymentIntent },
      },
    };

    worker.queue.dequeue.mockResolvedValue('task_id_1');
    worker.queue.getTask.mockResolvedValue(task);

    await worker.processNextTask();

    expect(recordPaymentIntentSucceeded).toHaveBeenCalledWith(
      paymentIntent,
      expect.objectContaining({ supabase: worker.supabase, stripe: worker.stripe })
    );
    expect(worker.queue.completeTask).toHaveBeenCalledWith('task_id_1', true);
  });

  it('propagates ledger errors as a failed task rather than swallowing them', async () => {
    recordPaymentIntentSucceeded.mockRejectedValueOnce(new Error('ledger insert failed'));

    const task = {
      payload: {
        event_id: 'evt_3',
        event_type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_789', amount: 1000, currency: 'usd' } },
      },
    };

    worker.queue.dequeue.mockResolvedValue('task_id_2');
    worker.queue.getTask.mockResolvedValue(task);

    await worker.processNextTask();

    expect(worker.queue.completeTask).toHaveBeenCalledWith(
      'task_id_2',
      false,
      'ledger insert failed'
    );
  });
});
