const { describe, it } = require('node:test');
const assert = require('node:assert');

const { CapabilityPolicy, isNamespaced, checkForbidden } = require('../src/index');

const resonateManifest = {
  name: 'Resonate',
  version: '1.0.0',
  capabilities: ['audio-generation'],
  eventsProduced: ['audio.asset.created'],
  eventsConsumed: ['ownership.updated'],
  providers: ['local-audio-provider'],
  dependencies: { services: ['supabase'], packages: [] },
  deprecated: false
};

const switchboardManifest = {
  name: 'Switchboard',
  version: '1.0.0',
  capabilities: ['event-ingestion', 'trust-layer'],
  eventsProduced: ['user.created', 'gig.created'],
  eventsConsumed: ['user.parent_approved'],
  providers: ['json-store'],
  dependencies: { services: ['supabase'], packages: [] },
  deprecated: false
};

describe('CapabilityPolicy', () => {
  it('validates a Resonate manifest against its policy', () => {
    const policy = new CapabilityPolicy({
      resonate: {
        allowedEventsProduced: ['audio.asset.created', 'processing.completed'],
        allowedEventsConsumed: ['ownership.updated'],
        requiredServices: ['supabase', 'local-audio-provider']
      }
    });
    const result = policy.validate(resonateManifest);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.errors, []);
  });

  it('rejects an unregistered application', () => {
    const policy = new CapabilityPolicy({});
    const result = policy.validate({ name: 'Rogue', version: '1.0.0' });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors[0].includes('No capability policy'));
  });

  it('rejects disallowed produced events', () => {
    const policy = new CapabilityPolicy({
      resonate: {
        allowedEventsProduced: ['audio.asset.created'],
        allowedEventsConsumed: []
      }
    });
    const bad = { ...resonateManifest, eventsProduced: ['nuclear.launch'] };
    const result = policy.validate(bad);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('nuclear.launch')));
  });

  it('rejects disallowed consumed events', () => {
    const policy = new CapabilityPolicy({
      resonate: {
        allowedEventsProduced: ['audio.asset.created'],
        allowedEventsConsumed: []
      }
    });
    const result = policy.validate(resonateManifest);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('ownership.updated')));
  });

  it('rejects forbidden safety events', () => {
    const policy = new CapabilityPolicy({
      bad: {
        allowedEventsProduced: ['system.delete.everything'],
        allowedEventsConsumed: []
      }
    });
    const result = policy.validate({
      name: 'bad',
      eventsProduced: ['system.delete.everything']
    });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('forbidden')));
  });

  it('rejects missing required services', () => {
    const policy = new CapabilityPolicy({
      resonate: {
        allowedEventsProduced: ['audio.asset.created'],
        requiredServices: ['supabase', 'local-audio-provider']
      }
    });
    const bad = { ...resonateManifest, providers: [] };
    delete bad.dependencies;
    const result = policy.validate(bad);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('local-audio-provider')));
  });

  it('rejects missing required capabilities', () => {
    const policy = new CapabilityPolicy({
      resonate: {
        allowedEventsProduced: ['audio.asset.created'],
        requiredCapabilities: ['audio-generation']
      }
    });
    const bad = { ...resonateManifest, capabilities: [] };
    const result = policy.validate(bad);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('audio-generation')));
  });

  it('rejects un-namespaced events', () => {
    const policy = new CapabilityPolicy({
      resonate: {
        allowedEventsProduced: ['audio.asset.created'],
      }
    });
    const bad = { ...resonateManifest, eventsProduced: ['created'] };
    const result = policy.validate(bad);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('dot-namespaced')));
  });

  it('supports wildcard for permissive policy', () => {
    const policy = new CapabilityPolicy({
      proto: {
        allowedEventsProduced: '*',
        allowedEventsConsumed: '*'
      }
    });
    const result = policy.validate({
      name: 'proto',
      eventsProduced: ['anything.works'],
      eventsConsumed: ['also.works']
    });
    assert.strictEqual(result.ok, true);
  });

  it('validates multiple manifests', () => {
    const policy = new CapabilityPolicy({
      resonate: { allowedEventsProduced: ['audio.asset.created'], allowedEventsConsumed: ['ownership.updated'] },
      switchboard: { allowedEventsProduced: ['user.created', 'gig.created'], allowedEventsConsumed: ['user.parent_approved'] }
    });
    const results = policy.validateAll([resonateManifest, switchboardManifest]);
    assert.strictEqual(results.length, 2);
    assert.ok(results.every(r => r.ok));
  });

  it('identifies non-namespaced event types', () => {
    assert.strictEqual(isNamespaced('audio.asset.created'), true);
    assert.strictEqual(isNamespaced('created'), false);
  });

  it('flags destructive event names', () => {
    assert.strictEqual(checkForbidden('system.delete.everything'), false);
    assert.strictEqual(checkForbidden('audio.asset.created'), true);
  });
});
