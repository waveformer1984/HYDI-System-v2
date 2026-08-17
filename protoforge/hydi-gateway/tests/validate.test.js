const { describe, it } = require('node:test');
const assert = require('node:assert');
const { validateEvent } = require('../src/validate');

const base = {
  eventId: 'evt-1',
  eventType: 'audio.asset.created',
  source: 'resonate',
  version: '1',
  timestamp: '2026-08-01T00:00:00.000Z',
  payload: { assetId: 'a1' }
};

describe('Event validation', () => {
  it('accepts a valid event', () => {
    const v = validateEvent(base);
    assert.strictEqual(v.ok, true);
  });

  it('requires eventId', () => {
    const v = validateEvent({ ...base, eventId: '' });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /eventId/);
  });

  it('requires eventType', () => {
    const v = validateEvent({ ...base, eventType: '' });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /eventType/);
  });

  it('requires source', () => {
    const v = validateEvent({ ...base, source: '' });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /source/);
  });

  it('requires payload as object', () => {
    const v = validateEvent({ ...base, payload: null });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /payload/);
  });

  it('rejects array payload', () => {
    const v = validateEvent({ ...base, payload: [1, 2] });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /payload/);
  });

  it('rejects non-string version', () => {
    const v = validateEvent({ ...base, version: 1 });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /version/);
  });

  it('rejects invalid timestamp', () => {
    const v = validateEvent({ ...base, timestamp: 'yesterday' });
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /timestamp/);
  });

  it('accepts missing optional timestamp', () => {
    const v = validateEvent({ ...base, timestamp: undefined });
    assert.strictEqual(v.ok, true);
  });
});
