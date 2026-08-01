const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Ledger } = require('../src/store');

function tmpConfig() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-ledger-'));
  return { ledgerPath: path.join(dataDir, 'events.json') };
}

describe('Ledger', () => {
  it('appends and retrieves an event', () => {
    const cfg = tmpConfig();
    const store = new Ledger(cfg);
    const record = store.append({
      eventId: 'evt-1',
      eventType: 'audio.asset.created',
      source: 'resonate',
      payload: { assetId: 'a1' }
    });
    assert.strictEqual(record.eventId, 'evt-1');
    assert.ok(record.receivedAt);

    const found = store.get('evt-1');
    assert.strictEqual(found.eventId, 'evt-1');
    assert.strictEqual(found.payload.assetId, 'a1');
  });

  it('returns null for unknown event', () => {
    const cfg = tmpConfig();
    const store = new Ledger(cfg);
    assert.strictEqual(store.get('missing'), null);
  });

  it('lists events with pagination', () => {
    const cfg = tmpConfig();
    const store = new Ledger(cfg);
    for (let i = 0; i < 5; i++) {
      store.append({
        eventId: `evt-${i}`,
        eventType: 'processing.completed',
        source: 'resonate',
        payload: { i }
      });
    }
    const page = store.list({ offset: '1', limit: '2' });
    assert.strictEqual(page.events.length, 2);
    assert.strictEqual(page.events[0].eventId, 'evt-1');
    assert.strictEqual(page.total, 5);
    assert.strictEqual(page.hasMore, true);
  });

  it('filters by eventType', () => {
    const cfg = tmpConfig();
    const store = new Ledger(cfg);
    store.append({ eventId: 'e1', eventType: 'audio.asset.created', source: 'resonate', payload: {} });
    store.append({ eventId: 'e2', eventType: 'processing.completed', source: 'resonate', payload: {} });
    const res = store.list({ eventType: 'audio.asset.created' });
    assert.strictEqual(res.events.length, 1);
    assert.strictEqual(res.events[0].eventId, 'e1');
  });

  it('filters by source', () => {
    const cfg = tmpConfig();
    const store = new Ledger(cfg);
    store.append({ eventId: 'e1', eventType: 'x', source: 'resonate', payload: {} });
    store.append({ eventId: 'e2', eventType: 'x', source: 'proto-yi', payload: {} });
    const res = store.list({ source: 'proto-yi' });
    assert.strictEqual(res.events.length, 1);
    assert.strictEqual(res.events[0].eventId, 'e2');
  });

  it('filters by timestamp range', () => {
    const cfg = tmpConfig();
    const store = new Ledger(cfg);
    store.append({ eventId: 'e1', eventType: 'x', source: 'r', timestamp: '2026-08-01T10:00:00Z', payload: {} });
    store.append({ eventId: 'e2', eventType: 'x', source: 'r', timestamp: '2026-08-01T15:00:00Z', payload: {} });
    const res = store.list({ since: '2026-08-01T12:00:00Z', until: '2026-08-01T20:00:00Z' });
    assert.strictEqual(res.events.length, 1);
    assert.strictEqual(res.events[0].eventId, 'e2');
  });

  it('maintains append-only order', () => {
    const cfg = tmpConfig();
    const store = new Ledger(cfg);
    for (let i = 0; i < 3; i++) {
      store.append({ eventId: `o-${i}`, eventType: 'x', source: 'r', payload: { i } });
    }
    const res = store.list({ limit: '10' });
    assert.deepStrictEqual(res.events.map(e => e.eventId), ['o-0', 'o-1', 'o-2']);
  });

  it('returns accurate count', () => {
    const cfg = tmpConfig();
    const store = new Ledger(cfg);
    store.append({ eventId: 'c1', eventType: 'x', source: 'r', payload: {} });
    store.append({ eventId: 'c2', eventType: 'x', source: 'r', payload: {} });
    assert.strictEqual(store.count(), 2);
  });
});
