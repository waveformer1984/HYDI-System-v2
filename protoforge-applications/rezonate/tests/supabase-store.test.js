const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SupabaseStore } = require('../src/persistence/supabase-store');
const { UnsupportedOperationError } = require('../src/errors');

/**
 * Minimal fake `@supabase/supabase-js` query builder — not the real library.
 * SupabaseStore never imports @supabase/supabase-js itself (constructor injection
 * only, see src/persistence/supabase-store.js), so this is enough to exercise every
 * code path without a real project or network access, matching the mocking approach
 * already used in tests/unit/rezonate.test.js for the legacy API.
 *
 * Mimics the real client's "thenable query builder" shape closely enough for
 * SupabaseStore's exact call chains:
 *   .from(t).insert(record)                      -> { error }
 *   .from(t).select('*').eq('id', id).maybeSingle() -> { data, error }
 *   .from(t).select('*')                          -> { data, error }
 *   .from(t).update(record).eq('id', id)          -> { error }
 *   .from(t).delete().eq('id', id)                -> { error }
 */
function makeFakeSupabase(tables) {
  const calls = [];
  function builder(tableName) {
    let mode = null; // 'select' | 'insert' | 'update' | 'delete'
    let payload = null;
    let filterId = null;
    let single = false;

    const api = {
      insert(record) { mode = 'insert'; payload = record; return api; },
      select() { mode = 'select'; return api; },
      update(record) { mode = 'update'; payload = record; return api; },
      delete() { mode = 'delete'; return api; },
      eq(col, val) { if (col === 'id') filterId = val; return api; },
      maybeSingle() { single = true; return api; },
      then(resolve, reject) {
        calls.push({ table: tableName, mode, payload, filterId, single });
        try {
          const rows = tables[tableName] || (tables[tableName] = []);
          if (mode === 'insert') {
            rows.push(payload);
            return resolve({ data: payload, error: null });
          }
          if (mode === 'update') {
            const idx = rows.findIndex(r => r.id === filterId);
            if (idx >= 0) rows[idx] = { ...rows[idx], ...payload };
            return resolve({ error: null });
          }
          if (mode === 'delete') {
            const idx = rows.findIndex(r => r.id === filterId);
            if (idx >= 0) rows.splice(idx, 1);
            return resolve({ error: null });
          }
          // select
          if (filterId != null) {
            const row = rows.find(r => r.id === filterId) || null;
            return resolve(single ? { data: row, error: null } : { data: row ? [row] : [], error: null });
          }
          return resolve({ data: rows.slice(), error: null });
        } catch (err) {
          if (reject) return reject(err);
          throw err;
        }
      }
    };
    return api;
  }

  return {
    client: { from: (t) => builder(t) },
    calls,
    tables
  };
}

describe('SupabaseStore', () => {
  it('requires a client to be constructed', () => {
    assert.throws(() => new SupabaseStore({}), /requires a client/);
  });

  it('init() resolves true without a network check', async () => {
    const { client } = makeFakeSupabase({});
    const store = new SupabaseStore({ client });
    assert.strictEqual(await store.init(), true);
  });

  it('creates and reads back a project via rezonate_projects', async () => {
    const { client, tables } = makeFakeSupabase({});
    const store = new SupabaseStore({ client });
    const project = { id: 'p1', name: 'Test Project' };

    await store.create('projects', project);
    assert.deepStrictEqual(tables.rezonate_projects, [project]);

    const found = await store.getById('projects', 'p1');
    assert.deepStrictEqual(found, project);

    const all = await store.getAll('projects');
    assert.strictEqual(all.length, 1);
  });

  it('creates and reads back a track via rezonate_tracks', async () => {
    const { client } = makeFakeSupabase({});
    const store = new SupabaseStore({ client });
    const track = { id: 't1', project_id: 'p1', name: 'Bass' };

    await store.create('tracks', track);
    const found = await store.getById('tracks', 't1');
    assert.strictEqual(found.name, 'Bass');
  });

  it('updates and deletes a project', async () => {
    const { client, tables } = makeFakeSupabase({ rezonate_projects: [{ id: 'p1', name: 'Old' }] });
    const store = new SupabaseStore({ client });

    await store.update('projects', 'p1', { id: 'p1', name: 'New' });
    assert.strictEqual(tables.rezonate_projects[0].name, 'New');

    await store.delete('projects', 'p1');
    assert.strictEqual(tables.rezonate_projects.length, 0);
  });

  it('getById returns null when not found', async () => {
    const { client } = makeFakeSupabase({});
    const store = new SupabaseStore({ client });
    const found = await store.getById('projects', 'does-not-exist');
    assert.strictEqual(found, null);
  });

  // --- The schema gap: these five tables have no matching Supabase table today. ---
  // See docs/REZONATE_SUPABASE_SCHEMA_GAP.md. Every operation must throw loud, not
  // silently no-op or drop data.
  for (const table of ['assets', 'processing_jobs', 'ownership_records', 'rights', 'audit_log']) {
    it(`refuses create('${table}') — no matching Supabase table exists`, async () => {
      const { client } = makeFakeSupabase({});
      const store = new SupabaseStore({ client });
      await assert.rejects(() => store.create(table, { id: 'x' }), UnsupportedOperationError);
    });

    it(`refuses getAll('${table}') — no matching Supabase table exists`, async () => {
      const { client } = makeFakeSupabase({});
      const store = new SupabaseStore({ client });
      await assert.rejects(() => store.getAll(table), UnsupportedOperationError);
    });
  }

  it('load() returns real data for mapped tables and empty arrays for unsupported ones', async () => {
    const { client } = makeFakeSupabase({
      rezonate_projects: [{ id: 'p1', name: 'A' }],
      rezonate_tracks: [{ id: 't1', name: 'B' }]
    });
    const store = new SupabaseStore({ client });
    const snapshot = await store.load();

    assert.strictEqual(snapshot.projects.length, 1);
    assert.strictEqual(snapshot.tracks.length, 1);
    assert.deepStrictEqual(snapshot.assets, []);
    assert.deepStrictEqual(snapshot.processing_jobs, []);
    assert.deepStrictEqual(snapshot.ownership_records, []);
    assert.deepStrictEqual(snapshot.rights, []);
    assert.deepStrictEqual(snapshot.audit_log, []);
  });

  it('surfaces a Supabase error from the client as a real Error', async () => {
    const client = { from: () => ({
      insert() { return this; },
      then(resolve) { return resolve({ error: { message: 'permission denied' } }); }
    }) };
    const store = new SupabaseStore({ client });
    await assert.rejects(() => store.create('projects', { id: 'p1' }), /permission denied/);
  });

  it('createStore() factory returns a SupabaseStore instance', () => {
    const { createStore } = require('../src/persistence/supabase-store');
    const { client } = makeFakeSupabase({});
    const store = createStore({ client });
    assert.ok(store instanceof SupabaseStore);
  });
});
