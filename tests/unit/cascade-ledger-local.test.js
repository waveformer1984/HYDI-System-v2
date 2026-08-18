'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const LocalLedgerStore = require('../../lib/protoforge/local-ledger-store');

describe('CASCADE raw ledger — local-first', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-ledger-'));
    process.env.HYDI_PROTOFORGE_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.HYDI_PROTOFORGE_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('LocalLedgerStore reads a missing event as null', async () => {
    const store = new LocalLedgerStore(tmpDir);
    const result = await store.get('not-there');
    expect(result).toBeNull();
  });

  test('local-ledger append and read without Supabase', async () => {
    const store = new LocalLedgerStore(tmpDir);
    const event = { fingerprint: 'fp-1', event_type: 'audio.asset.created', payload: { assetId: 'a1' } };
    const { record, duplicate } = await store.append(event);
    expect(duplicate).toBe(false);
    expect(record.fingerprint).toBe('fp-1');
    expect(record.hash).toBeDefined();

    const read = await store.get('fp-1');
    expect(read).not.toBeNull();
    expect(read.fingerprint).toBe('fp-1');
  });

  test('local-ledger append is idempotent', async () => {
    const store = new LocalLedgerStore(tmpDir);
    const event = { fingerprint: 'fp-dup', event_type: 'test', payload: {} };
    await store.append(event);
    const { duplicate } = await store.append(event);
    expect(duplicate).toBe(true);
  });

  test('LocalLedgerStore lists local events', async () => {
    const store = new LocalLedgerStore(tmpDir);
    for (let i = 0; i < 5; i++) {
      await store.append({ fingerprint: `fp-${i}`, event_type: 'x', payload: { i } });
    }

    const result = await store.list({ offset: 1, limit: 2 });
    expect(result.events.length).toBe(2);
    expect(result.total).toBe(5);
    expect(result.hasMore).toBe(true);
  });

  test('LocalLedgerStore filters by eventType', async () => {
    const store = new LocalLedgerStore(tmpDir);
    await store.append({ fingerprint: 'a', event_type: 'a', payload: {} });
    await store.append({ fingerprint: 'b', event_type: 'b', payload: {} });

    const result = await store.list({ eventType: 'a' });
    expect(result.events.length).toBe(1);
    expect(result.events[0].event_type).toBe('a');
  });

  test('local ledger health is ok', async () => {
    const store = new LocalLedgerStore(tmpDir);
    const h = await store.health();
    expect(h.ok).toBe(true);
    expect(h.connected).toBe(true);
    expect(typeof h.events).toBe('number');
  });

  test('persistence survives restart (fresh store instance reads old data)', async () => {
    const store1 = new LocalLedgerStore(tmpDir);
    await store1.append({ fingerprint: 'persist-1', event_type: 'test', payload: { msg: 'hello' } });

    // Simulate restart: create a fresh store instance pointing at the same dir
    const store2 = new LocalLedgerStore(tmpDir);
    const read = await store2.get('persist-1');
    expect(read).not.toBeNull();
    expect(read.payload.msg).toBe('hello');
  });
});
