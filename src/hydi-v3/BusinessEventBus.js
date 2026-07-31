'use strict';

const { EventEmitter } = require('events');

function generateId() {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * BusinessEventBus is the central nervous system for HYDI's real-world
 * integrations. Any subsystem — filesystem, git, telemetry, sales, inventory —
 * publishes typed events here. Consumers subscribe by event type and interpret
 * those events into business signals.
 *
 * The bus itself is intentionally dumb: it does not understand meaning, only
 * reliable, ordered, typed delivery. Every event carries:
 *   type      the event name (e.g., 'FileCreated')
 *   source    which provider emitted it
 *   at        timestamp
 *   payload   provider-specific data
 *   id        unique event id
 */
class BusinessEventBus extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      maxHistory: config.maxHistory ?? 10000,
      logger: config.logger || console,
      ...config,
    };
    this.registry = config.registry || null;
    this.auditLedger = config.auditLedger || null;
    this.history = [];
    this._handlerCount = 1;
  }

  setAuditLedger(auditLedger) {
    this.auditLedger = auditLedger || null;
  }

  /**
   * Publish an event. Returns the event object. Supports optional awaiting.
   */
  emit(type, payload = {}, source = 'unknown') {
    const event = {
      id: generateId(),
      at: Date.now(),
      type,
      source,
      payload,
    };
    this.history.push(event);
    if (this.history.length > this.config.maxHistory) {
      this.history = this.history.slice(-this.config.maxHistory);
    }
    if (this.registry) {
      this.registry.recordEmission(type, source);
      if (type === 'BusinessSignal' && payload && payload.originatingEvent) {
        this.registry.recordInterpretation(payload.originatingEvent);
      }
      if (!this.registry.isRegistered(type) && this.auditLedger) {
        this.auditLedger.record({
          category: 'unknown-event',
          actor: source || 'unknown',
          subjectId: type,
          payload: event,
        });
      }
    }
    super.emit(type, event);
    super.emit('*', event);
    return event;
  }

  /**
   * Subscribe to a specific event type.
   */
  subscribe(type, handler) {
    return this.on(type, handler);
  }

  /**
   * Subscribe to all events.
   */
  subscribeAll(handler) {
    return this.on('*', handler);
  }

  /**
   * Unsubscribe a handler. Expects the same function reference.
   */
  unsubscribe(type, handler) {
    this.off(type, handler);
    if (type === '*') this.off('*', handler);
  }

  /**
   * Query history by type, source, or time window.
   */
  getHistory(query = {}) {
    let out = [...this.history];
    if (query.type) out = out.filter((e) => e.type === query.type);
    if (query.source) out = out.filter((e) => e.source === query.source);
    if (query.since) out = out.filter((e) => e.at >= query.since);
    if (query.limit) out = out.slice(-query.limit);
    return out;
  }

  /**
   * Replay recent events into a handler for a given type or all types.
   */
  replay(type, handler, limit = 100) {
    let events = [...this.history];
    if (type !== '*') events = events.filter((e) => e.type === type);
    events.slice(-limit).forEach((e) => handler(e));
  }

  /**
   * Report event contract health. Requires a registry to be configured.
   */
  healthCheck() {
    if (!this.registry) return { ok: true, reason: 'no event registry configured' };
    return this.registry.healthCheck();
  }

  /**
   * Destroy the bus and remove listeners.
   */
  destroy() {
    this.removeAllListeners();
    this.history = [];
  }
}

module.exports = BusinessEventBus;
