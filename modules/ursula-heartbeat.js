/**
 * Ursula Heartbeat - Local Model Health Check & Silent Failure Recovery
 * Monitors all 13 local models, detects hangs/silent failures, auto-recovers
 * Provides user-facing ETA notifications when models timeout
 */

const EventEmitter = require('events');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto'); // fix #5: top-level, not inline

class UrsulaHeartbeat extends EventEmitter {
  constructor(localModelAdapter) {
    super();
    this.adapter = localModelAdapter;
    this.modelHealth = new Map();
    this.pendingRequests = new Map();
    this.cache = new Map(); // 24h result cache
    this.heartbeatInterval = 10000; // 10 seconds
    this.timeoutThreshold = 30000; // 30 seconds
    this.cacheTTL = 24 * 60 * 60 * 1000; // 24 hours
    this._stopped = false; // fix #3: use private flag, not this.destroyed

    // LATENCY WATCHDOG: Track response times to detect "ghost" models (alive but slow)
    this.latencyWatchdog = {
      enabled: true,
      threshold: 5000,         // 5s threshold for "degraded" performance
      criticalThreshold: 15000, // 15s threshold for "critical" latency
      windowSize: 10,           // Rolling window of last 10 requests
      checkInterval: 30000      // Check every 30s for latency spikes
    };
    this.modelResponseTimes = new Map(); // modelId -> [responseTimes]

    this.startHeartbeat();
    this.startCacheCleanup();
    this.startLatencyWatchdog();
  }

  startHeartbeat() {
    console.log('[HEARTBEAT] Starting local model health monitor...');
    this.heartbeatTimer = setInterval(async () => {
      await this.checkAllModels();
    }, this.heartbeatInterval);
  }

  async checkAllModels() {
    const models = this.adapter.models;

    // fix #4: recover in parallel — don't block the tick on sequential awaits
    const checks = [];
    for (const [modelId] of models) {
      checks.push(this._checkOneModel(modelId));
    }
    await Promise.allSettled(checks);
  }

  async _checkOneModel(modelId) {
    const health = this.modelHealth.get(modelId) || this.createDefaultHealth();

    // Check hung pending request
    const pending = this.pendingRequests.get(modelId);
    if (pending && (Date.now() - pending.startTime > this.timeoutThreshold)) {
      console.log(`[HEARTBEAT] Model ${modelId} has hung request (${this.timeoutThreshold}ms)`);
      health.status = 'hung';
      health.consecutiveFailures++;
      health.lastFailure = new Date();

      if (!this._stopped) {
        this.emit('model_hung', {
          modelId,
          requestId: pending.requestId,
          elapsed: Date.now() - pending.startTime,
          eta: this.calculateETA(modelId, health)
        });
      }
      await this.recoverModel(modelId);
    }

    // fix #2: guard against null lastResponse — only check staleness if model has been seen
    if (
      health.lastResponse !== null &&
      Date.now() - health.lastResponse > this.timeoutThreshold * 2
    ) {
      health.status = 'stale';
      console.log(`[HEARTBEAT] Model ${modelId} stale (no response in ${this.timeoutThreshold * 2}ms)`);
      await this.recoverModel(modelId);
    }

    this.modelHealth.set(modelId, health);
  }

  registerRequest(modelId, requestId, userId) {
    this.pendingRequests.set(modelId, {
      requestId,
      userId,
      startTime: Date.now(),
      notified: false
    });

    const health = this.modelHealth.get(modelId) || this.createDefaultHealth();
    health.totalRequests++;
    this.modelHealth.set(modelId, health);
  }

  completeRequest(modelId, requestId, success, responseTime) {
    const pending = this.pendingRequests.get(modelId);
    if (pending && pending.requestId === requestId) {
      this.pendingRequests.delete(modelId);
    }

    const health = this.modelHealth.get(modelId) || this.createDefaultHealth();
    health.lastResponse = Date.now();

    if (responseTime !== undefined) {
      this.recordResponseTime(modelId, responseTime);
    }

    if (success) {
      health.status = 'healthy';
      health.consecutiveFailures = 0;
      health.recoveryAttempts = 0; // reset backoff on success
      health.successfulRequests++;
      const n = health.successfulRequests;
      health.averageResponseTime =
        (health.averageResponseTime * (n - 1) + responseTime) / n;
    } else {
      health.consecutiveFailures++;
      health.lastFailure = new Date();

      if (health.consecutiveFailures >= 3) {
        health.status = 'critical';
        console.log(`[HEARTBEAT] Model ${modelId} CRITICAL - ${health.consecutiveFailures} consecutive failures`);
        if (!this._stopped) {
          this.emit('model_critical', { modelId, health });
        }
      } else {
        health.status = 'degraded';
      }
    }

    this.modelHealth.set(modelId, health);
  }

