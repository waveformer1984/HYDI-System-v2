// Compatibility wrapper: legacy CASCADE intake -> protoforge/cascade
// @deprecated Use protoforge/cascade/src/processor directly. Removal target: Phase 5.

const { EventEmitter } = require('events');
const { EventProcessor } = require('../protoforge/cascade/src/processor');
const { computeFingerprint, computeHash } = require('../protoforge/cascade/src/adapters/ledger-adapter');

function toCanonical(raw, source = 'legacy') {
  const payload = raw.payload || raw.data || {};
  const eventId = raw.id || raw.eventId || `legacy-${Date.now()}`;
  const eventType = raw.type || raw.eventType || 'legacy.event';
  const timestamp = raw.createdAt || raw.timestamp || new Date().toISOString();
  const version = raw.version || '1';
  const fingerprint = computeFingerprint(source, eventId, eventType);
  const hash = computeHash(fingerprint, eventType, payload);

  return {
    id: raw.id,
    eventId,
    eventType,
    source,
    version,
    timestamp,
    payload,
    fingerprint,
    hash,
    created_at: timestamp
  };
}

class LegacyCascade extends EventEmitter {
  constructor() {
    super();
    this.processor = new EventProcessor({
      versionAdapters: new Map([['1', v1 => v1]]),
      processorVersion: '1.0-compat'
    });
  }

  process(raw, source) {
    const canonical = toCanonical(raw, source);
    const result = this.processor.process(canonical);

    if (!result.ok) {
      this.emit('cascade_error', { error: result.error, raw });
      return { ok: false, error: result.error };
    }

    const output = {
      ok: true,
      classification: result.event.eventType,
      confidence: '1.00',
      derivedId: result.event.id,
      fingerprint: result.event.fingerprint,
      event: result.event
    };

    this.emit('cascade_output', output);
    return output;
  }
}

module.exports = { LegacyCascade, toCanonical };
