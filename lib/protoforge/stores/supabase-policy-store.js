'use strict';

const { createClient } = require('@supabase/supabase-js');

class SupabasePolicyStore {
  constructor(supabaseUrl, supabaseKey) {
    this._client = createClient(supabaseUrl, supabaseKey);
    this._reloadCallbacks = [];
  }

  onReload(cb) {
    this._reloadCallbacks.push(cb);
  }

  async loadPolicy(stream) {
    let policy = null;

    if (stream) {
      const { data } = await this._client
        .from('policies')
        .select('id, version, name, description, rules, stream')
        .eq('stream', stream)
        .eq('is_active', true)
        .maybeSingle();
      policy = data;
    }

    if (!policy) {
      const { data } = await this._client
        .from('policies')
        .select('id, version, name, description, rules, stream')
        .is('stream', null)
        .eq('is_active', true)
        .maybeSingle();
      policy = data;
    }

    return policy;
  }

  async recordDecision(row) {
    const { data, error } = await this._client
      .from('decisions')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      console.error('[PROTOFORGE] Failed to record decision:', error.message);
      return null;
    }

    return data?.id || row.id || null;
  }

  async recordOutcome(decisionId, outcome, detail = {}) {
    const { error } = await this._client
      .from('decisions')
      .update({ outcome, outcome_at: new Date().toISOString(), outcome_detail: detail })
      .eq('id', decisionId);

    if (error) {
      console.error('[PROTOFORGE] Failed to record outcome:', error.message);
    }
  }

  _notifyReload(policy) {
    for (const cb of this._reloadCallbacks) {
      try {
        cb(policy);
      } catch (err) {
        console.warn('[PROTOFORGE] Reload callback failed:', err.message);
      }
    }
  }

  subscribeToPolicyChanges(stream) {
    const channel = this._client
      .channel('protoforge-policy-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'policies' },
        async (payload) => {
          const row = payload.new || payload.old;
          const affectsUs = row && (row.stream === stream || row.stream === null);
          if (!affectsUs) return;

          console.log('[PROTOFORGE] Policy change detected — reloading...');
          const policy = await this.loadPolicy(stream);
          this._notifyReload(policy);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[PROTOFORGE] Realtime hot-reload active');
        } else if (status === 'CHANNEL_ERROR') {
          console.warn('[PROTOFORGE] Realtime subscription error — hot-reload degraded');
        }
      });

    return channel;
  }

  async destroy(channel) {
    if (channel) {
      await this._client.removeChannel(channel);
    }
  }
}

module.exports = SupabasePolicyStore;
