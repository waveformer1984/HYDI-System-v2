const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { HydiAdapter } = require('../src/events/event-bus');

function makeFetch() {
  const calls = [];
  const mock = (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('invalid-host-xyz')) {
      return Promise.reject(new Error('getaddrinfo ENOTFOUND invalid-host-xyz'));
    }
    const ok = !mock._fail;
    return Promise.resolve({ ok, status: ok ? 201 : 503, text: () => Promise.resolve('') });
  };
  mock.calls = calls;
  mock._fail = false;
  return mock;
}

describe('HydiAdapter', () => {
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

  it('does nothing when disabled', async () => {
    const adapter = new HydiAdapter({ enabled: false });
    const result = await adapter.publish({ type: 'payment.completed', id: 'e1', payload: {}, createdAt: new Date().toISOString() });
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(adapter.outbox.length, 0);
  });

  it('translates and publishes a canonical Switchboard event', async () => {
    const adapter = new HydiAdapter({ enabled: true, endpoint: 'http://localhost:4000', serviceKey: 'secret' });
    const event = { type: 'payment.completed', id: 'e1', payload: { paymentId: 'p1' }, createdAt: '2026-08-01T00:00:00.000Z' };
    const result = await adapter.publish(event);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(mockFetch.calls.length, 1);
    const call = mockFetch.calls[0];
    assert.ok(call.url.includes('/events'));
    assert.strictEqual(call.options.headers['Authorization'], 'Bearer secret');
    const body = JSON.parse(call.options.body);
    assert.strictEqual(body.eventId, 'e1');
    assert.strictEqual(body.eventType, 'payment.completed');
    assert.strictEqual(body.source, 'switchboard');
    assert.strictEqual(body.payload.paymentId, 'p1');
  });

  it('skips non-canonical events', async () => {
    const adapter = new HydiAdapter({ enabled: true, endpoint: 'http://localhost:4000' });
    const event = { type: 'gig.created', id: 'e2', payload: {}, createdAt: new Date().toISOString() };
    const result = await adapter.publish(event);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(mockFetch.calls.length, 0);
  });

  it('queues events when HYDI endpoint fails', async () => {
    mockFetch._fail = true;
    const adapter = new HydiAdapter({ enabled: true, endpoint: 'http://localhost:4000' });
    const event = { type: 'contract.created', id: 'e3', payload: {}, createdAt: new Date().toISOString() };
    const result = await adapter.publish(event);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(adapter.outbox.length, 1);
  });

  it('reports health', async () => {
    const adapter = new HydiAdapter({ enabled: true, endpoint: 'http://localhost:4000' });
    const h = await adapter.health();
    assert.strictEqual(h.ok, true);
    assert.strictEqual(h.status, 'healthy');
  });

  it('reports unhealthy when endpoint is unreachable', async () => {
    const adapter = new HydiAdapter({ enabled: true, endpoint: 'http://invalid-host-xyz:7001' });
    const h = await adapter.health();
    assert.strictEqual(h.ok, false);
    assert.strictEqual(h.status, 'unreachable');
  });

  it('flushes queued canonical events on retry', async () => {
    mockFetch._fail = true;
    const adapter = new HydiAdapter({ enabled: true, endpoint: 'http://localhost:4000' });
    const event = { type: 'moderation.created', id: 'e4', payload: {}, createdAt: new Date().toISOString() };
    await adapter.publish(event);
    mockFetch._fail = false;
    const result = await adapter.flush();
    assert.strictEqual(result.sent, 1);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(adapter.outbox.length, 0);
  });

  it('does not throw from handle when publish fails', async () => {
    mockFetch._fail = true;
    const adapter = new HydiAdapter({ enabled: true, endpoint: 'http://localhost:4000' });
    const event = { type: 'user.restricted', id: 'e5', payload: {}, createdAt: new Date().toISOString() };
    assert.doesNotThrow(() => adapter.handle(event));
    assert.strictEqual(adapter.outbox.length, 1);
  });
});
