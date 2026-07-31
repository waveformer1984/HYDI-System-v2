'use strict';

const { EventEmitter } = require('events');

/**
 * SharedMemoryStore replicates selected memory namespaces across nodes using
 * vector-clock causality. Conflicts are detected, not silently overwritten,
 * and resolved deterministically per namespace policy.
 */
class SharedMemoryStore extends EventEmitter {
  constructor(config = {}) {
    super();
    this.identity = config.identity || null;
    this.nodeId = config.nodeId || (this.identity ? this.identity.nodeId : 'local');
    this.logger = config.logger || console;
    this.data = new Map();
    this.conflicts = new Map();
    this.audit = [];
    this.policies = new Map();
    this.counters = new Map();
    this._setDefaultPolicies();
  }

  _setDefaultPolicies() {
    this.policies.set('sessions', { resolution: 'lww' });
    this.policies.set('missions', { resolution: 'semantic' });
    this.policies.set('facts', { resolution: 'append' });
  }

  setPolicy(namespace, policy) {
    this.policies.set(namespace, { ...this.policies.get(namespace), ...policy });
  }

  _clock(increment = true) {
    const counter = (this.counters.get(this.nodeId) || 0) + (increment ? 1 : 0);
    if (increment) this.counters.set(this.nodeId, counter);
    const vector = new Map(this.counters);
    vector.set(this.nodeId, counter);
    return Object.fromEntries(vector);
  }

  _increment() {
    const counter = (this.counters.get(this.nodeId) || 0) + 1;
    this.counters.set(this.nodeId, counter);
    return this._clock(false);
  }

  get(namespace, key) {
    const ns = this.data.get(namespace);
    if (!ns) return null;
    const record = ns.get(key);
    if (!record) return null;
    return record.value;
  }

  getRecord(namespace, key) {
    const ns = this.data.get(namespace);
    return ns ? ns.get(key) || null : null;
  }

  set(namespace, key, value, options = {}) {
    const vector = options.vector || this._increment();
    const record = {
      namespace,
      key,
      value,
      vector,
      nodeId: options.nodeId || this.nodeId,
      ts: options.ts || Date.now(),
      history: [],
    };

    const ns = this._getNamespace(namespace);
    const existing = ns.get(key);
    if (existing) {
      const relation = this._compareVectors(record.vector, existing.vector);
      if (relation === 'before') {
        record.history = [...existing.history, existing];
        this._audit('set', record, 'ignored_stale');
        return { applied: false, reason: 'stale', record: existing };
      }
      if (relation === 'concurrent') {
        this._recordConflict(namespace, key, existing, record);
      }
      return this._resolve(namespace, key, existing, record);
    }

    ns.set(key, record);
    this._audit('set', record);
    this.emit('changed', record);
    return { applied: true, record };
  }

  _getNamespace(namespace) {
    if (!this.data.has(namespace)) this.data.set(namespace, new Map());
    return this.data.get(namespace);
  }

  _recordConflict(namespace, key, a, b) {
    const conflictId = `${namespace}:${key}:${Math.min(a.ts, b.ts)}`;
    if (!this.conflicts.has(namespace)) this.conflicts.set(namespace, new Map());
    this.conflicts.get(namespace).set(key, { a, b, conflictId, detectedAt: Date.now() });
    this._audit('conflict', { conflictId, namespace, key });
    this.emit('conflict_detected', { conflictId, namespace, key, a, b });
  }

  _resolve(namespace, key, existing, incoming) {
    const policy = this.policies.get(namespace) || { resolution: 'lww' };
    let winner;
    if (policy.resolution === 'lww') {
      if (incoming.ts > existing.ts) {
        winner = incoming;
      } else if (existing.ts > incoming.ts) {
        winner = existing;
      } else if (this._compareVectors(incoming.vector, existing.vector) === 'after') {
        winner = incoming;
      } else if (this._compareVectors(existing.vector, incoming.vector) === 'after') {
        winner = existing;
      } else {
        winner = incoming.nodeId > existing.nodeId ? incoming : existing;
      }
    } else if (policy.resolution === 'append') {
      winner = { ...incoming, value: this._appendValues(existing.value, incoming.value) };
    } else {
      winner = incoming;
    }
    winner.vector = this._mergeVectors(existing.vector, incoming.vector);
    const ns = this._getNamespace(namespace);
    winner.history = [...existing.history, existing, incoming];
    ns.set(key, winner);
    this._audit('resolve', winner);
    this.emit('resolved', { namespace, key, winner });
    return { applied: true, conflict: true, record: winner };
  }

  _appendValues(a, b) {
    const arrA = Array.isArray(a) ? a : [a];
    const arrB = Array.isArray(b) ? b : [b];
    return [...arrA, ...arrB];
  }

  _compareVectors(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let aAhead = false;
    let bAhead = false;
    for (const k of keys) {
      const av = a[k] || 0;
      const bv = b[k] || 0;
      if (av > bv) aAhead = true;
      if (bv > av) bAhead = true;
    }
    if (aAhead && !bAhead) return 'after';
    if (bAhead && !aAhead) return 'before';
    if (!aAhead && !bAhead) return 'equal';
    return 'concurrent';
  }

  _mergeVectors(a, b) {
    const merged = { ...a };
    for (const [k, v] of Object.entries(b)) {
      merged[k] = Math.max(merged[k] || 0, v);
    }
    return merged;
  }

  applyDelta(delta) {
    if (!delta || !delta.namespace || !delta.key) return { applied: false, error: 'invalid_delta' };
    return this.set(delta.namespace, delta.key, delta.value, {
      vector: delta.vector,
      nodeId: delta.nodeId,
      ts: delta.ts,
    });
  }

  getDelta(namespace, key) {
    const record = this.getRecord(namespace, key);
    if (!record) return null;
    return { namespace, key, value: record.value, vector: record.vector, nodeId: record.nodeId, ts: record.ts };
  }

  getConflicts(namespace) {
    const ns = this.conflicts.get(namespace);
    return ns ? Array.from(ns.entries()).map(([key, v]) => ({ key, ...v })) : [];
  }

  resolveConflict(namespace, key, chosen) {
    const ns = this._getNamespace(namespace);
    const existing = ns.get(key);
    if (!existing) return { success: false, error: 'not_found' };
    const resolved = { ...existing, value: chosen, resolvedAt: Date.now() };
    ns.set(key, resolved);
    if (this.conflicts.has(namespace)) this.conflicts.get(namespace).delete(key);
    this._audit('operator_resolve', resolved);
    this.emit('resolved', { namespace, key, winner: resolved });
    return { success: true, record: resolved };
  }

  snapshot() {
    const result = {};
    for (const [namespace, ns] of this.data) {
      result[namespace] = Object.fromEntries(ns);
    }
    return result;
  }

  _audit(action, record, note) {
    const entry = { at: Date.now(), action, nodeId: this.nodeId, note, record };
    this.audit.push(entry);
    this.emit('audit', entry);
  }
}

module.exports = SharedMemoryStore;
