'use strict';

const { EventEmitter } = require('events');

const PRIORITY = { Critical: 5, High: 4, Normal: 3, Background: 2, Experimental: 1 };

/**
 * DistributedQueue is a priority task queue with reservation, acknowledgement,
 * expiration, cancellation, and ownership tracking.
 */
class DistributedQueue extends EventEmitter {
  constructor(config = {}) {
    super();
    this.items = [];
    this.owned = new Map();
    this.completed = new Map();
    this.defaultTtlMs = config.defaultTtlMs || 300000;
    this.logger = config.logger || console;
    this._timer = null;
    this._reaperIntervalMs = config.reaperIntervalMs || 10000;
    this._clock = 0;
  }

  start() {
    if (this._timer) return this;
    this._timer = setInterval(() => this._reap(), this._reaperIntervalMs);
    if (this._timer.unref) this._timer.unref();
    this.emit('started');
    return this;
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.emit('stopped');
    return this;
  }

  enqueue(task, options = {}) {
    this._clock += 1;
    const item = {
      id: task.id || `q-${Date.now()}-${this._clock}`,
      task,
      priority: PRIORITY[task.priority] || PRIORITY.Normal,
      priorityName: task.priority || 'Normal',
      submittedAt: Date.now(),
      expiresAt: options.expiresAt || Date.now() + (options.ttlMs || this.defaultTtlMs),
      status: 'queued',
      owner: null,
      reservedAt: null,
      attempts: 0,
      seq: this._clock,
    };
    this.items.push(item);
    this._sort();
    this.emit('enqueued', item);
    return item;
  }

  _sort() {
    this.items.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.submittedAt !== b.submittedAt) return a.submittedAt - b.submittedAt;
      return a.seq - b.seq;
    });
  }

  reserve(nodeId) {
    const now = Date.now();
    const index = this.items.findIndex((i) => i.status === 'queued' && i.expiresAt > now);
    if (index === -1) return null;
    const item = this.items[index];
    item.status = 'reserved';
    item.owner = nodeId;
    item.reservedAt = now;
    item.attempts += 1;
    this.owned.set(item.id, item);
    this._sort();
    this.emit('reserved', { item, owner: nodeId });
    return item;
  }

  ack(itemId, nodeId) {
    const item = this.owned.get(itemId) || this.items.find((i) => i.id === itemId);
    if (!item || item.owner !== nodeId) return { success: false, error: 'not_owner' };
    item.status = 'acknowledged';
    this.emit('acknowledged', { item, owner: nodeId });
    return { success: true, item };
  }

  complete(itemId, nodeId, result) {
    const item = this.owned.get(itemId);
    if (!item || item.owner !== nodeId) return { success: false, error: 'not_owner' };
    this._removeFromQueue(itemId);
    this.owned.delete(itemId);
    item.status = 'completed';
    item.completedAt = Date.now();
    item.result = result;
    this.completed.set(itemId, item);
    this.emit('completed', item);
    return { success: true, item };
  }

  fail(itemId, nodeId, error) {
    const item = this.owned.get(itemId);
    if (!item || item.owner !== nodeId) return { success: false, error: 'not_owner' };
    item.status = 'queued';
    item.owner = null;
    item.reservedAt = null;
    item.error = error;
    this.owned.delete(itemId);
    if (item.attempts >= 3) {
      return this._deadLetter(item, error);
    }
    this._sort();
    this.emit('failed', item);
    return { success: false, retry: true, item };
  }

  cancel(itemId, requestedBy) {
    const item = this.owned.get(itemId) || this.items.find((i) => i.id === itemId);
    if (!item) return { success: false, error: 'not_found' };
    this._removeFromQueue(itemId);
    this.owned.delete(itemId);
    item.status = 'cancelled';
    item.cancelledAt = Date.now();
    item.cancelledBy = requestedBy;
    this.emit('cancelled', item);
    return { success: true, item };
  }

  _removeFromQueue(itemId) {
    const index = this.items.findIndex((i) => i.id === itemId);
    if (index !== -1) this.items.splice(index, 1);
  }

  _deadLetter(item, error) {
    this._removeFromQueue(item.id);
    this.owned.delete(item.id);
    item.status = 'dead';
    item.error = error;
    this.emit('dead', item);
    return { success: false, dead: true, item };
  }

  _reap() {
    const now = Date.now();
    for (const item of this.items) {
      if (item.status === 'reserved' && item.expiresAt < now) {
        item.status = 'queued';
        item.owner = null;
        item.reservedAt = null;
        this.owned.delete(item.id);
        this.emit('expired', item);
      }
    }
    this._sort();
  }

  list() {
    return this.items.map((i) => ({ ...i }));
  }

  get(itemId) {
    return this.owned.get(itemId) || this.items.find((i) => i.id === itemId) || this.completed.get(itemId) || null;
  }

  stats() {
    return {
      queued: this.items.filter((i) => i.status === 'queued').length,
      reserved: this.items.filter((i) => i.status === 'reserved').length,
      completed: this.completed.size,
      total: this.items.length + this.completed.size,
    };
  }
}

module.exports = DistributedQueue;
