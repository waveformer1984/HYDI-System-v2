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

function normalizePayload(envelope) {
  return {
    ...envelope.payload,
    _meta: {
      eventId: envelope.eventId,
      source: envelope.source,
      version: envelope.version,
      timestamp: envelope.timestamp
    }
  };
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
    created_at: row.created_at,
    receivedAt: row.created_at
  };
}

function toRawEvent(envelope) {
  const fingerprint = computeFingerprint(envelope.source, envelope.eventId, envelope.eventType);
  const payload = normalizePayload(envelope);
  const hash = computeHash(fingerprint, envelope.eventType, payload);
  return { fingerprint, event_type: envelope.eventType, payload, hash };
}

class RawLedgerAdapter {
  constructor(options = {}) {
    this.client = options.client || this._createClient(options);
    this.table = options.table || 'raw_event_ledger';
    this.outbox = options.outbox || null;
    this._computeFingerprint = options.computeFingerprint || computeFingerprint;
    this._computeHash = options.computeHash || computeHash;
    this._lastSuccessfulAppend = null;
    this._lastRetryAttempt = null;
    this._lastError = null;
    this._appendLatencyMs = null;
    this.worker = null;
  }

  setRetryWorker(worker) {
    this.worker = worker;
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

  _fingerprint(envelope) {
    return this._computeFingerprint(envelope.source, envelope.eventId, envelope.eventType);
  }

  _hash(envelope, fingerprint) {
    const payload = normalizePayload(envelope);
    return this._computeHash(fingerprint, envelope.eventType, payload);
  }

  async _getByFingerprint(fingerprint) {
    const { data } = await this.client
      .from(this.table)
      .select('*')
      .eq('fingerprint', fingerprint)
      .maybeSingle();
    return data || null;
  }

  async commit(rawEvent) {
    const existing = await this._getByFingerprint(rawEvent.fingerprint);
    if (existing) {
      return { ok: true, record: toGatewayRecord(existing), alreadyExists: true };
    }

    const { data, error } = await this.client
      .from(this.table)
      .insert(rawEvent)
      .select()
      .single();

    if (error) {
      this._lastError = error.message;
      if (error.code === '23505') {
        return { ok: true, alreadyExists: true };
      }
      return { ok: false, error: error.message, code: error.code || 'UNKNOWN' };
    }

    this._lastError = null;
    return { ok: true, record: toGatewayRecord(data) };
  }

  async append(envelope) {
    const rawEvent = toRawEvent(envelope);
    const start = Date.now();
    const result = await this.commit(rawEvent);
    this._appendLatencyMs = Date.now() - start;

    if (result.ok) {
      if (this.outbox) {
        this.outbox.remove(rawEvent.fingerprint);
      }
      if (result.alreadyExists) {
        return { ok: false, error: 'Duplicate fingerprint', code: '409', record: result.record };
      }
      this._lastSuccessfulAppend = new Date().toISOString();
      this._lastError = null;
      return { ok: true, record: result.record };
    }

    if (this.outbox) {
      const queued = this.outbox.enqueue(rawEvent);
      if (queued.ok) {
        return { ok: true, queued: true, error: result.error, fingerprint: rawEvent.fingerprint };
      }
      return { ok: false, error: result.error, code: result.code };
    }

    return { ok: false, error: result.error, code: result.code };
  }

  async get(fingerprint) {
    const row = await this._getByFingerprint(fingerprint);
    if (!row) return { ok: false, error: 'Event not found', code: '404' };
    return { ok: true, event: toGatewayRecord(row) };
  }

  async list(options = {}) {
    const offset = Math.max(0, parseInt(options.offset, 10) || 0);
    const limit = Math.min(1000, Math.max(1, parseInt(options.limit, 10) || 100));

    let query = this.client
      .from(this.table)
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true });

    if (options.eventType) {
      query = query.eq('event_type', options.eventType);
    }
    if (options.since) {
      query = query.gte('created_at', options.since);
    }
    if (options.until) {
      query = query.lte('created_at', options.until);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) return { ok: false, error: error.message };

    let events = (data || []).map(toGatewayRecord);

    if (options.source) {
      events = events.filter(e => e.source === options.source);
    }

    const total = count || events.length;
    return {
      ok: true,
      events,
      total,
      offset,
      limit,
      hasMore: offset + events.length < total
    };
  }

  async health() {
    try {
      const start = Date.now();
      const { count, error } = await this.client
        .from(this.table)
        .select('*', { count: 'exact', head: true });
      const latencyMs = Date.now() - start;
      if (error) return { ok: false, connected: false, error: error.message };
      return { ok: true, connected: true, events: count || 0, latencyMs };
    } catch (err) {
      return { ok: false, connected: false, error: err.message };
    }
  }

  diagnostics() {
    const outboxStats = this.outbox ? this.outbox.stats() : null;
    return {
      ledgerReachable: this._lastSuccessfulAppend !== null,
      outboxPending: outboxStats ? outboxStats.total : 0,
      lastSuccessfulAppend: this._lastSuccessfulAppend,
      lastRetryAttempt: this.worker?.stats?.lastRun || null,
      bridgeHealthy: this._lastError === null,
      appendLatencyMs: this._appendLatencyMs,
      lastError: this._lastError,
      outbox: outboxStats
    };
  }
}

module.exports = { RawLedgerAdapter, toRawEvent, toGatewayRecord, computeFingerprint, computeHash };
