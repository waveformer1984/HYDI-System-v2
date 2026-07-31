'use strict';

/**
 * BusinessEventRegistry is the single source of truth for every business event
 * type that flows through the HYDI sensing layer.
 *
 * Every sensor registers the event types it can emit.
 * Every interpreter declares the event types it can translate into BusinessSignals.
 * Coverage, startup validation, and runtime monitoring all read from here.
 */
class BusinessEventRegistry {
  constructor() {
    this.events = new Map();
    this.interpreters = new Map();
    this.handlerMetadata = new Map();
    this.ignored = new Map();
    this.emitted = new Map();
    this.interpreted = new Map();
    this.unknownEmissions = new Map();
  }

  register(type, source, metadata = {}) {
    if (!type || typeof type !== 'string') {
      throw new Error('BusinessEventRegistry.register requires a non-empty string type');
    }
    const entry = this.events.get(type) || { sources: new Set(), metadata: {}, lastRegisteredAt: 0 };
    entry.sources.add(source || 'unknown');
    if (metadata && Object.keys(metadata).length > 0) {
      entry.metadata = { ...entry.metadata, ...metadata };
    }
    entry.lastRegisteredAt = Date.now();
    this.events.set(type, entry);
    return this;
  }

  declareHandled(type, interpreterName, metadata = {}) {
    if (!type || typeof type !== 'string') {
      throw new Error('BusinessEventRegistry.declareHandled requires a non-empty string type');
    }
    const handlers = this.interpreters.get(type) || new Set();
    const name = interpreterName || 'anonymous';
    handlers.add(name);
    this.interpreters.set(type, handlers);
    if (metadata && Object.keys(metadata).length > 0) {
      this.handlerMetadata.set(`${type}:${name}`, { ...metadata, declaredAt: Date.now() });
    }
    return this;
  }

  declareIgnored(type, reason) {
    if (!type || typeof type !== 'string') {
      throw new Error('BusinessEventRegistry.declareIgnored requires a non-empty string type');
    }
    this.ignored.set(type, reason || 'no reason given');
    return this;
  }

  isRegistered(type) { return this.events.has(type); }
  isHandled(type) { return this.interpreters.has(type); }
  isIgnored(type) { return this.ignored.has(type); }

  getHandlers(type) {
    const set = this.interpreters.get(type);
    return set ? [...set] : [];
  }

  recordEmission(type, _source) {
    if (!this.isRegistered(type)) {
      this.unknownEmissions.set(type, (this.unknownEmissions.get(type) || 0) + 1);
      return;
    }
    this.emitted.set(type, (this.emitted.get(type) || 0) + 1);
  }

  recordInterpretation(originatingType) {
    if (!originatingType) return;
    this.interpreted.set(originatingType, (this.interpreted.get(originatingType) || 0) + 1);
  }

  validate() {
    const errors = [];
    const warnings = [];

    for (const [type] of this.events) {
      const handlers = this.getHandlers(type);
      const ignored = this.ignored.has(type);
      if (handlers.length === 0 && !ignored) {
        errors.push({ type, error: 'registered event has no interpreter and is not ignored', severity: 'critical' });
      }
      if (handlers.length > 1) {
        errors.push({ type, error: 'registered event has multiple interpreters', interpreters: handlers, severity: 'critical' });
      }
      if (handlers.length === 1 && ignored) {
        warnings.push({ type, error: 'registered event is both handled and ignored', severity: 'warning' });
      }
    }

    for (const [type] of this.interpreters) {
      if (!this.events.has(type)) {
        warnings.push({ type, error: 'interpreter handles an unregistered event', severity: 'warning' });
      }
    }

    for (const [type] of this.ignored) {
      if (!this.events.has(type)) {
        warnings.push({ type, error: 'ignored event is not registered', severity: 'warning' });
      }
    }

    if (this.unknownEmissions.size > 0) {
      for (const [type, count] of this.unknownEmissions) {
        errors.push({ type, count, error: 'unknown event emitted at runtime', severity: 'critical' });
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  }

  getDropped() {
    const dropped = [];
    for (const [type] of this.events) {
      if (this.ignored.has(type)) continue;
      const emitted = this.emitted.get(type) || 0;
      const interpreted = this.interpreted.get(type) || 0;
      if (emitted > interpreted) {
        dropped.push({ type, emitted, interpreted, dropped: emitted - interpreted });
      }
    }
    return dropped;
  }

  getRuntimeStats() {
    const handlersByType = new Map();
    for (const [type, set] of this.interpreters) {
      handlersByType.set(type, [...set]);
    }

    const duplicates = [];
    for (const [type, handlers] of handlersByType) {
      if (handlers.length > 1) duplicates.push({ type, handlers });
    }

    const orphan = [];
    for (const [type] of this.interpreters) {
      if (!this.events.has(type)) orphan.push(type);
    }

    return {
      emitted: [...this.emitted.entries()].map(([type, count]) => ({ type, count })),
      interpreted: [...this.interpreted.entries()].map(([type, count]) => ({ type, count })),
      dropped: this.getDropped(),
      duplicates,
      orphan,
      ignored: [...this.ignored.entries()].map(([type, reason]) => ({ type, reason })),
      unknown: [...this.unknownEmissions.entries()].map(([type, count]) => ({ type, count })),
    };
  }

  healthCheck() {
    const validation = this.validate();
    const runtime = this.getRuntimeStats();
    const ok = validation.ok
      && runtime.dropped.length === 0
      && runtime.unknown.length === 0
      && runtime.duplicates.length === 0;
    return { ok, validation, runtime };
  }

  listEventTypes() {
    return [...this.events.keys()].sort();
  }

  listHandledEventTypes() {
    return [...this.interpreters.keys()].sort();
  }

  listIgnoredEventTypes() {
    return [...this.ignored.keys()].sort();
  }

  getMetadata(type) {
    return this.events.get(type)?.metadata || null;
  }

  getSchema(type) {
    return this.events.get(type)?.metadata?.schema || null;
  }

  getEventSources(type) {
    const entry = this.events.get(type);
    return entry ? [...entry.sources] : [];
  }

  getMeasurementCapability(type) {
    return this.events.get(type)?.metadata?.measurement || null;
  }

  getStrategicObjective(type) {
    return this.events.get(type)?.metadata?.strategicObjective || null;
  }

  getHandlerMetadata(type, interpreterName) {
    return this.handlerMetadata.get(`${type}:${interpreterName}`) || null;
  }

  getContract(type) {
    const entry = this.events.get(type);
    if (!entry) return null;
    return {
      type,
      sources: [...entry.sources],
      metadata: { ...entry.metadata },
      handlers: this.getHandlers(type),
      ignored: this.ignored.has(type),
      lastRegisteredAt: entry.lastRegisteredAt,
    };
  }

  getStale(thresholdMs = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - thresholdMs;
    const stale = [];
    for (const [type, entry] of this.events) {
      if (entry.lastRegisteredAt < cutoff) stale.push(type);
    }
    return stale;
  }
}

module.exports = BusinessEventRegistry;
