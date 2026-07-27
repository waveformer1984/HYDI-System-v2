import { EventBus } from '../../lib/event-bus/EventBus';

describe('EventBus causality propagation (AsyncLocalStorage)', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ maxHistory: 100, logToConsole: false });
  });

  afterEach(() => {
    bus.clear();
  });

  test('a handler that publishes a new event synchronously has it auto-inherit causationId and traceId', async () => {
    bus.subscribe('parent', () => {
      void bus.publish('child', null); // fire-and-forget, deliberately not awaited
    });

    const parentEvent = await bus.publish('parent', null);
    // The nested publish is queued and drained by the OUTER processQueue()
    // loop, after handler returns — give it a tick to actually dispatch.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const childEvents = bus.getHistory({ type: 'child' });
    expect(childEvents).toHaveLength(1);
    expect(childEvents[0].causationId).toBe(parentEvent.id);
    expect(childEvents[0].traceId).toBe(parentEvent.traceId);
  });

  test('a handler that awaits before publishing still inherits context (survives a timer continuation)', async () => {
    jest.useFakeTimers();
    bus.subscribe('parent', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await bus.publish('child-after-await', null);
    });

    const publishPromise = bus.publish('parent', null);
    await jest.advanceTimersByTimeAsync(10);
    const parentEvent = await publishPromise;
    jest.useRealTimers();

    const childEvents = bus.getHistory({ type: 'child-after-await' });
    expect(childEvents).toHaveLength(1);
    expect(childEvents[0].causationId).toBe(parentEvent.id);
    expect(childEvents[0].traceId).toBe(parentEvent.traceId);
  });

  test('explicit options always win over auto-inference, even inside a handler', async () => {
    bus.subscribe('parent2', () => {
      void bus.publish('child2', null, { causationId: 'manual-cause', traceId: 'manual-trace' });
    });

    await bus.publish('parent2', null);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const childEvents = bus.getHistory({ type: 'child2' });
    expect(childEvents[0].causationId).toBe('manual-cause');
    expect(childEvents[0].traceId).toBe('manual-trace');
  });

  test('two independent (non-nested) top-level publishes get two different traceIds', async () => {
    const a = await bus.publish('a', null);
    const b = await bus.publish('b', null);

    expect(a.traceId).not.toBe(b.traceId);
    expect(a.traceId).toBe(a.id);
    expect(b.traceId).toBe(b.id);
  });

  test('a grandchild event (published from a handler of a child event) inherits the same traceId as the root', async () => {
    bus.subscribe('root', () => {
      void bus.publish('mid', null);
    });
    bus.subscribe('mid', () => {
      void bus.publish('leaf', null);
    });

    const rootEvent = await bus.publish('root', null);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const leafEvents = bus.getHistory({ type: 'leaf' });
    expect(leafEvents).toHaveLength(1);
    expect(leafEvents[0].traceId).toBe(rootEvent.traceId);

    const midEvents = bus.getHistory({ type: 'mid' });
    expect(leafEvents[0].causationId).toBe(midEvents[0].id);
  });
});
