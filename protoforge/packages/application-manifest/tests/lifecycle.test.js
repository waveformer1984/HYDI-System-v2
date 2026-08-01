const { describe, it } = require('node:test');
const assert = require('node:assert');

const { LIFECYCLE_TYPES, createApplicationEvent, LifecycleEmitter } = require('../src/lifecycle');
const { createManifest } = require('../src/manifest');

describe('application lifecycle events', () => {
  const manifest = createManifest({
    name: 'resonate',
    version: '1.0.0',
    capabilities: ['audio-generation'],
    eventsProduced: ['audio.asset.created'],
    eventsConsumed: ['ownership.updated'],
    providers: ['local-audio']
  });

  it('exposes lifecycle type constants', () => {
    assert.strictEqual(LIFECYCLE_TYPES.created, 'application.created');
    assert.strictEqual(LIFECYCLE_TYPES.registered, 'application.registered');
    assert.strictEqual(LIFECYCLE_TYPES.started, 'application.started');
    assert.strictEqual(LIFECYCLE_TYPES.health, 'application.health.changed');
    assert.strictEqual(LIFECYCLE_TYPES.deprecated, 'application.deprecated');
  });

  it('creates an application.created envelope', () => {
    const env = createApplicationEvent('application.created', manifest);
    assert.strictEqual(env.eventType, 'application.created');
    assert.strictEqual(env.source, 'protoforge-factory');
    assert.strictEqual(env.payload.name, 'resonate');
    assert.ok(env.fingerprint);
    assert.ok(env.hash);
  });

  it('creates an application.registered envelope', () => {
    const env = createApplicationEvent('application.registered', manifest);
    assert.strictEqual(env.eventType, 'application.registered');
  });

  it('creates an application.started envelope', () => {
    const env = createApplicationEvent('application.started', manifest);
    assert.strictEqual(env.eventType, 'application.started');
  });

  it('creates an application.health.changed envelope with extra payload', () => {
    const env = createApplicationEvent('application.health.changed', manifest, { status: 'degraded' });
    assert.strictEqual(env.eventType, 'application.health.changed');
    assert.strictEqual(env.payload.status, 'degraded');
  });

  it('creates an application.deprecated envelope', () => {
    const env = createApplicationEvent('application.deprecated', manifest);
    assert.strictEqual(env.eventType, 'application.deprecated');
  });

  it('throws on unknown lifecycle type', () => {
    assert.throws(() => createApplicationEvent('application.unknown', manifest), /Unknown lifecycle event type/);
  });

  it('emits through a mock adapter', async () => {
    const mock = { append: async (envelope) => ({ ok: true, record: envelope }) };
    const emitter = new LifecycleEmitter(mock);
    const result = await emitter.created(manifest);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.event.eventType, 'application.created');
  });

  it('emits registered through a mock adapter', async () => {
    const mock = { append: async (envelope) => ({ ok: true, record: envelope }) };
    const emitter = new LifecycleEmitter(mock);
    const result = await emitter.registered(manifest);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.event.eventType, 'application.registered');
  });

  it('queues to outbox when adapter append fails', async () => {
    const outbox = { enqueue: (event) => ({ ok: true }) };
    const mock = { append: async () => ({ ok: false, error: 'down' }), outbox };
    const emitter = new LifecycleEmitter(mock);
    const result = await emitter.started(manifest);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.queued, true);
  });

  it('returns error when adapter append fails and no outbox', async () => {
    const mock = { append: async () => ({ ok: false, error: 'down' }) };
    const emitter = new LifecycleEmitter(mock);
    const result = await emitter.started(manifest);
    assert.strictEqual(result.ok, false);
    assert.ok(result.error);
  });

  it('returns error when no adapter is configured', async () => {
    const emitter = new LifecycleEmitter();
    const result = await emitter.healthChanged(manifest);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'No adapter configured');
  });
});
