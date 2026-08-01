const { describe, it } = require('node:test');
const assert = require('node:assert');
const { CapabilityRegistry, DEFAULT_REGISTRY } = require('../src/index');

describe('capability-registry', () => {
  it('loads the default registry', () => {
    const reg = new CapabilityRegistry();
    assert.ok(reg.list().length > 0);
    assert.ok(reg.get('Resonate'));
  });

  it('registers a new application', () => {
    const reg = new CapabilityRegistry();
    reg.register({
      name: 'ProtoYI',
      path: 'protoforge/proto-yi/index.js',
      versionFrom: 'package.json',
      capabilities: ['builder'],
      produces: ['builder.blueprint.created'],
      consumes: [],
      requires: []
    });
    assert.ok(reg.get('ProtoYI'));
  });

  it('finds applications by event type they produce', () => {
    const reg = new CapabilityRegistry();
    const producers = reg.getProducers('audio.asset.created');
    assert.ok(producers.some(p => p.name === 'Resonate'));
  });

  it('finds applications by event type they consume', () => {
    const reg = new CapabilityRegistry();
    const consumers = reg.getConsumers('ownership.updated');
    assert.ok(consumers.some(c => c.name === 'Resonate'));
  });

  it('wildcard consumers match any event', () => {
    const reg = new CapabilityRegistry();
    const consumers = reg.getConsumers('any.event');
    assert.ok(consumers.some(c => c.name === 'CASCADE'));
  });

  it('finds applications by capability', () => {
    const reg = new CapabilityRegistry();
    const apps = reg.findByCapability('event-ingestion');
    assert.ok(apps.some(a => a.name === 'HYDI Event Gateway'));
  });

  it('finds applications by requirement', () => {
    const reg = new CapabilityRegistry();
    const apps = reg.findByRequirement('supabase');
    assert.ok(apps.some(a => a.name === 'HYDI Event Gateway'));
    assert.ok(apps.some(a => a.name === 'ProtoForge PolicyEngine'));
  });
});
