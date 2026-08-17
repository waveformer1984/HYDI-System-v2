'use strict';

const { EventEmitter } = require('events');

/**
 * HeartbeatSystem publishes and monitors heartbeats for every running service.
 *
 * A heartbeat includes: timestamp, uptime, CPU, memory, queue depth, active mission,
 * active task, and a health score.
 */
class HeartbeatSystem extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      publishIntervalMs: config.publishIntervalMs || 30000,
      missingThresholdMs: config.missingThresholdMs || 90000,
      checkIntervalMs: config.checkIntervalMs || 30000,
      ...config,
    };

    this.heartbeats = new Map();
    this.publishers = new Map();
    this.checkTimer = null;
    this._destroyed = false;
  }

  /**
   * Register a service that publishes heartbeats automatically.
   * @param {string} serviceId
   * @param {function():object|object} provider - function returning heartbeat or an object with getStatus()
   */
  registerPublisher(serviceId, provider, metadata = {}) {
    if (this._destroyed) return;
    this.publishers.set(serviceId, { provider, metadata });
    this.heartbeats.set(serviceId, {
      serviceId,
      timestamp: Date.now(),
      uptime: 0,
      cpu: 0,
      memory: 0,
      queueDepth: 0,
      activeMission: null,
      activeTask: null,
      healthScore: 1.0,
      metadata,
    });
  }

  unregisterPublisher(serviceId) {
    this.publishers.delete(serviceId);
    this.heartbeats.delete(serviceId);
  }

  /**
   * Publish a heartbeat manually or update from a provider.
   */
  publish(serviceId, heartbeat = {}) {
    if (this._destroyed) return;
    const now = Date.now();
    const existing = this.heartbeats.get(serviceId) || { serviceId };
    const merged = {
      ...existing,
      ...heartbeat,
      serviceId,
      timestamp: heartbeat.timestamp || now,
    };

    if (!merged.healthScore) {
      const uptime = merged.uptime || 0;
      const cpu = merged.cpu || 0;
      const memory = merged.memory || 0;
      const queueDepth = merged.queueDepth || 0;
      const healthScore = Math.max(0, 1 - (cpu + memory + queueDepth / 1000) / 3) + Math.min(0.1, uptime / 3600000);
      merged.healthScore = Math.min(1, healthScore);
    }

    this.heartbeats.set(serviceId, merged);
    this.emit('heartbeat', merged);
  }

  async publishAll() {
    if (this._destroyed) return;
    for (const [serviceId, { provider }] of this.publishers) {
      try {
        const heartbeat = typeof provider === 'function'
          ? await provider()
          : (typeof provider.getStatus === 'function' ? await provider.getStatus() : {});
        this.publish(serviceId, heartbeat);
      } catch (err) {
        this.emit('publish_failed', { serviceId, error: err.message });
      }
    }
  }

  start() {
    if (this._destroyed) return;
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => this.checkHeartbeats(), this.config.checkIntervalMs);
    if (this.checkTimer.unref) this.checkTimer.unref();
  }

  stop() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  destroy() {
    this._destroyed = true;
    this.stop();
    this.heartbeats.clear();
    this.publishers.clear();
  }

  checkHeartbeats() {
    if (this._destroyed) return;
    const now = Date.now();
    const missing = [];
    for (const [serviceId, heartbeat] of this.heartbeats) {
      if (now - heartbeat.timestamp > this.config.missingThresholdMs) {
        missing.push({ serviceId, lastSeen: heartbeat.timestamp, elapsed: now - heartbeat.timestamp });
      }
    }
    if (missing.length) {
      this.emit('heartbeat_missing', missing);
    }
  }

  getHeartbeat(serviceId) {
    return this.heartbeats.get(serviceId) || null;
  }

  getHeartbeats() {
    return Array.from(this.heartbeats.values());
  }

  getMissingHeartbeats() {
    const now = Date.now();
    return Array.from(this.heartbeats.values()).filter(
      (h) => now - h.timestamp > this.config.missingThresholdMs
    );
  }

  getHealthScore(serviceId) {
    return this.heartbeats.get(serviceId)?.healthScore || 0;
  }

  getStatus() {
    return {
      total: this.heartbeats.size,
      healthy: this.getHeartbeats().filter((h) => h.healthScore >= 0.7).length,
      degraded: this.getHeartbeats().filter((h) => h.healthScore < 0.7 && h.healthScore >= 0.4).length,
      failed: this.getHeartbeats().filter((h) => h.healthScore < 0.4).length,
      missing: this.getMissingHeartbeats().length,
      heartbeats: this.getHeartbeats(),
    };
  }
}

module.exports = HeartbeatSystem;
