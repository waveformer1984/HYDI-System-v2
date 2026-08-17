const { computeFingerprint, computeHash } = require('./adapters/ledger-adapter');

const REQUIRED_FIELDS = ['eventId', 'eventType', 'source', 'payload', 'version', 'timestamp'];

function validate(event) {
  if (!event || typeof event !== 'object') return { ok: false, error: 'event must be an object' };
  for (const f of REQUIRED_FIELDS) {
    if (event[f] === undefined || event[f] === null) return { ok: false, error: `${f} is required` };
  }
  if (typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    return { ok: false, error: 'payload must be an object' };
  }
  if (Number.isNaN(Date.parse(event.timestamp))) {
    return { ok: false, error: 'timestamp must be a valid ISO 8601 string' };
  }
  return { ok: true };
}

function verifyIntegrity(event) {
  if (!event.fingerprint || !event.hash) {
    return { ok: false, error: 'fingerprint and hash are required for integrity verification' };
  }
  const expectedFingerprint = computeFingerprint(event.source, event.eventId, event.eventType);
  if (expectedFingerprint !== event.fingerprint) {
    return { ok: false, error: 'fingerprint mismatch' };
  }
  const expectedHash = computeHash(event.fingerprint, event.eventType, event.payload);
  if (expectedHash !== event.hash) {
    return { ok: false, error: 'hash mismatch' };
  }
  return { ok: true };
}

class EventProcessor {
  constructor(options = {}) {
    this.versionAdapters = options.versionAdapters || new Map([['1', v1 => v1]]);
    this.processorVersion = options.processorVersion || '1.0';
  }

  registerAdapter(version, adapter) {
    this.versionAdapters.set(String(version), adapter);
  }

  normalize(version, payload) {
    const adapter = this.versionAdapters.get(String(version));
    if (!adapter) return { ok: false, error: `unknown schema version: ${version}` };
    return { ok: true, normalized: adapter(payload) };
  }

  process(event) {
    const validation = validate(event);
    if (!validation.ok) return { ok: false, error: validation.error };

    const integrity = verifyIntegrity(event);
    if (!integrity.ok) return { ok: false, error: integrity.error };

    const norm = this.normalize(event.version, event.payload);
    if (!norm.ok) return { ok: false, error: norm.error };

    const normalizedPayload = norm.normalized;
    const parentFingerprint = normalizedPayload.parentFingerprint || null;

    const derived = {
      id: `cascade:${event.fingerprint}`,
      fingerprint: event.fingerprint,
      eventId: event.eventId,
      eventType: event.eventType,
      source: event.source,
      version: event.version,
      timestamp: event.timestamp,
      originalPayload: event.payload,
      normalizedPayload,
      processingTimestamp: new Date().toISOString(),
      processorVersion: this.processorVersion,
      parentFingerprint,
      children: [],
      created_at: event.created_at
    };

    return { ok: true, event: derived };
  }
}

module.exports = { EventProcessor, validate, verifyIntegrity };
