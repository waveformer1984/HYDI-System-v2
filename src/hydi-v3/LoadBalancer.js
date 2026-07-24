'use strict';

/**
 * LoadBalancer implements scheduling strategies for the CUDA pool.
 *
 * Strategies are pure functions: (gpus, job, profile) => ranked gpu list.
 */
class LoadBalancer {
  constructor(strategy = 'least-loaded') {
    this.strategy = strategy;
    this.strategies = {
      'weighted': this.weighted.bind(this),
      'least-loaded': this.leastLoaded.bind(this),
      'shortest-job': this.shortestJob.bind(this),
      'vram-aware': this.vramAware.bind(this),
      'thermal-aware': this.thermalAware.bind(this),
      'latency-aware': this.latencyAware.bind(this),
    };
  }

  rank(gpus, job = {}, profile = null) {
    const fn = this.strategies[this.strategy] || this.leastLoaded;
    return fn(gpus, job, profile);
  }

  /**
   * Weighted: combine VRAM headroom, utilization, temperature, and latency weight.
   */
  weighted(gpus, job, profile) {
    const weights = job.weights || { vram: 0.4, utilization: 0.25, temperature: 0.2, latency: 0.15 };
    const vramNeed = job.vramBytes || profile?.estimateMemory(job.contextSize, job.batchSize) || 0;
    return [...gpus].sort((a, b) => {
      if (a.isFallback && !b.isFallback) return 1;
      if (!a.isFallback && b.isFallback) return -1;
      const score = (g) => {
        const free = Math.max(0, (g.vramFreeBytes || g.vramBytes || 0) - g.allocatedVramBytes - vramNeed);
        const vramScore = weights.vram * (free / Math.max(1, g.vramBytes || 1));
        const utilScore = weights.utilization * (1 - (g.utilizationGpu || 0) / 100);
        const tempScore = weights.temperature * (1 - Math.min((g.temperatureC || 0), 100) / 100);
        const latencyScore = weights.latency * (1 / Math.max(1, g.latencyMs || profile?.latencyMs || 100));
        return vramScore + utilScore + tempScore + latencyScore;
      };
      return score(b) - score(a);
    });
  }

  /**
   * Least-loaded: prefer the GPU with the lowest utilization + allocated VRAM ratio.
   */
  leastLoaded(gpus, _job, _profile) {
    return [...gpus].sort((a, b) => {
      if (a.isFallback && !b.isFallback) return 1;
      if (!a.isFallback && b.isFallback) return -1;
      const load = (g) => (g.utilizationGpu || 0) + ((g.allocatedVramBytes / Math.max(1, g.vramBytes || 1)) * 100);
      return load(a) - load(b);
    });
  }

  /**
   * Shortest-job: prefer GPUs that historically finish this model fastest.
   */
  shortestJob(gpus, job, profile) {
    const history = this.buildPlacementHistoryMap(profile);
    return [...gpus].sort((a, b) => {
      if (a.isFallback && !b.isFallback) return 1;
      if (!a.isFallback && b.isFallback) return -1;
      const aLatency = history.get(a.index) || profile?.latencyMs || Infinity;
      const bLatency = history.get(b.index) || profile?.latencyMs || Infinity;
      return aLatency - bLatency;
    });
  }

  /**
   * VRAM-aware: prefer GPUs with enough free memory first, then by headroom.
   */
  vramAware(gpus, job, profile) {
    const vramNeed = job.vramBytes || profile?.estimateMemory(job.contextSize, job.batchSize) || 0;
    return [...gpus].sort((a, b) => {
      if (a.isFallback && !b.isFallback) return 1;
      if (!a.isFallback && b.isFallback) return -1;
      const aFree = (a.vramFreeBytes || a.vramBytes || 0) - a.allocatedVramBytes - vramNeed;
      const bFree = (b.vramFreeBytes || b.vramBytes || 0) - b.allocatedVramBytes - vramNeed;
      if (aFree >= 0 && bFree < 0) return -1;
      if (bFree >= 0 && aFree < 0) return 1;
      return bFree - aFree;
    });
  }

  /**
   * Thermal-aware: prefer coolest GPUs, with enough VRAM.
   */
  thermalAware(gpus, job, profile) {
    const vramNeed = job.vramBytes || profile?.estimateMemory(job.contextSize, job.batchSize) || 0;
    return [...gpus].sort((a, b) => {
      if (a.isFallback && !b.isFallback) return 1;
      if (!a.isFallback && b.isFallback) return -1;
      const aFits = ((a.vramFreeBytes || a.vramBytes || 0) - a.allocatedVramBytes) >= vramNeed;
      const bFits = ((b.vramFreeBytes || b.vramBytes || 0) - b.allocatedVramBytes) >= vramNeed;
      if (aFits && !bFits) return -1;
      if (bFits && !aFits) return 1;
      return (a.temperatureC || 0) - (b.temperatureC || 0);
    });
  }

  /**
   * Latency-aware: prefer GPUs with lowest expected latency for this model.
   */
  latencyAware(gpus, job, profile) {
    const history = this.buildPlacementHistoryMap(profile);
    return [...gpus].sort((a, b) => {
      if (a.isFallback && !b.isFallback) return 1;
      if (!a.isFallback && b.isFallback) return -1;
      const aLatency = history.get(a.index) ?? (profile?.latencyMs || 0);
      const bLatency = history.get(b.index) ?? (profile?.latencyMs || 0);
      return aLatency - bLatency;
    });
  }

  buildPlacementHistoryMap(profile) {
    const map = new Map();
    if (!profile || !Array.isArray(profile.placements)) return map;
    for (const p of profile.placements) {
      if (p.success && p.latencyMs !== undefined) {
        const existing = map.get(p.gpuIndex);
        if (existing === undefined || p.latencyMs < existing) {
          map.set(p.gpuIndex, p.latencyMs);
        }
      }
    }
    return map;
  }

  setStrategy(name) {
    if (!this.strategies[name]) throw new Error(`Unknown strategy: ${name}`);
    this.strategy = name;
  }

  listStrategies() {
    return Object.keys(this.strategies);
  }
}

module.exports = LoadBalancer;
