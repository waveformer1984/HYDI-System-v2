'use strict';

/**
 * Supabase-backed store adapter. Wraps supabase-js so call sites never
 * import @supabase/supabase-js directly for Heidi-owned tables.
 */
const { createClient } = require('@supabase/supabase-js');

class SupabaseStore {
  constructor({ url, key }) {
    this.name = 'supabase';
    this.configured = Boolean(url && key);
    this.client = this.configured ? createClient(url, key) : null;
  }

  isAvailable() { return this.configured && Boolean(this.client); }

  /** Pass-through for table access during migration; prefer typed helpers. */
  from(table) {
    if (!this.client) throw new Error('[store:supabase] not configured');
    return this.client.from(table);
  }

  /** Insert an audit row into heidi_events. Never throws — audit must not break callers. */
  async insertEvent(row) {
    if (!this.client) return { ok: false, reason: 'not-configured' };
    try {
      const { error } = await this.client.from('heidi_events').insert({
        event_type: 'event',
        ...row,
      });
      return error ? { ok: false, reason: error.message } : { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  async health() {
    if (!this.client) return { store: this.name, configured: false, status: 'unavailable' };
    try {
      const { error } = await this.client.from('heidi_events').select('id').limit(1);
      return {
        store: this.name,
        configured: true,
        status: error ? 'degraded' : 'ok',
        detail: error ? error.message : undefined,
      };
    } catch (e) {
      return { store: this.name, configured: true, status: 'unavailable', detail: e.message };
    }
  }
}

module.exports = { SupabaseStore };
