import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mock so it's available when vi.mock factory runs
const mockRedis = vi.hoisted(() => ({
  xadd: vi.fn(),
  xgroup: vi.fn(),
  xreadgroup: vi.fn(),
  xack: vi.fn(),
  xrevrange: vi.fn(),
}));

vi.mock('@upstash/redis', () => ({
  // Must use a regular function (not arrow) so vitest can call it as a constructor
  Redis: vi.fn(function () { return mockRedis; }),
}));

import { StreamConsumer } from './stream-consumer';

beforeEach(() => {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://test.upstash.io');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('StreamConsumer.publish', () => {
  it('calls xadd and returns the message ID', async () => {
    mockRedis.xadd.mockResolvedValueOnce('1700000000000-0');
    const consumer = new StreamConsumer();
    const id = await consumer.publish('hydi:task-results', { loopId: 'l1' });
    expect(id).toBe('1700000000000-0');
    expect(mockRedis.xadd).toHaveBeenCalledWith(
      'hydi:task-results', '*', { data: JSON.stringify({ loopId: 'l1' }) }
    );
  });

  it('returns null when Redis is not configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    const consumer = new StreamConsumer();
    const id = await consumer.publish('hydi:task-results', { loopId: 'l2' });
    expect(id).toBeNull();
    expect(mockRedis.xadd).not.toHaveBeenCalled();
  });

  it('returns null on xadd error', async () => {
    mockRedis.xadd.mockRejectedValueOnce(new Error('connection refused'));
    const consumer = new StreamConsumer();
    const id = await consumer.publish('hydi:task-failures', { loopId: 'l3' });
    expect(id).toBeNull();
  });
});

describe('StreamConsumer.peek', () => {
  it('parses xrevrange result into StreamMessage array', async () => {
    mockRedis.xrevrange.mockResolvedValueOnce([
      ['1700000000001-0', { data: '{"loopId":"loop-1"}' }],
      ['1700000000000-0', { data: '{"loopId":"loop-0"}' }],
    ]);
    const consumer = new StreamConsumer();
    const messages = await consumer.peek('hydi:task-results', 2);
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('1700000000001-0');
    expect(messages[0].data).toEqual({ loopId: 'loop-1' });
  });

  it('returns empty array when Redis is not configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    const consumer = new StreamConsumer();
    const messages = await consumer.peek('hydi:task-results', 5);
    expect(messages).toEqual([]);
    expect(mockRedis.xrevrange).not.toHaveBeenCalled();
  });

  it('returns empty array on xrevrange error', async () => {
    mockRedis.xrevrange.mockRejectedValueOnce(new Error('timeout'));
    const consumer = new StreamConsumer();
    const messages = await consumer.peek('hydi:task-results', 5);
    expect(messages).toEqual([]);
  });
});

describe('StreamConsumer.ack', () => {
  it('calls xack with correct arguments', async () => {
    mockRedis.xack.mockResolvedValueOnce(1);
    const consumer = new StreamConsumer();
    await consumer.ack('hydi:task-failures', 'my-group', '1700000000000-0');
    expect(mockRedis.xack).toHaveBeenCalledWith('hydi:task-failures', 'my-group', '1700000000000-0');
  });

  it('does not throw when Redis is not configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    const consumer = new StreamConsumer();
    await expect(consumer.ack('stream', 'group', 'id')).resolves.not.toThrow();
    expect(mockRedis.xack).not.toHaveBeenCalled();
  });
});

describe('StreamConsumer.ensureGroup', () => {
  it('swallows BUSYGROUP errors silently', async () => {
    mockRedis.xgroup.mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists'));
    const consumer = new StreamConsumer();
    await expect(consumer.ensureGroup('hydi:edge-tasks', 'termux-edge')).resolves.not.toThrow();
  });
});
