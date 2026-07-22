import { EventBus } from '../../lib/event-bus/EventBus';

describe('EventBus audit/replay', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ maxHistory: 100, logToConsole: false });
  });

  afterEach(() => {
    bus.clear();
  });

  describe('getTrace', () => {
    test('returns only events sharing a traceId, in chronological order', async () => {
      const a = await bus.publish('a', 1, { traceId: 'trace-x' });
      const unrelated = await bus.publish('unrelated', 1, { traceId: 'trace-y' });
      const b = await bus.publish('b', 2, { traceId: 'trace-x' });
      void unrelated;

      const trace = bus.getTrace('trace-x');
      expect(trace.map((e) => e.id)).toEqual([a.id, b.id]);
    });

    test('returns an empty array for an unknown traceId', () => {
      expect(bus.getTrace('nonexistent')).toEqual([]);
    });
  });

  describe('getCausationChain', () => {
    test('walks a multi-hop chain back to its root', async () => {
      const root = await bus.publish('root', null);
      const mid = await bus.publish('mid', null, { causationId: root.id, traceId: root.traceId });
      const leaf = await bus.publish('leaf', null, { causationId: mid.id, traceId: root.traceId });

      const chain = bus.getCausationChain(leaf.id);
      expect(chain.map((e) => e.id)).toEqual([leaf.id, mid.id, root.id]);
    });

    test('returns an empty array for an unknown eventId', () => {
      expect(bus.getCausationChain('nonexistent')).toEqual([]);
    });

    test('a single root event with no causationId returns just itself', async () => {
      const root = await bus.publish('lonely-root', null);
      expect(bus.getCausationChain(root.id)).toEqual([root]);
    });

    test('does not infinite-loop on a constructed cycle', async () => {
      const a = await bus.publish('cycle-a', null);
      const b = await bus.publish('cycle-b', null, { causationId: a.id });
      // Manually corrupt history to force a cycle: a "caused by" b, b "caused by" a.
      const historyEntryA = bus.getHistory({ type: 'cycle-a' })[0];
      (historyEntryA as { causationId?: string }).causationId = b.id;

      const chain = bus.getCausationChain(b.id);
      expect(chain.length).toBeLessThanOrEqual(2); // terminates, doesn't hang or grow unbounded
    });
  });

  describe('replay', () => {
    test('invokes handler once per matching historical event, in chronological order', async () => {
      await bus.publish('replay-me', 1);
      await bus.publish('other', 99);
      await bus.publish('replay-me', 2);

      const seen: unknown[] = [];
      const count = await bus.replay({ type: 'replay-me' }, (event) => {
        seen.push(event.payload);
      });

      expect(count).toBe(2);
      expect(seen).toEqual([1, 2]);
    });

    test('does not mutate history, subscription count, or invoke real subscribers', async () => {
      await bus.publish('watched', 1);
      const realHandler = jest.fn();
      bus.subscribe('watched', realHandler);

      const historyLengthBefore = bus.getHistory().length;
      const subCountBefore = bus.subscriptionCount();

      await bus.replay({ type: 'watched' }, () => {});

      expect(bus.getHistory().length).toBe(historyLengthBefore);
      expect(bus.subscriptionCount()).toBe(subCountBefore);
      expect(realHandler).not.toHaveBeenCalled();
    });

    test('passes a shallow clone, not the live history object', async () => {
      await bus.publish('clone-check', { n: 1 });

      let capturedEvent: any;
      await bus.replay({ type: 'clone-check' }, (event) => {
        capturedEvent = event;
        (event as any).payload = { n: 999 }; // mutate the clone
      });

      const realHistoryEvent = bus.getHistory({ type: 'clone-check' })[0];
      expect(capturedEvent).not.toBe(realHistoryEvent); // different object references
      expect(realHistoryEvent.payload).toEqual({ n: 1 }); // live history untouched
    });
  });

  describe('broadcast', () => {
    test('is equivalent to publish() — wildcard subscribers receive it with the same event shape', async () => {
      const wildcardHandler = jest.fn();
      bus.subscribe('*', wildcardHandler);

      const event = await bus.broadcast('announcement', { msg: 'hi' });

      expect(wildcardHandler).toHaveBeenCalledWith(expect.objectContaining({ type: 'announcement', payload: { msg: 'hi' } }));
      expect(event.handled).toBe(true);
    });
  });
});
