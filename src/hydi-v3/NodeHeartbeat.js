'use strict';

const { EventEmitter } = require('events');

/**
 * NodeHeartbeat sends periodic health updates to all connected peers and
 * forwards received heartbeats to the mesh for health monitoring.
 */
class NodeHeartbeat extends EventEmitter {
  constructor(config = {}) {
    super();
    this.transport = config.transport;
    this.intervalMs = config.intervalMs || 30000;
    this.timeoutMs = config.timeoutMs || 90000;
    this.metrics = config.metrics || (() => ({}));
    this.logger = config.logger || console;
    this._timer = null;
    this._lastHeard = new Map();
  }

  start() {
    if (this._timer) return this;
    this._timer = setInterval(() => this.beat(), this.intervalMs);
    if (this._timer.unref) this._timer.unref();
    if (this.transport) {
      this.transport.on('message', (msg) => {
        if (msg.type === 'heartbeat') this._onHeartbeat(msg);
      });
    }
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

  beat() {
    if (!this.transport) return;
    const payload = { ts: Date.now(), ...this.metrics() };
    this.transport.broadcast('heartbeat', payload);
    this.emit('beat', payload);
    return payload;
  }

  _onHeartbeat(msg) {
    this._lastHeard.set(msg.from, msg.ts || Date.now());
    this.emit('heartbeat', { from: msg.from, payload: msg.payload });
  }

  isAlive(nodeId) {
    if (!this._lastHeard.has(nodeId)) return false;
    return Date.now() - this._lastHeard.get(nodeId) <= this.timeoutMs;
  }

  getPeerHealth() {
    const now = Date.now();
    const result = {};
    for (const [nodeId, ts] of this._lastHeard) {
      result[nodeId] = now - ts <= this.timeoutMs ? 'healthy' : 'unhealthy';
    }
    return result;
  }
}

module.exports = NodeHeartbeat;
