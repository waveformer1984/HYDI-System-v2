/**
 * Ursula Heartbeat - Local Model Health Check & Silent Failure Recovery
 * Monitors all 13 local models, detects hangs/silent failures, auto-recovers
 * Provides user-facing ETA notifications when models timeout
 */

const EventEmitter = require('events');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

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
    
    // LATENCY WATCHDOG: Track response times to detect "ghost" models (alive but slow)
    this.latencyWatchdog = {
      enabled: true,
      threshold: 5000, // 5s threshold for "degraded" performance
      criticalThreshold: 15000, // 15s threshold for "critical" latency
      windowSize: 10, // Rolling window of last 10 requests
      checkInterval: 30000 // Check every 30s for latency spikes
    };
    this.modelResponseTimes = new Map(); // modelId -> [responseTimes]
    
    this.startHeartbeat();
    this.startCacheCleanup();
    this.startLatencyWatchdog();
  }

  /**
   * Start the heartbeat monitor
   */
  startHeartbeat() {
    console.log('[HEARTBEAT] Starting local model health monitor...');
    
    this.heartbeatTimer = setInterval(async () => {
      await this.checkAllModels();
    }, this.heartbeatInterval);
  }

  /**
   * Check health of all registered models
   */
  async checkAllModels() {
    const models = this.adapter.models;
    
    for (const [modelId, model] of models) {
      const health = this.modelHealth.get(modelId) || {
        status: 'unknown',
        lastResponse: null,
        consecutiveFailures: 0,
        totalRequests: 0,
        successfulRequests: 0,
        averageResponseTime: 0,
        lastFailure: null,
        recoveryAttempts: 0
      };

      // Check if model has pending requests that timed out
      const pending = this.pendingRequests.get(modelId);
      if (pending && (Date.now() - pending.startTime > this.timeoutThreshold)) {
        console.log(`[HEARTBEAT] ⚠️ Model ${modelId} has hung request (${this.timeoutThreshold}ms)`);
        
        // Mark as unhealthy
        health.status = 'hung';
        health.consecutiveFailures++;
        health.lastFailure = new Date();
        
        // Emit for Heidi to notify user
        this.emit('model_hung', {
          modelId,
          requestId: pending.requestId,
          elapsed: Date.now() - pending.startTime,
          eta: this.calculateETA(modelId, health)
        });
        
        // Auto-recovery
        await this.recoverModel(modelId);
      }
      
      // Check if model hasn't responded in 2x timeout threshold
      if (health.lastResponse && (Date.now() - health.lastResponse > this.timeoutThreshold * 2)) {
        health.status = 'stale';
        console.log(`[HEARTBEAT] ⚠️ Model ${modelId} stale (no response in ${this.timeoutThreshold * 2}ms)`);
        await this.recoverModel(modelId);
      }
      
      this.modelHealth.set(modelId, health);
    }
  }

  /**
   * Register a pending request for monitoring
   */
  registerRequest(modelId, requestId, userId) {
    this.pendingRequests.set(modelId, {
      requestId,
      userId,
      startTime: Date.now(),
      notified: false
    });
    
    // Update health stats
    const health = this.modelHealth.get(modelId) || this.createDefaultHealth();
    health.totalRequests++;
    this.modelHealth.set(modelId, health);
  }

  /**
   * Mark request as completed
   */
  completeRequest(modelId, requestId, success, responseTime) {
    const pending = this.pendingRequests.get(modelId);
    if (pending && pending.requestId === requestId) {
      this.pendingRequests.delete(modelId);
    }
    
    const health = this.modelHealth.get(modelId) || this.createDefaultHealth();
    health.lastResponse = Date.now();
    
    // LATENCY WATCHDOG: Track response time for spike detection
    if (responseTime !== undefined) {
      this.recordResponseTime(modelId, responseTime);
    }
    
    if (success) {
      health.status = 'healthy';
      health.consecutiveFailures = 0;
      health.successfulRequests++;
      
      // Update rolling average response time
      const totalSuccess = health.successfulRequests;
      health.averageResponseTime = 
        (health.averageResponseTime * (totalSuccess - 1) + responseTime) / totalSuccess;
    } else {
      health.consecutiveFailures++;
      health.lastFailure = new Date();
      
      if (health.consecutiveFailures >= 3) {
        health.status = 'critical';
        console.log(`[HEARTBEAT] 🔴 Model ${modelId} CRITICAL - ${health.consecutiveFailures} consecutive failures`);
        this.emit('model_critical', { modelId, health });
      } else {
        health.status = 'degraded';
      }
    }
    
    this.modelHealth.set(modelId, health);
  }

  /**
   * Record response time for latency watchdog
   */
  recordResponseTime(modelId, responseTime) {
    let times = this.modelResponseTimes.get(modelId) || [];
    times.push(responseTime);
    
    // Keep rolling window
    if (times.length > this.latencyWatchdog.windowSize) {
      times = times.slice(-this.latencyWatchdog.windowSize);
    }
    
    this.modelResponseTimes.set(modelId, times);
  }

  /**
   * Start latency watchdog to detect "ghost" models (alive but slow)
   */
  startLatencyWatchdog() {
    if (!this.latencyWatchdog.enabled) return;
    
    console.log('[HEARTBEAT] Starting latency watchdog (5s degraded, 15s critical thresholds)...');
    
    this.latencyTimer = setInterval(() => {
      this.checkLatencySpikes();
    }, this.latencyWatchdog.checkInterval);
  }

  /**
   * Check for latency spikes across all models
   */
  checkLatencySpikes() {
    for (const [modelId, times] of this.modelResponseTimes) {
      if (times.length === 0) continue;
      
      // Calculate p95 and average
      const sorted = [...times].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      
      const health = this.modelHealth.get(modelId) || this.createDefaultHealth();
      
      // CRITICAL: p95 > 15s — model is a "ghost" (alive but unusably slow)
      if (p95 > this.latencyWatchdog.criticalThreshold) {
        console.log(`[HEARTBEAT] 🐌 LATENCY CRITICAL: ${modelId} p95=${p95.toFixed(0)}ms > ${this.latencyWatchdog.criticalThreshold}ms`);
        health.status = 'latency_critical';
        health.latencySpike = { p95, avg, timestamp: Date.now() };
        this.emit('model_latency_critical', { 
          modelId, 
          p95, 
          avg, 
          threshold: this.latencyWatchdog.criticalThreshold,
          samples: times.length 
        });
        // Trigger recovery for ghost models
        this.recoverModel(modelId);
      }
      // DEGRADED: p95 > 5s — model is struggling
      else if (p95 > this.latencyWatchdog.threshold) {
        console.log(`[HEARTBEAT] ⚠️ LATENCY DEGRADED: ${modelId} p95=${p95.toFixed(0)}ms > ${this.latencyWatchdog.threshold}ms`);
        if (health.status === 'healthy') {
          health.status = 'latency_degraded';
        }
        health.latencySpike = { p95, avg, timestamp: Date.now() };
        this.emit('model_latency_degraded', { 
          modelId, 
          p95, 
          avg, 
          threshold: this.latencyWatchdog.threshold 
        });
      }
      // RECOVERY: latency back to normal
      else if (health.status === 'latency_degraded' && p95 < this.latencyWatchdog.threshold * 0.8) {
        console.log(`[HEARTBEAT] ✅ LATENCY RECOVERED: ${modelId} p95=${p95.toFixed(0)}ms`);
        health.status = 'healthy';
        delete health.latencySpike;
        this.emit('model_latency_recovered', { modelId, p95, avg });
      }
      
      this.modelHealth.set(modelId, health);
    }
  }

  /**
   * Calculate ETA for recovery
   */
  calculateETA(modelId, health) {
    const baseRecovery = 5000; // 5 seconds base
    const recoveryMultiplier = Math.min(health.recoveryAttempts, 5);
    return baseRecovery * (recoveryMultiplier + 1);
  }

  /**
   * Recover a hung or failed model
   */
  async recoverModel(modelId) {
    const health = this.modelHealth.get(modelId);
    if (!health) return;
    
    health.recoveryAttempts++;
    console.log(`[HEARTBEAT] 🔄 Recovering model ${modelId} (attempt ${health.recoveryAttempts})`);
    
    // Notify pending users with ETA
    const pending = this.pendingRequests.get(modelId);
    if (pending && !pending.notified) {
      const eta = this.calculateETA(modelId, health);
      
      this.emit('user_notification', {
        userId: pending.userId,
        type: 'model_recovery',
        message: `Your request is taking longer than expected. We're restarting the AI engine. ETA: ${Math.ceil(eta / 1000)} seconds.`,
        eta: eta,
        modelId,
        requestId: pending.requestId
      });
      
      pending.notified = true;
    }
    
    // Attempt recovery via adapter
    try {
      await this.adapter.handleHungModel(modelId);
      
      health.status = 'recovering';
      health.consecutiveFailures = 0;
      
      // Verify recovery with a ping
      setTimeout(async () => {
        const pingSuccess = await this.pingModel(modelId);
        if (pingSuccess) {
          health.status = 'healthy';
          health.recoveryAttempts = 0;
          console.log(`[HEARTBEAT] ✅ Model ${modelId} recovered successfully`);
          this.emit('model_recovered', { modelId });
        } else {
          health.status = 'failed';
          console.log(`[HEARTBEAT] ❌ Model ${modelId} recovery failed`);
          this.emit('model_recovery_failed', { modelId });
        }
      }, 3000);
      
    } catch (error) {
      console.error(`[HEARTBEAT] ❌ Recovery error for ${modelId}:`, error.message);
      health.status = 'failed';
      this.emit('model_recovery_failed', { modelId, error: error.message });
    }
    
    this.modelHealth.set(modelId, health);
  }

  /**
   * Ping a model to verify it's responsive
   */
  async pingModel(modelId) {
    try {
      const model = this.adapter.models.get(modelId);
      if (!model || !model.loaded) return false;
      
      // Simple ping based on model type
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

  /**
   * Ping an LLM model
   */
  async pingLLM(modelId) {
    try {
      // Send a simple test prompt
      const result = await this.adapter.executeDirect(modelId, { 
        prompt: 'ping',
        maxTokens: 10 
      });
      return !!result;
    } catch {
      return false;
    }
  }

  /**
   * Ping a classifier model
   */
  async pingClassifier(modelId) {
    try {
      const result = await this.adapter.executeDirect(modelId, { 
        text: 'test' 
      });
      return !!result && result.confidence !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Ping a custom model
   */
  async pingCustom(modelId) {
    try {
      const result = await this.adapter.executeDirect(modelId, { 
        test: true 
      });
      return !!result;
    } catch {
      return false;
    }
  }

  /**
   * Get cached result if available
   */
  getCachedResult(serviceId, inputHash) {
    const cacheKey = `${serviceId}:${inputHash}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      console.log(`[HEARTBEAT] 💾 Cache hit for ${cacheKey}`);
      this.emit('cache_hit', { serviceId, inputHash, age: Date.now() - cached.timestamp });
      return cached.result;
    }
    
    return null;
  }

  /**
   * Store result in cache
   */
  setCachedResult(serviceId, inputHash, result) {
    const cacheKey = `${serviceId}:${inputHash}`;
    
    this.cache.set(cacheKey, {
      result,
      timestamp: Date.now(),
      hitCount: 0
    });
    
    console.log(`[HEARTBEAT] 💾 Cached result for ${cacheKey}`);
  }

  /**
   * Generate hash for cache key from input
   */
  hashInput(input) {
    const crypto = require('crypto');
    const str = JSON.stringify(input);
    return crypto.createHash('md5').update(str).digest('hex');
  }

  /**
   * Clean up expired cache entries
   */
  startCacheCleanup() {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      
      for (const [key, entry] of this.cache) {
        if (now - entry.timestamp > this.cacheTTL) {
          this.cache.delete(key);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        console.log(`[HEARTBEAT] 🧹 Cleaned ${cleaned} expired cache entries`);
      }
    }, 60 * 60 * 1000); // Every hour
  }

  /**
   * Get health report for all models
   */
  getHealthReport() {
    const report = {
      timestamp: new Date().toISOString(),
      models: {},
      summary: {
        total: 0,
        healthy: 0,
        degraded: 0,
        critical: 0,
        hung: 0,
        recovering: 0,
        failed: 0
      },
      cache: {
        entries: this.cache.size,
        hitRate: this.calculateCacheHitRate()
      }
    };
    
    for (const [modelId, health] of this.modelHealth) {
      report.models[modelId] = { ...health };
      report.summary.total++;
      report.summary[health.status] = (report.summary[health.status] || 0) + 1;
    }
    
    return report;
  }

  /**
   * Calculate cache hit rate
   */
  calculateCacheHitRate() {
    let hits = 0;
    let total = 0;
    
    for (const entry of this.cache.values()) {
      total++;
      if (entry.hitCount > 0) hits++;
    }
    
    return total > 0 ? (hits / total) * 100 : 0;
  }

  /**
   * Create default health record
   */
  createDefaultHealth() {
    return {
      status: 'unknown',
      lastResponse: null,
      consecutiveFailures: 0,
      totalRequests: 0,
      successfulRequests: 0,
      averageResponseTime: 0,
      lastFailure: null,
      recoveryAttempts: 0
    };
  }

  /**
   * Stop heartbeat
   */
  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      console.log('[HEARTBEAT] Stopped');
    }
  }
}

module.exports = UrsulaHeartbeat;
