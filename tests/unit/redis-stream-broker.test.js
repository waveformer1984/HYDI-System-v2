'use strict';

/**
 * Unit tests for RedisStreamBroker
 * All HTTP calls are intercepted via a mocked global fetch.
 */

global.fetch = jest.fn();

// Load after mocking fetch so the module captures our mock
const broker = require('../../src/queue/RedisStreamBroker');

const UPSTASH_URL = 'https://test.upstash.io';
const UPSTASH_TOKEN = 'test-token';

function mockUpstashOk(result) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ result }),
  });
}

function mockUpstashError(status = 500) {
  return Promise.resolve({ ok: false, status });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.UPSTASH_REDIS_REST_URL = UPSTASH_URL;
  process.env.UPSTASH_REDIS_REST_TOKEN = UPSTASH_TOKEN;
});

afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe('RedisStreamBroker.publish', () => {
  it('sends XADD and returns the message ID', async () => {
    global.fetch.mockResolvedValueOnce(mockUpstashOk('1700000000000-0'));

    const id = await broker.publish('hydi:task-results', { loopId: 'l1', task: 'test' });

    expect(id).toBe('1700000000000-0');
    const call = global.fetch.mock.calls[0];
    expect(call[0]).toBe(UPSTASH_URL);
    const body = JSON.parse(call[1].body);
    expect(body[0]).toBe('XADD');
    expect(body[1]).toBe('hydi:task-results');
    expect(body[2]).toBe('*');
    expect(body[3]).toBe('data');
    const payload = JSON.parse(body[4]);
    expect(payload.loopId).toBe('l1');
  });

  it('returns null when Redis is not configured', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    const id = await broker.publish('hydi:task-results', { loopId: 'l2' });
    expect(id).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null on HTTP error', async () => {
    global.fetch.mockResolvedValueOnce(mockUpstashError(503));
    const id = await broker.publish('hydi:task-failures', { loopId: 'l3' });
    expect(id).toBeNull();
  });

  it('returns null when fetch throws (network error)', async () => {
    global.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const id = await broker.publish('hydi:task-results', { loopId: 'l4' });
    expect(id).toBeNull();
  });
});

describe('RedisStreamBroker.peek', () => {
  it('parses XREVRANGE response into StreamMessage array', async () => {
    const xrevrangeResult = [
      ['1700000000001-0', ['data', '{"loopId":"loop-1","task":"rev"}']],
      ['1700000000000-0', ['data', '{"loopId":"loop-0","task":"init"}']],
    ];
    global.fetch.mockResolvedValueOnce(mockUpstashOk(xrevrangeResult));

    const messages = await broker.peek('hydi:task-results', 2);
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('1700000000001-0');
    expect(messages[0].data.loopId).toBe('loop-1');
    expect(messages[1].data.task).toBe('init');
  });

  it('returns empty array when Redis is not configured', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    const messages = await broker.peek('hydi:task-results', 5);
    expect(messages).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns empty array on malformed data field', async () => {
    global.fetch.mockResolvedValueOnce(mockUpstashOk([
      ['1700000000002-0', ['data', 'NOT_JSON{{{']],
    ]));
    const messages = await broker.peek('hydi:task-results', 1);
    expect(messages).toHaveLength(1);
    expect(messages[0].data).toEqual({});
  });
});

describe('RedisStreamBroker.ack', () => {
  it('sends XACK command', async () => {
    global.fetch.mockResolvedValueOnce(mockUpstashOk(1));
    await broker.ack('hydi:task-failures', 'my-group', '1700000000000-0');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toEqual(['XACK', 'hydi:task-failures', 'my-group', '1700000000000-0']);
  });

  it('does nothing when Redis is not configured', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    await expect(broker.ack('stream', 'group', 'id')).resolves.not.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
