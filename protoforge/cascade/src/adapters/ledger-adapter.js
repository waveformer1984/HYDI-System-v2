const crypto = require('crypto');

function computeFingerprint(source, eventId, eventType) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ source, eventId, eventType }))
    .digest('hex');
}

function computeHash(fingerprint, eventType, payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ fingerprint, event_type: eventType, payload }))
    .digest('hex');
}

function toGatewayRecord(row) {
  const payload = row.payload || {};
  const meta = payload._meta || {};
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    eventId: meta.eventId,
    eventType: row.event_type,
    source: meta.source,
    version: meta.version,
    timestamp: meta.timestamp,
    payload: Object.fromEntries(Object.entries(payload).filter(([k]) => k !== '_meta')),
    hash: row.hash,
    created_at: row.created_at
  };
}

class LedgerAdapter {
  constructor(options = {}) {
    this.client = options.client || this._createClient(options);
    this.table = options.table || 'raw_event_ledger';
  }

  _createClient(options) {
    const url = options.supabaseUrl || process.env.SUPABASE_URL;
    const key = options.supabaseKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    }
    const { createClient } = require('@supabase/supabase-js');
    return createClient(url, key, { auth: { persistSession: false } });
  }

  async get(fingerprint) {
    const { data, error } = await this.client
      .from(this.table)
      .select('*')
      .eq('fingerprint', fingerprint)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'Event not found', code: '404' };
    return { ok: true, event: toGatewayRecord(data) };
  }

  async list(options = {}) {
    const offset = Math.max(0, parseInt(options.offset, 10) || 0);
    const limit = Math.min(1000, Math.max(1, parseInt(options.limit, 10) || 100));

    let query = this.client
      .from(this.table)
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (options.since) {
      query = query.gte('created_at', options.since);
    }
    if (options.fromTimestamp) {
      query = query.gte('created_at', options.fromTimestamp);
    }
    if (options.eventType) {
      query = query.eq('event_type', options.eventType);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) return { ok: false, error: error.message };

    return {
      ok: true,
      events: (data || []).map(toGatewayRecord),
      total: count || 0,
      offset,
      limit,
      hasMore: offset + (data || []).length < (count || 0)
    };
  }
}

module.exports = { LedgerAdapter, computeFingerprint, computeHash, toGatewayRecord };
