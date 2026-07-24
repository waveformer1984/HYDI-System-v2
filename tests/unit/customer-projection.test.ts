import { EventBus } from '../../lib/event-bus/EventBus';
import { ProjectionEngine } from '../../lib/commercial/projections/projection-engine';
import { createCustomerProjection } from '../../lib/commercial/projections/customer-projection';

describe('CustomerProjection', () => {
  let bus: EventBus;
  let engine: ProjectionEngine;
  let customers: ReturnType<typeof createCustomerProjection>;

  beforeEach(() => {
    bus = new EventBus({ maxHistory: 100, logToConsole: false });
    customers = createCustomerProjection();
    engine = new ProjectionEngine(bus);
    engine.register(customers);
    engine.start();
  });

  afterEach(() => {
    engine.stop();
    bus.clear();
  });

  it('creates a customer', async () => {
    await bus.publish(
      'customer.created',
      {
        customer_id: 'cus-1',
        email: 'a@b.com',
        name: 'Alice',
        stripe_customer_id: 'cus_stripe_1',
        status: 'active',
      },
      { source: 'test' }
    );

    const state = customers.getState();
    expect(state.byId['cus-1']).toBeDefined();
    expect(state.byEmail['a@b.com']).toBeDefined();
    expect(state.byStripeCustomerId['cus_stripe_1']).toBeDefined();
    expect(state.byId['cus-1'].name).toBe('Alice');
  });

  it('updates a customer and reindexes email changes', async () => {
    await bus.publish(
      'customer.created',
      { customer_id: 'cus-1', email: 'a@b.com', name: 'Alice', status: 'active' },
      { source: 'test' }
    );

    await bus.publish(
      'customer.updated',
      { customer_id: 'cus-1', email: 'alice@b.com', name: 'Alice B', status: 'active' },
      { source: 'test' }
    );

    const state = customers.getState();
    expect(state.byEmail['a@b.com']).toBeUndefined();
    expect(state.byEmail['alice@b.com']).toBeDefined();
    expect(state.byId['cus-1'].name).toBe('Alice B');
  });

  it('ignores malformed events', async () => {
    await bus.publish('customer.created', { email: 'no-id@b.com' }, { source: 'test' });
    expect(Object.keys(customers.getState().byId)).toHaveLength(0);
  });
});
