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
    return Promise.resolve({ ok, status: ok ? 200 : 503, json: () => Promise.resolve({ ok }) });
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

  it('does nothing when disabled', () => {
    const adapter = new HydiAdapter({ enabled: false });
    const result = adapter.handle({ type: 'gig.created', id: 'e1', payload: {}, meta: {}, createdAt: new Date().toISOString() });
    assert.strictEqual(result, undefined);
    assert.strictEqual(adapter.outbox.length, 0);
  });

  it('translates and publishes a Switchboard event', async () => {
    const adapter = new HydiAdapter({ enabled: true, endpoint: 'http://localhost:7001' });
    const event = { type: 'gig.created', id: 'e1', payload: { id: 'g1' }, meta: {}, createdAt: '2026-08-01T00:00:00.000Z' };
    const result = await adapter.publish(event);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(mockFetch.calls.length, 1);
    assert.ok(mockFetch.calls[0].url.includes('/events'));
    const body = JSON.parse(mockFetch.calls[0].options.body);
    assert.strictEqual(body.system, 'switchboard');
    assert.strictEqual(body.capability, 'switchboard.marketplace');
    assert.strictEqual(body.event, 'gig.created');
    assert.strictEqual(body.data.id, 'g1');
  });

  it('queues events when HYDI endpoint fails', async () => {
    mockFetch._fail = true;
    const adapter = new HydiAdapter({ enabled: true, endpoint: 'http://localhost:7001' });
    const event = { type: 'application.submitted', id: 'e2', payload: {}, meta: {}, createdAt: new Date().toISOString() };
    const result = await adapter.publish(event);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(adapter.outbox.length, 1);
    mockFetch._fail = false;
  });

  it('reports health', async () => {
    const adapter = new HydiAdapter({ enabled: true, endpoint: 'http://localhost:7001' });
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

  it('flushes queued events on retry', async () => {
    mockFetch._fail = true;
    const adapter = new HydiAdapter({ enabled: true, endpoint: 'http://localhost:7001' });
    const event = { type: 'payment.completed', id: 'e3', payload: {}, meta: {}, createdAt: new Date().toISOString() };
    await adapter.publish(event);
    mockFetch._fail = false;
    const result = await adapter.flush();
    assert.strictEqual(result.sent, 1);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(adapter.outbox.length, 0);
  });

  it('does not throw from handle when publish fails', () => {
    mockFetch._fail = true;
    const adapter = new HydiAdapter({ enabled: true, endpoint: 'http://localhost:7001' });
    const event = { type: 'user.created', id: 'e4', payload: {}, meta: {}, createdAt: new Date().toISOString() };
    assert.doesNotThrow(() => adapter.handle(event));
    assert.strictEqual(adapter.outbox.length, 1);
    mockFetch._fail = false;
  });
});
