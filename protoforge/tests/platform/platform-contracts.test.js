const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  createEventEnvelope,
  createProducerMetadata,
  createCapabilityDeclaration,
  createCorrelationId,
  validateEventEnvelope
} = require('../../packages/event-contracts/src/index');
const { CapabilityRegistry } = require('../../packages/capability-registry/src/index');

describe('platform contracts and capabilities', () => {
  it('producer metadata includes emitted_at timestamp', () => {
    const meta = createProducerMetadata({ name: 'Switchboard', version: '1.0.0' });
    assert.ok(meta.emitted_at);
    assert.match(meta.emitted_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('capability declaration normalizes strings to arrays', () => {
    const cap = createCapabilityDeclaration({
      produces: 'contract.created',
      consumes: ['user.parent_approved'],
      requires: 'supabase'
    });
    assert.deepStrictEqual(cap.produces, ['contract.created']);
    assert.deepStrictEqual(cap.consumes, ['user.parent_approved']);
    assert.deepStrictEqual(cap.requires, ['supabase']);
  });

  it('correlation id is unique per event', () => {
    const a = createCorrelationId('evt-1');
    const b = createCorrelationId('evt-1');
    assert.notStrictEqual(a, b);
    assert.ok(a.startsWith('corr-evt-1-'));
  });

  it('correlation id includes event id', () => {
    const c = createCorrelationId('my-event');
    assert.ok(c.includes('my-event'));
  });

  it('validated envelope accepts Switchboard contract.created', () => {
    const env = createEventEnvelope({
      eventId: 'sw-1',
      eventType: 'contract.created',
      source: 'switchboard',
      payload: { gig_id: 'g1', contract_id: 'c1' }
    });
    const result = validateEventEnvelope(env);
    assert.strictEqual(result.ok, true);
  });

  it('registry returns Switchboard by name', () => {
    const reg = new CapabilityRegistry();
    const app = reg.get('Switchboard');
    assert.ok(app);
    assert.ok(app.produces.includes('contract.created'));
  });

  it('registry finds consumers of any event for CASCADE', () => {
    const reg = new CapabilityRegistry();
    const consumers = reg.getConsumers('some.future.event');
    assert.ok(consumers.some(c => c.name === 'CASCADE'));
  });

  it('registry maps requirements to dependent apps', () => {
    const reg = new CapabilityRegistry();
    const apps = reg.findByRequirement('supabase');
    assert.ok(apps.some(a => a.name === 'ProtoForge PolicyEngine'));
  });

  it('registry maps capabilities to apps', () => {
    const reg = new CapabilityRegistry();
    const apps = reg.findByCapability('audio-generation');
    assert.ok(apps.some(a => a.name === 'Resonate'));
  });

  it('legacy entries are marked deprecated', () => {
    const reg = new CapabilityRegistry();
    const legacy = reg.get('Legacy CASCADE Core');
    assert.ok(legacy);
    assert.strictEqual(legacy.deprecated, true);
  });
});
