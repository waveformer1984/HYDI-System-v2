// Compatibility wrapper: legacy modules/raw-event-ledger.js -> protoforge/hydi-gateway raw ledger
// @deprecated Use lib/protoforge/raw-ledger.ts or protoforge/hydi-gateway/src/adapters/raw-ledger.js. Removal target: Phase 5.

const { RawLedgerAdapter } = require('../protoforge/hydi-gateway/src/adapters/raw-ledger');

class LegacyRawLedger {
  constructor(options = {}) {
    this.adapter = new RawLedgerAdapter(options);
  }

  async appendRawEvent(rawEvent, sourceMetadata = {}) {
    const envelope = {
      eventId: rawEvent.id || `legacy-${Date.now()}`,
      eventType: rawEvent.type || 'legacy.event',
      source: sourceMetadata.source || rawEvent.source || 'legacy',
      version: rawEvent.version || '1',
      timestamp: rawEvent.timestamp || new Date().toISOString(),
      payload: rawEvent.data || rawEvent.payload || {}
    };
    return this.adapter.append(envelope);
  }

  async getByFingerprint(fingerprint) {
    return this.adapter.get(fingerprint);
  }

  async listEvents(options = {}) {
    return this.adapter.list(options);
  }

  async health() {
    return this.adapter.health();
  }
}

module.exports = { LegacyRawLedger };
