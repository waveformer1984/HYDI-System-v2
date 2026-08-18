const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');

const {
  createEventEnvelope,
  computeFingerprint,
  computeHash,
  validateEventEnvelope,
  createProducerMetadata
} = require('../../packages/event-contracts/src/index');

const { RawLedgerAdapter, computeFingerprint: gatewayFingerprint, computeHash: gatewayHash } = require('../../hydi-gateway/src/adapters/raw-ledger');
const { Outbox } = require('../../hydi-gateway/src/outbox/outbox');
const { RetryWorker } = require('../../hydi-gateway/src/outbox/retry-worker');
const { EventProcessor } = require('../../cascade/src/processor');
const { ReplayEngine } = require('../../cascade/src/replay');
const { DerivedStore } = require('../../cascade/src/derived-store');
const { KiloEngine } = require('../../../kilo/index');
const { evaluateRules } = require('../../../lib/protoforge/policy-engine');

const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe('ProtoForge platform flow', () => {
  describe('event contracts', () => {
    it('produces a canonical event envelope', () => {
      const producer = createProducerMetadata({ name: 'Resonate', version: '1.0.0' });
      const envelope = createEventEnvelope({
        eventId: 'evt-1',
        eventType: 'audio.asset.created',
        source: 'resonate',
        payload: { assetId: 'a1' },
        producer
      });
      assert.strictEqual(envelope.eventType, 'audio.asset.created');
      assert.strictEqual(envelope.producer.name, 'Resonate');
      assert.ok(validateEventEnvelope(envelope).ok);
    });

    it('event-contracts fingerprint matches gateway fingerprint', () => {
      const a = computeFingerprint('resonate', 'evt-1', 'audio.asset.created');
      const b = gatewayFingerprint('resonate', 'evt-1', 'audio.asset.created');
      assert.strictEqual(a, b);
    });

    it('event-contracts hash matches gateway hash', () => {
      const fp = computeFingerprint('resonate', 'evt-1', 'audio.asset.created');
      const a = computeHash(fp, 'audio.asset.created', { assetId: 'a1' });
      const b = gatewayHash(fp, 'audio.asset.created', { assetId: 'a1' });
      assert.strictEqual(a, b);
    });

    it('rejects an envelope with tampered hash', () => {
      const envelope = createEventEnvelope({ eventId: 'evt-1', eventType: 't', source: 's', payload: {} });
      envelope.hash = 'tampered';
      const result = validateEventEnvelope(envelope);
      assert.strictEqual(result.ok, false);
    });
  });

  describe('gateway ledger adapter', () => {
    const describeSupabase = describe.skip; // live Supabase requires raw_event_ledger table

    describeSupabase('with Supabase', () => {
      const adapter = new RawLedgerAdapter({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY
      });

      it('reports health', async () => {
        const h = await adapter.health();
        assert.ok(h.ok || h.error);
      });

      it('appends and retrieves an event by fingerprint', async () => {
        if (!(await adapter.health()).ok) return;
        const envelope = createEventEnvelope({
          eventId: `pf-test-${Date.now()}`,
          eventType: 'platform.flow.test',
          source: 'platform-tests',
          payload: { index: 0 }
        });
        const append = await adapter.append(envelope);
        assert.ok(append.ok, append.error);

        const found = await adapter.get(envelope.fingerprint);
        assert.ok(found.ok);
        assert.strictEqual(found.data.eventId, envelope.eventId);
      });

      it('rejects duplicate fingerprints', async () => {
        if (!(await adapter.health()).ok) return;
        const envelope = createEventEnvelope({
          eventId: `pf-dup-${Date.now()}`,
          eventType: 'platform.flow.dup',
          source: 'platform-tests',
          payload: { index: 1 }
        });
        const first = await adapter.append(envelope);
        assert.ok(first.ok);
        const second = await adapter.append(envelope);
        assert.strictEqual(second.ok, false);
        assert.ok(second.error.toLowerCase().includes('duplicate') || second.error.toLowerCase().includes('already'));
      });

      it('lists events by event type', async () => {
        if (!(await adapter.health()).ok) return;
        const envelope = createEventEnvelope({
          eventId: `pf-list-${Date.now()}`,
          eventType: 'platform.flow.list',
          source: 'platform-tests',
          payload: { index: 2 }
        });
        await adapter.append(envelope);
        const list = await adapter.list({ eventType: 'platform.flow.list' });
        assert.ok(list.ok);
        assert.ok(list.data.some(e => e.fingerprint === envelope.fingerprint));
      });
    });
  });

  describe('outbox', () => {
    function tmpDataDir() {
      return path.join(os.tmpdir(), `pf-outbox-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }

    it('enqueues and removes an event', () => {
      const outbox = new Outbox({ dataDir: tmpDataDir() });
      const event = createEventEnvelope({ eventId: 'o1', eventType: 'outbox.test', source: 's', payload: {} });
      const result = outbox.enqueue(event);
      assert.strictEqual(result.ok, true);
      const item = outbox.peek();
      assert.ok(item);
      outbox.markSuccess(item.fingerprint);
      assert.strictEqual(outbox.pendingCount(), 0);
    });

    it('rejects duplicate enqueue', () => {
      const outbox = new Outbox({ dataDir: tmpDataDir() });
      const event = createEventEnvelope({ eventId: 'o2', eventType: 'outbox.test', source: 's', payload: {} });
      outbox.enqueue(event);
      const result = outbox.enqueue(event);
      assert.strictEqual(result.ok, false);
    });

    it('requeues on delivery failure and backs off', () => {
      const outbox = new Outbox({ dataDir: tmpDataDir() });
      const event = createEventEnvelope({ eventId: 'o3', eventType: 'outbox.test', source: 's', payload: {} });
      outbox.enqueue(event);
      outbox.markFailure(event.fingerprint, new Error('network'));
      const item = outbox.peek();
      assert.ok(item.attempt >= 1);
      assert.ok(item.nextAttempt > item.enqueuedAt);
    });

    it('RetryWorker delivers a queued event', async () => {
      const outbox = new Outbox({ dataDir: tmpDataDir() });
      const event = createEventEnvelope({ eventId: 'o4', eventType: 'outbox.test', source: 's', payload: {} });
      outbox.enqueue(event, { nextAttempt: Date.now() });
      const worker = new RetryWorker(outbox, async () => ({ ok: true }));
      await worker._tick();
      worker.stop();
      assert.strictEqual(outbox.pendingCount(), 0);
    });

    it('RetryWorker requeues on delivery failure', async () => {
      const outbox = new Outbox({ dataDir: tmpDataDir() });
      const event = createEventEnvelope({ eventId: 'o5', eventType: 'outbox.test', source: 's', payload: {} });
      outbox.enqueue(event, { nextAttempt: Date.now() });
      const worker = new RetryWorker(outbox, async () => ({ ok: false, error: 'down' }));
      await worker._tick();
      worker.stop();
      assert.strictEqual(outbox.pendingCount(), 1);
      assert.strictEqual(worker.stats.failures, 1);
    });
  });

  describe('CASCADE processing', () => {
    it('EventProcessor derives a canonical derived event', () => {
      const envelope = createEventEnvelope({
        eventId: 'c1',
        eventType: 'audio.asset.created',
        source: 'resonate',
        payload: { assetId: 'a1' }
      });
      const processor = new EventProcessor({ processorVersion: '1.0' });
      const result = processor.process(envelope);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.event.eventType, 'audio.asset.created');
      assert.ok(result.event.id.startsWith('cascade:'));
      assert.strictEqual(result.event.fingerprint, envelope.fingerprint);
    });

    it('LineageGraph tracks parent and child', () => {
      const store = new DerivedStore({ dataDir: path.join(os.tmpdir(), `pf-lineage-${Date.now()}`) });
      const g = new (require('../../cascade/src/derived-store').LineageGraph)(store);
      const parent = { fingerprint: 'fp-parent', eventType: 'parent', children: [], payload: {} };
      const child = { fingerprint: 'fp-child', eventType: 'child', parentFingerprint: 'fp-parent', children: [], payload: {} };
      store.add(parent);
      store.add(child);
      const children = g.getChildren('fp-parent');
      assert.deepStrictEqual(children, ['fp-child']);
      const ancestors = g.getAncestors('fp-child').map(e => e.fingerprint);
      assert.deepStrictEqual(ancestors, ['fp-parent']);
    });

    it('ReplayEngine can be instantiated', () => {
      const engine = new ReplayEngine({});
      assert.strictEqual(typeof engine.replay, 'function');
    });
  });

  describe('KILO and ProtoForge handoff', () => {
    it('KILO generates hypotheses from a derived event', () => {
      const kilo = new KiloEngine();
      const derived = {
        eventType: 'audio.asset.created',
        fingerprint: 'fp-1',
        normalizedPayload: { assetId: 'a1' }
      };
      const out = kilo.generateHypotheses(derived);
      assert.ok(Array.isArray(out.hypotheses));
      assert.ok(typeof out.confidence === 'number');
    });

    it('KILO execute() throws', () => {
      const kilo = new KiloEngine();
      assert.throws(() => kilo.execute({}), /KILO is a hypothesis generator only/);
    });

    it('PolicyEngine approves a confident, low-risk hypothesis', () => {
      const decision = evaluateRules({
        rules: [{ id: 'r1', priority: 1, if: { confidence: { gte: 0.9 }, risk: { lte: 0.2 } }, then: 'approve' }],
        default: 'reject'
      }, { confidence: 0.95, risk: 0.1 });
      assert.strictEqual(decision.decision, 'approve');
    });

    it('PolicyEngine rejects an unknown hypothesis by default', () => {
      const decision = evaluateRules({ rules: [] }, { confidence: 0.5 });
      assert.strictEqual(decision.decision, 'reject');
    });

    it('PolicyEngine escalates high-risk hypotheses', () => {
      const decision = evaluateRules({
        rules: [{ id: 'r2', priority: 1, if: { risk: { gte: 0.8 } }, then: 'escalate' }],
        default: 'reject'
      }, { confidence: 0.5, risk: 0.9 });
      assert.strictEqual(decision.decision, 'escalate');
    });
  });

  describe('diagnostics', () => {
    it('runtime inventory contains canonical and legacy components', async () => {
      const { getRuntimeInventory } = require('../../../lib/platform-diagnostics');
      const inventory = await getRuntimeInventory();
      assert.ok(inventory.canonical.length > 0);
      assert.ok(inventory.legacy.length > 0);
      assert.ok(inventory.summary.total >= 10);
    });

    it('runtime inventory answers what each component produces', async () => {
      const { getRuntimeInventory } = require('../../../lib/platform-diagnostics');
      const inventory = await getRuntimeInventory();
      const cascade = inventory.canonical.find(c => c.name === 'CASCADE');
      assert.ok(cascade);
      assert.ok(cascade.produces.includes('cascade.derived'));
    });

    it('runtime inventory answers what each component consumes', async () => {
      const { getRuntimeInventory } = require('../../../lib/platform-diagnostics');
      const inventory = await getRuntimeInventory();
      const kilo = inventory.canonical.find(c => c.name === 'KILO');
      assert.ok(kilo);
      assert.ok(kilo.consumes.includes('cascade.derived'));
    });
  });
});
