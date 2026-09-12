const { Store, SCHEMA_VERSION } = require('./store');
const { UnsupportedOperationError } = require('../errors');

/**
 * Supabase-backed Store implementation (P1 #5, docs/REZONATE_CONSOLIDATION_PLAN.md).
 *
 * IMPORTANT — schema gap (discovered 2026-08-13, see docs/REZONATE_SUPABASE_SCHEMA_GAP.md):
 * the live migration (supabase/migrations/20260522000001_rezonate_schema.sql) only
 * defines tables for `projects` and `tracks` in a shape this domain model can use.
 * It has NO table for `assets`, `processing_jobs`, `ownership_records`, `rights`, or
 * `audit_log` — those are required by the domain model (see
 * protoforge-applications/rezonate/src/persistence/store.js `defaultTables`) but do
 * not exist in Supabase today. `rezonate_audio_files` exists but lacks the columns
 * (`type`, `status`, `metadata` JSONB, `bpm`, `key`) AudioAsset needs, so mapping
 * `assets` to it would silently drop data — this store refuses that mapping rather
 * than doing it lossily.
 *
 * Operations on `projects` and `tracks` are real and tested against a mocked Supabase
 * client (tests/supabase-store.test.js). Operations on the five unsupported tables
 * throw UnsupportedOperationError immediately — they do not silently no-op or lose
 * data. This means Supabase persistence mode is NOT a complete drop-in replacement
 * for local storage today: the primary /processing/jobs generate/stems workflow
 * (which needs the `processing_jobs` table) will fail loud in Supabase mode until a
 * new migration adds the missing tables. That is a deliberate, visible failure, not
 * a silently broken one.
 *
 * Not connected to a live Supabase project in this codebase — activation requires
 * the caller to supply a real `@supabase/supabase-js` client (see
 * persistence/index.js createStore({ type: 'supabase', client })).
 */

const TABLE_MAP = {
  projects: 'rezonate_projects',
  tracks: 'rezonate_tracks'
};

const UNSUPPORTED_TABLES = ['assets', 'processing_jobs', 'ownership_records', 'rights', 'audit_log'];

class SupabaseStore extends Store {
  /**
   * @param {object} opts
   * @param {object} opts.client  A `@supabase/supabase-js` client (createClient(url, key)).
   *   Required — this store does not construct its own client or read env vars itself,
   *   so it can never accidentally connect to a live project just by being instantiated.
   * @param {object} [opts.logger]
   */
  constructor({ client, logger = { warn: () => {}, error: () => {} } } = {}) {
    super();
    if (!client) throw new Error('SupabaseStore requires a client (see persistence/index.js)');
    this.client = client;
    this.logger = logger;
  }

  async init() {
    // No local file/dir to prepare. A lightweight reachability check is deliberately
    // NOT performed here — init() must not throw just because the network is briefly
    // unavailable; individual operations surface their own errors.
    return true;
  }

  _tableFor(table) {
    if (UNSUPPORTED_TABLES.includes(table)) {
      throw new UnsupportedOperationError(
        `SupabaseStore: '${table}' has no matching table in the live schema yet ` +
        `(supabase/migrations/20260522000001_rezonate_schema.sql). See ` +
        `docs/REZONATE_SUPABASE_SCHEMA_GAP.md. Use local/memory persistence for this ` +
        `table until a migration adds it, or catch this error and degrade gracefully.`
      );
    }
    const real = TABLE_MAP[table];
    if (!real) throw new UnsupportedOperationError(`SupabaseStore: unknown table '${table}'`);
    return real;
  }

  async create(table, record) {
    const real = this._tableFor(table);
    const { error } = await this.client.from(real).insert(record);
    if (error) throw new Error(`SupabaseStore.create(${table}): ${error.message}`);
    return record;
  }

  async getById(table, id) {
    const real = this._tableFor(table);
    const { data, error } = await this.client.from(real).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseStore.getById(${table}): ${error.message}`);
    return data || null;
  }

  async getAll(table) {
    const real = this._tableFor(table);
    const { data, error } = await this.client.from(real).select('*');
    if (error) throw new Error(`SupabaseStore.getAll(${table}): ${error.message}`);
    return data || [];
  }

  async update(table, id, record) {
    const real = this._tableFor(table);
    const { error } = await this.client.from(real).update(record).eq('id', id);
    if (error) throw new Error(`SupabaseStore.update(${table}): ${error.message}`);
    return record;
  }

  async delete(table, id) {
    const real = this._tableFor(table);
    const { error } = await this.client.from(real).delete().eq('id', id);
    if (error) throw new Error(`SupabaseStore.delete(${table}): ${error.message}`);
  }

  /** Best-effort snapshot across the tables that exist. Used by diagnostics.js.
   *  Unsupported tables report as empty arrays here rather than throwing, since
   *  diagnostics is a read-only health view, not a write path — hiding a table that
   *  doesn't exist yet from a health check is reasonable; silently dropping a write
   *  to it is not, which is why create/update/delete still throw. */
  async load() {
    const snapshot = { schemaVersion: SCHEMA_VERSION };
    for (const table of Object.keys(TABLE_MAP)) {
      try {
        snapshot[table] = await this.getAll(table);
      } catch (err) {
        this.logger.warn('persistence', 'load.warn', err.message);
        snapshot[table] = [];
      }
    }
    for (const table of UNSUPPORTED_TABLES) snapshot[table] = [];
    return snapshot;
  }
}

function createStore(options = {}) {
  return new SupabaseStore(options);
}

module.exports = { SupabaseStore, createStore, TABLE_MAP, UNSUPPORTED_TABLES };
