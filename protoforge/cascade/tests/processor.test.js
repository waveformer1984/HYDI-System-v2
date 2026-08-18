const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EventProcessor, validate, verifyIntegrity } = require('../src/processor');
const { computeFingerprint, computeHash } = require('../src/adapters/ledger-adapter');
const { createDefaultAdapters } = require('../src/versioning/adapters');

function makeEvent(overrides = {}) {
  const payload = { ...(overrides.payload || {}) };
  const eventId = overrides.eventId || 'evt-1';
  const eventType = overrides.eventType || 'audio.asset.created';
  const source = overrides.source || 'resonate';
  const version = overrides.version || '1';
  const timestamp = overrides.timestamp || new Date().toISOString();
  const fingerprint = computeFingerprint(source, eventId, eventType);
  const hash = computeHash(fingerprint, eventType, payload);
  return { eventId, eventType, source, version, timestamp, payload, fingerprint, hash };
}

describe('EventProcessor', () => {
  it('validates a well-formed event', () => {
    const v = validate(makeEvent());
    assert.strictEqual(v.ok, true);
  });

  it('rejects missing eventId', () => {
    const v = validate({ ...makeEvent(), eventId: undefined });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /eventId/);
  });

  it('rejects non-object payload', () => {
    const v = validate({ ...makeEvent(), payload: [1] });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /payload/);
  });

  it('rejects invalid timestamp', () => {
    const v = validate({ ...makeEvent(), timestamp: 'yesterday' });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /timestamp/);
  });

  it('verifies fingerprint and hash', () => {
    const v = verifyIntegrity(makeEvent());
    assert.strictEqual(v.ok, true);
  });

  it('rejects fingerprint mismatch', () => {
    const e = makeEvent();
    const v = verifyIntegrity({ ...e, fingerprint: 'bad' });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /fingerprint/);
  });

  it('rejects hash mismatch', () => {
    const e = makeEvent();
    const v = verifyIntegrity({ ...e, hash: 'bad' });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /hash/);
  });

  it('processes a v1 event and derives an id', () => {
    const p = new EventProcessor({ versionAdapters: createDefaultAdapters() });
    const result = p.process(makeEvent());
    assert.strictEqual(result.ok, true);
    assert.ok(result.event.id.startsWith('cascade:'));
    assert.strictEqual(result.event.eventType, 'audio.asset.created');
  });

  it('adapts a v2 payload to set parentFingerprint', () => {
    const p = new EventProcessor({ versionAdapters: createDefaultAdapters() });
    const parent = makeEvent({ eventId: 'p', payload: {} });
    const child = makeEvent({ eventId: 'c', version: '2', payload: { parent: parent.fingerprint } });
    const result = p.process(child);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.event.parentFingerprint, parent.fingerprint);
  });

  it('preserves original payload after normalization', () => {
    const p = new EventProcessor({ versionAdapters: createDefaultAdapters() });
    const e = makeEvent({ payload: { original: true } });
    const result = p.process(e);
    assert.deepStrictEqual(result.event.originalPayload, { original: true });
    assert.deepStrictEqual(result.event.normalizedPayload, { original: true, cascadeVersion: 1 });
  });

  it('fails on unknown schema version', () => {
    const p = new EventProcessor({ versionAdapters: createDefaultAdapters() });
    const result = p.process(makeEvent({ version: '99' }));
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /unknown schema version/);
  });
});
