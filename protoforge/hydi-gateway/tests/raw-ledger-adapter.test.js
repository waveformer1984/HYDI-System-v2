const { describe, it } = require('node:test');
const assert = require('node:assert');
const { RawLedgerAdapter, computeFingerprint, computeHash } = require('../src/adapters/raw-ledger');
const crypto = require('crypto');

class MockQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this._insert = null;
    this._select = null;
    this._filters = [];
    this._order = null;
    this._range = null;
    this._maybeSingle = false;
    this._single = false;
    this._head = false;
  }

  from(table) { this.table = table; return this; }
  insert(obj) { this._insert = obj; return this; }
  select(sel, opts) { this._select = { sel, opts }; this._head = !!(opts && opts.head); return this; }
  eq(col, val) { this._filters.push({ col, val, op: 'eq' }); return this; }
  gte(col, val) { this._filters.push({ col, val, op: 'gte' }); return this; }
  lte(col, val) { this._filters.push({ col, val, op: 'lte' }); return this; }
  order(col, opts) { this._order = { col, ...opts }; return this; }
  range(from, to) { this._range = { from, to }; return this; }
  maybeSingle() { this._maybeSingle = true; return this; }
  single() { this._single = true; return this; }

  then(resolve, reject) {
    try {
      resolve(this._run());
    } catch (err) {
      reject(err);
    }
  }

  _matches(row) {
    return this._filters.every(f => {
      const val = row[f.col];
      if (f.op === 'eq') return val === f.val;
      if (f.op === 'gte') return (val || '') >= f.val;
      if (f.op === 'lte') return (val || '') <= f.val;
      return true;
    });
  }

  _run() {
    if (this.client._error) {
      return { data: null, error: { message: this.client._error, code: '500' } };
    }

    if (this._insert) {
      const exists = this.client._records.some(r => r.fingerprint === this._insert.fingerprint);
      if (exists || this.client._conflict) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
      }
      const record = {
        ...this._insert,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString()
      };
      this.client._records.push(record);
      return { data: record, error: null };
    }

    let rows = this.client._records.filter(r => this._matches(r));
    if (this._order) {
      rows = rows.slice().sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    }

    if (this._maybeSingle) {
      const row = rows[0] || null;
      return { data: row, error: null };
    }

    if (this._single) {
      const row = rows[0] || null;
      return { data: row, error: null };
    }

    const count = rows.length;
    let paged = rows;
    if (this._range) {
      paged = rows.slice(this._range.from, this._range.to + 1);
    }
    if (this._head) {
      return { count, data: null, error: null };
    }
    return { data: paged, count, error: null };
  }
}

class MockSupabaseClient {
  constructor(records = []) {
    this._records = records;
    this._conflict = false;
    this._error = null;
  }
  from(table) {
    return new MockQuery(this, table);
  }
}

const baseEnvelope = {
  eventId: 'evt-1',
  eventType: 'audio.asset.created',
  source: 'resonate',
  version: '1',
  timestamp: '2026-08-01T00:00:00.000Z',
  payload: { assetId: 'a1' }
};

describe('RawLedgerAdapter', () => {
  it('computes deterministic fingerprint and hash', () => {
    const fp1 = computeFingerprint('resonate', 'evt-1', 'audio.asset.created');
    const fp2 = computeFingerprint('resonate', 'evt-1', 'audio.asset.created');
    assert.strictEqual(fp1, fp2);
    assert.strictEqual(fp1.length, 64);

    const payload = { assetId: 'a1' };
    const h1 = computeHash(fp1, 'audio.asset.created', payload);
    const h2 = computeHash(fp1, 'audio.asset.created', payload);
    assert.strictEqual(h1, h2);
    assert.strictEqual(h1.length, 64);
  });

  it('appends an event to canonical ledger', async () => {
    const client = new MockSupabaseClient();
    const adapter = new RawLedgerAdapter({ client });
    const result = await adapter.append(baseEnvelope);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.record.eventId, 'evt-1');
    assert.strictEqual(result.record.eventType, 'audio.asset.created');
    assert.ok(result.record.hash);
    assert.ok(result.record.created_at);
  });

  it('rejects duplicate fingerprint', async () => {
    const client = new MockSupabaseClient();
    const adapter = new RawLedgerAdapter({ client });
    await adapter.append(baseEnvelope);
    const result = await adapter.append(baseEnvelope);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'Duplicate fingerprint');
    assert.strictEqual(result.code, '409');
    assert.ok(result.record);
  });

  it('detects duplicate on conflict error', async () => {
    const client = new MockSupabaseClient();
    client._conflict = true;
    const adapter = new RawLedgerAdapter({ client });
    const result = await adapter.append(baseEnvelope);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'Duplicate fingerprint');
    assert.strictEqual(result.code, '409');
  });

  it('returns error when adapter fails', async () => {
    const client = new MockSupabaseClient();
    client._error = 'connection refused';
    const adapter = new RawLedgerAdapter({ client });
    const result = await adapter.append(baseEnvelope);

    assert.strictEqual(result.ok, false);
    assert.match(result.error, /connection refused/);
  });

  it('retrieves an event by fingerprint', async () => {
    const client = new MockSupabaseClient();
    const adapter = new RawLedgerAdapter({ client });
    const { record } = await adapter.append(baseEnvelope);
    const result = await adapter.get(record.fingerprint);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.event.eventId, 'evt-1');
    assert.strictEqual(result.event.source, 'resonate');
    assert.deepStrictEqual(result.event.payload, { assetId: 'a1' });
  });

  it('returns not found for missing fingerprint', async () => {
    const client = new MockSupabaseClient();
    const adapter = new RawLedgerAdapter({ client });
    const result = await adapter.get('missing');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, '404');
  });

  it('lists events with pagination', async () => {
    const client = new MockSupabaseClient();
    const adapter = new RawLedgerAdapter({ client });
    for (let i = 0; i < 5; i++) {
      await adapter.append({
        eventId: `e-${i}`,
        eventType: 'x',
        source: 'r',
        payload: { i }
      });
    }
    const result = await adapter.list({ offset: '1', limit: '2' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.events.length, 2);
    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.hasMore, true);
  });

  it('filters list by eventType', async () => {
    const client = new MockSupabaseClient();
    const adapter = new RawLedgerAdapter({ client });
    await adapter.append({ ...baseEnvelope, eventType: 'a' });
    await adapter.append({ ...baseEnvelope, eventId: 'evt-2', eventType: 'b' });
    const result = await adapter.list({ eventType: 'a' });
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.events[0].eventType, 'a');
  });

  it('reports health', async () => {
    const client = new MockSupabaseClient();
    const adapter = new RawLedgerAdapter({ client });
    await adapter.append(baseEnvelope);
    const h = await adapter.health();
    assert.strictEqual(h.ok, true);
    assert.strictEqual(h.connected, true);
    assert.strictEqual(h.events, 1);
  });

  it('reports health failure on error', async () => {
    const client = new MockSupabaseClient();
    client._error = 'database down';
    const adapter = new RawLedgerAdapter({ client });
    const h = await adapter.health();
    assert.strictEqual(h.ok, false);
    assert.strictEqual(h.connected, false);
    assert.match(h.error, /database down/);
  });
});
