/**
 * Storage provider interface (P1 #3, docs/REZONATE_CONSOLIDATION_PLAN.md — "Storage
 * for audio/stems/assets").
 *
 * Scope note: this is an additive adapter layer, not a cutover. Today, every asset's
 * `file_path` is a raw filesystem path written by LocalModelRuntime / manual asset
 * registration and served directly via fs.existsSync + res.sendFile in
 * src/api/router.js (GET /assets/:id/file). That flow is unchanged by this file.
 *
 * What this file adds: a StorageProvider interface plus a local implementation that
 * names the existing behavior explicitly, and a factory (create()) that mirrors
 * src/persistence/index.js's local-first-by-default pattern — 'local' unless a caller
 * explicitly opts into 'supabase'. Wiring router.js's asset endpoints to go through a
 * provider instead of raw fs calls is deliberately NOT done here: that would be a live
 * behavior cutover on an already-working path, which is out of scope for the same
 * reason P1 #9/#10 (migrating remaining CRUD off legacy paths, removing conflicting
 * persistence paths) were deferred — see docs/REZONATE_CONSOLIDATION_PLAN.md P1 notes.
 */
class StorageProvider {
  /** @returns {Promise<{ok: boolean, key?: string, error?: string}>} */
  async save(_key, _buffer) { throw new Error('save() not implemented'); }
  /** @returns {Promise<Buffer|null>} */
  async read(_key) { throw new Error('read() not implemented'); }
  /** @returns {Promise<boolean>} */
  async exists(_key) { throw new Error('exists() not implemented'); }
  /** @returns {Promise<{ok: boolean, error?: string}>} */
  async delete(_key) { throw new Error('delete() not implemented'); }
  /** @returns {string} human-readable provider name, e.g. 'local' | 'supabase' */
  name() { throw new Error('name() not implemented'); }
}

/**
 * options.type: 'local' (default) | 'supabase'
 * options.baseDir: for 'local', root directory keys are resolved against (optional —
 *   local storage also accepts absolute paths as keys, matching today's file_path
 *   convention, so existing callers are not forced to change).
 * options.client: for 'supabase', an injected @supabase/supabase-js client (never
 *   imported directly here — same constructor-injection pattern as SupabaseStore).
 * options.bucket: for 'supabase', the Storage bucket name (default 'rezonate-assets').
 */
function createStorageProvider(options = {}) {
  if (options.type === 'supabase') {
    const { SupabaseStorageProvider } = require('./supabase-storage-provider');
    return new SupabaseStorageProvider(options);
  }
  const { LocalStorageProvider } = require('./local-storage-provider');
  return new LocalStorageProvider(options);
}

module.exports = { StorageProvider, createStorageProvider };