  recordResponseTime(modelId, responseTime) {
    let times = this.modelResponseTimes.get(modelId) || [];
    times.push(responseTime);
    if (times.length > this.latencyWatchdog.windowSize) {
      times = times.slice(-this.latencyWatchdog.windowSize);
    }
    this.modelResponseTimes.set(modelId, times);
  }

  startLatencyWatchdog() {
    if (!this.latencyWatchdog.enabled) return;
    console.log('[HEARTBEAT] Starting latency watchdog (5s degraded, 15s critical thresholds)...');
    this.latencyTimer = setInterval(() => {
      this.checkLatencySpikes();
    }, this.latencyWatchdog.checkInterval);
  }

  checkLatencySpikes() {
    for (const [modelId, times] of this.modelResponseTimes) {
      if (times.length === 0) continue;

      const sorted = [...times].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
      const avg = times.reduce((a, b) => a + b, 0) / times.length;

      const health = this.modelHealth.get(modelId) || this.createDefaultHealth();

      if (p95 > this.latencyWatchdog.criticalThreshold) {
        console.log(`[HEARTBEAT] LATENCY CRITICAL: ${modelId} p95=${p95.toFixed(0)}ms`);
        health.status = 'latency_critical';
        health.latencySpike = { p95, avg, timestamp: Date.now() };
        if (!this._stopped) {
          this.emit('model_latency_critical', {
            modelId, p95, avg,
            threshold: this.latencyWatchdog.criticalThreshold,
            samples: times.length
          });
        }
        this.recoverModel(modelId);
      } else if (p95 > this.latencyWatchdog.threshold) {
        console.log(`[HEARTBEAT] LATENCY DEGRADED: ${modelId} p95=${p95.toFixed(0)}ms`);
        if (health.status === 'healthy') health.status = 'latency_degraded';
        health.latencySpike = { p95, avg, timestamp: Date.now() };
        if (!this._stopped) {
          this.emit('model_latency_degraded', {
            modelId, p95, avg,
            threshold: this.latencyWatchdog.threshold
          });
        }
      } else if (health.status === 'latency_degraded' && p95 < this.latencyWatchdog.threshold * 0.8) {
        console.log(`[HEARTBEAT] LATENCY RECOVERED: ${modelId} p95=${p95.toFixed(0)}ms`);
        health.status = 'healthy';
        delete health.latencySpike;
        if (!this._stopped) {
          this.emit('model_latency_recovered', { modelId, p95, avg });
        }
      }

      this.modelHealth.set(modelId, health);
    }
  }

  calculateETA(modelId, health) {
    const base = 5000;
    // fix #6: exponential backoff — 5s, 10s, 20s, 40s, 80s cap
    const backoff = Math.min(health.recoveryAttempts, 4);
    return base * Math.pow(2, backoff);
  }

  async recoverModel(modelId) {
    const health = this.modelHealth.get(modelId);
    if (!health) return;

    // fix #6: hard stop after 10 failed recoveries — don't hammer a dead model
    if (health.recoveryAttempts >= 10) {
      if (health.status !== 'failed') {
        health.status = 'failed';
        console.log(`[HEARTBEAT] Model ${modelId} permanently failed after ${health.recoveryAttempts} recovery attempts`);
        if (!this._stopped) {
          this.emit('model_recovery_failed', { modelId, permanent: true });
        }
        this.modelHealth.set(modelId, health);
      }
      return;
    }

    health.recoveryAttempts++;
    console.log(`[HEARTBEAT] Recovering model ${modelId} (attempt ${health.recoveryAttempts})`);

    const pending = this.pendingRequests.get(modelId);
    if (pending && !pending.notified) {
      const eta = this.calculateETA(modelId, health);
      if (!this._stopped) {
        this.emit('user_notification', {
          userId: pending.userId,
          type: 'model_recovery',
          message: `Your request is taking longer than expected. Restarting AI engine. ETA: ${Math.ceil(eta / 1000)}s.`,
          eta,
          modelId,
          requestId: pending.requestId
        });
      }
      pending.notified = true;
    }

    try {
      await this.adapter.handleHungModel(modelId);
      health.status = 'recovering';
      health.consecutiveFailures = 0;

      await new Promise(resolve => setTimeout(resolve, 3000));
      const pingSuccess = await this.pingModel(modelId);

      if (pingSuccess) {
        health.status = 'healthy';
        health.recoveryAttempts = 0;
        console.log(`[HEARTBEAT] Model ${modelId} recovered`);
        if (!this._stopped) this.emit('model_recovered', { modelId });
      } else {
        health.status = 'failed';
        console.log(`[HEARTBEAT] Model ${modelId} recovery failed`);
        if (!this._stopped) this.emit('model_recovery_failed', { modelId, permanent: false });
      }
    } catch (error) {
      console.error(`[HEARTBEAT] Recovery error for ${modelId}:`, error.message);
      health.status = 'failed';
      if (!this._stopped) this.emit('model_recovery_failed', { modelId, error: error.message, permanent: false });
    }

    this.modelHealth.set(modelId, health);
  }

