import { EventBus } from '../../lib/event-bus/EventBus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ maxHistory: 100, logToConsole: false });
  });

  afterEach(() => {
    bus.clear();
  });

  test('publishes and delivers events to subscribers', async () => {
    const handler = jest.fn();
    bus.subscribe('user:login', handler);

    const event = await bus.publish('user:login', { userId: '123' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'user:login',
      payload: { userId: '123' },
      id: event.id,
    }));
    expect(event.handled).toBe(true);
  });

  test('wildcard subscribers receive all events', async () => {
    const handler = jest.fn();
    bus.subscribe('*', handler);

    await bus.publish('a', 1);
    await bus.publish('b', 2);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('priority queue processes high priority events before low', async () => {
    const order: string[] = [];

    bus.subscribe('task', async () => {
      order.push('handled');
    });

    // Publish low then high; high should be processed first.
    bus.publish('task', 'low', { priority: 'low' });
    bus.publish('task', 'high', { priority: 'high' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const history = bus.getHistory({ limit: 2 });
    expect(history[0].priority).toBe('high');
    expect(history[1].priority).toBe('low');
  });

  test('handler priority determines execution order', async () => {
    const order: number[] = [];
    bus.subscribe('compute', () => { order.push(2); }, { handlerPriority: 2 });
    bus.subscribe('compute', () => { order.push(1); }, { handlerPriority: 1 });
    bus.subscribe('compute', () => { order.push(3); }, { handlerPriority: 3 });

    await bus.publish('compute', null);

    expect(order).toEqual([1, 2, 3]);
  });

  test('unsubscribe removes handler', async () => {
    const handler = jest.fn();
    const id = bus.subscribe('event', handler);

    expect(bus.unsubscribe(id)).toBe(true);
    await bus.publish('event', null);

    expect(handler).not.toHaveBeenCalled();
  });

  test('history is retained and queryable', async () => {
    await bus.publish('order', { id: 1 }, { source: 'api' });
    await bus.publish('login', { id: 2 }, { source: 'web' });
    await bus.publish('order', { id: 3 }, { source: 'api' });

    expect(bus.getHistory().length).toBe(3);
    expect(bus.getHistory({ type: 'order' }).length).toBe(2);
    expect(bus.getHistory({ source: 'web' }).length).toBe(1);
    expect(bus.getHistory({ limit: 1 }).length).toBe(1);
  });

  test('history respects max size', async () => {
    const smallBus = new EventBus({ maxHistory: 2, logToConsole: false });
    await smallBus.publish('a', 1);
    await smallBus.publish('b', 2);
    await smallBus.publish('c', 3);

    expect(smallBus.getHistory().length).toBe(2);
    expect(smallBus.getHistory()[0].payload).toBe(3);
  });

  test('log hooks receive bus activity', async () => {
    const logs: string[] = [];
    const remove = bus.onLog((entry) => logs.push(entry.message));

    bus.subscribe('test', () => {});
    await bus.publish('test', null);

    expect(logs.some((m) => m.includes('Subscribed'))).toBe(true);
    remove();
  });

  test('handler errors do not break bus or other handlers', async () => {
    const good = jest.fn();
    bus.subscribe('multi', () => { throw new Error('boom'); });
    bus.subscribe('multi', good);

    const event = await bus.publish('multi', null);

    expect(good).toHaveBeenCalled();
    expect(event.errors).toEqual(['boom']);
    expect(event.handled).toBe(true);
  });

  test('once subscriptions are removed after first delivery', async () => {
    const handler = jest.fn();
    bus.subscribe('ping', handler, { once: true });

    await bus.publish('ping', 1);
    await bus.publish('ping', 2);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('a fresh top-level publish gets no correlationId/causationId and starts its own trace', async () => {
    const event = await bus.publish('standalone', null);

    expect(event.correlationId).toBeUndefined();
    expect(event.causationId).toBeUndefined();
    expect(event.traceId).toBe(event.id); // no ambient context => this event is its own trace root
  });

  test('explicit correlationId/traceId/causationId in options are preserved as-is', async () => {
    const event = await bus.publish('explicit', null, {
      correlationId: 'corr-1',
      traceId: 'trace-1',
      causationId: 'cause-1',
    });

    expect(event.correlationId).toBe('corr-1');
    expect(event.traceId).toBe('trace-1');
    expect(event.causationId).toBe('cause-1');
  });
});
