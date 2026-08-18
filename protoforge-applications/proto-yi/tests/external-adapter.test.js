const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ExternalAdapter } = require('../src/events/event-bus');

function fakeFetch(calls) {
  return async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({})
    };
  };
}

function fakeFailingFetch(calls) {
  return async (url, options = {}) => {
    calls.push({ url, options });
    throw new Error('gateway down');
  };
}

describe('ExternalAdapter HYDI gateway integration', () => {
  it('reaches the configured HYDI gateway with the canonical event envelope', async () => {
    const calls = [];
    const adapter = new ExternalAdapter({
      endpoint: 'http://h.test',
      version: '0.1.0',
      eventTypes: ['project.created', 'milestone.scheduled'],
      fetch: fakeFetch(calls)
    });

    const event = {
      id: 'evt-1',
      type: 'milestone.scheduled',
      payload: { milestone: 'Alpha' },
      createdAt: '2026-08-01T06:00:00.000Z'
    };

    const result = await adapter.publish(event);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'http://h.test/events');
    assert.strictEqual(calls[0].options.method, 'POST');
    const body = JSON.parse(calls[0].options.body);
    assert.strictEqual(body.eventId, 'evt-1');
    assert.strictEqual(body.eventType, 'milestone.scheduled');
    assert.strictEqual(body.source, 'proto-yi');
    assert.strictEqual(body.version, '0.1.0');
    assert.strictEqual(body.timestamp, '2026-08-01T06:00:00.000Z');
    assert.deepStrictEqual(body.payload, { milestone: 'Alpha' });
  });

  it('includes an Authorization header when a service key is configured', async () => {
    const calls = [];
    const adapter = new ExternalAdapter({
      endpoint: 'http://h.test',
      serviceKey: 'secret-key',
      eventTypes: ['project.created'],
      fetch: fakeFetch(calls)
    });

    const event = { id: 'evt-2', type: 'project.created', payload: {}, createdAt: new Date().toISOString() };
    await adapter.publish(event);

    assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer secret-key');
  });

  it('skips events not in the configured eventTypes list', async () => {
    const calls = [];
    const adapter = new ExternalAdapter({
      endpoint: 'http://h.test',
      eventTypes: ['project.created'],
      fetch: fakeFetch(calls)
    });

    const event = { id: 'evt-3', type: 'milestone.scheduled', payload: {}, createdAt: new Date().toISOString() };
    const result = await adapter.publish(event);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(calls.length, 0);
  });

  it('handles gateway failure safely and retains the event in the outbox', async () => {
    const calls = [];
    const logger = { warn: (cat, evt, msg, meta) => { calls.push({ cat, evt, msg, meta }); } };
    const adapter = new ExternalAdapter({
      endpoint: 'http://h.test',
      eventTypes: ['project.created'],
      fetch: fakeFailingFetch([]),
      logger
    });

    const event = { id: 'evt-4', type: 'project.created', payload: {}, createdAt: new Date().toISOString() };
    const result = await adapter.publish(event);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'gateway down');
    assert.strictEqual(adapter.outbox.length, 1);
    assert.strictEqual(adapter.healthy, false);
    assert.strictEqual(calls[0].evt, 'publish.failed');
  });

  it('remains disabled when no endpoint is configured', async () => {
    const calls = [];
    const adapter = new ExternalAdapter({ fetch: fakeFetch(calls) });

    const event = { id: 'evt-5', type: 'project.created', payload: {}, createdAt: new Date().toISOString() };
    const result = await adapter.publish(event);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(calls.length, 0);
  });

  it('handle() does not throw on gateway failure', async () => {
    const adapter = new ExternalAdapter({
      endpoint: 'http://h.test',
      eventTypes: ['project.created'],
      fetch: fakeFailingFetch([])
    });

    const event = { id: 'evt-6', type: 'project.created', payload: {}, createdAt: new Date().toISOString() };
    assert.doesNotThrow(() => adapter.handle(event));
  });
});
