const crypto = require('crypto');

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,})?(Z|[+-]\d{2}:\d{2})$/;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

function createTimestamp() {
  return new Date().toISOString();
}

function createCorrelationId(eventId) {
  const base = eventId || crypto.randomUUID();
  const suffix = crypto.randomBytes(4).toString('hex');
  return `corr-${base}-${Date.now()}-${suffix}`;
}

function computeFingerprint(source, eventId, eventType) {
  const canonical = JSON.stringify({ source, eventId, eventType });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function computeHash(fingerprint, eventType, payload) {
  const canonical = JSON.stringify({ fingerprint, event_type: eventType, payload });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function createProducerMetadata({ name, version, capabilities = [] }) {
  if (!isNonEmptyString(name)) throw new Error('producer name is required');
  return {
    name,
    version: version || '0.0.0',
    capabilities: Array.isArray(capabilities) ? capabilities : [],
    emitted_at: createTimestamp()
  };
}

function createCapabilityDeclaration({ produces = [], consumes = [], requires = [] }) {
  const asArray = v => (Array.isArray(v) ? v : [v]).filter(Boolean);
  return {
    produces: asArray(produces),
    consumes: asArray(consumes),
    requires: asArray(requires)
  };
}

function createEventEnvelope({
  eventId,
  eventType,
  source,
  version = '1',
  timestamp = createTimestamp(),
  payload = {},
  correlationId,
  producer
}) {
  if (!isNonEmptyString(eventId)) throw new Error('eventId is required');
  if (!isNonEmptyString(eventType)) throw new Error('eventType is required');
  if (!isNonEmptyString(source)) throw new Error('source is required');
  if (!isPlainObject(payload)) throw new Error('payload must be a plain object');
  if (!ISO_8601.test(timestamp)) throw new Error('timestamp must be ISO 8601');

  const fingerprint = computeFingerprint(source, eventId, eventType);
  const hash = computeHash(fingerprint, eventType, payload);

  return {
    eventId,
    eventType,
    source,
    version: String(version),
    timestamp,
    payload,
    fingerprint,
    hash,
    correlationId: correlationId || createCorrelationId(eventId),
    producer: producer || null
  };
}

function validateEventEnvelope(envelope) {
  const errors = [];
  const { eventId, eventType, source, version, timestamp, payload, fingerprint, hash } = envelope || {};

  if (!isNonEmptyString(eventId)) errors.push('eventId is required');
  if (!isNonEmptyString(eventType)) errors.push('eventType is required');
  if (!isNonEmptyString(source)) errors.push('source is required');
  if (!isNonEmptyString(version)) errors.push('version is required');
  if (!isPlainObject(payload)) errors.push('payload must be a plain object');
  if (!ISO_8601.test(timestamp || '')) errors.push('timestamp must be ISO 8601');

  if (eventId && eventType && source) {
    const expectedFingerprint = computeFingerprint(source, eventId, eventType);
    if (fingerprint !== expectedFingerprint) errors.push('fingerprint mismatch');
  }

  if (fingerprint && eventType && payload) {
    const expectedHash = computeHash(fingerprint, eventType, payload);
    if (hash !== expectedHash) errors.push('hash mismatch');
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  createTimestamp,
  createCorrelationId,
  createProducerMetadata,
  createCapabilityDeclaration,
  createEventEnvelope,
  computeFingerprint,
  computeHash,
  validateEventEnvelope
};
