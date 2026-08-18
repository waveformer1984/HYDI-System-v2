function validateEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'payload must be an object' };
  }
  if (!input.eventId || typeof input.eventId !== 'string') {
    return { ok: false, error: 'eventId is required and must be a string' };
  }
  if (!input.eventType || typeof input.eventType !== 'string') {
    return { ok: false, error: 'eventType is required and must be a string' };
  }
  if (!input.source || typeof input.source !== 'string') {
    return { ok: false, error: 'source is required and must be a string' };
  }
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    return { ok: false, error: 'payload is required and must be an object' };
  }
  if (input.version && typeof input.version !== 'string') {
    return { ok: false, error: 'version must be a string' };
  }
  if (input.timestamp && Number.isNaN(Date.parse(input.timestamp))) {
    return { ok: false, error: 'timestamp must be a valid ISO 8601 string' };
  }
  return { ok: true };
}

module.exports = { validateEvent };
