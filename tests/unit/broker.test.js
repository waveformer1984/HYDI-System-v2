'use strict';

const { createBroker, getBroker, resetBroker } = require('../../src/queue/BrokerFactory');
const InMemoryBroker = require('../../src/queue/InMemoryBroker');
const RedisStreamsBroker = require('../../src/queue/RedisStreamsBroker');
const MessageBroker = require('../../src/queue/MessageBroker');
const { EventTypes, Sources, createEvent, validateEvent, assertEvent } = require('../../src/events/HYDIEventSchema');

// ── MessageBroker abstract class ──────────────────────────────────────────────

describe('MessageBroker (abstract)', () => {
  test('cannot be instantiated directly', () => {
    expect(() => new MessageBroker()).toThrow('abstract');
  });

  test('RedisStreamsBroker extends MessageBroker', () => {
    const b = new RedisStreamsBroker();
    expect(b).toBeInstanceOf(MessageBroker);
    b.destroy();
  });

  test('InMemoryBroker extends MessageBroker', () => {
    const b = new InMemoryBroker();
    expect(b).toBeInstanceOf(MessageBroker);
    b.destroy();
  });
});

// ── BrokerFactory ─────────────────────────────────────────────────────────────

describe('BrokerFactory', () => {
  afterEach(() => resetBroker());

  test('createBroker(memory) returns InMemoryBroker', () => {
    const b = createBroker({ transport: 'memory' });
    expect(b).toBeInstanceOf(InMemoryBroker);
    b.destroy();
  });

  test('createBroker(redis) returns RedisStreamsBroker', () => {
    const b = createBroker({ transport: 'redis' });
    expect(b).toBeInstanceOf(RedisStreamsBroker);
    b.destroy();
  });

  test('createBroker throws on unknown transport', () => {
    expect(() => createBroker({ transport: 'rabbitmq' })).toThrow('Unknown BROKER_TRANSPORT');
  });

  test('getBroker returns singleton', () => {
    const a = getBroker({ transport: 'memory' });
    const b = getBroker();
    expect(a).toBe(b);
  });

  test('resetBroker destroys singleton and allows fresh creation', () => {
    const a = getBroker({ transport: 'memory' });
    resetBroker();
    const b = getBroker({ transport: 'memory' });
    expect(a).not.toBe(b);
  });

  test('BROKER_TRANSPORT env var is respected', () => {
    const orig = process.env.BROKER_TRANSPORT;
    process.env.BROKER_TRANSPORT = 'memory';
    const b = createBroker();
    expect(b).toBeInstanceOf(InMemoryBroker);
    b.destroy();
    process.env.BROKER_TRANSPORT = orig;
  });
});

// ── InMemoryBroker ────────────────────────────────────────────────────────────

