const { createEventEnvelope } = require('../../event-contracts/src/index');

const LIFECYCLE_TYPES = {
  created: 'application.created',
  registered: 'application.registered',
  started: 'application.started',
  health: 'application.health.changed',
  deprecated: 'application.deprecated'
};

function createApplicationEvent(type, manifest, payload = {}) {
  if (!Object.values(LIFECYCLE_TYPES).includes(type)) {
    throw new Error(`Unknown lifecycle event type: ${type}`);
  }

  const name = manifest.name || 'unknown';
  return createEventEnvelope({
    eventId: `app-${name}-${type}-${Date.now()}`,
    eventType: type,
    source: 'protoforge-factory',
    version: '1',
    payload: {
      name: manifest.name,
      version: manifest.version,
      capabilities: manifest.capabilities,
      eventsProduced: manifest.eventsProduced,
      eventsConsumed: manifest.eventsConsumed,
      providers: manifest.providers,
      ...payload
    }
  });
}

class LifecycleEmitter {
  constructor(adapter) {
    this.adapter = adapter || null;
  }

  setAdapter(adapter) {
    this.adapter = adapter;
  }

  async emit(type, manifest, payload) {
    const event = createApplicationEvent(type, manifest, payload);
    if (!this.adapter) {
      return { ok: false, queued: false, error: 'No adapter configured' };
    }
    const result = await this.adapter.append(event);
    if (result.ok) return { ok: true, queued: false, event };
    if (this.adapter.outbox) {
      this.adapter.outbox.enqueue(event);
      return { ok: true, queued: true, error: result.error, event };
    }
    return { ok: false, error: result.error };
  }

  async created(manifest, payload) {
    return this.emit(LIFECYCLE_TYPES.created, manifest, payload);
  }

  async registered(manifest, payload) {
    return this.emit(LIFECYCLE_TYPES.registered, manifest, payload);
  }

  async started(manifest, payload) {
    return this.emit(LIFECYCLE_TYPES.started, manifest, payload);
  }

  async healthChanged(manifest, payload) {
    return this.emit(LIFECYCLE_TYPES.health, manifest, payload);
  }

  async deprecated(manifest, payload) {
    return this.emit(LIFECYCLE_TYPES.deprecated, manifest, payload);
  }
}

module.exports = {
  LIFECYCLE_TYPES,
  createApplicationEvent,
  LifecycleEmitter
};
