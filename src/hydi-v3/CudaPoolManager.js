'use strict';

const { EventEmitter } = require('events');
const HardwareDiscovery = require('./HardwareDiscovery');
const OllamaAdapter = require('./OllamaAdapter');
const ModelPlacementEngine = require('./ModelPlacementEngine');
const { randomUUID } = require('crypto');

/**
 * CudaPoolManager unifies GPU allocation, job scheduling, runtime adapters,
 * thermal protection, and health monitoring into one local execution pool.
 *
 * It is designed to operate with zero CUDA hardware: it falls back to a
 * virtual CPU device and routes inference through available local runtimes.
 */
class CudaPoolManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataPath: config.dataPath || './data/cuda-pool',
      pollIntervalMs: config.pollIntervalMs || 5000,
      thermalLimitC: config.thermalLimitC || 85,
      vramHeadroom: config.vramHeadroom || 0.15,
      maxQueueDepth: config.maxQueueDepth || 256,
      ...config,
    };

    this.hardware = new HardwareDiscovery(config.hardwareDiscovery);
    this.placementEngine = new ModelPlacementEngine({
      strategy: config.strategy || 'weighted',
      profileConfig: config.profileConfig,
    });
    this.gpus = [];
    this.runtimes = new Map();
    this.allocations = new Map();
    this.queue = [];
    this.activeJobs = new Map();
    this.jobCounter = 0;
    this.pollTimer = null;
    this.healthy = true;
    this.metrics = this.createMetrics();

    // Always register Ollama as a default runtime.
    this.registerRuntime(new OllamaAdapter(config.ollama));
  }

  createMetrics() {
    return {
      jobsSubmitted: 0,
      jobsCompleted: 0,
      jobsFailed: 0,
      jobsQueued: 0,
      totalLatencyMs: 0,
      failedAllocations: 0,
      lastBalanceAt: null,
    };
  }

  /**
   * Initialize the pool: detect hardware, create a CPU fallback, start polling.
   */
  async initialize() {
    const inventory = await this.hardware.detect();
    this.gpus = inventory.gpus.filter((g) => g.cudaCapable).map((g) => ({
      ...g,
      allocatedVramBytes: 0,
      allocationIds: new Set(),
      lastHealthCheck: Date.now(),
    }));

    // Ensure there is always a fallback compute target.
    if (this.gpus.length === 0) {
      this.gpus.push(this.createCpuFallback());
    }

    for (const runtime of this.runtimes.values()) {
      const health = await runtime.health();
      this.emit('runtime_health', health);
    }

    this.startPolling();
    this.emit('initialized', { gpuCount: this.gpus.length });
  }

  createCpuFallback() {
    return {
      index: -1,
      name: 'CPU_FALLBACK',
      vendor: 'Generic',
      cudaCapable: false,
      vramBytes: Number.MAX_SAFE_INTEGER,
      vramFreeBytes: Number.MAX_SAFE_INTEGER,
      vramUsedBytes: 0,
      allocatedVramBytes: 0,
      allocationIds: new Set(),
      utilizationGpu: 0,
      temperatureC: 0,
      isHealthy: true,
      isFallback: true,
    };
  }

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.poll(), this.config.pollIntervalMs);
    if (this.pollTimer.unref) this.pollTimer.unref();
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Register a runtime adapter (Ollama, OpenVINO, ONNX, etc.).
   */
  registerRuntime(adapter) {
    if (!adapter || !adapter.name) throw new Error('Runtime adapter must have a name');
    this.runtimes.set(adapter.name, adapter);
    return adapter.name;
  }

  /**
   * Estimate VRAM bytes for a job.
   */
  estimateMemory({ modelSizeBytes = 0, parameterBillions = 0, quantizationBits = 4, contextSize = 4096, batchSize = 1, includeHeadroom = true }) {
    const bytesPerWeight = parameterBillions > 0
      ? (parameterBillions * 1_000_000_000 * quantizationBits) / 8
      : modelSizeBytes;

    // KV cache: roughly 2 bytes per token per layer. We approximate with 1MB per 1K context tokens.
    const kvCacheBytes = contextSize * batchSize * 1024;
    const activationBytes = bytesPerWeight * 0.2;
    let estimate = bytesPerWeight + kvCacheBytes + activationBytes;
    if (includeHeadroom) estimate *= 1.0 + this.config.vramHeadroom;
    return Math.max(1, Math.round(estimate));
  }

  /**
   * Allocate a GPU/CPU device for a task.
   */
  allocateGPU({ vramBytes = 0, preferredRuntime = null, durationHintMs = 60000, gpuIndex = null }) {
    let candidates;
    if (gpuIndex !== null && gpuIndex !== undefined) {
      const selected = this.gpus.find((g) => g.index === gpuIndex && g.isHealthy);
      candidates = selected ? [selected] : [];
    } else {
      candidates = this.gpus.filter((g) => g.isHealthy && (g.isFallback || g.cudaCapable));

      // Score: prefer free VRAM headroom, then low utilization, then low temperature.
      candidates.sort((a, b) => {
        if (a.isFallback && !b.isFallback) return 1;
        if (!a.isFallback && b.isFallback) return -1;
        const aFree = a.vramFreeBytes - a.allocatedVramBytes;
        const bFree = b.vramFreeBytes - b.allocatedVramBytes;
        if (vramBytes > 0 && aFree >= vramBytes && bFree < vramBytes) return -1;
        if (vramBytes > 0 && bFree >= vramBytes && aFree < vramBytes) return 1;
        const aLoad = a.utilizationGpu + a.temperatureC * 0.1;
        const bLoad = b.utilizationGpu + b.temperatureC * 0.1;
        return aLoad - bLoad;
      });
    }

    const chosen = candidates[0];
    if (!chosen || (!chosen.isFallback && vramBytes > 0 && chosen.vramFreeBytes - chosen.allocatedVramBytes < vramBytes)) {
      this.metrics.failedAllocations += 1;
      return null;
    }

    const allocationId = `alloc_${randomUUID()}`;
    chosen.allocatedVramBytes += vramBytes;
    chosen.allocationIds.add(allocationId);
    this.allocations.set(allocationId, {
      id: allocationId,
      gpuIndex: chosen.index,
      vramBytes,
      allocatedAt: Date.now(),
      expiresAt: Date.now() + Math.max(1000, durationHintMs),
      preferredRuntime,
    });

    this.emit('allocated', { allocationId, gpu: chosen, vramBytes });
    return { allocationId, gpu: chosen };
  }

  /**
   * Release a previous allocation.
   */
  releaseGPU(allocationId) {
    const alloc = this.allocations.get(allocationId);
    if (!alloc) return false;
    const gpu = this.gpus.find((g) => g.index === alloc.gpuIndex);
    if (gpu) {
      gpu.allocatedVramBytes = Math.max(0, gpu.allocatedVramBytes - alloc.vramBytes);
      gpu.allocationIds.delete(allocationId);
    }
    this.allocations.delete(allocationId);
    this.emit('released', { allocationId, gpuIndex: alloc.gpuIndex });
    return true;
  }

  /**
   * Submit an inference job to the pool.
   */
  scheduleInference(job) {
    if (!job || !job.model) throw new Error('job.model is required');
    if (this.queue.length >= this.config.maxQueueDepth) throw new Error('queue depth exceeded');

    this.jobCounter += 1;
    const id = `job_${this.jobCounter}_${randomUUID().slice(0, 8)}`;
    const wrapped = {
      id,
      model: job.model,
      prompt: job.prompt,
      messages: job.messages,
      options: job.options || {},
      runtime: job.runtime,
      priority: Number(job.priority) || 0,
      vramHint: Number(job.vramHint) || 0,
      submittedAt: Date.now(),
      status: 'queued',
    };

    this.queue.push(wrapped);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.metrics.jobsSubmitted += 1;
    this.metrics.jobsQueued += 1;

    this.emit('job_queued', { id });
    this.processQueue();
    return id;
  }

  /**
   * Process the inference queue. This is intentionally lightweight: jobs run
   * on the best available runtime while respecting GPU allocation limits.
   */
  async processQueue() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        this.metrics.jobsQueued = Math.max(0, this.metrics.jobsQueued - 1);
        await this.executeJob(job);
      }
    } finally {
      this.processing = false;
    }
  }

  async executeJob(job) {
    const start = Date.now();
    job.status = 'running';
    this.activeJobs.set(job.id, job);
    this.emit('job_started', { id: job.id });

    try {
      const placement = await this.placementEngine.choosePlacement(job, this.gpus, this.runtimes);
      if (!placement) throw new Error('No runtime or GPU available for job');

      const alloc = this.allocateGPU({
        vramBytes: placement.vramEstimateBytes,
        gpuIndex: placement.gpu.index,
        preferredRuntime: placement.runtime,
        durationHintMs: 120000,
      });
      if (alloc) job.allocationId = alloc.allocationId;

      const runtime = this.runtimes.get(placement.runtime);
      if (!runtime) throw new Error(`Runtime ${placement.runtime} not registered`);

      const response = await runtime.runInference({
        model: job.model,
        prompt: job.prompt,
        messages: job.messages,
        options: job.options,
      });

      const latency = Date.now() - start;
      this.metrics.jobsCompleted += 1;
      this.metrics.totalLatencyMs += latency;
      job.status = 'completed';
      job.completedAt = Date.now();
      job.latencyMs = latency;
      job.result = response;

      this.placementEngine.recordOutcome(job.model, {
        gpuIndex: placement.gpu.index,
        runtime: placement.runtime,
        success: true,
        latencyMs: latency,
        vramBytes: placement.vramEstimateBytes,
      });

      this.emit('job_completed', { id: job.id, latencyMs: latency, runtime: placement.runtime, gpu: placement.gpu });
      return response;
    } catch (err) {
      this.metrics.jobsFailed += 1;
      job.status = 'failed';
      job.error = err.message;
      this.emit('job_failed', { id: job.id, error: err.message });
      throw err;
    } finally {
      this.activeJobs.delete(job.id);
      if (job.allocationId) this.releaseGPU(job.allocationId);
    }
  }

  /**
   * Access the placement engine for profile management and strategy tuning.
   */
  getPlacementEngine() {
    return this.placementEngine;
  }

  /**
   * Rebalance work across GPUs. For now this refreshes discovery and emits stats.
   */
  async balanceLoad() {
    const inventory = await this.hardware.detect();
    const fresh = inventory.gpus.filter((g) => g.cudaCapable);

    // Merge live metrics into pool state without losing allocations.
    for (const gpu of this.gpus) {
      if (gpu.isFallback) continue;
      const live = fresh.find((f) => f.index === gpu.index);
      if (live) {
        gpu.vramFreeBytes = live.vramFreeBytes;
        gpu.vramUsedBytes = live.vramUsedBytes;
        gpu.utilizationGpu = live.utilizationGpu;
        gpu.temperatureC = live.temperatureC;
        gpu.isHealthy = live.isHealthy;
      }
    }

    this.metrics.lastBalanceAt = Date.now();
    this.emit('load_balanced', { gpuCount: this.gpus.length, activeJobs: this.activeJobs.size });
  }

  /**
   * Health and status of the entire pool.
   */
  healthStatus() {
    const issues = [];
    if (this.gpus.every((g) => !g.isHealthy)) issues.push('no_healthy_gpu');
    if (this.queue.length > this.config.maxQueueDepth * 0.8) issues.push('queue_congested');
    if (this.metrics.failedAllocations > 5) issues.push('allocation_pressure');

    const runtimes = Array.from(this.runtimes.entries()).map(([name, runtime]) => ({
      name,
      lastError: runtime.lastError,
    }));

    return {
      healthy: issues.length === 0,
      issues,
      gpuCount: this.gpus.length,
      gpus: this.gpus.map((g) => ({
        index: g.index,
        name: g.name,
        isHealthy: g.isHealthy,
        vramBytes: g.vramBytes,
        vramFreeBytes: g.vramFreeBytes,
        allocatedVramBytes: g.allocatedVramBytes,
        utilizationGpu: g.utilizationGpu,
        temperatureC: g.temperatureC,
      })),
      runtimes,
      queueDepth: this.queue.length,
      activeJobCount: this.activeJobs.size,
      metrics: { ...this.metrics },
    };
  }

  getStats() {
    return this.healthStatus();
  }

  async poll() {
    try {
      await this.balanceLoad();
      this.cleanExpiredAllocations();
      this.emit('polled', { at: Date.now() });
    } catch (err) {
      this.emit('poll_error', err);
    }
  }

  cleanExpiredAllocations() {
    const now = Date.now();
    for (const [id, alloc] of this.allocations) {
      if (now > alloc.expiresAt) this.releaseGPU(id);
    }
  }

  async shutdown() {
    this.stopPolling();
    for (const id of Array.from(this.allocations.keys())) this.releaseGPU(id);
    this.activeJobs.clear();
    this.queue = [];
    this.emit('shutdown');
  }
  
  /**
   * Idempotent full teardown
   */
  async destroy() {
    await this.shutdown();
    this.allocations.clear();
    this.runtimes.clear();
    this.gpus = [];
    this.removeAllListeners();
  }
}

module.exports = CudaPoolManager;
