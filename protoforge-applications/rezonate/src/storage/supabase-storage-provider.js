const { StorageProvider } = require('./storage-provider');

/**
 * Supabase Storage adapter (P1 #3, opt-in only). Requires an injected
 * @supabase/supabase-js client (never imported directly here — this file has no
 * network dependency, mirroring SupabaseStore's testability design in
 * src/persistence/supabase-store.js).
 *
 * Honesty note: this has been exercised only against a fake Storage client in
 * tests/storage-provider.test.js, never a live Supabase project (see
 * docs/REZONATE_SUPABASE_SCHEMA_GAP.md for the parallel caveat on SupabaseStore).
 * It is not wired into any default code path — capability-contract.json should not
 * mark storage capabilities above PARTIAL until it has been verified against a real
 * bucket.
 */
class SupabaseStorageProvider extends StorageProvider {
  constructor(options = {}) {
    super();
    if (!options.client) {
      throw new Error('SupabaseStorageProvider requires an injected Supabase client (options.client)');
    }
    this.client = options.client;
    this.bucket = options.bucket || 'rezonate-assets';
  }

  name() { return 'supabase'; }

  async save(key, buffer) {
    const { error } = await this.client.storage.from(this.bucket).upload(key, buffer, { upsert: true });
    if (error) return { ok: false, error: error.message };
    return { ok: true, key };
  }

  async read(key) {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) return null;
    // supabase-js returns a Blob in browser-like environments; Node callers of this
    // adapter are expected to pass a client whose download() resolves a Buffer or
    // something with arrayBuffer(). Normalize defensively.
    if (Buffer.isBuffer(data)) return data;
    if (typeof data.arrayBuffer === 'function') return Buffer.from(await data.arrayBuffer());
    return Buffer.from(data);
  }

  async exists(key) {
    const dir = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
    const name = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key;
    const { data, error } = await this.client.storage.from(this.bucket).list(dir);
    if (error || !data) return false;
    return data.some(f => f.name === name);
  }

  async delete(key) {
    const { error } = await this.client.storage.from(this.bucket).remove([key]);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }
}

module.exports = { SupabaseStorageProvider };
