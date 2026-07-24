'use strict';

const { randomUUID } = require('crypto');

/**
 * ModelProfile stores a continuously updated performance profile for a single model.
 *
 * It tracks size, VRAM requirements, latency, throughput, memory fragmentation,
 * startup time, and placement history. Profiles are used by the placement engine
 * to choose the best GPU and runtime for each request.
 */
class ModelProfile {
  constructor(modelName, config = {}) {
    if (!modelName) throw new Error('modelName is required');
    this.id = `profile_${randomUUID()}`;
    this.modelName = modelName;
    this.config = {
      historyMax: config.historyMax || 100,
      smoothing: config.smoothing || 0.3,
      ...config,
    };

    // Static metadata (populated by adapters or manual input)
    this.sizeBytes = 0;
    this.parameterCount = 0;
    this.quantization = null;
    this.contextSize = 4096;
    this.runtimeHints = []; // e.g. ['ollama', 'vllm']

    // Rolling estimates
    this.tokensPerSecond = 0;
    this.latencyMs = 0;        // end-to-end latency
    this.timeToFirstTokenMs = 0;
    this.startupTimeMs = 0;
    this.peakVramBytes = 0;
    this.averageVramBytes = 0;
    this.memoryFragmentation = 0;
    this.averageResponseTimeMs = 0;
    this.peakThroughput = 0;

    // Placement history for learning
    this.placements = [];
    this.successfulPlacements = 0;
    this.failedPlacements = 0;
    this.energyEfficiency = 0; // tokens per watt (optional)
  }

  /**
   * Update profile after an observed inference run.
   */
  recordRun(metrics) {
    const s = this.config.smoothing;
    if (metrics.tokensPerSecond !== undefined) {
      this.tokensPerSecond = this.ewma(this.tokensPerSecond, metrics.tokensPerSecond, s);
    }
    if (metrics.latencyMs !== undefined) {
      this.latencyMs = this.ewma(this.latencyMs, metrics.latencyMs, s);
    }
    if (metrics.timeToFirstTokenMs !== undefined) {
      this.timeToFirstTokenMs = this.ewma(this.timeToFirstTokenMs, metrics.timeToFirstTokenMs, s);
    }
    if (metrics.peakVramBytes !== undefined) {
      this.peakVramBytes = Math.max(this.peakVramBytes, metrics.peakVramBytes);
      this.averageVramBytes = this.ewma(this.averageVramBytes, metrics.peakVramBytes, s);
    }
    if (metrics.startupTimeMs !== undefined) {
      this.startupTimeMs = this.ewma(this.startupTimeMs, metrics.startupTimeMs, s);
    }
    if (metrics.energyEfficiency !== undefined) {
      this.energyEfficiency = this.ewma(this.energyEfficiency, metrics.energyEfficiency, s);
    }

    this.averageResponseTimeMs = this.latencyMs;
    this.peakThroughput = Math.max(this.peakThroughput, metrics.tokensPerSecond || 0);
  }

  /**
   * Record a placement attempt (successful or failed) for learning.
   */
  recordPlacement(placement) {
    this.placements.unshift({
      id: `placement_${randomUUID()}`,
      gpuIndex: placement.gpuIndex,
      runtime: placement.runtime,
      success: placement.success,
      latencyMs: placement.latencyMs,
      vramBytes: placement.vramBytes,
      timestamp: Date.now(),
    });
    if (this.placements.length > this.config.historyMax) this.placements.pop();

    if (placement.success) this.successfulPlacements += 1;
    else this.failedPlacements += 1;

    if (placement.latencyMs !== undefined) {
      this.recordRun({ latencyMs: placement.latencyMs, peakVramBytes: placement.vramBytes });
    }
  }

  ewma(current, value, smoothing) {
    if (current === 0 || value === 0) return value || current;
    return smoothing * value + (1 - smoothing) * current;
  }

  /**
   * Estimated VRAM requirement given a context size and batch size.
   */
  estimateMemory(contextSize = this.contextSize, batchSize = 1) {
    const bytesPerWeight = this.parameterCount > 0 && this.quantization
      ? (this.parameterCount * this.quantization) / 8
      : this.sizeBytes;
    const kvCacheBytes = contextSize * batchSize * 1024;
    const activationBytes = bytesPerWeight * 0.2;
    return Math.round(bytesPerWeight + kvCacheBytes + activationBytes);
  }

  toJSON() {
    return {
      id: this.id,
      modelName: this.modelName,
      sizeBytes: this.sizeBytes,
      parameterCount: this.parameterCount,
      quantization: this.quantization,
      contextSize: this.contextSize,
      runtimeHints: this.runtimeHints,
      tokensPerSecond: this.tokensPerSecond,
      latencyMs: this.latencyMs,
      timeToFirstTokenMs: this.timeToFirstTokenMs,
      startupTimeMs: this.startupTimeMs,
      peakVramBytes: this.peakVramBytes,
      averageVramBytes: this.averageVramBytes,
      memoryFragmentation: this.memoryFragmentation,
      averageResponseTimeMs: this.averageResponseTimeMs,
      peakThroughput: this.peakThroughput,
      successfulPlacements: this.successfulPlacements,
      failedPlacements: this.failedPlacements,
      placements: this.placements,
      energyEfficiency: this.energyEfficiency,
    };
  }

  static fromJSON(data) {
    const profile = new ModelProfile(data.modelName, { historyMax: data.historyMax, smoothing: data.smoothing });
    Object.assign(profile, data);
    return profile;
  }
}

module.exports = ModelProfile;