  async pingModel(modelId) {
    try {
      const model = this.adapter.models.get(modelId);
      if (!model || !model.loaded) return false;
      switch (model.type) {
        case 'llama':
        case 'codellama':
          return await this.pingLLM(modelId);
        case 'distilbert':
          return await this.pingClassifier(modelId);
        case 'custom':
          return await this.pingCustom(modelId);
        default:
          return model.loaded;
      }
    } catch {
      return false;
    }
  }

  async pingLLM(modelId) {
    try {
      const result = await this.adapter.executeDirect(modelId, { prompt: 'ping', maxTokens: 10 });
      return !!result;
    } catch { return false; }
  }

  async pingClassifier(modelId) {
    try {
      const result = await this.adapter.executeDirect(modelId, { text: 'test' });
      return !!result && result.confidence !== undefined;
    } catch { return false; }
  }

  async pingCustom(modelId) {
    try {
      const result = await this.adapter.executeDirect(modelId, { test: true });
      return !!result;
    } catch { return false; }
  }

  getCachedResult(serviceId, inputHash) {
    const cacheKey = `${serviceId}:${inputHash}`;
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      cached.hitCount++; // fix #1: actually increment so hit rate is real
      console.log(`[HEARTBEAT] Cache hit for ${cacheKey} (hits: ${cached.hitCount})`);
      if (!this._stopped) {
        this.emit('cache_hit', { serviceId, inputHash, age: Date.now() - cached.timestamp });
      }
      return cached.result;
    }
    return null;
  }

  setCachedResult(serviceId, inputHash, result) {
    const cacheKey = `${serviceId}:${inputHash}`;
    this.cache.set(cacheKey, { result, timestamp: Date.now(), hitCount: 0 });
    console.log(`[HEARTBEAT] Cached result for ${cacheKey}`);
  }

  hashInput(input) {
    // fix #5: crypto already required at top — no inline require
    return crypto.createHash('md5').update(JSON.stringify(input)).digest('hex');
  }

  startCacheCleanup() {
    this.cacheCleanupTimer = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [key, entry] of this.cache) {
        if (now - entry.timestamp > this.cacheTTL) {
          this.cache.delete(key);
          cleaned++;
        }
      }
      if (cleaned > 0) console.log(`[HEARTBEAT] Cleaned ${cleaned} expired cache entries`);
    }, 60 * 60 * 1000);
  }

  getHealthReport() {
    const report = {
      timestamp: new Date().toISOString(),
      models: {},
      summary: { total: 0, healthy: 0, degraded: 0, critical: 0, hung: 0, recovering: 0, failed: 0 },
      cache: { entries: this.cache.size, hitRate: this.calculateCacheHitRate() }
    };
    for (const [modelId, health] of this.modelHealth) {
      report.models[modelId] = { ...health };
      report.summary.total++;
      report.summary[health.status] = (report.summary[health.status] || 0) + 1;
    }
    return report;
  }

  calculateCacheHitRate() {
    // fix #1 prerequisite: now that hitCount is actually incremented, this is accurate
    let hits = 0;
    let total = 0;
    for (const entry of this.cache.values()) {
      total++;
      if (entry.hitCount > 0) hits++;
    }
    return total > 0 ? Math.round((hits / total) * 100) : 0;
  }

  createDefaultHealth() {
    return {
      status: 'unknown',
      lastResponse: null, // null = never seen; stale check guards against this
      consecutiveFailures: 0,
      totalRequests: 0,
      successfulRequests: 0,
      averageResponseTime: 0,
      lastFailure: null,
      recoveryAttempts: 0
    };
  }

  stop() {
    this._stopped = true; // fix #3: use our own flag
    clearInterval(this.heartbeatTimer);
    clearInterval(this.latencyTimer);
    clearInterval(this.cacheCleanupTimer);
    console.log('[HEARTBEAT] Stopped');
  }
}

module.exports = UrsulaHeartbeat;
