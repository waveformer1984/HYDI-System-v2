'use strict';

/**
 * Local Postgres store adapter — STUB for the Phase 6 local-first move.
 *
 * Intended backing store once Heidi runs fully local on Frank. Until then
 * every operation fails loudly with a clear message so a misconfigured
 * HYDI_STORE=postgres can never silently drop audit rows.
 *
 * When implemented it must provide the same surface as SupabaseStore:
 * from(table), insertEvent(row), health(), isAvailable(). `pg` is already
 * a dependency (package.json); wire it here with a connection pool keyed
 * off HYDI_PG_URL.
 */
class PostgresStore {
  constructor({ connectionString } = {}) {
    this.name = 'postgres';
    this.configured = Boolean(connectionString);
    this.connectionString = connectionString || null;
  }

  isAvailable() { return false; }

  async health() {
    return {
      store: this.name,
      configured: this.configured,
      status: 'unimplemented',
      detail: 'local Postgres adapter is a Phase 6 stub — use HYDI_STORE=supabase',
    };
  }

  from() {
    throw new Error('[store:postgres] adapter not implemented yet (Phase 6)');
  }

  async insertEvent() {
    return { ok: false, reason: 'postgres-adapter-unimplemented' };
  }
}

module.exports = { PostgresStore };
