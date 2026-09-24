'use strict';

/**
 * In-memory RAW EVENT LEDGER with the same append() contract as
 * protoforge/hydi-gateway's RawLedgerAdapter: append-only, keyed by
 * fingerprint, and a duplicate returns { ok: false, code: '409' }.
 *
 * Fingerprint and hash come from the gateway's own toRawEvent(), so a
 * record here is byte-for-byte what the Supabase-backed adapter would
 * store. Used by the replay/determinism tests and for local dry runs; it
 * is never the production ledger.
 */

const { toRawEvent } = require('../../protoforge/hydi-gateway/src/adapters/raw-ledger');

class MemoryLedger {
  constructor() {
    this._rows = new Map();
  }

  async append(envelope) {
    const raw = toRawEvent(envelope);
    const existing = this._rows.get(raw.fingerprint);
    if (existing) {
      return { ok: false, error: 'Duplicate fingerprint', code: '409', record: existing };
    }
    const record = { ...raw, id: `mem-${this._rows.size + 1}` };
    this._rows.set(raw.fingerprint, record);
    return { ok: true, record };
  }

  size() {
    return this._rows.size;
  }

  list() {
    return [...this._rows.values()];
  }
}

module.exports = { MemoryLedger };
