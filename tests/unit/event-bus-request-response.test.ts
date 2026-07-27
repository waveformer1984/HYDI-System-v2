import { EventBus } from '../../lib/event-bus/EventBus';

describe('EventBus request/response', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ maxHistory: 100, logToConsole: false });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    bus.clear();
  });

  test('request() resolves with the matching respond() event', async () => {
    bus.subscribe('ping', async (event) => {
      await bus.respond(event, { pong: true });
    });

    const responsePromise = bus.request('ping', { hello: 'world' });
    await jest.advanceTimersByTimeAsync(10);
    const response = await responsePromise;

    expect(response.payload).toEqual({ pong: true });
    expect(response.type).toBe('ping:response');
  });

  test('concurrent requests of the same type do not cross-resolve each other', async () => {
    const received: unknown[] = [];
    bus.subscribe('echo', async (event) => {
      received.push(event.payload);
    });

    const first = bus.request('echo', { n: 1 }, { timeoutMs: 1000 });
    // Attach the rejection assertion synchronously, before any timer advance
    // — otherwise the eventual timeout rejection has a window with no
    // handler attached yet, which Jest treats as an unhandled rejection.
    const firstShouldTimeOut = expect(first).rejects.toThrow(/timed out/);
    const second = bus.request('echo', { n: 2 }, { timeoutMs: 1000 });
    await jest.advanceTimersByTimeAsync(10);

    // Respond only to the second request's correlationId.
    const echoEvents = bus.getHistory({ type: 'echo' });
    const secondEvent = echoEvents.find((e) => (e.payload as { n: number }).n === 2)!;
    await bus.respond(secondEvent, { answeredFirst: false });
    await jest.advanceTimersByTimeAsync(10);

    const secondResult = await second;
    expect(secondResult.payload).toEqual({ answeredFirst: false });

    // The first request must still be pending — advance past its timeout to confirm it wasn't silently resolved.
    await jest.advanceTimersByTimeAsync(1000);
    await firstShouldTimeOut;
  });

  test('a request with no responder times out and cleans up its temporary subscription', async () => {
    const baseline = bus.subscriptionCount();
    const requestPromise = bus.request('unanswered', null, { timeoutMs: 500 });
    const shouldTimeOut = expect(requestPromise).rejects.toThrow(/timed out after 500ms: unanswered/);

    await jest.advanceTimersByTimeAsync(500);
    await shouldTimeOut;
    expect(bus.subscriptionCount()).toBe(baseline);
  });

  test('a successful response also cleans up the temporary subscription and clears the timer', async () => {
    const baseline = bus.subscriptionCount();
    bus.subscribe('quick', async (event) => {
      await bus.respond(event, 'ok');
    });

    const requestPromise = bus.request('quick', null, { timeoutMs: 5000 });
    await jest.advanceTimersByTimeAsync(10);
    await requestPromise;

    // Only the 'quick' subscriber remains; the temp response subscriber is gone.
    expect(bus.subscriptionCount()).toBe(baseline + 1);
  });

  test("respond() on an event without a correlationId publishes but matches no pending request (silent no-op)", async () => {
    const orphanEvent = await bus.publish('no-request', null);
    // Should not throw, and should not resolve/reject anything since no request() is waiting.
    await expect(bus.respond(orphanEvent, 'unused')).resolves.toBeDefined();
  });
});
