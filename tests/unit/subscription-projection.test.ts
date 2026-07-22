import { EventBus } from '../../lib/event-bus/EventBus';
import { ProjectionEngine } from '../../lib/commercial/projections/projection-engine';
import { createSubscriptionProjection } from '../../lib/commercial/projections/subscription-projection';

describe('SubscriptionProjection', () => {
  let bus: EventBus;
  let engine: ProjectionEngine;
  let subscriptions: ReturnType<typeof createSubscriptionProjection>;

  beforeEach(() => {
    bus = new EventBus({ maxHistory: 100, logToConsole: false });
    subscriptions = createSubscriptionProjection();
    engine = new ProjectionEngine(bus);
    engine.register(subscriptions);
    engine.start();
  });

  afterEach(() => {
    engine.stop();
    bus.clear();
  });

  it('creates a subscription', async () => {
    await bus.publish(
      'subscription.created',
      {
        subscription_id: 'sub-1',
        customer_id: 'cus-1',
        tier: 'pro',
        status: 'active',
        revenue_stream: 'galactic_bytes',
        started_at: '2026-01-01T00:00:00Z',
      },
      { source: 'test' }
    );

    const state = subscriptions.getState();
    expect(state.byId['sub-1']).toBeDefined();
    expect(state.byId['sub-1'].tier).toBe('pro');
    expect(state.byCustomerId['cus-1']).toHaveLength(1);
  });

  it('updates a subscription tier', async () => {
    await bus.publish(
      'subscription.created',
      { subscription_id: 'sub-1', customer_id: 'cus-1', tier: 'starter', status: 'active' },
      { source: 'test' }
    );

    await bus.publish(
      'subscription.updated',
      { subscription_id: 'sub-1', customer_id: 'cus-1', tier: 'enterprise', status: 'active' },
      { source: 'test' }
    );

    expect(subscriptions.getState().byId['sub-1'].tier).toBe('enterprise');
  });

  it('cancels a subscription', async () => {
    await bus.publish(
      'subscription.created',
      { subscription_id: 'sub-1', customer_id: 'cus-1', tier: 'pro', status: 'active' },
      { source: 'test' }
    );

    await bus.publish(
      'subscription.cancelled',
      { subscription_id: 'sub-1', cancelled_at: '2026-06-01T00:00:00Z' },
      { source: 'test' }
    );

    const sub = subscriptions.getState().byId['sub-1'];
    expect(sub.status).toBe('canceled');
    expect(sub.cancelledAt).toBe('2026-06-01T00:00:00Z');
  });

  it('ignores malformed events', async () => {
    await bus.publish('subscription.created', { customer_id: 'cus-1', tier: 'pro' }, { source: 'test' });
    expect(Object.keys(subscriptions.getState().byId)).toHaveLength(0);
  });
});