describe('InMemoryBroker', () => {
  let broker;

  beforeEach(async () => {
    broker = new InMemoryBroker();
    await broker.connect();
  });

  afterEach(() => broker.destroy());

  test('connect/disconnect toggles isConnected', async () => {
    expect(broker.isConnected()).toBe(true);
    await broker.disconnect();
    expect(broker.isConnected()).toBe(false);
  });

  test('publish returns a string message id', async () => {
    const event = createEvent(EventTypes.TASK_CREATED, Sources.PROCESSOR, { task: 'test' });
    const id = await broker.publish('tasks', event);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('subscribe receives published messages', async () => {
    const received = [];
    broker.subscribe('tasks', 'worker-group', async (event) => {
      received.push(event);
    });

    const event = createEvent(EventTypes.TASK_CREATED, Sources.PROCESSOR, { n: 1 });
    await broker.publish('tasks', event);

    // setImmediate delivers asynchronously
    await new Promise(r => setTimeout(r, 20));
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe(EventTypes.TASK_CREATED);
  });

  test('multiple consumer groups each receive the message', async () => {
    const groupA = [];
    const groupB = [];
    broker.subscribe('events', 'group-a', async (e) => groupA.push(e));
    broker.subscribe('events', 'group-b', async (e) => groupB.push(e));

    const event = createEvent(EventTypes.SERVICE_HEALTHY, Sources.URSULA, {});
    await broker.publish('events', event);

    await new Promise(r => setTimeout(r, 20));
    expect(groupA).toHaveLength(1);
    expect(groupB).toHaveLength(1);
  });

  test('ack removes message from pending', async () => {
    const ids = [];
    broker.subscribe('jobs', 'ack-group', async (event) => {
      ids.push(event.id);
    });

    const event = createEvent(EventTypes.INFERENCE_REQUESTED, Sources.HEIDI_CORE, {});
    const msgId = await broker.publish('jobs', event);
    await new Promise(r => setTimeout(r, 20));

    await broker.ack('jobs', 'ack-group', msgId);
    const group = broker._groups.get('jobs:ack-group');
    expect(group.pending.has(msgId)).toBe(false);
  });

  test('nack redelivers message to handler', async () => {
    const calls = [];
    broker.subscribe('retry-topic', 'retry-group', async (event) => {
      calls.push(event.id);
    });

    const event = createEvent(EventTypes.TASK_FAILED, Sources.PROCESSOR, {});
    const msgId = await broker.publish('retry-topic', event);
    await new Promise(r => setTimeout(r, 20));

    // Manually restore to pending so nack has something to redeliver
    const group = broker._groups.get('retry-topic:retry-group');
    group.pending.set(msgId, { ...event, id: msgId });

    await broker.nack('retry-topic', 'retry-group', msgId);
    await new Promise(r => setTimeout(r, 20));

    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  test('late subscriber receives already-published messages', async () => {
    const event = createEvent(EventTypes.MEMORY_STORED, Sources.MEMORY, {});
    await broker.publish('memory-topic', event);

    // Subscribe AFTER publish
    const received = [];
    broker.subscribe('memory-topic', 'late-group', async (e) => received.push(e));

    await new Promise(r => setTimeout(r, 20));
    expect(received).toHaveLength(1);
  });

  test('destroy clears all state', async () => {
    broker.subscribe('cleanup', 'g1', async () => {});
    await broker.publish('cleanup', createEvent(EventTypes.TASK_CREATED, Sources.HEIDI_CORE, {}));
    broker.destroy();
    expect(broker._handlers.size).toBe(0);
    expect(broker._messages.size).toBe(0);
    expect(broker.isConnected()).toBe(false);
  });
});

// ── HYDIEventSchema ───────────────────────────────────────────────────────────

describe('HYDIEventSchema', () => {
  test('createEvent produces a valid event', () => {
    const event = createEvent(EventTypes.TASK_CREATED, Sources.PROCESSOR, { foo: 'bar' });
    const { valid } = validateEvent(event);
    expect(valid).toBe(true);
  });

  test('createEvent includes correlationId and userId when provided', () => {
    const event = createEvent(EventTypes.TASK_CREATED, Sources.PROCESSOR, {}, {
      correlationId: 'corr-123',
      userId: 'user-456',
    });
    expect(event.correlationId).toBe('corr-123');
    expect(event.userId).toBe('user-456');
  });

  test('validateEvent detects missing fields', () => {
    const { valid, errors } = validateEvent({ type: 'task.created' });
    expect(valid).toBe(false);
    expect(errors).toContain('missing id');
    expect(errors).toContain('missing source');
  });

  test('assertEvent throws on invalid event', () => {
    expect(() => assertEvent({ id: '1' })).toThrow('Invalid HYDIEvent');
  });

  test('assertEvent does not throw on valid event', () => {
    const event = createEvent(EventTypes.SERVICE_HEALTHY, Sources.URSULA, {});
    expect(() => assertEvent(event)).not.toThrow();
  });

  test('EventTypes values are unique strings', () => {
    const values = Object.values(EventTypes);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  test('EventTypes and Sources are frozen', () => {
    expect(() => { EventTypes.NEW_TYPE = 'x'; }).toThrow();
    expect(() => { Sources.NEW_SOURCE = 'y'; }).toThrow();
  });
});
