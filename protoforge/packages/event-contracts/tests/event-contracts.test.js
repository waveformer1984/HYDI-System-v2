const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  createTimestamp,
  createCorrelationId,
  createProducerMetadata,
  createCapabilityDeclaration,
  createEventEnvelope,
  computeFingerprint,
  computeHash,
  validateEventEnvelope
} = require('../src/index');

describe('event-contracts', () => {
  describe('createTimestamp', () => {
    it('returns an ISO 8601 string', () => {
      const ts = createTimestamp();
      assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('createCorrelationId', () => {
    it('uses the event id', () => {
      const c = createCorrelationId('evt-1');
      assert.ok(c.startsWith('corr-evt-1-'));
    });

    it('generates a random id when none is provided', () => {
      const c = createCorrelationId();
      assert.ok(c.startsWith('corr-'));
    });
  });

  describe('createProducerMetadata', () => {
    it('requires a name', () => {
      assert.throws(() => createProducerMetadata({}), /name is required/);
    });

    it('returns structured metadata', () => {
      const meta = createProducerMetadata({ name: 'Resonate', version: '1.0.0', capabilities: ['audio'] });
      assert.strictEqual(meta.name, 'Resonate');
      assert.strictEqual(meta.version, '1.0.0');
      assert.deepStrictEqual(meta.capabilities, ['audio']);
      assert.match(meta.emitted_at, /^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('createCapabilityDeclaration', () => {
    it('normalizes strings to arrays', () => {
      const cap = createCapabilityDeclaration({ produces: 'audio.asset.created', consumes: 'ownership.updated' });
      assert.deepStrictEqual(cap.produces, ['audio.asset.created']);
      assert.deepStrictEqual(cap.consumes, ['ownership.updated']);
      assert.deepStrictEqual(cap.requires, []);
    });
  });

  describe('computeFingerprint', () => {
    it('is deterministic for the same inputs', () => {
      const a = computeFingerprint('resonate', 'evt-1', 'audio.asset.created');
      const b = computeFingerprint('resonate', 'evt-1', 'audio.asset.created');
      assert.strictEqual(a, b);
      assert.strictEqual(a.length, 64);
    });

    it('changes with different inputs', () => {
      const a = computeFingerprint('resonate', 'evt-1', 'audio.asset.created');
      const b = computeFingerprint('resonate', 'evt-2', 'audio.asset.created');
      assert.notStrictEqual(a, b);
    });
  });

  describe('computeHash', () => {
    it('is deterministic', () => {
      const a = computeHash('fp', 'audio.asset.created', { id: 1 });
      const b = computeHash('fp', 'audio.asset.created', { id: 1 });
      assert.strictEqual(a, b);
    });

    it('changes with payload mutation', () => {
      const a = computeHash('fp', 'audio.asset.created', { id: 1 });
      const b = computeHash('fp', 'audio.asset.created', { id: 2 });
      assert.notStrictEqual(a, b);
    });
  });

  describe('createEventEnvelope', () => {
    it('builds a complete envelope', () => {
      const env = createEventEnvelope({
        eventId: 'evt-1',
        eventType: 'audio.asset.created',
        source: 'resonate',
        payload: { id: 1 }
      });
      assert.strictEqual(env.eventId, 'evt-1');
      assert.strictEqual(env.eventType, 'audio.asset.created');
      assert.strictEqual(env.source, 'resonate');
      assert.strictEqual(env.version, '1');
      assert.ok(env.fingerprint);
      assert.ok(env.hash);
      assert.ok(env.correlationId);
    });

    it('requires a source', () => {
      assert.throws(() => createEventEnvelope({ eventId: 'x', eventType: 't', payload: {} }), /source is required/);
    });

    it('rejects an array payload', () => {
      assert.throws(() => createEventEnvelope({ eventId: 'x', eventType: 't', source: 's', payload: [] }), /plain object/);
    });
  });

  describe('validateEventEnvelope', () => {
    it('accepts a well-formed envelope', () => {
      const env = createEventEnvelope({ eventId: 'evt-1', eventType: 't', source: 's', payload: {} });
      const result = validateEventEnvelope(env);
      assert.strictEqual(result.ok, true);
      assert.deepStrictEqual(result.errors, []);
    });

    it('rejects missing fields', () => {
      const result = validateEventEnvelope({});
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.length > 0);
    });

    it('rejects a fingerprint mismatch', () => {
      const env = createEventEnvelope({ eventId: 'evt-1', eventType: 't', source: 's', payload: {} });
      env.fingerprint = 'bad';
      const result = validateEventEnvelope(env);
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.includes('fingerprint mismatch'));
    });

    it('rejects a hash mismatch', () => {
      const env = createEventEnvelope({ eventId: 'evt-1', eventType: 't', source: 's', payload: {} });
      env.hash = 'bad';
      const result = validateEventEnvelope(env);
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.includes('hash mismatch'));
    });
  });
});
