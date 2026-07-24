'use strict';

const LoadBalancer = require('./LoadBalancer');
const ModelProfile = require('./ModelProfile');

/**
 * ModelPlacementEngine determines the best GPU and runtime for every inference
 * request. It maintains a registry of model profiles and uses a configurable
 * load-balancing strategy.
 */
class ModelPlacementEngine {
  constructor(config = {}) {
    this.config = {
      strategy: config.strategy || 'weighted',
      fallbackStrategy: config.fallbackStrategy || 'least-loaded',
      ...config,
    };
    this.profiles = new Map();
    this.balancer = new LoadBalancer(this.config.strategy);
  }

  /**
   * Register or update a model profile.
   */
  registerProfile(modelName, metadata = {}) {
    let profile = this.profiles.get(modelName);
    if (!profile) {
      profile = new ModelProfile(modelName, this.config.profileConfig);
      this.profiles.set(modelName, profile);
    }
    if (metadata.sizeBytes !== undefined) profile.sizeBytes = metadata.sizeBytes;
    if (metadata.parameterCount !== undefined) profile.parameterCount = metadata.parameterCount;
    if (metadata.quantization !== undefined) profile.quantization = metadata.quantization;
    if (metadata.contextSize !== undefined) profile.contextSize = metadata.contextSize;
    if (metadata.runtimeHints !== undefined) profile.runtimeHints = metadata.runtimeHints;
    return profile;
  }

  getProfile(modelName) {
    return this.profiles.get(modelName);
  }

  /**
   * Choose the best runtime and GPU for a job.
   *
   * Returns { runtime, gpu, profile, vramEstimateBytes } or null if impossible.
   */
  async choosePlacement({ model, prompt: _prompt, messages: _messages, runtime, options = {} }, gpus, runtimes) {
    const profile = this.registerProfile(model);

    // 1. Choose runtime.
    const selectedRuntime = await this.selectRuntime(runtime, profile, runtimes);
    if (!selectedRuntime) return null;

    // 2. Estimate VRAM.
    const vramEstimateBytes = await this.estimateVram(selectedRuntime, profile, runtimes, options);

    // 3. Filter healthy GPUs that can fit the job.
    const healthyGpus = gpus.filter((g) => g.isHealthy && (g.cudaCapable || g.isFallback));

    // 4. Rank GPUs by strategy.
    const ranked = this.balancer.rank(healthyGpus, {
      model,
      vramBytes: vramEstimateBytes,
      contextSize: options.num_ctx || profile.contextSize,
      batchSize: options.batchSize || 1,
      weights: options.weights,
    }, profile);

    const chosen = ranked[0];
    if (!chosen) return null;

    // If a real GPU cannot fit the model, only fall back to CPU as a last resort.
    const free = (chosen.vramFreeBytes || chosen.vramBytes || 0) - chosen.allocatedVramBytes;
    if (!chosen.isFallback && free < vramEstimateBytes) {
      const cpuFallback = gpus.find((g) => g.isFallback && g.isHealthy);
      if (cpuFallback) return { runtime: selectedRuntime, gpu: cpuFallback, profile, vramEstimateBytes };
      return null;
    }

    return { runtime: selectedRuntime, gpu: chosen, profile, vramEstimateBytes };
  }

  /**
   * Pick the best available runtime for a model.
   */
  async selectRuntime(preferred, profile, runtimes) {
    const candidates = [];
    if (preferred && runtimes.has(preferred)) candidates.push(preferred);
    if (profile.runtimeHints && profile.runtimeHints.length > 0) {
      for (const hint of profile.runtimeHints) {
        if (runtimes.has(hint) && !candidates.includes(hint)) candidates.push(hint);
      }
    }
    for (const name of runtimes.keys()) {
      if (!candidates.includes(name)) candidates.push(name);
    }

    for (const name of candidates) {
      const runtime = runtimes.get(name);
      if (!runtime || !runtime.health) continue;
      const health = await runtime.health().catch(() => ({ available: false }));
      if (health.available) return name;
    }
    return null;
  }

  async estimateVram(runtimeName, profile, runtimes, options = {}) {
    const contextSize = options.num_ctx || profile.contextSize || 4096;
    const batchSize = options.batchSize || 1;
    const profileEstimate = profile.estimateMemory(contextSize, batchSize);
    const runtime = runtimes.get(runtimeName);
    if (runtime && runtime.estimateMemory) {
      try {
        const runtimeEstimate = await runtime.estimateMemory(profile.modelName, profile.quantization, profile.sizeBytes);
        return Math.max(runtimeEstimate || 0, profileEstimate);
      } catch {
        // fall through
      }
    }
    return profileEstimate;
  }

  /**
   * Record the outcome of a placement so the engine learns.
   */
  recordOutcome(modelName, outcome) {
    const profile = this.profiles.get(modelName);
    if (!profile) return;
    profile.recordPlacement(outcome);
  }

  setStrategy(strategy) {
    this.balancer.setStrategy(strategy);
  }

  listStrategies() {
    return this.balancer.listStrategies();
  }

  exportProfiles() {
    return Array.from(this.profiles.values()).map((p) => p.toJSON());
  }

  importProfiles(data) {
    for (const item of data) {
      const profile = ModelProfile.fromJSON(item);
      this.profiles.set(profile.modelName, profile);
    }
  }
}

module.exports = ModelPlacementEngine;
