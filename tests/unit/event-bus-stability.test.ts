import { rmSync, existsSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { EventBus } from '../../lib/event-bus';
import { EventRecorder } from '../../lib/event-bus/recorder';
import type { BusEvent } from '../../lib/event-bus';

const TEST_LOG_DIR = join(process.cwd(), 'logs', 'event-bus-stability-test');

function cleanLog() {
  if (existsSync(TEST_LOG_DIR)) {
    rmSync(TEST_LOG_DIR, { recursive: true, force: true });
  }
}

describe('EventBus + EventRecorder stability', () => {
  let bus: EventBus;
  let recorder: EventRecorder;

  beforeEach(() => {
    cleanLog();
    bus = new EventBus({ maxHistory: 1000, logToConsole: false });
    recorder = new EventRecorder(bus, { path: TEST_LOG_DIR, maxMemory: 10000, flushIntervalMs: 1000 });
  });

  afterEach(() => {
    recorder.stop();
    bus.clear();
    cleanLog();
  });

  it('publishes 10,000 events without errors and preserves ordering', async () => {
    const seen: BusEvent[] = [];
    bus.subscribe('test:event', (event) => {
      seen.push(event);
    });

    const count = 10000;
    const start = Date.now();
    for (let i = 0; i < count; i++) {
      await bus.publish('test:event', { index: i });
    }
    const elapsed = Date.now() - start;

    expect(seen.length).toBe(count);
    expect(seen[0].payload).toEqual({ index: 0 });
    expect(seen[count - 1].payload).toEqual({ index: count - 1 });

    // Should complete 10k events within 30s including recorder overhead.
    expect(elapsed).toBeLessThan(30000);
  });

  it('does not leak subscriptions after unsubscribe', () => {
    const id = bus.subscribe('test:event', () => {});
    expect(bus.subscriptionCount('test:event')).toBe(1);
    bus.unsubscribe(id);
    expect(bus.subscriptionCount('test:event')).toBe(0);
  });

  it('recorder maintains bounded buffer and persists to disk', async () => {
    const count = 1200;
    for (let i = 0; i < count; i++) {
      await bus.publish('test:event', { index: i });
    }

    // Force a flush so the file exists before we assert on it.
    (recorder as any).flush();

    // Buffer holds all published events (count < maxMemory).
    expect(recorder.getBuffer().length).toBe(count);

    // Disk should have been flushed.
    const logPath = join(TEST_LOG_DIR, 'event-fabric.ndjson');
    expect(existsSync(logPath)).toBe(true);

    const fileSize = statSync(logPath).size;
    expect(fileSize).toBeGreaterThan(0);

    // Rehydration: new recorder on same bus reads disk back.
    const bus2 = new EventBus({ maxHistory: 1000, logToConsole: false });
    const recorder2 = new EventRecorder(bus2, { path: TEST_LOG_DIR, maxMemory: 500, flushIntervalMs: 0 });
    expect(recorder2.getBuffer().length).toBe(500);
    recorder2.stop();
  });

  it('replays events chronologically', async () => {
    for (let i = 0; i < 10; i++) {
      await bus.publish('test:event', { index: i });
    }

    const replayed: number[] = [];
    await recorder.replay({ type: 'test:event' }, (event) => {
      replayed.push((event.payload as any).index);
    });

    expect(replayed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('traces causal chains across events', async () => {
    const traceId = 'test-trace-1';
    const first = await bus.publish('test:root', { step: 0 }, { traceId });
    const second = await bus.publish('test:child', { step: 1 }, { traceId, causationId: first.id });
    const third = await bus.publish('test:grandchild', { step: 2 }, { traceId, causationId: second.id });

    const chain = recorder.getCausationChain(third.id);
    expect(chain.map((e) => (e.payload as any).step)).toEqual([2, 1, 0]);

    const trace = recorder.getTrace(traceId);
    expect(trace.length).toBe(3);
  });

  it('handles wildcard subscribers without duplicate delivery', async () => {
    let count = 0;
    bus.subscribe('*', () => {
      count++;
    });

    await bus.publish('test:a', {});
    await bus.publish('test:b', {});
    await bus.publish('test:c', {});

    expect(count).toBe(3);
  });

  it('keeps internal buffers bounded after a large burst', async () => {
    const count = 25000;
    for (let i = 0; i < count; i++) {
      await bus.publish('test:event', { index: i });
    }

    // Force a final flush and drain the pending queue.
    (recorder as any).flush();

    // Bounded in-memory state should not scale with the burst size.
    expect(bus['history'].length).toBeLessThanOrEqual(1000);
    expect(recorder.getBuffer().length).toBeLessThanOrEqual(10000);
    expect((recorder as any).pending.length).toBe(0);
  });
});
