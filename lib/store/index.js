/**
 * Data-layer adapter for Heidi-owned persistence (heidi_events,
 * heidi_state_snapshots, heidi_reflections, hydi_facts, ...).
 *
 * Goal (Phase 3): Heidi code should talk to this interface instead of
 * calling Supabase directly, so the backing store can move from hosted
 * Supabase to local Postgres later without touching call sites.
 *
 * Selection (env HYDI_STORE, default auto):
 *   - HYDI_STORE=supabase | unset + SUPABASE_URL+key present -> SupabaseStore
 *   - HYDI_STORE=postgres | HYDI_PG_URL set                 -> PostgresStore (stub)
 *   - neither                                               -> NullStore (local-only)
 */
const { SupabaseStore } = require('./supabase-store');
const { PostgresStore } = require('./postgres-store');

class NullStore {
  constructor() {
    this.name = 'null';
    this.configured = false;
  }
  isAvailable() { return false; }
  async health() {
    return { store: this.name, configured: false, status: 'unavailable' };
  }
  from() { throw new Error('[store] no data store configured (local-only mode)'); }
  async insertEvent() { return { ok: false, reason: 'no-store' }; }
}

function createStore(env = process.env) {
  const kind = (env.HYDI_STORE || '').toLowerCase();
  if (kind === 'postgres' || (!kind && env.HYDI_PG_URL)) {
    return new PostgresStore({ connectionString: env.HYDI_PG_URL });
  }
  if (kind === 'supabase' || (!kind && env.SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY))) {
    return new SupabaseStore({
      url: env.SUPABASE_URL,
      key: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY,
    });
  }
  return new NullStore();
}

let singleton = null;
function getStore() {
  if (!singleton) singleton = createStore();
  return singleton;
}

module.exports = { createStore, getStore, NullStore };
