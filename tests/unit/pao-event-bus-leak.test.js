'use strict';

/**
 * Regression test for the pao-system/core/event.bus.ts setInterval(100ms) leak.
 *
 * Before the fix, the EventBus constructor called startEventProcessor() which
 * created a setInterval(..., 100) that was never cleared and not .unref()'d.
 * This prevented Jest from exiting (and kept the heidi-web process ticking
 * unnecessarily in local dev).
 *
 * After the fix:
 * - The constructor does NOT start any setInterval
 * - publish() calls processEvents() on-demand (fire-and-forget)
 * - shutdown() clears all state and listeners
 * - The unused singleton (export const eventBus = new EventBus()) is removed
 */

const { EventBus } = require('../../pao-system/core/event.bus');

describe('PAO EventBus — polling leak fix', () => {
  // Timer-counting tests use fake timers to verify no setInterval is created
  test('constructor does not start a setInterval', () => {
    jest.useFakeTimers();
    const bus = new EventBus();
    expect(jest.getTimerCount()).toBe(0);
    bus.shutdown();
    jest.useRealTimers();
  });

  test('no timer leak when creating and destroying multiple buses', () => {
    jest.useFakeTimers();
    const buses = [];
    for (let i = 0; i < 10; i++) {
      buses.push(new EventBus());
    }
    expect(jest.getTimerCount()).toBe(0);
    buses.forEach((b) => b.shutdown());
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  // Async behavior tests use real timers (on-demand processing, no polling)
  test('publish processes events on-demand without polling', async () => {
    const bus = new EventBus();
    const handler = jest.fn().mockResolvedValue(undefined);
    bus.subscribe({ agent_id: 'test-agent', event_types: ['test.event'], handler });

    await bus.publish({
      type: 'test.event',
      source_agent: 'test-source',
      target_agent: 'test-agent',
      priority: 'high',
      payload: { hello: 'world' },
    });

    // Allow microtasks to flush (processEvents is fire-and-forget async)
    await new Promise((resolve) => setImmediate(resolve));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'test.event',
      source_agent: 'test-source',
      target_agent: 'test-agent',
      payload: { hello: 'world' },
    }));

    bus.shutdown();
  });

  test('shutdown clears all state and listeners', () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.subscribe({ agent_id: 'agent-1', event_types: ['*'], handler });
    bus.on('event_published', () => {});

    expect(bus.listenerCount('event_published')).toBeGreaterThan(0);

    bus.shutdown();

    expect(bus.listenerCount('event_published')).toBe(0);
    const stats = bus.getStats();
    expect(stats.total_events).toBe(0);
    expect(stats.dead_letter_count).toBe(0);
  });

  test('broadcast events reach all subscribed agents', async () => {
    const bus = new EventBus();
    const handler1 = jest.fn().mockResolvedValue(undefined);
    const handler2 = jest.fn().mockResolvedValue(undefined);
    bus.subscribe({ agent_id: 'agent-1', event_types: ['broadcast.event'], handler: handler1 });
    bus.subscribe({ agent_id: 'agent-2', event_types: ['broadcast.event'], handler: handler2 });

    await bus.publish({
      type: 'broadcast.event',
      source_agent: 'source',
      target_agent: 'broadcast',
      priority: 'medium',
      payload: {},
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);

    bus.shutdown();
  });

  test('priority ordering is respected when events accumulate', async () => {
    const bus = new EventBus();
    const callOrder = [];
    bus.subscribe({
      agent_id: 'test-agent',
      event_types: ['*'],
      handler: async (event) => { callOrder.push(event.priority); },
    });

    // Publish all events without awaiting — they accumulate in the queues
    // before processEvents() gets to run its first await
    bus.publish({ type: 'e1', source_agent: 's', target_agent: 'test-agent', priority: 'low', payload: {} });
    bus.publish({ type: 'e2', source_agent: 's', target_agent: 'test-agent', priority: 'critical', payload: {} });
    bus.publish({ type: 'e3', source_agent: 's', target_agent: 'test-agent', priority: 'high', payload: {} });

    // Allow all microtasks to flush
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    // All three should be processed
    expect(callOrder).toHaveLength(3);
    // Critical should be processed before low (priority ordering)
    const criticalIdx = callOrder.indexOf('critical');
    const lowIdx = callOrder.indexOf('low');
    expect(criticalIdx).toBeLessThan(lowIdx);

    bus.shutdown();
  });
});
