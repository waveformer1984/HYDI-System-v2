import {
  createCustomer,
  getCustomerById,
  getCustomerByEmail,
  getCustomerByStripeCustomerId,
  getOrCreateCustomer,
  Customer,
} from '../../lib/customers/customer-service';

function createMockClient(singleResponse: { data: any; error: any }) {
  const chain: any = {
    select: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    single: jest.fn().mockResolvedValue(singleResponse),
  };

  return {
    from: jest.fn(() => chain),
  } as any;
}

describe('CustomerService', () => {
  const customer: Customer = {
    customer_id: 'cus-123',
    name: 'Acme Corp',
    email: 'acme@example.com',
    stripe_customer_id: 'stripe_cus_123',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('creates a customer', async () => {
    const mock = createMockClient({ data: customer, error: null });
    const result = await createCustomer(
      { name: 'Acme Corp', email: 'acme@example.com', stripe_customer_id: 'stripe_cus_123' },
      mock
    );
    expect(result).toEqual(customer);
  });

  it('finds a customer by id', async () => {
    const mock = createMockClient({ data: customer, error: null });
    const result = await getCustomerById('cus-123', mock);
    expect(result).toEqual(customer);
  });

  it('finds a customer by email', async () => {
    const mock = createMockClient({ data: customer, error: null });
    const result = await getCustomerByEmail('acme@example.com', mock);
    expect(result).toEqual(customer);
  });

  it('finds a customer by Stripe customer id', async () => {
    const mock = createMockClient({ data: customer, error: null });
    const result = await getCustomerByStripeCustomerId('stripe_cus_123', mock);
    expect(result).toEqual(customer);
  });

  it('returns an existing customer from getOrCreateCustomer when found by email', async () => {
    const mock = createMockClient({ data: customer, error: null });
    const result = await getOrCreateCustomer({ email: 'acme@example.com' }, mock);
    expect(result).toEqual(customer);
  });

  it('creates a customer from getOrCreateCustomer when not found', async () => {
    const newCustomer = { ...customer, customer_id: 'cus-new' };
    const chain: any = {
      select: jest.fn(() => chain),
      insert: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      single: jest
        .fn()
        .mockResolvedValueOnce({ data: null, error: { message: 'not found' } })
        .mockResolvedValueOnce({ data: newCustomer, error: null }),
    };
    const mock = { from: jest.fn(() => chain) } as any;

    const result = await getOrCreateCustomer(
      { name: 'New Corp', email: 'new@example.com', stripe_customer_id: 'stripe_cus_new' },
      mock
    );
    expect(result).toEqual(newCustomer);
  });

  it('returns null when no supabase client is available', async () => {
    const result = await createCustomer({ name: 'X', email: 'x@x.com' }, null as any);
    expect(result).toBeNull();
  });
});
