const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { ExternalAdapter } = require('../src/events/event-bus');

function makeFetch() {
  const calls = [];
  const mock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('invalid-host-xyz')) {
      return Promise.reject(new Error('getaddrinfo ENOTFOUND invalid-host-xyz'));
    }
    return { ok: !mock._fail, status: mock._fail ? 503 : 201, text: async () => '' };
  };
  mock.calls = calls;
  mock._fail = false;
  return mock;
}

describe('HYDI Gateway Transport', () => {
  let originalFetch;
  const mockFetch = makeFetch();

  before(() => {
    originalFetch = global.fetch;
    global.fetch = mockFetch;
  });

  beforeEach(() => {
    mockFetch.calls.length = 0;
    mockFetch._fail = false;
  });

  after(() => {
    global.fetch = originalFetch;
  });

  it('skips when disabled', async () => {
    const adapter = new ExternalAdapter({ enabled: false });
    const result = await adapter.publish({ type: 'audio.asset.created', id: 'e1', payload: {}, createdAt: new Date().toISOString() });
    assert.strictEqual(result.skipped, true);
  });

  it('publishes canonical audio.asset.created event', async () => {
    const adapter = new ExternalAdapter({ enabled: true, endpoint: 'http://localhost:4000', serviceKey: 'secret' });
    const event = { type: 'audio.asset.created', id: 'e1', payload: { assetId: 'a1' }, createdAt: '2026-08-01T00:00:00.000Z' };
    const result = await adapter.publish(event);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(mockFetch.calls.length, 1);
    const call = mockFetch.calls[0];
    assert.ok(call.url.endsWith('/events'));
    assert.strictEqual(call.options.headers['Authorization'], 'Bearer secret');
    const body = JSON.parse(call.options.body);
    assert.strictEqual(body.eventId, 'e1');
    assert.strictEqual(body.eventType, 'audio.asset.created');
    assert.strictEqual(body.source, 'resonate');
    assert.strictEqual(body.payload.assetId, 'a1');
  });

  it('skips non-canonical events', async () => {
    const adapter = new ExternalAdapter({ enabled: true, endpoint: 'http://localhost:4000' });
    const event = { type: 'track.created', id: 'e2', payload: {}, createdAt: new Date().toISOString() };
    const result = await adapter.publish(event);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(mockFetch.calls.length, 0);
  });

  it('queues failed events', async () => {
    mockFetch._fail = true;
    const adapter = new ExternalAdapter({ enabled: true, endpoint: 'http://localhost:4000' });
    const event = { type: 'processing.completed', id: 'e3', payload: {}, createdAt: new Date().toISOString() };
    const result = await adapter.publish(event);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(adapter.outbox.length, 1);
    mockFetch._fail = false;
  });

  it('reports health', async () => {
    const adapter = new ExternalAdapter({ enabled: true, endpoint: 'http://localhost:4000' });
    const h = await adapter.health();
    assert.strictEqual(h.ok, true);
    assert.strictEqual(h.status, 'healthy');
  });
});
