'use strict';

const { EventEmitter } = require('events');

/**
 * FaultCorrelationEngine correlates faults across subsystems to identify
 * root causes and cascading failures from a stream of individual alerts.
 */
class FaultCorrelationEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.windowMs = config.windowMs || 60000;
    this.minConfidence = config.minConfidence || 0.5;
    this.rules = config.rules || [];
    this.events = [];
    this.correlations = new Map();
    this._clock = 0;
    this.lifecycleRegistry = config.lifecycleRegistry || null;
  }

  ingest(event) {
    this._clock += 1;
    const record = {
      id: `f-${Date.now()}-${this._clock}`,
      at: event.at || Date.now(),
      subsystem: event.subsystem,
      type: event.type,
      severity: event.severity || 'warning',
      message: event.message || '',
      context: event.context || {},
    };
    this.events.push(record);
    this._prune();
    this._audit('fault_ingested', record);
    this.emit('fault_ingested', record);
    this._correlate(record);
    return record;
  }

  _prune() {
    const cutoff = Date.now() - this.windowMs;
    this.events = this.events.filter((e) => e.at >= cutoff);
  }

  _correlate(record) {
    const recent = this.events.filter((e) => e.id !== record.id && e.at >= record.at - this.windowMs);

    const candidates = recent.filter((e) => this._related(e, record));
    if (candidates.length === 0) return;

    const group = [record, ...candidates].sort((a, b) => a.at - b.at);
    const key = this._groupKey(group);
    const existing = this.correlations.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastAt = record.at;
      existing.events = group;
      this.emit('correlation_updated', existing);
      return;
    }

    const correlation = {
      id: `c-${Date.now()}-${this.correlations.size}`,
      key,
      events: group,
      count: 1,
      rootCause: this._inferRootCause(group),
      confidence: this._confidence(group),
      createdAt: Date.now(),
      lastAt: record.at,
    };
    this.correlations.set(key, correlation);
    this._audit('correlation_detected', correlation);
    this.emit('correlation_detected', correlation);
  }

  _related(a, b) {
    if (a.subsystem === b.subsystem) return true;
    if (a.context && b.context && a.context.traceId && a.context.traceId === b.context.traceId) return true;
    for (const rule of this.rules) {
      if (rule(a, b)) return true;
    }
    return false;
  }

  _groupKey(group) {
    const subsystems = [...new Set(group.map((e) => e.subsystem))].sort().join('|');
    const types = [...new Set(group.map((e) => e.type))].sort().join('|');
    return `${subsystems}::${types}`;
  }

  _inferRootCause(group) {
    const bySeverity = group.sort((a, b) => this._severityIndex(a.severity) - this._severityIndex(b.severity));
    return bySeverity[0] || null;
  }

  _confidence(group) {
    const unique = new Set(group.map((g) => g.subsystem)).size;
    const score = Math.min(1, unique / 3) * Math.min(1, group.length / 5);
    return parseFloat(score.toFixed(2));
  }

  _severityIndex(severity) {
    const order = { critical: 0, error: 1, warning: 2, info: 3 };
    return order[severity] !== undefined ? order[severity] : 2;
  }

  getCorrelations(filter = {}) {
    let list = Array.from(this.correlations.values());
    if (filter.minConfidence) list = list.filter((c) => c.confidence >= filter.minConfidence);
    if (filter.subsystem) list = list.filter((c) => c.events.some((e) => e.subsystem === filter.subsystem));
    return list;
  }

  _audit(action, record) {
    const entry = { at: Date.now(), action, recordId: record.id };
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(entry);
    this.emit('audit', entry);
  }
}

module.exports = FaultCorrelationEngine;
