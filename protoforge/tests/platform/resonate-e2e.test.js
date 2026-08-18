const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');

const { createEventEnvelope, createProducerMetadata, validateEventEnvelope } = require('../../packages/event-contracts/src/index');
const { CapabilityRegistry } = require('../../packages/capability-registry/src/index');
const { EventProcessor } = require('../../cascade/src/processor');
const { DerivedStore } = require('../../cascade/src/derived-store');
const { KiloEngine } = require('../../../kilo/index');
const { evaluateRules } = require('../../../lib/protoforge/policy-engine');

const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe('Resonate end-to-end flow', () => {
  it('Resonate is registered in the capability registry', () => {
    const reg = new CapabilityRegistry();
    const app = reg.get('Resonate');
    assert.ok(app);
    assert.ok(app.capabilities.includes('audio-generation'));
  });

  it('Resonate produces audio.asset.created', () => {
    const reg = new CapabilityRegistry();
    const producers = reg.getProducers('audio.asset.created');
    assert.ok(producers.some(p => p.name === 'Resonate'));
  });

  it('Resonate consumes ownership.updated', () => {
    const reg = new CapabilityRegistry();
    const consumers = reg.getConsumers('ownership.updated');
    assert.ok(consumers.some(c => c.name === 'Resonate'));
  });

  it('audio.asset.created event envelope is canonical', () => {
    const producer = createProducerMetadata({ name: 'Resonate', version: '1.0.0' });
    const envelope = createEventEnvelope({
      eventId: 'rez-asset-1',
      eventType: 'audio.asset.created',
      source: 'resonate',
      payload: {
        asset_id: 'asset-1',
        project_id: 'project-1',
        type: 'generated_song',
        file_path: 'C:\\audio\\song.mp3'
      },
      producer
    });
    const result = validateEventEnvelope(envelope);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('fingerprint is deterministic for the same audio asset', () => {
    const e1 = createEventEnvelope({ eventId: 'a1', eventType: 'audio.asset.created', source: 'resonate', payload: { id: 1 } });
    const e2 = createEventEnvelope({ eventId: 'a1', eventType: 'audio.asset.created', source: 'resonate', payload: { id: 1 } });
    assert.strictEqual(e1.fingerprint, e2.fingerprint);
  });

  it('CASCADE derives a processed audio.asset.created event', () => {
    const envelope = createEventEnvelope({
      eventId: 'a1',
      eventType: 'audio.asset.created',
      source: 'resonate',
      payload: { asset_id: 'asset-1', project_id: 'p1', type: 'generated_song' }
    });
    const processor = new EventProcessor({ processorVersion: '1.0' });
    const result = processor.process(envelope);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.event.eventType, 'audio.asset.created');
    assert.ok(result.event.id.startsWith('cascade:'));
  });

  it('lineage records the audio asset as a root event', () => {
    const envelope = createEventEnvelope({
      eventId: 'a2',
      eventType: 'audio.asset.created',
      source: 'resonate',
      payload: { asset_id: 'asset-2' }
    });
    const processor = new EventProcessor({ processorVersion: '1.0' });
    const result = processor.process(envelope);
    const store = new DerivedStore({ dataDir: path.join(require('os').tmpdir(), `rez-lineage-${Date.now()}`) });
    const g = new (require('../../cascade/src/derived-store').LineageGraph)(store);
    store.add(result.event);
    const lineage = g.getLineage(envelope.fingerprint);
    assert.strictEqual(lineage.ok, true);
    assert.deepStrictEqual(lineage.ancestors, []);
    assert.deepStrictEqual(lineage.descendants, []);
  });

  it('KILO generates hypotheses from an audio.asset.created derived event', () => {
    const envelope = createEventEnvelope({
      eventId: 'a3',
      eventType: 'audio.asset.created',
      source: 'resonate',
      payload: { asset_id: 'asset-3' }
    });
    const processor = new EventProcessor({ processorVersion: '1.0' });
    const { event } = processor.process(envelope);
    const kilo = new KiloEngine();
    const out = kilo.generateHypotheses(event);
    assert.ok(Array.isArray(out.hypotheses));
    assert.ok(typeof out.confidence === 'number');
  });

  it('ProtoForge approves a low-risk audio asset', () => {
    const decision = evaluateRules({
      rules: [
        { id: 'approve-audio', priority: 1, if: { eventType: { eq: 'audio.asset.created' }, risk: { lte: 0.3 } }, then: 'approve' }
      ],
      default: 'reject'
    }, { eventType: 'audio.asset.created', risk: 0.1, confidence: 0.95 });
    assert.strictEqual(decision.decision, 'approve');
  });

  const describeSupabase = describe.skip; // live Supabase requires raw_event_ledger table
  describeSupabase('with live ledger', () => {
    it('gateway stores and CASCADE can read the audio.asset.created event', async () => {
      const { RawLedgerAdapter } = require('../../hydi-gateway/src/adapters/raw-ledger');
      const { LedgerAdapter } = require('../../cascade/src/adapters/ledger-adapter');
      const { ReplayEngine } = require('../../cascade/src/replay');

      const envelope = createEventEnvelope({
        eventId: `rez-live-${Date.now()}`,
        eventType: 'audio.asset.created',
        source: 'resonate',
        payload: { asset_id: 'live-1' }
      });

      const gateway = new RawLedgerAdapter({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY
      });
      if (!(await gateway.health()).ok) return;
      const append = await gateway.append(envelope);
      assert.ok(append.ok, append.error);

      const ledger = new LedgerAdapter({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY
      });
      const replay = new ReplayEngine({ ledger, processor: new (require('../../cascade/src/processor').EventProcessor)() });
      const found = await ledger.get(envelope.fingerprint);
      assert.ok(found.ok);
      assert.strictEqual(found.data.eventId, envelope.eventId);
    });
  });
});
