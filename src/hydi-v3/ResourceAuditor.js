'use strict';

const { EventEmitter } = require('events');

/**
 * ResourceAuditor captures snapshots of process resources and compares
 * before/after state to detect leaks in memory, handles, timers, and
 * event listeners.
 */
class ResourceAuditor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.thresholds = {
      heapGrowthBytes: config.heapGrowthBytes || 1024 * 1024,
      handlesGrowth: config.handlesGrowth || 5,
      requestsGrowth: config.requestsGrowth || 5,
      listenersGrowth: config.listenersGrowth || 3,
    };
    this.eventBus = config.eventBus || process;
  }

  snapshot(label = 'snap') {
    const mem = process.memoryUsage();
    return {
      label,
      at: Date.now(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      handles: this._activeHandles(),
      requests: this._activeRequests(),
      listeners: this._globalListeners(),
    };
  }

  diff(a, b) {
    return {
      heapUsed: b.heapUsed - a.heapUsed,
      heapTotal: b.heapTotal - a.heapTotal,
      handles: b.handles - a.handles,
      requests: b.requests - a.requests,
      listeners: b.listeners - a.listeners,
    };
  }

  checkLeak(before, after, options = {}) {
    const d = this.diff(before, after);
    const thresholds = { ...this.thresholds, ...options };
    const leaks = [];
    if (d.heapUsed > thresholds.heapGrowthBytes) leaks.push({ kind: 'heap', growth: d.heapUsed });
    if (d.handles > thresholds.handlesGrowth) leaks.push({ kind: 'handles', growth: d.handles });
    if (d.requests > thresholds.requestsGrowth) leaks.push({ kind: 'requests', growth: d.requests });
    if (d.listeners > thresholds.listenersGrowth) leaks.push({ kind: 'listeners', growth: d.listeners });
    const ok = leaks.length === 0;
    this.emit(ok ? 'clean' : 'leak', { diff: d, leaks, thresholds });
    return { ok, diff: d, leaks };
  }

  _activeHandles() {
    if (typeof process._getActiveHandles === 'function') {
      return process._getActiveHandles().length;
    }
    return 0;
  }

  _activeRequests() {
    if (typeof process._getActiveRequests === 'function') {
      return process._getActiveRequests().length;
    }
    return 0;
  }

  _globalListeners() {
    if (!this.eventBus || !this.eventBus.eventNames) return 0;
    return this.eventBus.eventNames().reduce((sum, e) => sum + this.eventBus.listenerCount(e), 0);
  }
}

module.exports = ResourceAuditor;
