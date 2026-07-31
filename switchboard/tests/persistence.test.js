const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { JsonStore, SCHEMA_VERSION } = require('../src/persistence/json-store');
const { MemoryStore } = require('../src/persistence/memory-store');

describe('persistence', () => {
  it('JsonStore migrates legacy schema to current version', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
    const file = path.join(dir, 'db.json');
    fs.writeFileSync(file, JSON.stringify({ users: [{ id: 'u1', name: 'Test' }] }));
    const store = new JsonStore({ filePath: file });
    store.init();
    assert.strictEqual(store.state.schemaVersion, SCHEMA_VERSION);
    assert.ok(Array.isArray(store.state.gigs));
    assert.strictEqual(store.state.users[0].name, 'Test');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('JsonStore writes atomically and preserves state', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
    const file = path.join(dir, 'db.json');
    const store = new JsonStore({ filePath: file });
    store.init();
    store.create('users', { id: 'u2', name: 'Bob' });
    const fromDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(fromDisk.users.length, 1);
    assert.strictEqual(fromDisk.users[0].name, 'Bob');
    assert.strictEqual(fromDisk.schemaVersion, SCHEMA_VERSION);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('MemoryStore is database-neutral and supports CRUD', () => {
    const store = new MemoryStore();
    store.init();
    store.create('gigs', { id: 'g1', title: 'Jazz' });
    assert.strictEqual(store.getAll('gigs').length, 1);
    store.update('gigs', 'g1', { id: 'g1', title: 'Blues' });
    assert.strictEqual(store.getById('gigs', 'g1').title, 'Blues');
    assert.strictEqual(store.delete('gigs', 'g1'), true);
    assert.strictEqual(store.getAll('gigs').length, 0);
  });
});
