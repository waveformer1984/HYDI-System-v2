/**
 * Unit tests for ProvisioningWorker's Stripe event payload unwrapping.
 *
 * payload.data is the Stripe Event's `data` wrapper ({ object,
 * previous_attributes }), not the underlying object -- these handlers must
 * read payload.data.object. Getting this wrong throws on every real event
 * (e.g. subscription.items is undefined on the wrapper), which
 * processNextTask's catch silently turns into a failed task.
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

jest.mock('../../modules/service-provisioner', () => {
  return jest.fn().mockImplementation(() => ({
    provisionServices: jest.fn().mockResolvedValue(undefined),
    deactivateServices: jest.fn().mockResolvedValue(undefined),
  }));
});

const ProvisioningWorker = require('../../workers/ProvisioningWorker');

function mockSupabaseCustomerLookup(worker, customer) {
  worker.supabase = {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: customer, error: null }),
    }),
  };
}

describe('ProvisioningWorker - Stripe event unwrapping', () => {
  let worker;

  beforeEach(() => {
    jest.clearAllMocks();
    worker = new ProvisioningWorker('test-worker');
  });

  it('handleCheckoutCompleted reads session from payload.data.object', async () => {
    const session = {
      customer_details: { email: 'buyer@example.com' },
      customer: 'cus_123',
      amount_total: 4900,
      metadata: {},
    };

    await expect(
      worker.handleCheckoutCompleted({ data: { object: session } })
    ).resolves.not.toThrow();

    expect(worker.serviceProvisioner.provisionServices).toHaveBeenCalledWith(
      expect.objectContaining({ customer_email: 'buyer@example.com', tier: 'starter' })
    );
  });

  it('handleSubscriptionCreated reads subscription from payload.data.object', async () => {
    const subscription = {
      id: 'sub_123',
      customer: 'cus_456',
      items: { data: [{ price: { id: 'price_starter' } }] },
    };
    mockSupabaseCustomerLookup(worker, { email: 'sub@example.com' });

    await expect(
      worker.handleSubscriptionCreated({ data: { object: subscription } })
    ).resolves.not.toThrow();

    expect(worker.serviceProvisioner.provisionServices).toHaveBeenCalledWith(
      expect.objectContaining({ customer_email: 'sub@example.com' })
    );
  });

  it('processNextTask routes checkout.session.completed through the unwrap correctly', async () => {
    const session = {
      customer_details: { email: 'routed@example.com' },
      customer: 'cus_789',
      amount_total: 9900,
      metadata: {},
    };
    const task = {
      payload: {
        event_type: 'checkout.session.completed',
        data: { object: session },
      },
    };

    worker.queue.dequeue.mockResolvedValue('task_1');
    worker.queue.getTask.mockResolvedValue(task);

    await worker.processNextTask();

    expect(worker.serviceProvisioner.provisionServices).toHaveBeenCalledWith(
      expect.objectContaining({ customer_email: 'routed@example.com' })
    );
    expect(worker.queue.completeTask).toHaveBeenCalledWith('task_1', true);
  });
});
