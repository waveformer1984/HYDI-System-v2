'use strict';

const { EventEmitter } = require('events');

/**
 * DeadlockDetector tracks resource waits and detects cycles in the wait-for
 * graph. It can be attached to any resource manager without requiring
 * modification of the resources themselves.
 */
class DeadlockDetector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.waitFor = new Map(); // resource -> Set of resources it waits for
    this.heldBy = new Map(); // resource -> holder id
    this.pending = new Map(); // holder id -> Set of resources it is waiting for
    this.timeoutMs = config.timeoutMs || 30000;
    this.cycles = new Set();
    this.lifecycleRegistry = config.lifecycleRegistry || null;
  }

  hold(holderId, resourceId) {
    this.heldBy.set(resourceId, holderId);
    this.emit('resource_held', { holderId, resourceId });
    return this;
  }

  release(holderId, resourceId) {
    const current = this.heldBy.get(resourceId);
    if (current !== holderId) return { success: false, error: 'not_holder' };
    this.heldBy.delete(resourceId);
    for (const [h, set] of this.pending) {
      if (set.has(resourceId)) {
        set.delete(resourceId);
        if (set.size === 0) this.pending.delete(h);
        const waiters = this.waitFor.get(h);
        if (waiters) {
          waiters.delete(holderId);
          if (waiters.size === 0) this.waitFor.delete(h);
        }
      }
    }
    this.emit('resource_released', { holderId, resourceId });
    return { success: true };
  }

  wait(holderId, resourceId) {
    const holder = holderId;
    const resource = resourceId;

    this.pending.set(holder, (this.pending.get(holder) || new Set()).add(resource));

    const targetHolder = this.heldBy.get(resource);
    if (targetHolder) {
      this.waitFor.set(holder, (this.waitFor.get(holder) || new Set()).add(targetHolder));
    }

    const cycle = this._detectCycle(holder);
    if (cycle) {
      const report = { holder, cycle, resources: Array.from(cycle) };
      this._audit('deadlock_detected', report);
      this.emit('deadlock_detected', report);
      this.cycles.add(report);
      return { success: false, error: 'deadlock_detected', cycle };
    }

    this.emit('wait_registered', { holder, resource });
    return { success: true };
  }

  resolve(holderId, resourceId) {
    const set = this.pending.get(holderId);
    if (set) {
      set.delete(resourceId);
      if (set.size === 0) this.pending.delete(holderId);
    }
    const waiters = this.waitFor.get(holderId);
    if (waiters) {
      waiters.delete(this.heldBy.get(resourceId));
      if (waiters.size === 0) this.waitFor.delete(holderId);
    }
    this.emit('wait_resolved', { holderId, resourceId });
    return this;
  }

  _detectCycle(start) {
    const visited = new Set();
    const stack = new Set();
    const path = [];

    const visit = (node) => {
      if (stack.has(node)) {
        const idx = path.indexOf(node);
        return path.slice(idx).concat([node]);
      }
      if (visited.has(node)) return null;
      visited.add(node);
      stack.add(node);
      path.push(node);
      const edges = this.waitFor.get(node) || new Set();
      for (const next of edges) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
      stack.delete(node);
      path.pop();
      return null;
    };

    return visit(start);
  }

  getGraph() {
    return {
      heldBy: Object.fromEntries(this.heldBy),
      waitFor: Object.fromEntries(Array.from(this.waitFor).map(([k, v]) => [k, [...v]])),
      cycles: Array.from(this.cycles),
    };
  }

  _audit(action, report) {
    const entry = { at: Date.now(), action, ...report };
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(entry);
    this.emit('audit', entry);
  }
}

module.exports = DeadlockDetector;
